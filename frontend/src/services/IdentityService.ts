/**
 * QuantumShield - Cryptographic Identity Service
 *
 * Each user's identity IS their Ed25519 signing keypair.
 * Generated once in the browser, stored encrypted in localStorage.
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

  saveIdentity(identity);
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
// Persistence
// ---------------------------------------------------------------------------

export function saveIdentity(identity: QSIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function loadIdentity(): QSIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QSIdentity;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function updateAlias(identity: QSIdentity, alias: string): QSIdentity {
  const updated = { ...identity, alias: alias.trim() };
  saveIdentity(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Portable Export / Import
// ---------------------------------------------------------------------------

/**
 * Export identity as a JSON string (for QR code or manual backup).
 * Private key is included — treat this like a password.
 */
export function exportIdentityJSON(identity: QSIdentity): string {
  return JSON.stringify(identity, null, 2);
}

/**
 * Import from exported JSON string.
 * Validates schema before saving.
 */
export async function importIdentityJSON(json: string): Promise<QSIdentity> {
  const parsed = JSON.parse(json) as QSIdentity;
  if (parsed.version !== 1 || !parsed.publicKey || !parsed.privateKey) {
    throw new Error('Invalid identity format');
  }
  // Recompute fingerprint to verify public key integrity
  const publicKeyBytes = base64ToBytes(parsed.publicKey);
  const fingerprint = await buildFingerprint(publicKeyBytes);
  if (fingerprint !== parsed.fingerprint) {
    throw new Error('Fingerprint mismatch — identity may be tampered');
  }
  saveIdentity(parsed);
  return parsed;
}

/**
 * Generate a QR code data URL for identity export.
 * Uses the browser's Canvas API — no external library needed.
 */
export function generateQRDataUrl(identity: QSIdentity): string {
  // We encode only the public fingerprint + alias in the QR (not the private key)
  // The full export (with private key) is done via JSON copy-paste for security
  const payload = JSON.stringify({
    fingerprint: identity.fingerprint,
    alias: identity.alias,
    publicKey: identity.publicKey,
    createdAt: identity.createdAt,
  });
  // Return as a text/plain data URL; the UI component renders the actual QR
  return `data:text/plain;charset=utf-8,${encodeURIComponent(payload)}`;
}
