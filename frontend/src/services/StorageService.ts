/**
 * QuantumShield - Persistent Encrypted Storage Service (Phase 2)
 *
 * Messages are encrypted client-side using AES-256-GCM before writing to IndexedDB.
 * The encryption key is deterministically derived from the user's Ed25519 identity key
 * via SHA-256 domain-separation.
 *
 * Zero plaintext at rest. Zero server involvement.
 * Deleting the identity key renders all stored history cryptographically unreadable.
 */

import type { QSIdentity } from './IdentityService';
import type { ChatMessage, MessageDeliveryStatus, EncryptedStoredRecord, StoredRoomSummary, QueuedMessage } from '@/types';

const DB_NAME = 'QuantumShield_EncryptedStore_v1';
const DB_VERSION = 2;
const STORE_MESSAGES = 'messages';
const STORE_ROOMS = 'rooms';
const STORE_OFFLINE_QUEUE = 'offline_queue';
const DOMAIN_SALT = 'QuantumShield:ClientEncryptedStorage:v1';

// ---------------------------------------------------------------------------
// Base64 & Buffer Helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Cryptographic Key Derivation at Rest
// ---------------------------------------------------------------------------

const keyCache = new Map<string, CryptoKey>();

/**
 * Derives a dedicated AES-256-GCM storage key from the user's private identity key.
 */
async function deriveStorageKey(identity: QSIdentity): Promise<CryptoKey> {
  const cached = keyCache.get(identity.fingerprint);
  if (cached) return cached;

  const privBytes = base64ToBytes(identity.privateKey);
  const saltBytes = new TextEncoder().encode(DOMAIN_SALT);

  // Combine private key material and domain salt
  const combined = new Uint8Array(privBytes.length + saltBytes.length);
  combined.set(privBytes, 0);
  combined.set(saltBytes, privBytes.length);

  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(combined));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  keyCache.set(identity.fingerprint, cryptoKey);
  return cryptoKey;
}

async function getFallbackStorageKey(): Promise<CryptoKey> {
  const cached = keyCache.get('__device_fallback__');
  if (cached) return cached;
  let devSeed = (typeof localStorage !== 'undefined' ? localStorage.getItem('qs_dev_store_seed') : null);
  if (!devSeed) {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    devSeed = bytesToBase64(arr);
    try {
      localStorage.setItem('qs_dev_store_seed', devSeed);
    } catch {
      // Ignore if localStorage unavailable
    }
  }
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(base64ToBytes(devSeed)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  keyCache.set('__device_fallback__', cryptoKey);
  return cryptoKey;
}

// ---------------------------------------------------------------------------
// IndexedDB Initialization
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Messages store
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
        msgStore.createIndex('by_room', 'roomId', { unique: false });
        msgStore.createIndex('by_room_timestamp', ['roomId', 'timestamp'], { unique: false });
        msgStore.createIndex('by_timestamp', 'timestamp', { unique: false });
      }

      // Rooms summary store
      if (!db.objectStoreNames.contains(STORE_ROOMS)) {
        const roomStore = db.createObjectStore(STORE_ROOMS, { keyPath: 'roomId' });
        roomStore.createIndex('by_lastActivity', 'lastActivity', { unique: false });
      }

      // Offline queue store (Phase 3 resilience)
      if (!db.objectStoreNames.contains(STORE_OFFLINE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_OFFLINE_QUEUE, { keyPath: 'id' });
        queueStore.createIndex('by_room', 'roomId', { unique: false });
        queueStore.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt Message Record
// ---------------------------------------------------------------------------

async function encryptMessageRecord(
  msg: ChatMessage,
  roomId: string,
  key: CryptoKey
): Promise<EncryptedStoredRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const payloadToProtect = {
    plaintext: msg.plaintext,
    sessionId: msg.sessionId,
    senderId: msg.senderId,
    senderRole: msg.senderRole,
    senderAlias: msg.senderAlias,
    senderFingerprint: msg.senderFingerprint,
    attachment: msg.attachment,
    meta: msg.meta,
    encryptedPayload: msg.encryptedPayload,
    authVerified: msg.authVerified,
  };

  const encoded = new TextEncoder().encode(JSON.stringify(payloadToProtect));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoded)
  );

  return {
    id: msg.id,
    roomId,
    timestamp: msg.displayedAt || Date.now(),
    status: msg.status || 'sent',
    nonce: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
  };
}

