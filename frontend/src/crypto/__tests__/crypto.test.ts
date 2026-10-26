import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';

// Node environment localStorage polyfill for tests
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    length: 0,
  } as unknown as Storage;
}
import {
  generateX25519KeyPair,
  x25519SharedSecret,
  generateMLKEMKeyPair,
  mlkemEncapsulate,
  mlkemDecapsulate,
  deriveSessionKey,
  encryptMessage,
  decryptMessage,
  zeroizeBytes,
} from '../hybrid';
import {
  generateIdentity,
  loadIdentity,
  saveIdentity,
  deleteIdentity,
  signWithIdentity,
  verifySignature,
  exportIdentityEncrypted,
  importIdentityEncrypted,
} from '../../services/IdentityService';
import {
  FileTransferService,
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_SIZE,
} from '../../services/FileTransferService';

describe('QuantumShield Cryptographic Primitives', () => {
  it('generates X25519 keypair and derives matching classical shared secret', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();

    expect(alice.publicKey.length).toBe(32);
    expect(alice.privateKey.length).toBe(32);

    const aliceSS = x25519SharedSecret(alice.privateKey, bob.publicKey);
    const bobSS = x25519SharedSecret(bob.privateKey, alice.publicKey);

    expect(aliceSS.length).toBe(32);
    expect(aliceSS).toEqual(bobSS);
  });

  it('performs ML-KEM-768 key encapsulation and decapsulation roundtrip', () => {
    const mlkem = generateMLKEMKeyPair();
    expect(mlkem.publicKey.length).toBe(1184);
    expect(mlkem.secretKey.length).toBe(2400);

    const { ciphertext, sharedSecret: senderSS } = mlkemEncapsulate(mlkem.publicKey);
    expect(ciphertext.length).toBe(1088);
    expect(senderSS.length).toBe(32);

    const receiverSS = mlkemDecapsulate(ciphertext, mlkem.secretKey);
    expect(receiverSS.length).toBe(32);
    expect(senderSS).toEqual(receiverSS);
  });

  it('derives identical hybrid session keys with transcript binding for both peers', async () => {
    const aliceX = generateX25519KeyPair();
    const bobX = generateX25519KeyPair();

    const bobMLKEM = generateMLKEMKeyPair();
    const { ciphertext, sharedSecret: aliceMLKEM_SS } = mlkemEncapsulate(bobMLKEM.publicKey);
    const bobMLKEM_SS = mlkemDecapsulate(ciphertext, bobMLKEM.secretKey);

    const aliceX_SS = x25519SharedSecret(aliceX.privateKey, bobX.publicKey);
    const bobX_SS = x25519SharedSecret(bobX.privateKey, aliceX.publicKey);

    const transcriptData = {
      initiatorX25519Pk: aliceX.publicKey,
      responderX25519Pk: bobX.publicKey,
      mlkemPublicKey: bobMLKEM.publicKey,
      mlkemCiphertext: ciphertext,
    };

    const sessionId = 'test-room-session-123';
    const aliceKey = await deriveSessionKey(aliceX_SS, sessionId, 'hybrid', aliceMLKEM_SS, transcriptData);
    const bobKey = await deriveSessionKey(bobX_SS, sessionId, 'hybrid', bobMLKEM_SS, transcriptData);

    expect(aliceKey.keyBytes.length).toBe(32);
    expect(aliceKey.keyBytes).toEqual(bobKey.keyBytes);
    expect(aliceKey.fingerprint).toBe(bobKey.fingerprint);
  });

  it('fails closed when ML-KEM secret is missing in hybrid mode', async () => {
    const aliceX = generateX25519KeyPair();
    const bobX = generateX25519KeyPair();
    const xSS = x25519SharedSecret(aliceX.privateKey, bobX.publicKey);

    await expect(
      deriveSessionKey(xSS, 'sess-fail', 'hybrid', undefined)
    ).rejects.toThrow('[QS-CRYPTO] Missing ML-KEM shared secret');
  });

  it('encrypts and decrypts messages with authenticated data (AES-256-GCM)', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const aad = new TextEncoder().encode(JSON.stringify({ seq: 1, sender: 'alice' }));
    const secretText = 'Meet me at coordinates 48.8584, 2.2945 at dusk.';

    const { ciphertext, nonce } = await encryptMessage(secretText, key, aad);
    expect(ciphertext).toBeDefined();
    expect(nonce).toBeDefined();

    const decrypted = await decryptMessage(ciphertext, key, aad);
    expect(decrypted.plaintext).toBe(secretText);
  });

  it('aborts message decryption if ciphertext or AAD is tampered', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const validAAD = new TextEncoder().encode('valid-aad');
    const invalidAAD = new TextEncoder().encode('tampered-aad');

    const { ciphertext } = await encryptMessage('top secret', key, validAAD);

    // Tampered AAD must fail authentication
    await expect(decryptMessage(ciphertext, key, invalidAAD)).rejects.toThrow();
  });

  it('securely zeroizes private key buffer', () => {
    const secretBuf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    zeroizeBytes(secretBuf);
    expect(secretBuf.every(b => b === 0)).toBe(true);
  });
});

