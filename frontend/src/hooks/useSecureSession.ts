/**
 * QuantumShield - Secure Session Hook
 *
 * Manages the full lifecycle:
 *  1. WebSocket connection to the backend relay
 *  2. Classical or hybrid handshake (X25519 / X25519+ML-KEM-768)
 *  3. AES-256-GCM message encryption/decryption
 *  4. Replay protection (seen message ID set)
 *  5. Session state and error reporting
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  generateX25519KeyPair, x25519SharedSecret,
  generateMLKEMKeyPair, mlkemEncapsulate, mlkemDecapsulate,
  deriveSessionKey, encryptMessage, decryptMessage,
  bytesToBase64, base64ToBytes, bytesToHex,
  fingerprintKey, KEY_SIZES,
} from '@/crypto/hybrid';
import { createWebSocket } from '@/services/api';
import type {
  CryptoMode, HandshakeState, SessionState, ChatMessage,
  RoomState, MessageMeta, EncryptedPayload,
} from '@/types';

// --- Build AAD ----------------------------------------------------------------

function buildAAD(meta: Omit<MessageMeta, 'encryptDurationMs' | 'decryptDurationMs' | 'authVerified'>): Uint8Array {
  const str = JSON.stringify({
    messageId: meta.messageId,
    sessionId: meta.sessionId,
    senderId: meta.senderId,
    sequenceNumber: meta.sequenceNumber,
    algorithm: meta.algorithm,
    timestamp: meta.timestamp,
  });
  return new TextEncoder().encode(str);
}

// --- Hook ---------------------------------------------------------------------

export function useSecureSession() {
  const [roomState, setRoomState] = useState<RoomState>({
    role: 'unknown', participantCount: 0, connected: false,
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handshakeState, setHandshakeState] = useState<HandshakeState>('idle');

  const ws = useRef<WebSocket | null>(null);
  const sessionKeyBytes = useRef<Uint8Array | null>(null);
  const myX25519 = useRef<{ privateKey: Uint8Array; publicKey: Uint8Array } | null>(null);
  const myMLKEM = useRef<{ publicKey: Uint8Array; secretKey: Uint8Array } | null>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const sequenceCounter = useRef<number>(0);
  const sessionIdRef = useRef<string>('');
  const participantIdRef = useRef<string>('');
  const roleRef = useRef<'initiator' | 'responder' | 'unknown'>('unknown');
  const modeRef = useRef<CryptoMode>('classical');
  const handshakeStartRef = useRef<number>(0);
  const keyGenStartRef = useRef<number>(0);

  // --- Cleanup -------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    sessionKeyBytes.current = null;
    myX25519.current = null;
    myMLKEM.current = null;
    seenMessageIds.current.clear();
    sequenceCounter.current = 0;
    sessionIdRef.current = '';
    participantIdRef.current = '';
    roleRef.current = 'unknown';
    setMessages([]);
    setHandshakeState('idle');
    setSession(null);
    setRoomState({ role: 'unknown', participantCount: 0, connected: false });
  }, []);

  // --- Connect -------------------------------------------------------------

  const connect = useCallback(async (roomId: string, mode: CryptoMode) => {
    cleanup();
    modeRef.current = mode;
    const newSessionId = `${roomId}-${Date.now().toString(36)}`;
    sessionIdRef.current = newSessionId;

    setRoomState(prev => ({ ...prev, roomId, error: undefined }));

    const socket = createWebSocket(roomId);
    ws.current = socket;

    socket.onopen = () => {
      setRoomState(prev => ({ ...prev, roomId, connected: true }));
      socket.send(JSON.stringify({ type: 'set_crypto_mode', mode }));
    };

    socket.onclose = (ev) => {
      setRoomState(prev => ({ ...prev, connected: false, error: `Disconnected (${ev.code})` }));
    };

    socket.onerror = () => {
      setRoomState(prev => ({ ...prev, connected: false, error: 'WebSocket error' }));
    };

    socket.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        await handleServerMessage(msg);
      } catch (e) {
        console.error('[QS] WebSocket message error:', e);
      }
    };
  }, [cleanup]);

  // --- Server Message Handler -----------------------------------------------

  const handleServerMessage = useCallback(async (msg: Record<string, unknown>) => {
    const type = msg.type as string;

    switch (type) {
      case 'room_joined': {
        const pid = msg.participant_id as string;
        const role = msg.role as 'initiator' | 'responder';
        const pCount = msg.participant_count as number;
        participantIdRef.current = pid;
        roleRef.current = role;
        setRoomState(prev => ({
          ...prev,
          roomId: msg.room_id as string,
          participantId: pid,
          role,
          participantCount: pCount,
        }));
        setSession({
          sessionId: sessionIdRef.current,
          mode: modeRef.current,
          handshakeState: 'idle',
          messageCount: 0,
        });

        // Only initiator starts handshake if peer is already in room
        if (role === 'initiator' && pCount >= 2) {
          await initiateHandshake();
        }
        break;
      }

      case 'peer_joined': {
        setRoomState(prev => ({ ...prev, participantCount: msg.participant_count as number }));
        // Initiator starts handshake when peer joins
        if (roleRef.current === 'initiator') {
          await initiateHandshake();
        }
        break;
      }

      case 'peer_left': {
        setRoomState(prev => ({
          ...prev,
          participantCount: msg.participant_count as number,
          error: 'Peer disconnected',
        }));
        sessionKeyBytes.current = null;
        setHandshakeState('idle');
        break;
      }

      case 'handshake_offer': {
        await handleHandshakeOffer(msg);
        break;
      }

      case 'handshake_answer': {
        await handleHandshakeAnswer(msg);
        break;
      }

      case 'session_established': {
        // Both sides confirm
        setHandshakeState('complete');
        break;
      }

      case 'encrypted_message': {
        await handleIncomingMessage(msg);
        break;
      }

      case 'mode_accepted': {
        // Mode confirmed by server
        break;
      }

      case 'error': {
        console.error('[QS] Server error:', msg.message);
        setRoomState(prev => ({ ...prev, error: msg.message as string }));
        break;
      }
    }
  }, []);

  // --- Handshake Initiation -------------------------------------------------

  const initiateHandshake = useCallback(async () => {
    if (!ws.current) return;
    keyGenStartRef.current = performance.now();
    handshakeStartRef.current = performance.now();
    setHandshakeState('generating_keys');

    const x25519Keys = generateX25519KeyPair();
    myX25519.current = x25519Keys;

    let mlkemPublicKeyB64: string | undefined;
    let mlkemKeys = null;

    if (modeRef.current === 'hybrid') {
      mlkemKeys = generateMLKEMKeyPair();
      myMLKEM.current = mlkemKeys;
      mlkemPublicKeyB64 = bytesToBase64(mlkemKeys.publicKey);
    }

    const keyGenDurationMs = performance.now() - keyGenStartRef.current;
    setSession(prev => prev ? { ...prev, keyGenDurationMs, handshakeState: 'exchanging' } : prev);
    setHandshakeState('exchanging');

    ws.current.send(JSON.stringify({
      type: 'handshake_offer',
      sessionId: sessionIdRef.current,
      mode: modeRef.current,
      x25519PublicKey: bytesToBase64(x25519Keys.publicKey),
      mlkemPublicKey: mlkemPublicKeyB64,
      role: roleRef.current,
    }));
  }, []);

  // --- Handle Offer (peer sent offer to us) --------------------------------

  const handleHandshakeOffer = useCallback(async (msg: Record<string, unknown>) => {
    if (!ws.current) return;
    setHandshakeState('exchanging');

    if (msg.sessionId) {
      sessionIdRef.current = msg.sessionId as string;
    }

    const theirX25519PubKey = base64ToBytes(msg.x25519PublicKey as string);
    const mode = (msg.mode as CryptoMode) || modeRef.current;
    modeRef.current = mode;

    // Generate our own X25519 keys if not done yet
    if (!myX25519.current) {
      myX25519.current = generateX25519KeyPair();
    }

    // X25519 agreement
    const x25519SS = x25519SharedSecret(myX25519.current.privateKey, theirX25519PubKey);

    let mlkemCiphertextB64: string | undefined;
    let mlkemSS: Uint8Array | undefined;

    if (mode === 'hybrid' && msg.mlkemPublicKey) {
      const theirMLKEMPubKey = base64ToBytes(msg.mlkemPublicKey as string);
      const { ciphertext, sharedSecret } = mlkemEncapsulate(theirMLKEMPubKey);
      mlkemCiphertextB64 = bytesToBase64(ciphertext);
      mlkemSS = sharedSecret;
    }

    setHandshakeState('deriving');
    const { keyBytes, fingerprint } = await deriveSessionKey(
      x25519SS, sessionIdRef.current, mode, mlkemSS
    );
    sessionKeyBytes.current = keyBytes;

    const handshakeDurationMs = performance.now() - handshakeStartRef.current;

    setHandshakeState('complete');
    setSession(prev => prev ? {
      ...prev,
      handshakeState: 'complete',
      handshakeDurationMs,
      sessionKeyFingerprint: fingerprint,
      keySizes: {
        x25519PublicKey: KEY_SIZES.x25519.publicKey,
        mlkemPublicKey: mode === 'hybrid' ? KEY_SIZES.mlkem768.publicKey : undefined,
        mlkemCiphertext: mode === 'hybrid' ? KEY_SIZES.mlkem768.ciphertext : undefined,
        totalHandshakeBytes: mode === 'hybrid'
          ? KEY_SIZES.x25519.publicKey * 2 + KEY_SIZES.mlkem768.publicKey + KEY_SIZES.mlkem768.ciphertext
          : KEY_SIZES.x25519.publicKey * 2,
      },
    } : prev);

    // Send our answer
    ws.current.send(JSON.stringify({
      type: 'handshake_answer',
      sessionId: sessionIdRef.current,
      x25519PublicKey: bytesToBase64(myX25519.current.publicKey),
      mlkemCiphertext: mlkemCiphertextB64,
    }));

    // Tell server handshake is done
    ws.current.send(JSON.stringify({ type: 'handshake_done' }));
  }, []);

  // --- Handle Answer (peer responded to our offer) --------------------------

  const handleHandshakeAnswer = useCallback(async (msg: Record<string, unknown>) => {
    if (!myX25519.current) return;
    setHandshakeState('deriving');

    const theirX25519PubKey = base64ToBytes(msg.x25519PublicKey as string);
    const x25519SS = x25519SharedSecret(myX25519.current.privateKey, theirX25519PubKey);

    let mlkemSS: Uint8Array | undefined;

    if (modeRef.current === 'hybrid' && myMLKEM.current && msg.mlkemCiphertext) {
      const ct = base64ToBytes(msg.mlkemCiphertext as string);
      mlkemSS = mlkemDecapsulate(ct, myMLKEM.current.secretKey);
    }

    const { keyBytes, fingerprint } = await deriveSessionKey(
      x25519SS, sessionIdRef.current, modeRef.current, mlkemSS
    );
    sessionKeyBytes.current = keyBytes;

    const handshakeDurationMs = performance.now() - handshakeStartRef.current;

    setHandshakeState('complete');
    setSession(prev => prev ? {
      ...prev,
      handshakeState: 'complete',
      handshakeDurationMs,
      sessionKeyFingerprint: fingerprint,
      keySizes: {
        x25519PublicKey: KEY_SIZES.x25519.publicKey,
        mlkemPublicKey: modeRef.current === 'hybrid' ? KEY_SIZES.mlkem768.publicKey : undefined,
        mlkemCiphertext: modeRef.current === 'hybrid' ? KEY_SIZES.mlkem768.ciphertext : undefined,
        totalHandshakeBytes: modeRef.current === 'hybrid'
          ? KEY_SIZES.x25519.publicKey * 2 + KEY_SIZES.mlkem768.publicKey + KEY_SIZES.mlkem768.ciphertext
          : KEY_SIZES.x25519.publicKey * 2,
      },
    } : prev);

    // Tell server handshake is done
    ws.current?.send(JSON.stringify({ type: 'handshake_done' }));
  }, []);

  // --- Send Encrypted Message -----------------------------------------------

  const sendMessage = useCallback(async (plaintext: string): Promise<void> => {
    if (!sessionKeyBytes.current || !ws.current) {
      throw new Error('Session not established');
    }
    if (handshakeState !== 'complete') {
      throw new Error('Handshake not complete');
    }

    const messageId = crypto.randomUUID();
    if (seenMessageIds.current.has(messageId)) {
      throw new Error('Duplicate message ID — retry');
    }
    seenMessageIds.current.add(messageId);

    const seqNum = ++sequenceCounter.current;
    const now = Date.now();

    const meta: Omit<MessageMeta, 'encryptDurationMs' | 'decryptDurationMs' | 'authVerified'> = {
      messageId,
      sessionId: sessionIdRef.current,
      senderId: participantIdRef.current,
      sequenceNumber: seqNum,
      algorithm: `AES-256-GCM|${modeRef.current === 'hybrid' ? 'X25519+ML-KEM-768' : 'X25519'}`,
      timestamp: now,
    };

    const aad = buildAAD(meta);
    const { ciphertext, nonce, durationMs } = await encryptMessage(
      plaintext, sessionKeyBytes.current, aad
    );

    const chatMsg: ChatMessage = {
      id: messageId,
      sessionId: sessionIdRef.current,
      senderId: participantIdRef.current,
      senderRole: 'self',
      plaintext,
      encryptedPayload: { ciphertext, nonce },
      meta: { ...meta, encryptDurationMs: durationMs, authVerified: true },
      displayedAt: now,
      authVerified: true,
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);

    ws.current.send(JSON.stringify({
      type: 'encrypted_message',
      payload: { ciphertext, nonce },
      meta,
    }));
  }, [handshakeState]);

  // --- Handle Incoming Encrypted Message -----------------------------------

  const handleIncomingMessage = useCallback(async (msg: Record<string, unknown>) => {
    if (!sessionKeyBytes.current) return;

    const rawMeta = msg.meta as Omit<MessageMeta, 'encryptDurationMs' | 'decryptDurationMs' | 'authVerified'>;
    const payload = msg.payload as EncryptedPayload;

    // Replay protection
    if (seenMessageIds.current.has(rawMeta.messageId)) {
      console.warn('[QS] Replay detected, dropping message:', rawMeta.messageId);
      return;
    }
    seenMessageIds.current.add(rawMeta.messageId);

    const aad = buildAAD(rawMeta);

    let plaintext = '[Decryption failed]';
    let authVerified = false;
    let decryptDurationMs = 0;

    try {
      const result = await decryptMessage(payload.ciphertext, sessionKeyBytes.current, aad);
      plaintext = result.plaintext;
      decryptDurationMs = result.durationMs;
      authVerified = true;
    } catch (e) {
      console.error('[QS] Decryption/auth failure:', e);
      authVerified = false;
    }

    const chatMsg: ChatMessage = {
      id: rawMeta.messageId,
      sessionId: rawMeta.sessionId,
      senderId: rawMeta.senderId,
      senderRole: 'peer',
      plaintext,
      encryptedPayload: payload,
      meta: { ...rawMeta, decryptDurationMs, authVerified },
      displayedAt: Date.now(),
      authVerified,
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);
  }, []);

  // --- Disconnect -----------------------------------------------------------

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  useEffect(() => {
    return () => {
      ws.current?.close();
    };
  }, []);

  return {
    roomState,
    session,
    messages,
    handshakeState,
    connect,
    initiateHandshake,
    sendMessage,
    disconnect,
  };
}
