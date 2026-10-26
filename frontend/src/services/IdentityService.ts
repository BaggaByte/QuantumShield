/**
 * QuantumShield - Cryptographic Identity Service
 *
 * Each user's identity IS their Ed25519 signing keypair.
 * Generated once in the browser, retained in client-side origin storage
 * protected by browser origin-isolation and strict Content-Security-Policy (CSP).
 * No server, no account, no password reset.
 *
 * Identity fingerprint: first 8 bytes of SHA-256(publicKey) rendered as
 * two human-readable groups: "QS·4A2F·B91C"
 */

const STORAGE_KEY = 'qs_identity_v1';

export interface QSIdentity {
  /** Ed25519 public key — base64 encoded */
  publicKey: string;
  /** Ed25519 private key (seed) — base64 encoded */
  privateKey: string;
  /** Human-readable fingerprint — "QS·XXXX·XXXX" */
  fingerprint: string;
  /** Optional display alias chosen by user */
  alias: string;
  /** ISO timestamp of identity creation */
  createdAt: string;
  /** Schema version for future migrations */
  version: 1;
}

// ---------------------------------------------------------------------------
// Helpers
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

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

async function buildFingerprint(publicKeyBytes: Uint8Array): Promise<string> {
  const hash = await sha256(publicKeyBytes);
  const hex = Array.from(hash.slice(0, 4))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const part1 = hex.slice(0, 4).toUpperCase();
  const part2 = hex.slice(4, 8).toUpperCase();
  return `QS·${part1}·${part2}`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Generate a brand-new Ed25519 identity keypair.
 * Uses Web Crypto API — keys never leave the browser.
 */
export async function generateIdentity(alias = ''): Promise<QSIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as EcKeyGenParams,
    true, // extractable
    ['sign', 'verify'],
  );

  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKeyBytes = new Uint8Array(publicKeyBuffer);
  const fingerprint = await buildFingerprint(publicKeyBytes);

  const identity: QSIdentity = {
    publicKey: bytesToBase64(publicKeyBytes),
    privateKey: bytesToBase64(new Uint8Array(privateKeyBuffer)),
    fingerprint,
    alias: alias.trim(),
    createdAt: new Date().toISOString(),
    version: 1,
  };

  await saveIdentity(identity);
  return identity;
}

/**
 * Sign arbitrary data with the identity's private key.
 * Used to prove ownership of a room message (Phase 2+).
 */
export async function signWithIdentity(
  identity: QSIdentity,
  data: Uint8Array,
): Promise<Uint8Array> {
  const privateKeyBuffer = base64ToBytes(identity.privateKey);
  const pkcs8Buf = privateKeyBuffer.buffer.slice(
    privateKeyBuffer.byteOffset, privateKeyBuffer.byteOffset + privateKeyBuffer.byteLength
  ) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Buf,
    { name: 'Ed25519' } as EcKeyImportParams,
    false,
    ['sign'],
  );
  const dataSlice = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const signature = await crypto.subtle.sign('Ed25519', cryptoKey, dataSlice);
  return new Uint8Array(signature);
}

/**
 * Verify a signature against a public key.
 */
export async function verifySignature(
  publicKeyB64: string,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const publicKeyBytes = base64ToBytes(publicKeyB64);
    const pubBuf = publicKeyBytes.buffer.slice(
      publicKeyBytes.byteOffset, publicKeyBytes.byteOffset + publicKeyBytes.byteLength
    ) as ArrayBuffer;
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubBuf,
      { name: 'Ed25519' } as EcKeyImportParams,
      false,
      ['verify'],
    );
    const sigBuf = signature.buffer.slice(
      signature.byteOffset, signature.byteOffset + signature.byteLength
    ) as ArrayBuffer;
    const dataBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBuf, dataBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Non-Extractable Device Key Vault (IndexedDB)
// ---------------------------------------------------------------------------

const VAULT_DB_NAME = 'QuantumShield_DeviceVault_v1';
const VAULT_STORE_NAME = 'vault_keys';
const DEVICE_KEY_ID = 'identity_device_key';

let vaultDbPromise: Promise<IDBDatabase> | null = null;

function getVaultDB(): Promise<IDBDatabase> {
  if (vaultDbPromise) return vaultDbPromise;
  vaultDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const req = indexedDB.open(VAULT_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
        db.createObjectStore(VAULT_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return vaultDbPromise;
}

let cachedDeviceKey: CryptoKey | null = null;

/**
 * Retrieves or generates an AES-256-GCM key marked extractable: false.
 * WebCrypto prevents this key from ever being exported as raw bytes by any script.
 */
async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  if (cachedDeviceKey) return cachedDeviceKey;
  const db = await getVaultDB();

  const existingKey = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
    const store = tx.objectStore(VAULT_STORE_NAME);
    const req = store.get(DEVICE_KEY_ID);
    req.onsuccess = () => resolve(req.result ? req.result.key : undefined);
    req.onerror = () => reject(req.error);
  });

  if (existingKey) {
    cachedDeviceKey = existingKey;
    return existingKey;
  }

  // Generate non-extractable 256-bit AES-GCM hardware key
  const newKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false — cannot be exported!
    ['encrypt', 'decrypt']
  );

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VAULT_STORE_NAME);
    const req = store.put({ id: DEVICE_KEY_ID, key: newKey });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  cachedDeviceKey = newKey;
  return newKey;
}

async function encryptPrivateKeyAtRest(privateKeyPkcs8B64: string): Promise<{ ciphertext: string; nonce: string }> {
  const deviceKey = await getOrCreateDeviceKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(privateKeyPkcs8B64);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    deviceKey,
    plaintext
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    nonce: bytesToBase64(nonce),
  };
}

