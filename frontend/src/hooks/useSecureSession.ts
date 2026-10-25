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
  bytesToBase64, base64ToBytes,
  KEY_SIZES,
} from '@/crypto/hybrid';
import { createWebSocket } from '@/services/api';
import { StorageService } from '@/services/StorageService';
import {
  FileTransferService,
  type FileManifestPayload,
  type FileChunkPayload,
} from '@/services/FileTransferService';
import type { QSIdentity } from '@/services/IdentityService';
import type {
  CryptoMode, HandshakeState, SessionState, ChatMessage,
  RoomState, MessageMeta, EncryptedPayload, RoomParticipant, ParticipantRole,
  FileAttachment, FileTransferProgress
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

export function useSecureSession(identity?: QSIdentity | null) {
  const [roomState, setRoomState] = useState<RoomState>({
    role: 'unknown',
    participantCount: 0,
    participants: [],
    isHub: false,
    connected: false,
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handshakeState, setHandshakeState] = useState<HandshakeState>('idle');
  const [transferProgress, setTransferProgress] = useState<FileTransferProgress | null>(null);

  const identityRef = useRef<QSIdentity | null>(identity ?? null);
  useEffect(() => {
    identityRef.current = identity ?? null;
  }, [identity]);

  const ws = useRef<WebSocket | null>(null);
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
  const sessionIdRef = useRef<string>('');
  const roomIdRef = useRef<string>('');
  const participantIdRef = useRef<string>('');
  const roleRef = useRef<ParticipantRole>('unknown');
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
    peerSessionsRef.current.clear();
    peerEphemeralKeysRef.current.clear();
    incomingFilesMetaRef.current.clear();
    hubIdRef.current = '';
    isHubRef.current = false;
    seenMessageIds.current.clear();
    sequenceCounter.current = 0;
    sessionIdRef.current = '';
    roomIdRef.current = '';
    participantIdRef.current = '';
    roleRef.current = 'unknown';
    setMessages([]);
    setHandshakeState('idle');
    setTransferProgress(null);
    setSession(null);
    setRoomState({
      role: 'unknown',
      participantCount: 0,
      participants: [],
      isHub: false,
      connected: false
    });
  }, []);

  // --- Handshake Offer to a Specific Peer (Hub -> Spoke) -------------------

  const initiateHandshakeToPeer = useCallback(async (targetPeerId: string) => {
    if (!ws.current) return;
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

      ws.current.send(JSON.stringify({
        type: 'handshake_offer',
        to: targetPeerId,
        sessionId: sessionIdRef.current,
        mode: modeRef.current,
        x25519PublicKey: bytesToBase64(x25519Keys.publicKey),
        mlkemPublicKey: mlkemPublicKeyB64,
        role: roleRef.current,
      }));
    } catch (err) {
      console.error('[QS] Peer handshake initiation failed:', err);
      setHandshakeState('failed');
    }
  }, []);

  // --- Connect -------------------------------------------------------------

  const connect = useCallback(async (roomId: string, mode: CryptoMode) => {
    cleanup();
    modeRef.current = mode;
    roomIdRef.current = roomId;
    const newSessionId = `${roomId}-${Date.now().toString(36)}`;
    sessionIdRef.current = newSessionId;

    setRoomState(prev => ({ ...prev, roomId, error: undefined }));

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

    const socket = createWebSocket(roomId);
    ws.current = socket;

    socket.onopen = () => {
      setRoomState(prev => ({ ...prev, roomId, connected: true }));
      socket.send(JSON.stringify({ type: 'set_crypto_mode', mode }));

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

  // --- Handle Offer (Spoke receives from Hub) ------------------------------

  const handleHandshakeOffer = useCallback(async (msg: Record<string, unknown>) => {
    if (!ws.current) return;
    try {
      setHandshakeState('exchanging');
      const senderId = (msg.from as string) || (msg.to as string) || 'hub';

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
      peerSessionsRef.current.set(senderId, { sessionKey: keyBytes, fingerprint });

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

      // Send answer back to the offering peer / hub
      ws.current.send(JSON.stringify({
        type: 'handshake_answer',
        to: senderId,
        sessionId: sessionIdRef.current,
        x25519PublicKey: bytesToBase64(myKeys.publicKey),
        mlkemCiphertext: mlkemCiphertextB64,
      }));

      ws.current.send(JSON.stringify({ type: 'handshake_done' }));
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
      const ephemeral = peerEphemeralKeysRef.current.get(senderId) || (
        myX25519.current ? { x25519: myX25519.current, mlkem: myMLKEM.current ?? undefined } : null
      );
      if (!ephemeral) return;

      const theirX25519PubKey = base64ToBytes(msg.x25519PublicKey as string);
      const x25519SS = x25519SharedSecret(ephemeral.x25519.privateKey, theirX25519PubKey);

      let mlkemSS: Uint8Array | undefined;
      if (modeRef.current === 'hybrid' && ephemeral.mlkem && msg.mlkemCiphertext) {
        const ct = base64ToBytes(msg.mlkemCiphertext as string);
        mlkemSS = mlkemDecapsulate(ct, ephemeral.mlkem.secretKey);
      }

      const { keyBytes, fingerprint } = await deriveSessionKey(
        x25519SS, sessionIdRef.current, modeRef.current, mlkemSS
      );

      sessionKeyBytes.current = keyBytes;
      peerSessionsRef.current.set(senderId, { sessionKey: keyBytes, fingerprint });

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

    // Star Hub re-encryption for file chunks:
    // If I am the Hub, relay chunk to all other spokes
    if (isHubRef.current && ws.current) {
      for (const [peerId] of peerSessionsRef.current.entries()) {
        if (peerId !== senderId) {
          ws.current.send(JSON.stringify({
            type: 'file_chunk',
            to: peerId,
            chunk,
            from: senderId,
          }));
        }
      }
    }

    const attachment = await FileTransferService.ingestChunk(chunk, sessionIdRef.current, keyToUse);
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

      if (identityRef.current && roomIdRef.current) {
        StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(() => {});
      }
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
            if (peer.id !== myId && !peerSessionsRef.current.has(peer.id)) {
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

      case 'session_established': {
        setHandshakeState('complete');
        break;
      }

      case 'encrypted_message': {
        await handleIncomingMessage(msg);
        break;
      }

      case 'file_manifest': {
        const manifest = msg.manifest as FileManifestPayload;
        const senderAlias = (msg.senderAlias as string) || 'Peer';
        const senderFingerprint = msg.senderFingerprint as string;
        const senderId = (msg.from as string) || 'peer';

        FileTransferService.registerIncomingFile(manifest, (progress) => {
          setTransferProgress(progress);
        });

        incomingFilesMetaRef.current.set(manifest.fileId, {
          senderId,
          senderAlias,
          senderFingerprint,
          timestamp: (msg.timestamp as number) || Date.now(),
        });

        // Hub relays manifest to all other spokes
        if (isHubRef.current && ws.current) {
          for (const [peerId] of peerSessionsRef.current.entries()) {
            if (peerId !== senderId) {
              ws.current.send(JSON.stringify({
                type: 'file_manifest',
                to: peerId,
                manifest,
                senderAlias,
                senderFingerprint,
                from: senderId,
              }));
            }
          }
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
        }
        break;
      }

      case 'mode_accepted': {
        break;
      }

      case 'error': {
        console.error('[QS] Server error:', msg.message);
        setRoomState(prev => ({ ...prev, error: msg.message as string }));
        break;
      }
    }
  }, [handleHandshakeOffer, handleHandshakeAnswer, initiateHandshakeToPeer, handleIncomingFileChunk]);

  // --- Send Encrypted Message (with Star re-encryption routing) ------------

  const sendMessage = useCallback(async (plaintext: string): Promise<void> => {
    if (!ws.current) {
      throw new Error('WebSocket not connected');
    }
    if (handshakeState !== 'complete' && peerSessionsRef.current.size === 0 && !sessionKeyBytes.current) {
      throw new Error('Handshake not complete — wait for secure channel');
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
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);

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

    // 1. Send File Manifest
    ws.current.send(JSON.stringify({
      type: 'file_manifest',
      manifest,
      senderAlias: identityRef.current?.alias || (isHubRef.current ? 'Hub' : 'Peer'),
      senderFingerprint: identityRef.current?.fingerprint,
      timestamp: Date.now(),
    }));

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
    };

    setMessages(prev => [...prev, chatMsg]);
    setSession(prev => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);

    if (identityRef.current && roomIdRef.current) {
      StorageService.saveMessage(chatMsg, roomIdRef.current, identityRef.current).catch(err => {
        console.error('[QS] Error persisting incoming encrypted message:', err);
      });
    }
  }, []);

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
    cleanup();
  }, [cleanup]);

  const clearHistory = useCallback(async () => {
    if (roomIdRef.current) {
      await StorageService.deleteRoomHistory(roomIdRef.current);
      setMessages([]);
    }
  }, []);

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
    transferProgress,
    connect,
    initiateHandshake,
    sendMessage,
    sendFile,
    disconnect,
    clearHistory,
  };
}
