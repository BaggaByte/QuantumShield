/**
 * QuantumShield - Hybrid Cryptographic Core
 *
 * Implements:
 *  Mode A (classical): X25519 ECDH ? HKDF-SHA-256 ? AES-256-GCM
 *  Mode B (hybrid):    X25519 + ML-KEM-768 ? HKDF-SHA-256 ? AES-256-GCM
 *
 * Libraries used:
 *  @noble/curves    v2.4.0  — x25519 (from ed25519.js)
 *  @noble/post-quantum v0.7.1 — ML-KEM-768 (FIPS 203)
 *  @noble/ciphers   v2.4.0  — AES-256-GCM (from aes.js)
 *  @noble/ciphers/utils     — randomBytes
 *  Web Crypto API           — HKDF-SHA-256, SHA-256 digest
 *
 * EDUCATIONAL PROTOTYPE — Not production-ready. Not formally audited.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';

// --- Utility helpers ----------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export async function fingerprintKey(keyBytes: Uint8Array): Promise<string> {
  const digest = await sha256(keyBytes);
  return Array.from(digest.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(':');
}

// --- HKDF Key Derivation -----------------------------------------------------

export async function deriveSessionKey(
  x25519SharedSecret: Uint8Array,
  sessionId: string,
  mode: 'classical' | 'hybrid',
  mlkemSharedSecret?: Uint8Array,
): Promise<{ keyBytes: Uint8Array; fingerprint: string }> {
  let ikm: Uint8Array;
  if (mode === 'hybrid' && mlkemSharedSecret) {
    ikm = new Uint8Array(x25519SharedSecret.length + mlkemSharedSecret.length);
    ikm.set(x25519SharedSecret, 0);
    ikm.set(mlkemSharedSecret, x25519SharedSecret.length);
  } else {
    ikm = new Uint8Array(x25519SharedSecret);
  }

  const infoStr = `QuantumShield-v1|${mode}|X25519${mode === 'hybrid' ? '+ML-KEM-768' : ''}|AES-256-GCM|session:${sessionId}`;
  const infoBytes = new TextEncoder().encode(infoStr);
  const saltBytes = await sha256(new TextEncoder().encode(`QuantumShield-salt|${sessionId}`));

  const ikmKey = await crypto.subtle.importKey(
    'raw', ikm.buffer.slice(ikm.byteOffset, ikm.byteOffset + ikm.byteLength),
    'HKDF', false, ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes.buffer.slice(saltBytes.byteOffset, saltBytes.byteOffset + saltBytes.byteLength),
      info: infoBytes.buffer.slice(infoBytes.byteOffset, infoBytes.byteOffset + infoBytes.byteLength),
    },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  const exportedBuffer = await crypto.subtle.exportKey('raw', derivedKey);
  const keyBytes = new Uint8Array(exportedBuffer);
  const fingerprint = await fingerprintKey(keyBytes);

  return { keyBytes, fingerprint };
}

// --- X25519 ------------------------------------------------------------------

export interface X25519KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function x25519SharedSecret(myPrivKey: Uint8Array, theirPubKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(myPrivKey, theirPubKey);
}

// --- ML-KEM-768 --------------------------------------------------------------

export interface MLKEMKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateMLKEMKeyPair(): MLKEMKeyPair {
  const keys = ml_kem768.keygen();
  return { publicKey: keys.publicKey, secretKey: keys.secretKey };
}

export function mlkemEncapsulate(recipientPublicKey: Uint8Array): {
  ciphertext: Uint8Array;
  sharedSecret: Uint8Array;
} {
  const result = ml_kem768.encapsulate(recipientPublicKey);
  return { ciphertext: result.cipherText, sharedSecret: result.sharedSecret };
}

export function mlkemDecapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(ciphertext, secretKey);
}

// --- AES-256-GCM -------------------------------------------------------------

const NONCE_SIZE = 12;

export interface EncryptResult {
  ciphertext: string;
  nonce: string;
  algorithm: 'AES-256-GCM';
  durationMs: number;
}

export async function encryptMessage(
  plaintext: string,
  sessionKeyBytes: Uint8Array,
  aad: Uint8Array,
): Promise<EncryptResult> {
  const t0 = performance.now();
  const nonce = randomBytes(NONCE_SIZE);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const aadBytes = new Uint8Array(aad);

  const cipher = gcm(sessionKeyBytes, nonce, aadBytes);
  const encrypted = cipher.encrypt(plaintextBytes);

  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce, 0);
  combined.set(encrypted, nonce.length);

  return {
    ciphertext: bytesToBase64(combined),
    nonce: bytesToBase64(nonce),
    algorithm: 'AES-256-GCM',
    durationMs: performance.now() - t0,
  };
}

export async function decryptMessage(
  ciphertextB64: string,
  sessionKeyBytes: Uint8Array,
  aad: Uint8Array,
): Promise<{ plaintext: string; durationMs: number }> {
  const t0 = performance.now();
  const combined = base64ToBytes(ciphertextB64);

  if (combined.length < NONCE_SIZE + 16) {
    throw new Error('Ciphertext too short');
  }

  const nonce = combined.slice(0, NONCE_SIZE);
  const encrypted = combined.slice(NONCE_SIZE);
  const aadBytes = new Uint8Array(aad);

  const cipher = gcm(sessionKeyBytes, nonce, aadBytes);
  const plaintextBytes = cipher.decrypt(encrypted);

  return {
    plaintext: new TextDecoder().decode(plaintextBytes),
    durationMs: performance.now() - t0,
  };
}

// --- Key Sizes Reference -----------------------------------------------------

export const KEY_SIZES = {
  x25519: { publicKey: 32, privateKey: 32, sharedSecret: 32 },
  mlkem768: { publicKey: 1184, secretKey: 2400, ciphertext: 1088, sharedSecret: 32 },
  aesGcm: { key: 32, nonce: 12 },
} as const;