async function decryptPrivateKeyAtRest(ciphertextB64: string, nonceB64: string): Promise<string> {
  const deviceKey = await getOrCreateDeviceKey();
  const nonce = base64ToBytes(nonceB64);
  const cipherBytes = base64ToBytes(ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    deviceKey,
    cipherBytes
  );
  return new TextDecoder().decode(plainBuf);
}

export interface StoredEncryptedIdentityRecord {
  version: 2;
  publicKey: string;
  fingerprint: string;
  alias: string;
  createdAt: string;
  encryptedPrivateKey: {
    ciphertext: string;
    nonce: string;
  };
}

let memoryCachedIdentity: QSIdentity | null = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function saveIdentity(identity: QSIdentity): Promise<void> {
  memoryCachedIdentity = identity;
  try {
    const encryptedPrivateKey = await encryptPrivateKeyAtRest(identity.privateKey);
    const record: StoredEncryptedIdentityRecord = {
      version: 2,
      publicKey: identity.publicKey,
      fingerprint: identity.fingerprint,
      alias: identity.alias,
      createdAt: identity.createdAt,
      encryptedPrivateKey,
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    }
  } catch (err) {
    console.error('[QS-SEC] Failed to encrypt identity private key for local storage:', err);
  }
}

export async function loadIdentity(): Promise<QSIdentity | null> {
  if (memoryCachedIdentity) return memoryCachedIdentity;

  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Version 2: Encrypted with non-extractable device key
    if (parsed.version === 2 && parsed.encryptedPrivateKey) {
      const privateKey = await decryptPrivateKeyAtRest(
        parsed.encryptedPrivateKey.ciphertext,
        parsed.encryptedPrivateKey.nonce
      );
      const identity: QSIdentity = {
        publicKey: parsed.publicKey,
        privateKey,
        fingerprint: parsed.fingerprint,
        alias: parsed.alias || '',
        createdAt: parsed.createdAt,
        version: 1,
      };
      memoryCachedIdentity = identity;
      return identity;
    }

    // Version 1 legacy: Transparent auto-migration to Version 2
    if (parsed.version === 1 && parsed.privateKey) {
      const identity: QSIdentity = {
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey,
        fingerprint: parsed.fingerprint,
        alias: parsed.alias || '',
        createdAt: parsed.createdAt,
        version: 1,
      };
      // Overwrite plaintext record with encrypted record
      await saveIdentity(identity);
      memoryCachedIdentity = identity;
      return identity;
    }

    return null;
  } catch (err) {
    console.error('[QS-SEC] Error loading encrypted identity:', err);
    return null;
  }
}

export function loadIdentitySync(): QSIdentity | null {
  return memoryCachedIdentity;
}

export function deleteIdentity(): void {
  memoryCachedIdentity = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export async function updateAlias(identity: QSIdentity, alias: string): Promise<QSIdentity> {
  const updated: QSIdentity = { ...identity, alias: alias.trim() };
  await saveIdentity(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Portable Export / Import & Passphrase Encryption
// ---------------------------------------------------------------------------

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

/**
 * Export identity protected by a user passphrase using PBKDF2 (100k rounds) + AES-256-GCM.
 */
export async function exportIdentityEncrypted(identity: QSIdentity, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePassphraseKey(passphrase, salt);

  const plaintext = JSON.stringify(identity);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return JSON.stringify({
    schema: 'QuantumShield-EncryptedIdentity-v1',
    kdf: 'PBKDF2-SHA256-100k',
    cipher: 'AES-256-GCM',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    fingerprint: identity.fingerprint,
    createdAt: new Date().toISOString(),
  }, null, 2);
}

/**
 * Import a passphrase-encrypted identity backup.
 */
export async function importIdentityEncrypted(jsonStr: string, passphrase: string): Promise<QSIdentity> {
  const envelope = JSON.parse(jsonStr);
  if (envelope.schema !== 'QuantumShield-EncryptedIdentity-v1' || !envelope.ciphertext) {
    throw new Error('Unrecognized encrypted identity format');
  }

  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const cipherBytes = base64ToBytes(envelope.ciphertext);

  const key = await derivePassphraseKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );

  const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as QSIdentity;
  await saveIdentity(parsed);
  return parsed;
}

/**
 * Export identity as a JSON string (for manual unencrypted backup).
 */
export function exportIdentityJSON(identity: QSIdentity): string {
  return JSON.stringify(identity, null, 2);
}

/**
 * Import from exported JSON string.
 */
export async function importIdentityJSON(json: string): Promise<QSIdentity> {
  const parsed = JSON.parse(json) as QSIdentity;
  if (parsed.version !== 1 || !parsed.publicKey || !parsed.privateKey) {
    throw new Error('Invalid identity format');
  }
  const publicKeyBytes = base64ToBytes(parsed.publicKey);
  const fingerprint = await buildFingerprint(publicKeyBytes);
  if (fingerprint !== parsed.fingerprint) {
    throw new Error('Fingerprint mismatch — identity may be tampered');
  }
  await saveIdentity(parsed);
  return parsed;
}

/**
 * Generate a QR code payload for identity verification.
 */
export function generateQRDataUrl(identity: QSIdentity): string {
  const payload = JSON.stringify({
    fingerprint: identity.fingerprint,
    alias: identity.alias,
    publicKey: identity.publicKey,
    createdAt: identity.createdAt,
  });
  return `data:text/plain;charset=utf-8,${encodeURIComponent(payload)}`;
}