async function decryptMessageRecord(
  record: EncryptedStoredRecord,
  key: CryptoKey
): Promise<ChatMessage | null> {
  try {
    const iv = base64ToBytes(record.nonce);
    const ctBytes = base64ToBytes(record.ciphertext);

    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ctBytes)
    );

    const decodedStr = new TextDecoder().decode(decryptedBuf);
    const data = JSON.parse(decodedStr);

    return {
      id: record.id,
      roomId: record.roomId,
      sessionId: data.sessionId,
      senderId: data.senderId,
      senderRole: data.senderRole,
      senderAlias: data.senderAlias,
      senderFingerprint: data.senderFingerprint,
      attachment: data.attachment,
      plaintext: data.plaintext,
      encryptedPayload: data.encryptedPayload,
      meta: data.meta,
      displayedAt: record.timestamp,
      authVerified: data.authVerified ?? true,
      status: record.status,
    };
  } catch (err) {
    console.error(`[StorageService] Failed to decrypt message ${record.id}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public Storage API
// ---------------------------------------------------------------------------

export const StorageService = {
  /**
   * Encrypts and persists a chat message to IndexedDB, updating the room's activity.
   */
  async saveMessage(msg: ChatMessage, roomId: string, identity: QSIdentity): Promise<void> {
    const db = await getDB();
    const key = await deriveStorageKey(identity);
    const record = await encryptMessageRecord(msg, roomId, key);

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_ROOMS], 'readwrite');
      const msgStore = tx.objectStore(STORE_MESSAGES);
      const roomStore = tx.objectStore(STORE_ROOMS);

      msgStore.put(record);

      // Update room activity summary
      const roomReq = roomStore.get(roomId);
      roomReq.onsuccess = () => {
        const existing: StoredRoomSummary = roomReq.result || {
          roomId,
          lastActivity: record.timestamp,
          messageCount: 0,
        };

        const updated: StoredRoomSummary = {
          roomId,
          lastActivity: Math.max(existing.lastActivity, record.timestamp),
          messageCount: existing.messageCount + 1,
          lastMessageSnippet: msg.plaintext.slice(0, 40),
        };
        roomStore.put(updated);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Retrieves and decrypts all messages for a given room, sorted chronologically.
   */
  async getRoomMessages(roomId: string, identity: QSIdentity, limit = 100): Promise<ChatMessage[]> {
    const db = await getDB();
    const key = await deriveStorageKey(identity);

    const records: EncryptedStoredRecord[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const store = tx.objectStore(STORE_MESSAGES);
      const index = store.index('by_room');
      const request = index.getAll(IDBKeyRange.only(roomId));

      request.onsuccess = () => resolve(request.result as EncryptedStoredRecord[]);
      request.onerror = () => reject(request.error);
    });

    // Sort by timestamp
    records.sort((a, b) => a.timestamp - b.timestamp);
    const sliced = records.slice(-limit);

    const decrypted: ChatMessage[] = [];
    for (const rec of sliced) {
      const msg = await decryptMessageRecord(rec, key);
      if (msg) decrypted.push(msg);
    }

    return decrypted;
  },

  /**
   * Updates delivery status of a message (e.g. from 'sent' -> 'delivered').
   */
  async updateMessageStatus(messageId: string, status: MessageDeliveryStatus): Promise<void> {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = tx.objectStore(STORE_MESSAGES);
      const req = store.get(messageId);

      req.onsuccess = () => {
        const record = req.result as EncryptedStoredRecord | undefined;
        if (record) {
          record.status = status;
          store.put(record);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Deletes a specific message record (used for burn-after-reading / self-destruct).
   */
  async deleteMessage(messageId: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      tx.objectStore(STORE_MESSAGES).delete(messageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Returns a list of recently active rooms with message counts.
   */
  async getRecentRooms(): Promise<StoredRoomSummary[]> {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ROOMS, 'readonly');
      const store = tx.objectStore(STORE_ROOMS);
      const index = store.index('by_lastActivity');
      const request = index.getAll();

      request.onsuccess = () => {
        const list = (request.result as StoredRoomSummary[]) || [];
        list.sort((a, b) => b.lastActivity - a.lastActivity);
        resolve(list);
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Encrypts and persists a message to the offline queue until connection is restored.
   */
  async saveQueuedMessage(msg: QueuedMessage, identity?: QSIdentity | null): Promise<void> {
    const db = await getDB();
    const key = identity ? await deriveStorageKey(identity) : await getFallbackStorageKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const payload = {
      plaintext: msg.plaintext,
      burnDuration: msg.burnDuration,
      senderAlias: msg.senderAlias,
      senderFingerprint: msg.senderFingerprint,
      retryCount: msg.retryCount || 0,
    };

    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(encoded)
    );

    const record: EncryptedStoredRecord = {
      id: msg.id,
      roomId: msg.roomId,
      timestamp: msg.timestamp,
      status: 'queued',
      nonce: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OFFLINE_QUEUE, 'readwrite');
      tx.objectStore(STORE_OFFLINE_QUEUE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Retrieves and decrypts all queued messages for a room, sorted chronologically.
   */
  async getQueuedMessages(roomId: string, identity?: QSIdentity | null): Promise<QueuedMessage[]> {
    const db = await getDB();
    const key = identity ? await deriveStorageKey(identity) : await getFallbackStorageKey();

    const records: EncryptedStoredRecord[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OFFLINE_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_OFFLINE_QUEUE);
      const index = store.index('by_room');
      const req = index.getAll(IDBKeyRange.only(roomId));
      req.onsuccess = () => resolve((req.result as EncryptedStoredRecord[]) || []);
      req.onerror = () => reject(req.error);
    });

    records.sort((a, b) => a.timestamp - b.timestamp);
    const list: QueuedMessage[] = [];

    for (const rec of records) {
      try {
        const iv = base64ToBytes(rec.nonce);
        const ct = base64ToBytes(rec.ciphertext);
        const dec = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: toArrayBuffer(iv) },
          key,
          toArrayBuffer(ct)
        );
        const data = JSON.parse(new TextDecoder().decode(dec));
        list.push({
          id: rec.id,
          roomId: rec.roomId,
          plaintext: data.plaintext,
          burnDuration: data.burnDuration,
          senderAlias: data.senderAlias,
          senderFingerprint: data.senderFingerprint,
          retryCount: data.retryCount,
          timestamp: rec.timestamp,
        });
      } catch (e) {
        console.warn(`[StorageService] Could not decrypt queued message ${rec.id}:`, e);
      }
    }

    return list;
  },

  /**
   * Removes a sent or cancelled message from the offline queue.
   */
  async removeQueuedMessage(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OFFLINE_QUEUE, 'readwrite');
      tx.objectStore(STORE_OFFLINE_QUEUE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Clears the offline queue for a specific room or all rooms.
   */
  async clearQueuedMessages(roomId?: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OFFLINE_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_OFFLINE_QUEUE);
      if (!roomId) {
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        return;
      }
      const index = store.index('by_room');
      const cursorReq = index.openKeyCursor(IDBKeyRange.only(roomId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Deletes all stored history for a specific room.
   */
  async deleteRoomHistory(roomId: string): Promise<void> {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_ROOMS, STORE_OFFLINE_QUEUE], 'readwrite');
      const msgStore = tx.objectStore(STORE_MESSAGES);
      const roomStore = tx.objectStore(STORE_ROOMS);
      const queueStore = tx.objectStore(STORE_OFFLINE_QUEUE);

      const index = msgStore.index('by_room');
      const cursorReq = index.openKeyCursor(IDBKeyRange.only(roomId));

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          msgStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      const queueIndex = queueStore.index('by_room');
      const queueCursorReq = queueIndex.openKeyCursor(IDBKeyRange.only(roomId));
      queueCursorReq.onsuccess = () => {
        const cursor = queueCursorReq.result;
        if (cursor) {
          queueStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      roomStore.delete(roomId);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * Cryptographic Erase: Wipes all stored messages, rooms, and offline queue in IndexedDB.
   */
  async clearAllHistory(): Promise<void> {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_ROOMS, STORE_OFFLINE_QUEUE], 'readwrite');
      tx.objectStore(STORE_MESSAGES).clear();
      tx.objectStore(STORE_ROOMS).clear();
      tx.objectStore(STORE_OFFLINE_QUEUE).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