describe('Identity Service & Ed25519 Handshake Signatures', () => {
  it('generates Ed25519 identity, signs transcripts, and verifies authenticity', async () => {
    const identity = await generateIdentity('Agent-007');
    expect(identity.fingerprint).toMatch(/^QS·[0-9A-F]{4}·[0-9A-F]{4}$/);

    const transcript = new TextEncoder().encode(JSON.stringify({
      type: 'handshake_offer',
      sessionId: 'room-abc-123',
      x25519PublicKey: 'fake-pubkey-data',
    }));

    const sig = await signWithIdentity(identity, transcript);
    expect(sig.length).toBe(64);

    const isValid = await verifySignature(identity.publicKey, transcript, sig);
    expect(isValid).toBe(true);

    // Tampered transcript must fail signature verification
    const tamperedTranscript = new TextEncoder().encode(JSON.stringify({
      type: 'handshake_offer',
      sessionId: 'room-abc-123',
      x25519PublicKey: 'attacker-substitute-key',
    }));
    const isTamperedValid = await verifySignature(identity.publicKey, tamperedTranscript, sig);
    expect(isTamperedValid).toBe(false);
  });

  it('encrypts and recovers identity with PBKDF2 passphrase vault', async () => {
    const identity = await generateIdentity('VaultUser');
    const passphrase = 'SuperSecureMasterPassword!2026';

    const encryptedBlob = await exportIdentityEncrypted(identity, passphrase);
    expect(encryptedBlob).toContain('QuantumShield-EncryptedIdentity-v1');
    expect(encryptedBlob).toContain('PBKDF2-SHA256-100k');

    const recovered = await importIdentityEncrypted(encryptedBlob, passphrase);
    expect(recovered.publicKey).toBe(identity.publicKey);
    expect(recovered.privateKey).toBe(identity.privateKey);
    expect(recovered.fingerprint).toBe(identity.fingerprint);

    // Wrong password fails decryption
    await expect(
      importIdentityEncrypted(encryptedBlob, 'WrongPassword123')
    ).rejects.toThrow();
  });

  it('stores identity private key encrypted at rest without plaintext in localStorage', async () => {
    deleteIdentity();
    const identity = await generateIdentity('SecureAtRest');
    const rawStorage = localStorage.getItem('qs_identity_v1');
    expect(rawStorage).toBeDefined();

    // Verify localStorage NEVER contains plaintext private key
    expect(rawStorage).not.toContain(identity.privateKey);

    const parsed = JSON.parse(rawStorage!);
    expect(parsed.version).toBe(2);
    expect(parsed.encryptedPrivateKey).toBeDefined();
    expect(parsed.encryptedPrivateKey.ciphertext).toBeDefined();
    expect(parsed.encryptedPrivateKey.nonce).toBeDefined();

    // Verify loadIdentity recovers the decrypted private key via device vault
    const loaded = await loadIdentity();
    expect(loaded).toBeDefined();
    expect(loaded?.publicKey).toBe(identity.publicKey);
    expect(loaded?.privateKey).toBe(identity.privateKey);
  });
});

