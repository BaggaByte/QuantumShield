// --- Crypto Types -------------------------------------------------------------

export type CryptoMode = 'classical' | 'hybrid';

export type HandshakeState =
  | 'idle'
  | 'generating_keys'
  | 'waiting_peer'
  | 'exchanging'
  | 'deriving'
  | 'complete'
  | 'failed';

export interface KeySizes {
  x25519PublicKey: number;
  mlkemPublicKey?: number;
  mlkemCiphertext?: number;
  totalHandshakeBytes: number;
}

export interface SessionState {
  sessionId: string;
  mode: CryptoMode;
  handshakeState: HandshakeState;
  handshakeStartedAt?: number;
  handshakeDurationMs?: number;
  keyGenDurationMs?: number;
  sessionKeyFingerprint?: string;   // SHA-256 prefix of derived key (safe to display)
  keySizes?: KeySizes;
  messageCount: number;
  errorMessage?: string;
}

// --- Message Types ------------------------------------------------------------

export interface EncryptedPayload {
  ciphertext: string;   // base64
  nonce: string;        // base64
  tag?: string;         // base64 (for GCM, tag is appended to ciphertext by noble)
}

export interface MessageMeta {
  messageId: string;
  sessionId: string;
  senderId: string;
  sequenceNumber: number;
  algorithm: string;
  timestamp: number;
  encryptDurationMs?: number;
  decryptDurationMs?: number;
  authVerified?: boolean;
}

export type MessageDeliveryStatus = 'sending' | 'sent' | 'delivered';

export interface FileAttachment {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  blobUrl?: string;
  dataUrl?: string;
  isImage: boolean;
}

export interface FileTransferProgress {
  fileId: string;
  fileName: string;
  totalChunks: number;
  transferredChunks: number;
  percentage: number;
  direction: 'sending' | 'receiving';
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  roomId?: string;
  senderId: string;
  senderRole: 'self' | 'peer';
  plaintext: string;
  encryptedPayload?: EncryptedPayload;
  meta: MessageMeta;
  displayedAt: number;
  authVerified: boolean;
  status?: MessageDeliveryStatus;
  senderAlias?: string;
  senderFingerprint?: string;
  attachment?: FileAttachment;
}

export interface EncryptedStoredRecord {
  id: string;
  roomId: string;
  timestamp: number;
  status: MessageDeliveryStatus;
  nonce: string;       // base64
  ciphertext: string;  // base64 AES-256-GCM ciphertext
}

export interface StoredRoomSummary {
  roomId: string;
  lastActivity: number;
  messageCount: number;
  lastMessageSnippet?: string;
}

// --- Room / WebSocket Types ---------------------------------------------------

export type ParticipantRole = 'hub' | 'spoke' | 'initiator' | 'responder' | 'unknown';

export interface RoomParticipant {
  id: string;
  role: ParticipantRole;
  alias?: string;
  fingerprint?: string;
  connected_at?: number;
}

export interface RoomState {
  roomId?: string;
  participantId?: string;
  role: ParticipantRole;
  participantCount: number;
  participants: RoomParticipant[];
  hubId?: string;
  isHub: boolean;
  connected: boolean;
  error?: string;
}

// --- Benchmark Types ---------------------------------------------------------

export interface BenchmarkConfig {
  mode: CryptoMode;
  trials: number;
  messageSizeBytes: number;
  simulatedLatencyMs: number;
  simulatedPacketLossPercent: number;
}

export interface TrialResult {
  trial: number;
  keyGenMs: number;
  handshakeMs: number;
  encryptMs: number;
  decryptMs: number;
  handshakeBytesTotal: number;
  success: boolean;
  error?: string;
  simulated: boolean;
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  trials: TrialResult[];
  summary: {
    totalTrials: number;
    successfulTrials: number;
    failedTrials: number;
    keyGen: { median: number; p95: number; min: number; max: number };
    handshake: { median: number; p95: number; min: number; max: number };
    encrypt: { median: number; p95: number; min: number; max: number };
    decrypt: { median: number; p95: number; min: number; max: number };
    handshakeBytesTotal: number;
    x25519PublicKeyBytes: number;
    mlkemPublicKeyBytes?: number;
    mlkemCiphertextBytes?: number;
  };
  runAt: string;
  notes: string;
}

// --- Security Test Types ------------------------------------------------------

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip';

export interface SecurityTest {
  id: string;
  name: string;
  description: string;
  status: TestStatus;
  details?: string;
  durationMs?: number;
}
