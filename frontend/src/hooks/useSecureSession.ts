/**
 * QuantumShield - Secure Session Hook (Phase 4: Encrypted File & Image Sharing)
 *
 * Manages the full lifecycle:
 *  1. WebSocket connection to the backend relay
 *  2. Star topology: First participant is the ephemeral Hub; subsequent joiners are Spokes.
 *  3. Classical or hybrid bilateral handshake (X25519 / X25519 + ML-KEM-768) per peer.
 *  4. Client-side re-encryption at the Hub for true N-party E2E encryption without server knowledge.
 *  5. AES-256-GCM message & 32KB file chunk streaming with sequence-bound AAD.
 *  6. Replay protection and WhatsApp-style delivery acknowledgments.
 *  7. Encrypted history at rest via StorageService.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  generateX25519KeyPair, x25519SharedSecret,
  generateMLKEMKeyPair, mlkemEncapsulate, mlkemDecapsulate,
  deriveSessionKey, encryptMessage, decryptMessage,
  bytesToBase64, base64ToBytes, zeroizeBytes,
  KEY_SIZES,
} from '@/crypto/hybrid';
import { createWebSocket } from '@/services/api';
import { StorageService } from '@/services/StorageService';
import { pushService } from '@/services/PushNotificationService';
import {
  FileTransferService,
  type FileManifestPayload,
  type FileChunkPayload,
  type EncryptedManifestEnvelope,
} from '@/services/FileTransferService';
import { soundHapticService } from '@/services/SoundHapticService';
import { signWithIdentity, verifySignature, type QSIdentity } from '@/services/IdentityService';
import type {
  CryptoMode, HandshakeState, SessionState, ChatMessage,
  RoomState, MessageMeta, EncryptedPayload, RoomParticipant, ParticipantRole,
  FileAttachment, FileTransferProgress, QueuedMessage
} from '@/types';

// --- Backoff Constants --------------------------------------------------------
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 1.5;

// --- Build AAD ----------------------------------------------------------------

function buildAAD(meta: Omit<MessageMeta, 'encryptDurationMs' | 'decryptDurationMs' | 'authVerified'>): Uint8Array {
  const str = JSON.stringify({
    messageId: meta.messageId,
    sessionId: meta.sessionId,
    senderId: meta.senderId,
    sequenceNumber: meta.sequenceNumber,
    algorithm: meta.algorithm,
    timestamp: meta.timestamp,
    burnDuration: meta.burnDuration,
  });
  return new TextEncoder().encode(str);
}

// --- Hook ---------------------------------------------------------------------

export function useSecureSession(identity?: QSIdentity | null) {
  const [roomState, setRoomState] = useState<RoomState>({
    role: 'unknown',
    participantCount: 0,
    participants: [],
    isHub: false,
    connected: false,
    reconnecting: false,
    reconnectAttempt: 0,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handshakeState, setHandshakeState] = useState<HandshakeState>('idle');
  const [transferProgress, setTransferProgress] = useState<FileTransferProgress | null>(null);
  const [queuedCount, setQueuedCount] = useState<number>(0);

  const identityRef = useRef<QSIdentity | null>(identity ?? null);
  useEffect(() => {
    identityRef.current = identity ?? null;
  }, [identity]);

  const ws = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explicitDisconnectRef = useRef<boolean>(false);
  const offlineQueueRef = useRef<QueuedMessage[]>([]);
  const isFlushingQueueRef = useRef<boolean>(false);
  const handleServerMessageRef = useRef<(msg: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());

  const sessionKeyBytes = useRef<Uint8Array | null>(null);
  const myX25519 = useRef<{ privateKey: Uint8Array; publicKey: Uint8Array } | null>(null);
  const myMLKEM = useRef<{ publicKey: Uint8Array; secretKey: Uint8Array } | null>(null);

  // Per-peer session keys and ephemeral keys for Star Hub topology
  const peerSessionsRef = useRef<Map<string, { sessionKey: Uint8Array; fingerprint: string }>>(new Map());
  const peerEphemeralKeysRef = useRef<Map<string, {
    x25519: { privateKey: Uint8Array; publicKey: Uint8Array };
    mlkem?: { publicKey: Uint8Array; secretKey: Uint8Array };
  }>>(new Map());

  // Incoming file transfer metadata buffer
  const incomingFilesMetaRef = useRef<Map<string, {
    senderId: string;
    senderAlias?: string;
    senderFingerprint?: string;
    timestamp: number;
  }>>(new Map());

  const hubIdRef = useRef<string>('');
  const isHubRef = useRef<boolean>(false);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const sequenceCounter = useRef<number>(0);
  const lastSeenSequencePerSenderRef = useRef<Map<string, number>>(new Map());
  const sessionIdRef = useRef<string>('');
  const roomIdRef = useRef<string>('');
  const participantIdRef = useRef<string>('');
  const roleRef = useRef<ParticipantRole>('unknown');
  const modeRef = useRef<CryptoMode>('classical');
  const handshakeStartRef = useRef<number>(0);
  const keyGenStartRef = useRef<number>(0);

  const inFlightHandshakesRef = useRef<Set<string>>(new Set());
  const handshakeTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // --- Cleanup -------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (ws.current) {
      try { ws.current.close(); } catch {}
      ws.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    handshakeTimeoutsRef.current.forEach(t => clearTimeout(t));
    handshakeTimeoutsRef.current.clear();
    inFlightHandshakesRef.current.clear();
    sessionKeyBytes.current = null;
    myX25519.current = null;
    myMLKEM.current = null;
    peerSessionsRef.current.clear();
    peerEphemeralKeysRef.current.clear();
    incomingFilesMetaRef.current.clear();
    hubIdRef.current = '';
    isHubRef.current = false;
    seenMessageIds.current.clear();
    sequenceCounter.current = 0;
    lastSeenSequencePerSenderRef.current.clear();
    sessionIdRef.current = '';
    roomIdRef.current = '';
    participantIdRef.current = '';
    roleRef.current = 'unknown';
    setMessages([]);
    setHandshakeState('idle');
    setTransferProgress(null);
    setSession(null);
    setQueuedCount(0);
    offlineQueueRef.current = [];
    setRoomState({
      role: 'unknown',
      participantCount: 0,
      participants: [],
      isHub: false,
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    });
  }, []);

  // --- Handshake Offer to a Specific Peer (Hub -> Spoke) -------------------

  const initiateHandshakeToPeer = useCallback(async (targetPeerId: string, forceRetry = false) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    if (!targetPeerId) return;

    // Deduplicate concurrent handshakes to the same peer unless explicitly forced
    if (!forceRetry && inFlightHandshakesRef.current.has(targetPeerId)) {
      return;
    }
    inFlightHandshakesRef.current.add(targetPeerId);

    // Clear prior timeout if any
    if (handshakeTimeoutsRef.current.has(targetPeerId)) {
      clearTimeout(handshakeTimeoutsRef.current.get(targetPeerId)!);
      handshakeTimeoutsRef.current.delete(targetPeerId);
    }

    // Safety watchdog: if not completed within 3500ms, mark failed and allow retry
    const timeout = setTimeout(() => {
      if (!peerSessionsRef.current.has(targetPeerId)) {
        console.warn(`[QS] Handshake with ${targetPeerId} timed out after 3500ms`);
        inFlightHandshakesRef.current.delete(targetPeerId);
        setHandshakeState(prev => prev === 'complete' ? 'complete' : 'failed');
      }
    }, 3500);
    handshakeTimeoutsRef.current.set(targetPeerId, timeout);

    try {
      keyGenStartRef.current = performance.now();
      handshakeStartRef.current = performance.now();
      setHandshakeState('generating_keys');

      const x25519Keys = generateX25519KeyPair();
      let mlkemPublicKeyB64: string | undefined;
      let mlkemKeys = null;

      if (modeRef.current === 'hybrid') {
        mlkemKeys = generateMLKEMKeyPair();
        mlkemPublicKeyB64 = bytesToBase64(mlkemKeys.publicKey);
      }

      peerEphemeralKeysRef.current.set(targetPeerId, {
        x25519: x25519Keys,
        mlkem: mlkemKeys ?? undefined,
      });

      const keyGenDurationMs = performance.now() - keyGenStartRef.current;
      setSession(prev => prev ? { ...prev, keyGenDurationMs, handshakeState: 'exchanging' } : prev);
      setHandshakeState('exchanging');

      const offerTranscript = {
        type: 'handshake_offer',
        to: targetPeerId,
        sessionId: sessionIdRef.current,
        mode: modeRef.current,
        x25519PublicKey: bytesToBase64(x25519Keys.publicKey),
        mlkemPublicKey: mlkemPublicKeyB64 || '',
        role: roleRef.current,
      };

      let signatureB64: string | undefined;
      if (identityRef.current) {
        const sig = await signWithIdentity(
          identityRef.current,
          new TextEncoder().encode(JSON.stringify(offerTranscript))
        );
        signatureB64 = bytesToBase64(sig);
      }

      ws.current.send(JSON.stringify({
        ...offerTranscript,
        signature: signatureB64,
        senderIdentityPublicKey: identityRef.current?.publicKey,
      }));
    } catch (err) {
      console.error('[QS] Peer handshake initiation failed:', err);
      inFlightHandshakesRef.current.delete(targetPeerId);
      setHandshakeState('failed');
    }
  }, []);

  // Forward declare connectRef for backoff reconnect
  const connectRef = useRef<(roomId: string, mode: CryptoMode, isReconnect?: boolean) => Promise<void>>(async () => {});

  const scheduleReconnect = useCallback(() => {
    if (explicitDisconnectRef.current || !roomIdRef.current) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;

    const baseDelay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1));
    const jitter = baseDelay * (0.8 + 0.4 * Math.random());
    const delay = Math.round(jitter);

    setRoomState(prev => ({
      ...prev,
      connected: false,
      reconnecting: true,
      reconnectAttempt: attempt,
      nextRetryInMs: delay,
      error: `Network interrupted. Reconnecting in ${Math.ceil(delay / 1000)}s (attempt ${attempt})...`,
    }));

    reconnectTimerRef.current = setTimeout(() => {
      if (!explicitDisconnectRef.current && roomIdRef.current) {
        connectRef.current(roomIdRef.current, modeRef.current, true);
      }
    }, delay);
  }, []);

  const reconnectNow = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (roomIdRef.current) {
      reconnectAttemptRef.current = 0;
      connectRef.current(roomIdRef.current, modeRef.current, true);
    }
  }, []);

  // --- Network Watchers (Online/Offline/Visibility for mobile PWAs) ---------
  useEffect(() => {
    const handleOnline = () => {
      setRoomState(prev => ({ ...prev, isOffline: false, error: undefined }));
      if (roomIdRef.current && !explicitDisconnectRef.current) {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED || ws.current.readyState === WebSocket.CLOSING) {
          console.log('[QS-Transport] Network came online — reconnecting immediately');
          reconnectNow();
        }
      }
    };

    const handleOffline = () => {
      setRoomState(prev => ({
        ...prev,
        isOffline: true,
        error: 'Network connection lost. Messages will be queued offline.',
      }));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && roomIdRef.current && !explicitDisconnectRef.current) {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED || ws.current.readyState === WebSocket.CLOSING) {
          console.log('[QS-Transport] PWA resumed from background — reconnecting');
          reconnectNow();
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [reconnectNow]);

  // --- Flush Offline Message Queue -----------------------------------------
  const flushOfflineQueue = useCallback(async () => {
    if (isFlushingQueueRef.current) return;
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    const hasKey = sessionKeyBytes.current || peerSessionsRef.current.size > 0;
    if (!hasKey) return;

    isFlushingQueueRef.current = true;
    try {
      if (roomIdRef.current) {
        const stored = await StorageService.getQueuedMessages(roomIdRef.current, identityRef.current);
        const map = new Map<string, QueuedMessage>();
        for (const item of offlineQueueRef.current) map.set(item.id, item);
        for (const item of stored) map.set(item.id, item);
        offlineQueueRef.current = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
      }

      if (offlineQueueRef.current.length === 0) {
        setQueuedCount(0);
        return;
      }

      console.log(`[QS-OfflineQueue] Flushing ${offlineQueueRef.current.length} queued messages...`);
      const items = [...offlineQueueRef.current];

      for (const item of items) {
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) break;

        const seqNum = ++sequenceCounter.current;
        const now = Date.now();
        const meta: Omit<MessageMeta, 'encryptDurationMs' | 'decryptDurationMs' | 'authVerified'> = {
          messageId: item.id,
          sessionId: sessionIdRef.current,
          senderId: participantIdRef.current,
          sequenceNumber: seqNum,
          algorithm: `AES-256-GCM|${modeRef.current === 'hybrid' ? 'X25519+ML-KEM-768' : 'X25519'}`,
          timestamp: item.timestamp,
          burnDuration: item.burnDuration,
        };
        const aad = buildAAD(meta);

        if (isHubRef.current && peerSessionsRef.current.size > 0) {
          for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
            const { ciphertext, nonce } = await encryptMessage(item.plaintext, peerData.sessionKey, aad);
            ws.current.send(JSON.stringify({
              type: 'encrypted_message',
              to: peerId,
              payload: { ciphertext, nonce },
              meta: {
                ...meta,
                senderAlias: identityRef.current?.alias || item.senderAlias || 'Hub',
                senderFingerprint: identityRef.current?.fingerprint || item.senderFingerprint,
              },
            }));
          }
        } else if (sessionKeyBytes.current) {
          const { ciphertext, nonce } = await encryptMessage(item.plaintext, sessionKeyBytes.current, aad);
          ws.current.send(JSON.stringify({
            type: 'encrypted_message',
            to: 'hub',
            payload: { ciphertext, nonce },
            meta: {
              ...meta,
              senderAlias: identityRef.current?.alias || item.senderAlias || 'Peer',
              senderFingerprint: identityRef.current?.fingerprint || item.senderFingerprint,
            },
          }));
        }

        // Transition status from 'queued' to 'sent'
        setMessages(prev => prev.map(m => m.id === item.id ? { ...m, status: 'sent', meta: { ...m.meta, sequenceNumber: seqNum } } : m));
        await StorageService.updateMessageStatus(item.id, 'sent').catch(() => {});
        await StorageService.removeQueuedMessage(item.id).catch(() => {});

        offlineQueueRef.current = offlineQueueRef.current.filter(q => q.id !== item.id);
        setQueuedCount(offlineQueueRef.current.length);
        soundHapticService.play('send');
      }
    } catch (e) {
      console.error('[QS-OfflineQueue] Flush error:', e);
    } finally {
      isFlushingQueueRef.current = false;
      setQueuedCount(offlineQueueRef.current.length);
    }
  }, []);

  // --- Connect -------------------------------------------------------------

  const connect = useCallback(async (roomId: string, mode: CryptoMode, isReconnect = false) => {
    if (!isReconnect) {
      explicitDisconnectRef.current = false;
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      cleanup();
      modeRef.current = mode;
      roomIdRef.current = roomId;
      const newSessionId = `${roomId}-${Date.now().toString(36)}`;
      sessionIdRef.current = newSessionId;

      setRoomState(prev => ({
        ...prev,
        roomId,
        error: undefined,
        reconnecting: false,
        reconnectAttempt: 0,
        nextRetryInMs: undefined,
      }));

      // Load persistent encrypted history for this room if identity is available
      if (identityRef.current) {
        try {
          const storedMsgs = await StorageService.getRoomMessages(roomId, identityRef.current);
          setMessages(storedMsgs);
          storedMsgs.forEach(m => seenMessageIds.current.add(m.id));
        } catch (err) {
          console.error('[QS] Error loading encrypted chat history:', err);
        }
      }

      // Load offline queue for this room
      try {
        const queued = await StorageService.getQueuedMessages(roomId, identityRef.current);
        offlineQueueRef.current = queued;
        setQueuedCount(queued.length);
      } catch (err) {
        console.error('[QS] Error loading offline queue:', err);
      }
    } else {
      // Reconnect mode: keep chat history, close dead socket and reset ephemeral handshake state
      if (ws.current) {
        try { ws.current.close(); } catch {}
        ws.current = null;
      }
      inFlightHandshakesRef.current.clear();
      handshakeTimeoutsRef.current.forEach(t => clearTimeout(t));
      handshakeTimeoutsRef.current.clear();
      setHandshakeState('idle');
      setRoomState(prev => ({ ...prev, reconnecting: true }));
    }

    const socket = createWebSocket(roomId);
    ws.current = socket;

    socket.onopen = () => {
      explicitDisconnectRef.current = false;
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      setRoomState(prev => ({
        ...prev,
        roomId,
        connected: true,
        reconnecting: false,
        reconnectAttempt: 0,
        nextRetryInMs: undefined,
        error: undefined,
      }));

      socket.send(JSON.stringify({ type: 'set_crypto_mode', mode: modeRef.current }));

      // Share identity alias & fingerprint with room
      if (identityRef.current) {
        socket.send(JSON.stringify({
          type: 'set_identity',
          alias: identityRef.current.alias,
          fingerprint: identityRef.current.fingerprint,
        }));
      }
    };

    socket.onclose = (ev) => {
      if (explicitDisconnectRef.current) {
        setRoomState(prev => ({ ...prev, connected: false, reconnecting: false }));
        return;
      }

      if (ev.code === 4004) {
        setRoomState(prev => ({ ...prev, connected: false, reconnecting: false, error: `Room ${roomId} not found or expired` }));
        return;
      }

      if (ev.code === 4003) {
        setRoomState(prev => ({ ...prev, connected: false, reconnecting: false, error: 'Room is full (max 8 peers)' }));
        return;
      }

      setRoomState(prev => ({
        ...prev,
        connected: false,
        error: `Disconnected (${ev.code || 'network interrupted'})`,
      }));

      scheduleReconnect();
    };

    socket.onerror = () => {
      setRoomState(prev => ({ ...prev, connected: false }));
    };

    socket.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        await handleServerMessageRef.current(msg);
      } catch (e) {
        console.error('[QS] WebSocket message error:', e);
      }
    };
  }, [cleanup, scheduleReconnect]);

  connectRef.current = connect;

  // --- Handle Offer (Spoke receives from Hub) ------------------------------

  const handleHandshakeOffer = useCallback(async (msg: Record<string, unknown>) => {
    if (!ws.current) return;
    try {
      setHandshakeState('exchanging');
      const senderId = (msg.from as string) || (msg.to as string) || 'hub';

      // Spoke verification: verify offer comes from the elected hub
      if (!isHubRef.current && hubIdRef.current && senderId !== hubIdRef.current) {
        console.warn(`[QS-SEC] Ignored handshake offer from non-hub spoke: ${senderId}`);
        return;
      }

      // Handshake offer signature verification
      if (msg.signature && msg.senderIdentityPublicKey) {
        const offerTranscriptToVerify = {
          type: 'handshake_offer',
          to: participantIdRef.current || (msg.to as string),
          sessionId: (msg.sessionId as string) || sessionIdRef.current,
          mode: (msg.mode as string) || modeRef.current,
          x25519PublicKey: msg.x25519PublicKey as string,
          mlkemPublicKey: (msg.mlkemPublicKey as string) || '',
          role: (msg.role as string) || 'hub',
        };
        const valid = await verifySignature(
          msg.senderIdentityPublicKey as string,
          new TextEncoder().encode(JSON.stringify(offerTranscriptToVerify)),
          base64ToBytes(msg.signature as string)
        );
        if (!valid) {
          console.error('[QS-SEC] Handshake offer signature verification failed from peer:', senderId);
          setHandshakeState('failed');
          return;
        }
      }

      inFlightHandshakesRef.current.delete(senderId);
      if (handshakeTimeoutsRef.current.has(senderId)) {
        clearTimeout(handshakeTimeoutsRef.current.get(senderId)!);
        handshakeTimeoutsRef.current.delete(senderId);
      }

      if (msg.sessionId) {
        sessionIdRef.current = msg.sessionId as string;
      }

      const theirX25519PubKey = base64ToBytes(msg.x25519PublicKey as string);
      const mode = (msg.mode as CryptoMode) || modeRef.current;
      modeRef.current = mode;

      const myKeys = generateX25519KeyPair();
      myX25519.current = myKeys;

      const x25519SS = x25519SharedSecret(myKeys.privateKey, theirX25519PubKey);

      let mlkemCiphertextB64: string | undefined;
      let mlkemSS: Uint8Array | undefined;
      let ctBytes: Uint8Array | undefined;
      let theirMLKEMPubKey: Uint8Array | undefined;

      if (mode === 'hybrid' && msg.mlkemPublicKey) {
        theirMLKEMPubKey = base64ToBytes(msg.mlkemPublicKey as string);
        const { ciphertext, sharedSecret } = mlkemEncapsulate(theirMLKEMPubKey);
        ctBytes = ciphertext;
        mlkemCiphertextB64 = bytesToBase64(ciphertext);
        mlkemSS = sharedSecret;
      }

      setHandshakeState('deriving');
      const { keyBytes, fingerprint } = await deriveSessionKey(
        x25519SS,
        sessionIdRef.current,
        mode,
        mlkemSS,
        {
          initiatorX25519Pk: theirX25519PubKey,
          responderX25519Pk: myKeys.publicKey,
          mlkemPublicKey: theirMLKEMPubKey,
          mlkemCiphertext: ctBytes,
        }
      );

      // Securely zeroize private key buffer
      zeroizeBytes(myKeys.privateKey);

      sessionKeyBytes.current = keyBytes;
      peerSessionsRef.current.set(senderId, { sessionKey: keyBytes, fingerprint });

      const handshakeDurationMs = performance.now() - handshakeStartRef.current;

      setHandshakeState('complete');
      flushOfflineQueue();
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

      const answerTranscriptObj = {
        type: 'handshake_answer',
        to: senderId,
        sessionId: sessionIdRef.current,
        x25519PublicKey: bytesToBase64(myKeys.publicKey),
        mlkemCiphertext: mlkemCiphertextB64 || '',
      };

      let answerSigB64 = '';
      if (identityRef.current) {
        const ansSig = await signWithIdentity(
          identityRef.current,
          new TextEncoder().encode(JSON.stringify(answerTranscriptObj))
        );
        answerSigB64 = bytesToBase64(ansSig);
      }

      // Send authenticated answer back to the offering peer / hub
      ws.current.send(JSON.stringify({
        ...answerTranscriptObj,
        signature: answerSigB64,
        senderIdentityPublicKey: identityRef.current?.publicKey,
      }));
    } catch (err) {
      console.error('[QS] Error handling handshake offer:', err);
      setHandshakeState('failed');
    }
  }, []);

  // --- Handle Answer (Hub receives from Spoke) -----------------------------

  const handleHandshakeAnswer = useCallback(async (msg: Record<string, unknown>) => {
    try {
      setHandshakeState('deriving');
      const senderId = msg.from as string;
      inFlightHandshakesRef.current.delete(senderId);
      if (handshakeTimeoutsRef.current.has(senderId)) {
        clearTimeout(handshakeTimeoutsRef.current.get(senderId)!);
        handshakeTimeoutsRef.current.delete(senderId);
      }

      // Verify Spoke answer signature
      if (msg.signature && msg.senderIdentityPublicKey) {
        const answerTranscriptToVerify = {
          type: 'handshake_answer',
          to: participantIdRef.current || (msg.to as string),
          sessionId: sessionIdRef.current,
          x25519PublicKey: msg.x25519PublicKey as string,
          mlkemCiphertext: (msg.mlkemCiphertext as string) || '',
        };
        const valid = await verifySignature(
          msg.senderIdentityPublicKey as string,
          new TextEncoder().encode(JSON.stringify(answerTranscriptToVerify)),
          base64ToBytes(msg.signature as string)
        );
        if (!valid) {
          console.error('[QS-SEC] Handshake answer signature verification failed from spoke:', senderId);
          setHandshakeState('failed');
          return;
        }
      }

      const ephemeral = peerEphemeralKeysRef.current.get(senderId) || (
        myX25519.current ? { x25519: myX25519.current, mlkem: myMLKEM.current ?? undefined } : null
      );
      if (!ephemeral) {
        console.warn(`[QS] Missing ephemeral keys for peer ${senderId}`);
        return;
      }

      const theirX25519PubKey = base64ToBytes(msg.x25519PublicKey as string);
      const x25519SS = x25519SharedSecret(ephemeral.x25519.privateKey, theirX25519PubKey);

      let mlkemSS: Uint8Array | undefined;
      let ctBytes: Uint8Array | undefined;
      if (modeRef.current === 'hybrid' && ephemeral.mlkem && msg.mlkemCiphertext) {
        ctBytes = base64ToBytes(msg.mlkemCiphertext as string);
        mlkemSS = mlkemDecapsulate(ctBytes, ephemeral.mlkem.secretKey);
      }

      const { keyBytes, fingerprint } = await deriveSessionKey(
        x25519SS,
        sessionIdRef.current,
        modeRef.current,
        mlkemSS,
        {
          initiatorX25519Pk: ephemeral.x25519.publicKey,
          responderX25519Pk: theirX25519PubKey,
          mlkemPublicKey: ephemeral.mlkem?.publicKey,
          mlkemCiphertext: ctBytes,
        }
      );

      // Zeroize ephemeral private keys
      zeroizeBytes(ephemeral.x25519.privateKey);
      if (ephemeral.mlkem) {
        zeroizeBytes(ephemeral.mlkem.secretKey);
      }

      sessionKeyBytes.current = keyBytes;
      peerSessionsRef.current.set(senderId, { sessionKey: keyBytes, fingerprint });

      const handshakeDurationMs = performance.now() - handshakeStartRef.current;
      setHandshakeState('complete');
      flushOfflineQueue();
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

      // Only the hub sends handshake_done
      ws.current?.send(JSON.stringify({ type: 'handshake_done' }));
    } catch (err) {
      console.error('[QS] Error handling handshake answer:', err);
      setHandshakeState('failed');
    }
  }, []);

  // --- Handle Incoming File Chunk ------------------------------------------

  const handleIncomingFileChunk = useCallback(async (msg: Record<string, unknown>) => {
    const chunk = msg.chunk as FileChunkPayload;
    const senderId = (msg.from as string) || 'peer';

    let keyToUse = sessionKeyBytes.current;
    if (isHubRef.current && peerSessionsRef.current.has(senderId)) {
      keyToUse = peerSessionsRef.current.get(senderId)!.sessionKey;
    }
    if (!keyToUse) return;

    try {
      // 1. Decrypt raw chunk bytes with sender's key
      const chunkBytes = await FileTransferService.decryptChunkBytes(chunk, sessionIdRef.current, keyToUse);

      // 2. Star Hub re-encryption for file chunks:
      // Re-encrypt chunk with each other spoke's bilateral key and forward
      if (isHubRef.current && ws.current) {
        for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
          if (peerId !== senderId) {
            const reEncChunk = await FileTransferService.encryptChunk(
              chunkBytes,
              chunk.fileId,
              chunk.chunkIndex,
              sessionIdRef.current,
              peerData.sessionKey
            );
            ws.current.send(JSON.stringify({
              type: 'file_chunk',
              to: peerId,
              chunk: reEncChunk,
              from: senderId,
            }));
          }
        }
      }

      // 3. Ingest chunk bytes into local assembler
      const attachment = await FileTransferService.ingestChunkBytes(chunk.fileId, chunk.chunkIndex, chunkBytes);
      if (attachment) {
        setTransferProgress(null);
        const meta = incomingFilesMetaRef.current.get(chunk.fileId);
        incomingFilesMetaRef.current.delete(chunk.fileId);

        const chatMsg: ChatMessage = {
          id: crypto.randomUUID(),
          sessionId: sessionIdRef.current,
          roomId: roomIdRef.current,
          senderId: meta?.senderId || senderId,
          senderRole: 'peer',
          senderAlias: meta?.senderAlias,
          senderFingerprint: meta?.senderFingerprint,
          plaintext: `Shared file: ${attachment.fileName} (${(attachment.fileSize / 1024).toFixed(1)} KB)`,
          attachment,
          meta: {
            messageId: crypto.randomUUID(),
            sessionId: sessionIdRef.current,
            senderId: meta?.senderId || senderId,
            sequenceNumber: ++sequenceCounter.current,
            algorithm: `AES-256-GCM|FileStream`,
            timestamp: meta?.timestamp || Date.now(),
            authVerified: true,
          },
          displayedAt: Date.now(),
          authVerified: true,
          status: 'delivered',
        };

        setMessages(prev => [...prev, chatMsg]);
        setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);

        pushService.showLocalBackgroundNotification(
          'QuantumShield',
          `Encrypted file received: ${attachment.fileName}`
        );

        if (identityRef.current && roomIdRef.current) {
          StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[QS-SEC] Failed to process incoming file chunk:', err);
    }
  }, []);

  // --- Server Message Handler -----------------------------------------------

  const handleServerMessage = useCallback(async (msg: Record<string, unknown>) => {
    const type = msg.type as string;

    switch (type) {
      case 'room_joined': {
        const pid = msg.participant_id as string;
        const role = msg.role as ParticipantRole;
        const pCount = (msg.participant_count as number) || 1;
        const hubId = (msg.hub_id as string) || pid;
        const roster = (msg.participants as RoomParticipant[]) || [];
        const isHub = role === 'hub' || role === 'initiator' || hubId === pid;

        participantIdRef.current = pid;
        roleRef.current = role;
        hubIdRef.current = hubId;
        isHubRef.current = isHub;

        setRoomState(prev => ({
          ...prev,
          roomId: msg.room_id as string,
          participantId: pid,
          role,
          participantCount: pCount,
          participants: roster,
          hubId,
          isHub,
        }));

        setSession({
          sessionId: sessionIdRef.current,
          mode: modeRef.current,
          handshakeState: 'idle',
          messageCount: 0,
        });

        // If I am the Hub and peers are already waiting, initiate handshake with them
        if (isHub && pCount >= 2) {
          for (const peer of roster) {
            if (peer.id !== pid && !peerSessionsRef.current.has(peer.id)) {
              await initiateHandshakeToPeer(peer.id);
            }
          }
        }
        break;
      }

      case 'participant_list': {
        const pCount = (msg.participant_count as number) || 0;
        const roster = (msg.participants as RoomParticipant[]) || [];
        const hubId = (msg.hub_id as string) || hubIdRef.current;
        const myId = participantIdRef.current;
        const isHub = roleRef.current === 'hub' || roleRef.current === 'initiator' || hubId === myId;

        hubIdRef.current = hubId;
        isHubRef.current = isHub;

        // Clean up departed peers from active sessions
        const activeIds = new Set(roster.map(p => p.id));
        for (const peerId of peerSessionsRef.current.keys()) {
          if (!activeIds.has(peerId)) {
            peerSessionsRef.current.delete(peerId);
            peerEphemeralKeysRef.current.delete(peerId);
            inFlightHandshakesRef.current.delete(peerId);
            if (handshakeTimeoutsRef.current.has(peerId)) {
              clearTimeout(handshakeTimeoutsRef.current.get(peerId)!);
              handshakeTimeoutsRef.current.delete(peerId);
            }
          }
        }
        if (msg.peer_left) {
          const leftId = msg.peer_left as string;
          peerSessionsRef.current.delete(leftId);
          peerEphemeralKeysRef.current.delete(leftId);
          inFlightHandshakesRef.current.delete(leftId);
          if (handshakeTimeoutsRef.current.has(leftId)) {
            clearTimeout(handshakeTimeoutsRef.current.get(leftId)!);
            handshakeTimeoutsRef.current.delete(leftId);
          }
        }

        setRoomState(prev => ({
          ...prev,
          participantCount: pCount,
          participants: roster,
          hubId,
          isHub,
        }));

        // Star Hub: automatically handshake with any new joined peer
        if (isHub) {
          for (const peer of roster) {
            if (peer.id !== myId && !peerSessionsRef.current.has(peer.id) && !inFlightHandshakesRef.current.has(peer.id)) {
              await initiateHandshakeToPeer(peer.id);
            }
          }
        }
        break;
      }

      case 'peer_joined': {
        const pCount = msg.participant_count as number;
        setRoomState(prev => ({ ...prev, participantCount: pCount }));
        break;
      }

      case 'peer_left': {
        const leftId = msg.peer_left as string;
        if (leftId) {
          peerSessionsRef.current.delete(leftId);
          peerEphemeralKeysRef.current.delete(leftId);
          inFlightHandshakesRef.current.delete(leftId);
          if (handshakeTimeoutsRef.current.has(leftId)) {
            clearTimeout(handshakeTimeoutsRef.current.get(leftId)!);
            handshakeTimeoutsRef.current.delete(leftId);
          }
        }
        setRoomState(prev => ({
          ...prev,
          participantCount: msg.participant_count as number,
        }));
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

      case 'handshake_request': {
        const senderId = (msg.from as string) || (msg.to as string);
        if (isHubRef.current && senderId) {
          peerSessionsRef.current.delete(senderId);
          inFlightHandshakesRef.current.delete(senderId);
          await initiateHandshakeToPeer(senderId, true);
        }
        break;
      }

      case 'session_established': {
        inFlightHandshakesRef.current.clear();
        handshakeTimeoutsRef.current.forEach(t => clearTimeout(t));
        handshakeTimeoutsRef.current.clear();
        setHandshakeState('complete');
        setSession(prev => prev ? { ...prev, handshakeState: 'complete' } : prev);
        soundHapticService.play('handshake');
        soundHapticService.triggerHaptic('success');
        flushOfflineQueue();
        break;
      }

      case 'encrypted_message': {
        await handleIncomingMessage(msg);
        break;
      }

      case 'file_manifest': {
        const senderId = (msg.from as string) || 'peer';
        const senderAlias = (msg.senderAlias as string) || 'Peer';
        const senderFingerprint = msg.senderFingerprint as string;

        let keyToUse = sessionKeyBytes.current;
        if (isHubRef.current && peerSessionsRef.current.has(senderId)) {
          keyToUse = peerSessionsRef.current.get(senderId)!.sessionKey;
        }
        if (!keyToUse) break;

        try {
          const manifest = await FileTransferService.decryptManifest(
            msg.encryptedManifest as EncryptedManifestEnvelope,
            keyToUse,
            sessionIdRef.current
          );

          FileTransferService.registerIncomingFile(manifest, (progress) => {
            setTransferProgress(progress);
          });

          incomingFilesMetaRef.current.set(manifest.fileId, {
            senderId,
            senderAlias,
            senderFingerprint,
            timestamp: (msg.timestamp as number) || Date.now(),
          });

          // Hub re-encrypts manifest with each other spoke's bilateral key and relays
          if (isHubRef.current && ws.current) {
            for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
              if (peerId !== senderId) {
                const reEncManifest = await FileTransferService.encryptManifest(
                  manifest,
                  peerData.sessionKey,
                  sessionIdRef.current
                );
                ws.current.send(JSON.stringify({
                  type: 'file_manifest',
                  to: peerId,
                  encryptedManifest: reEncManifest,
                  senderAlias,
                  senderFingerprint,
                  from: senderId,
                }));
              }
            }
          }
        } catch (mErr) {
          console.error('[QS-SEC] Failed to decrypt file manifest:', mErr);
        }
        break;
      }

      case 'file_chunk': {
        await handleIncomingFileChunk(msg);
        break;
      }

      case 'message_ack': {
        const ackMsgId = msg.messageId as string;
        if (ackMsgId) {
          setMessages(prev => prev.map(m => m.id === ackMsgId ? { ...m, status: 'delivered' } : m));
          StorageService.updateMessageStatus(ackMsgId, 'delivered').catch(() => {});
          soundHapticService.play('delivered');
        }
        break;
      }

      case 'mode_accepted': {
        break;
      }

      case 'error': {
        console.error('[QS] Server error:', msg.message);
        setRoomState(prev => ({ ...prev, error: msg.message as string }));
        soundHapticService.play('error');
        soundHapticService.triggerHaptic('error');
        break;
      }
    }
  }, [handleHandshakeOffer, handleHandshakeAnswer, initiateHandshakeToPeer, handleIncomingFileChunk, flushOfflineQueue]);

  handleServerMessageRef.current = handleServerMessage;

  // --- Send Encrypted Message (with Star re-encryption routing & Offline Queue) ---

  const sendMessage = useCallback(async (plaintext: string, burnDuration?: number): Promise<void> => {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const isSocketOpen = ws.current && ws.current.readyState === WebSocket.OPEN;
    const isSecureReady = (handshakeState === 'complete' || peerSessionsRef.current.size > 0 || sessionKeyBytes.current !== null);

    // Transport Resilience: If socket is offline, disconnected, or negotiating, queue message!
    if (!isSocketOpen || !isSecureReady || !isOnline) {
      const messageId = crypto.randomUUID();
      seenMessageIds.current.add(messageId);
      const now = Date.now();

      const queuedItem: QueuedMessage = {
        id: messageId,
        roomId: roomIdRef.current,
        plaintext,
        burnDuration,
        timestamp: now,
        senderAlias: identityRef.current?.alias,
        senderFingerprint: identityRef.current?.fingerprint,
      };

      offlineQueueRef.current.push(queuedItem);
      setQueuedCount(offlineQueueRef.current.length);

      const chatMsg: ChatMessage = {
        id: messageId,
        sessionId: sessionIdRef.current,
        roomId: roomIdRef.current,
        senderId: participantIdRef.current || 'pending',
        senderRole: 'self',
        senderAlias: identityRef.current?.alias,
        senderFingerprint: identityRef.current?.fingerprint,
        plaintext,
        meta: {
          messageId,
          sessionId: sessionIdRef.current,
          senderId: participantIdRef.current || 'pending',
          sequenceNumber: 0,
          algorithm: `AES-256-GCM|OfflineQueue`,
          timestamp: now,
          burnDuration,
          authVerified: true,
        },
        displayedAt: now,
        authVerified: true,
        status: 'queued',
        burnDuration,
        expiresAt: burnDuration ? now + burnDuration * 1000 : undefined,
      };

      setMessages(prev => [...prev, chatMsg]);
      soundHapticService.play('tap');

      if (identityRef.current && roomIdRef.current) {
        StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(() => {});
      }
      StorageService.saveQueuedMessage(queuedItem, identityRef.current).catch(() => {});

      return;
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
      burnDuration,
    };

    const aad = buildAAD(meta);

    // If I am the Hub: encrypt separately for each connected Spoke
    if (isHubRef.current && peerSessionsRef.current.size > 0) {
      for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
        const { ciphertext, nonce } = await encryptMessage(plaintext, peerData.sessionKey, aad);
        ws.current.send(JSON.stringify({
          type: 'encrypted_message',
          to: peerId,
          payload: { ciphertext, nonce },
          meta: {
            ...meta,
            senderAlias: identityRef.current?.alias || 'Hub',
            senderFingerprint: identityRef.current?.fingerprint,
          },
        }));
      }
    } else if (sessionKeyBytes.current) {
      // If Spoke: encrypt with bilateral session key and send to Hub
      const { ciphertext, nonce } = await encryptMessage(plaintext, sessionKeyBytes.current, aad);
      ws.current.send(JSON.stringify({
        type: 'encrypted_message',
        to: 'hub',
        payload: { ciphertext, nonce },
        meta: {
          ...meta,
          senderAlias: identityRef.current?.alias || 'Peer',
          senderFingerprint: identityRef.current?.fingerprint,
        },
      }));
    }

    const chatMsg: ChatMessage = {
      id: messageId,
      sessionId: sessionIdRef.current,
      roomId: roomIdRef.current,
      senderId: participantIdRef.current,
      senderRole: 'self',
      senderAlias: identityRef.current?.alias,
      senderFingerprint: identityRef.current?.fingerprint,
      plaintext,
      meta: { ...meta, encryptDurationMs: 0, authVerified: true },
      displayedAt: now,
      authVerified: true,
      status: 'sent',
      burnDuration,
      expiresAt: burnDuration ? now + burnDuration * 1000 : undefined,
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);
    soundHapticService.play('send');
    soundHapticService.triggerHaptic('send');

    if (identityRef.current && roomIdRef.current) {
      StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(err => {
        console.error('[QS] Error persisting sent encrypted message:', err);
      });
    }
  }, [handshakeState]);

  // --- Send Encrypted File Streaming (Phase 4) -----------------------------

  const sendFile = useCallback(async (file: File): Promise<void> => {
    if (!ws.current) throw new Error('WebSocket not connected');
    if (handshakeState !== 'complete' && peerSessionsRef.current.size === 0 && !sessionKeyBytes.current) {
      throw new Error('Handshake not complete — wait for secure channel');
    }

    const { fileId, manifest, rawChunks, thumbnail } = await FileTransferService.prepareFile(file);

    setTransferProgress({
      fileId,
      fileName: file.name,
      totalChunks: rawChunks.length,
      transferredChunks: 0,
      percentage: 0,
      direction: 'sending',
    });

    // 1. Send Encrypted File Manifest
    if (isHubRef.current && peerSessionsRef.current.size > 0) {
      for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
        const encryptedManifest = await FileTransferService.encryptManifest(
          manifest,
          peerData.sessionKey,
          sessionIdRef.current
        );
        ws.current.send(JSON.stringify({
          type: 'file_manifest',
          to: peerId,
          encryptedManifest,
          senderAlias: identityRef.current?.alias || 'Hub',
          senderFingerprint: identityRef.current?.fingerprint,
          timestamp: Date.now(),
        }));
      }
    } else if (sessionKeyBytes.current) {
      const encryptedManifest = await FileTransferService.encryptManifest(
        manifest,
        sessionKeyBytes.current,
        sessionIdRef.current
      );
      ws.current.send(JSON.stringify({
        type: 'file_manifest',
        to: 'hub',
        encryptedManifest,
        senderAlias: identityRef.current?.alias || 'Peer',
        senderFingerprint: identityRef.current?.fingerprint,
        timestamp: Date.now(),
      }));
    }

    // 2. Encrypt & Stream Chunks
    for (let i = 0; i < rawChunks.length; i++) {
      const chunkBytes = rawChunks[i];

      if (isHubRef.current && peerSessionsRef.current.size > 0) {
        for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
          const chunkPayload = await FileTransferService.encryptChunk(
            chunkBytes,
            fileId,
            i,
            sessionIdRef.current,
            peerData.sessionKey
          );
          ws.current.send(JSON.stringify({
            type: 'file_chunk',
            to: peerId,
            chunk: chunkPayload,
          }));
        }
      } else if (sessionKeyBytes.current) {
        const chunkPayload = await FileTransferService.encryptChunk(
          chunkBytes,
          fileId,
          i,
          sessionIdRef.current,
          sessionKeyBytes.current
        );
        ws.current.send(JSON.stringify({
          type: 'file_chunk',
          to: 'hub',
          chunk: chunkPayload,
        }));
      }

      setTransferProgress({
        fileId,
        fileName: file.name,
        totalChunks: rawChunks.length,
        transferredChunks: i + 1,
        percentage: Math.round(((i + 1) / rawChunks.length) * 100),
        direction: 'sending',
      });

      if (i % 4 === 0) {
        await new Promise(r => setTimeout(r, 8));
      }
    }

    setTransferProgress(null);

    // 3. Add to local self messages
    const attachment: FileAttachment = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      blobUrl: URL.createObjectURL(file),
      dataUrl: thumbnail,
      isImage: file.type.startsWith('image/'),
    };

    const chatMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: sessionIdRef.current,
      roomId: roomIdRef.current,
      senderId: participantIdRef.current,
      senderRole: 'self',
      senderAlias: identityRef.current?.alias,
      senderFingerprint: identityRef.current?.fingerprint,
      plaintext: `Shared file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      attachment,
      meta: {
        messageId: crypto.randomUUID(),
        sessionId: sessionIdRef.current,
        senderId: participantIdRef.current,
        sequenceNumber: ++sequenceCounter.current,
        algorithm: `AES-256-GCM|FileStream`,
        timestamp: Date.now(),
        authVerified: true,
      },
      displayedAt: Date.now(),
      authVerified: true,
      status: 'sent',
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);

    if (identityRef.current && roomIdRef.current) {
      StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(() => {});
    }
  }, [handshakeState]);

  // --- Handle Incoming Encrypted Message (and Hub Re-encryption) ------------

  const handleIncomingMessage = useCallback(async (msg: Record<string, unknown>) => {
    const rawMeta = msg.meta as (Omit<MessageMeta, 'encryptDurationMs' | 'decryptDurationMs' | 'authVerified'> & {
      senderAlias?: string;
      senderFingerprint?: string;
    });
    const payload = msg.payload as EncryptedPayload;
    const senderId = (msg.from as string) || rawMeta.senderId;

    if (seenMessageIds.current.has(rawMeta.messageId)) {
      return;
    }
    seenMessageIds.current.add(rawMeta.messageId);

    // Monotonic sequence number enforcement per sender to prevent replays and drops
    const incomingSeq = rawMeta.sequenceNumber;
    if (typeof incomingSeq === 'number' && senderId) {
      const lastSeq = lastSeenSequencePerSenderRef.current.get(senderId) || 0;
      if (incomingSeq <= lastSeq) {
        console.warn(
          `[QS-SEC] Replay or out-of-order sequence detected from ${senderId}: got ${incomingSeq}, expected > ${lastSeq}`
        );
        return;
      }
      lastSeenSequencePerSenderRef.current.set(senderId, incomingSeq);
    }

    const aad = buildAAD(rawMeta);

    // Select decryption key: Hub uses per-peer key; Spoke uses bilateral session key
    let keyToUse = sessionKeyBytes.current;
    if (isHubRef.current && senderId && peerSessionsRef.current.has(senderId)) {
      keyToUse = peerSessionsRef.current.get(senderId)!.sessionKey;
    }

    if (!keyToUse) return;

    let plaintext = '[Decryption failed]';
    let authVerified = false;
    let decryptDurationMs = 0;

    try {
      const result = await decryptMessage(payload.ciphertext, keyToUse, aad);
      plaintext = result.plaintext;
      decryptDurationMs = result.durationMs;
      authVerified = true;
    } catch (e) {
      console.error('[QS] Decryption/auth failure:', e);
      authVerified = false;
    }

    // Send delivery acknowledgment back to the sender
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'message_ack',
        to: senderId,
        messageId: rawMeta.messageId,
        roomId: roomIdRef.current,
        timestamp: Date.now(),
      }));
    }

    // Star Hub Re-encryption:
    // If I am the Hub, re-encrypt this message for every OTHER spoke connected
    if (isHubRef.current && authVerified && ws.current) {
      for (const [peerId, peerData] of peerSessionsRef.current.entries()) {
        if (peerId !== senderId) {
          try {
            const reEncAAD = buildAAD(rawMeta);
            const { ciphertext, nonce } = await encryptMessage(plaintext, peerData.sessionKey, reEncAAD);
            ws.current.send(JSON.stringify({
              type: 'encrypted_message',
              to: peerId,
              payload: { ciphertext, nonce },
              meta: rawMeta,
            }));
          } catch (reErr) {
            console.error('[QS] Hub re-encryption error for spoke:', peerId, reErr);
          }
        }
      }
    }

    const burnDuration = rawMeta.burnDuration;
    const chatMsg: ChatMessage = {
      id: rawMeta.messageId,
      sessionId: rawMeta.sessionId,
      roomId: roomIdRef.current,
      senderId: rawMeta.senderId || senderId,
      senderRole: 'peer',
      senderAlias: rawMeta.senderAlias,
      senderFingerprint: rawMeta.senderFingerprint,
      plaintext,
      encryptedPayload: payload,
      meta: { ...rawMeta, decryptDurationMs, authVerified },
      displayedAt: Date.now(),
      authVerified,
      status: 'delivered',
      burnDuration,
      expiresAt: burnDuration ? Date.now() + burnDuration * 1000 : undefined,
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);
    soundHapticService.play('receive');
    soundHapticService.triggerHaptic('receive');

    pushService.showLocalBackgroundNotification(
      'QuantumShield',
      'New encrypted message received'
    );

    if (identityRef.current && roomIdRef.current) {
      StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(err => {
        console.error('[QS] Error persisting incoming encrypted message:', err);
      });
    }
  }, []);

  // --- Message Self-Destruct / Local Purge ---------------------------------

  const deleteMessageFromChat = useCallback(async (messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
    await StorageService.deleteMessage(messageId).catch(() => {});
  }, []);

  // --- Handshake Recovery / Manual Re-negotiation --------------------------

  const retryHandshake = useCallback(async () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    inFlightHandshakesRef.current.clear();
    handshakeTimeoutsRef.current.forEach(t => clearTimeout(t));
    handshakeTimeoutsRef.current.clear();
    setHandshakeState('generating_keys');

    if (isHubRef.current) {
      for (const p of roomState.participants) {
        if (p.id !== participantIdRef.current) {
          await initiateHandshakeToPeer(p.id, true);
        }
      }
    } else if (roomState.hubId) {
      ws.current.send(JSON.stringify({
        type: 'handshake_request',
        to: roomState.hubId,
      }));
    }
  }, [roomState.participants, roomState.hubId, initiateHandshakeToPeer]);

  // --- Manual Handshake Trigger --------------------------------------------

  const initiateHandshake = useCallback(async () => {
    if (isHubRef.current) {
      for (const p of roomState.participants) {
        if (p.id !== participantIdRef.current) {
          await initiateHandshakeToPeer(p.id);
        }
      }
    } else if (roomState.hubId) {
      await initiateHandshakeToPeer(roomState.hubId);
    }
  }, [roomState.participants, roomState.hubId, initiateHandshakeToPeer]);

  // --- Disconnect -----------------------------------------------------------

  const disconnect = useCallback(() => {
    explicitDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    cleanup();
  }, [cleanup]);

  const clearHistory = useCallback(async () => {
    if (roomIdRef.current) {
      await StorageService.deleteRoomHistory(roomIdRef.current);
      setMessages([]);
      setQueuedCount(0);
      offlineQueueRef.current = [];
    }
  }, []);

  useEffect(() => {
    if (handshakeState === 'complete') {
      flushOfflineQueue();
    }
  }, [handshakeState, flushOfflineQueue]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      ws.current?.close();
    };
  }, []);

  return {
    roomState,
    session,
    messages,
    handshakeState,
    transferProgress,
    queuedCount,
    connect,
    initiateHandshake,
    retryHandshake,
    sendMessage,
    sendFile,
    deleteMessageFromChat,
    disconnect,
    clearHistory,
    reconnectNow,
    flushOfflineQueue,
  };
}