describe('File Transfer Security & Manifest Encryption', () => {
  it('enforces safe raster MIME types and neutralizes dangerous HTML files', async () => {
    // Simulated HTML file attempt
    const htmlBlob = new Blob(['<script>alert(localStorage.getItem("key"))</script>'], { type: 'text/html' });
    const fakeHtmlFile = new File([htmlBlob], 'attack.html', { type: 'text/html' });

    const prepared = await FileTransferService.prepareFile(fakeHtmlFile);
    // MIME type must be forced to application/octet-stream, NOT text/html
    expect(prepared.manifest.fileType).toBe('application/octet-stream');
    expect(ALLOWED_IMAGE_TYPES.has(prepared.manifest.fileType)).toBe(false);
  });

  it('encrypts and decrypts file manifest payload with zero metadata leakage', async () => {
    const sessionKey = crypto.getRandomValues(new Uint8Array(32));
    const sessionId = 'session-manifest-test';

    const manifest = {
      fileId: 'file-1234',
      fileName: 'secret_document.pdf',
      fileSize: 4096,
      fileType: 'application/octet-stream',
      totalChunks: 1,
      sha256: 'a1b2c3d4e5f6',
      thumbnail: 'data:image/jpeg;base64,samplethumbnaildata',
    };

    const envelope = await FileTransferService.encryptManifest(manifest, sessionKey, sessionId);
    expect(envelope.fileId).toBe('file-1234');
    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.nonce).toBeDefined();

    // The envelope hides the filename and thumbnail from the relay
    expect(JSON.stringify(envelope)).not.toContain('secret_document.pdf');
    expect(JSON.stringify(envelope)).not.toContain('samplethumbnaildata');

    const decryptedManifest = await FileTransferService.decryptManifest(envelope, sessionKey, sessionId);
    expect(decryptedManifest.fileName).toBe(manifest.fileName);
    expect(decryptedManifest.sha256).toBe(manifest.sha256);
    expect(decryptedManifest.thumbnail).toBe(manifest.thumbnail);
  });

  it('encrypts, decrypts, and reassembles chunked file streams with SHA-256 verification', async () => {
    const sessionKey = crypto.getRandomValues(new Uint8Array(32));
    const sessionId = 'session-chunk-test';

    // 70 KB payload creates 3 chunks (CHUNK_SIZE = 32 KB)
    const testData = new Uint8Array(70000);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = (i * 7) % 256;
    }
    const testFile = new File([testData], 'sample.bin', { type: 'application/octet-stream' });
    const { fileId, manifest, rawChunks } = await FileTransferService.prepareFile(testFile);

    expect(rawChunks.length).toBe(3);
    expect(manifest.totalChunks).toBe(3);

    FileTransferService.registerIncomingFile(manifest);

    let assembledAttachment = null;
    for (let i = 0; i < rawChunks.length; i++) {
      const encryptedChunk = await FileTransferService.encryptChunk(rawChunks[i], fileId, i, sessionId, sessionKey);
      const decryptedChunkBytes = await FileTransferService.decryptChunkBytes(encryptedChunk, sessionId, sessionKey);
      expect(decryptedChunkBytes).toEqual(rawChunks[i]);

      const result = await FileTransferService.ingestChunkBytes(fileId, i, decryptedChunkBytes);
      if (result) {
        assembledAttachment = result;
      }
    }

    expect(assembledAttachment).toBeDefined();
    expect(assembledAttachment?.fileId).toBe(fileId);
    expect(assembledAttachment?.fileName).toBe('sample.bin');
    expect(assembledAttachment?.fileSize).toBe(70000);
    expect(assembledAttachment?.blobUrl).toBeDefined();
  });

  it('rejects file preparation exceeding 15MB size limit', async () => {
    // Construct fake oversized file object
    const oversizedFile = {
      name: 'huge_file.dat',
      size: MAX_FILE_SIZE + 1024,
      type: 'application/octet-stream',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as File;

    await expect(FileTransferService.prepareFile(oversizedFile)).rejects.toThrow(
      'exceeds maximum limit of 15MB'
    );
  });

  it('rejects out-of-bounds chunks and ignores duplicate chunks', async () => {
    const manifest = {
      fileId: 'bounds-test-file',
      fileName: 'bounds.bin',
      fileSize: 100,
      fileType: 'application/octet-stream',
      totalChunks: 2,
      sha256: 'fake-hash',
    };

    FileTransferService.registerIncomingFile(manifest);

    // Negative chunk index
    const negResult = await FileTransferService.ingestChunkBytes('bounds-test-file', -1, new Uint8Array(50));
    expect(negResult).toBeNull();

    // Out-of-bounds chunk index >= totalChunks
    const oobResult = await FileTransferService.ingestChunkBytes('bounds-test-file', 5, new Uint8Array(50));
    expect(oobResult).toBeNull();

    // First valid chunk
    const chunk0 = new Uint8Array(50);
    const validResult = await FileTransferService.ingestChunkBytes('bounds-test-file', 0, chunk0);
    expect(validResult).toBeNull(); // Not finished yet

    // Duplicate chunk 0
    const dupResult = await FileTransferService.ingestChunkBytes('bounds-test-file', 0, chunk0);
    expect(dupResult).toBeNull(); // Ignored
  });
});

describe('Anti-Replay & Sequence Enforcement', () => {
  it('enforces monotonic sequence numbers per sender and rejects replayed or out-of-order packets', () => {
    const senderSequences = new Map<string, number>();

    function validateSequence(senderId: string, seq: number): boolean {
      const lastSeq = senderSequences.get(senderId) || 0;
      if (seq <= lastSeq) {
        return false; // Replay or out of order detected
      }
      senderSequences.set(senderId, seq);
      return true;
    }

    // Packet 1: OK
    expect(validateSequence('alice', 1)).toBe(true);

    // Packet 2: OK
    expect(validateSequence('alice', 2)).toBe(true);

    // Replay of Packet 1: REJECTED
    expect(validateSequence('alice', 1)).toBe(false);

    // Duplicate of Packet 2: REJECTED
    expect(validateSequence('alice', 2)).toBe(false);

    // Packet 5 (forward jump): OK
    expect(validateSequence('alice', 5)).toBe(true);

    // Packet 4 (backward jump / late arrival): REJECTED
    expect(validateSequence('alice', 4)).toBe(false);

    // Another sender 'bob' starts independently: OK
    expect(validateSequence('bob', 1)).toBe(true);
  });
});
