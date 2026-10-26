/**
 * QuantumShield - File Transfer Service (Phase 4)
 *
 * Files are chunked into 32KB blocks, client-side encrypted with AES-256-GCM
 * using session keys and sequence-number-bound AAD.
 *
 * The server sees only opaque base64 chunk packets.
 * Decrypted files are assembled in browser memory as blob URLs.
 */

import { encryptMessage, decryptMessage, bytesToBase64, base64ToBytes } from '@/crypto/hybrid';
import type { FileAttachment, FileTransferProgress } from '@/types';

export const CHUNK_SIZE = 32768; // 32 KB
export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB cap to prevent buffer exhaustion attacks
export const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface FileManifestPayload {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  sha256: string;
  thumbnail?: string; // encrypted along with the manifest
}

export interface EncryptedManifestEnvelope {
  fileId: string;
  ciphertext: string;
  nonce: string;
}

export interface FileChunkPayload {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  ciphertext: string;
  nonce: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

async function computeSHA256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a small client-side image thumbnail (< 15KB) for instant preview
 */
export async function generateThumbnail(file: File): Promise<string | undefined> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) return undefined;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 320;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.65));
        } else {
          resolve(undefined);
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Chunk Assembler for Incoming Files
// ---------------------------------------------------------------------------

interface PendingFileTransfer {
  manifest: FileManifestPayload;
  receivedChunks: Map<number, Uint8Array>;
  totalChunks: number;
  onProgress?: (progress: FileTransferProgress) => void;
}

const pendingTransfers = new Map<string, PendingFileTransfer>();

export const FileTransferService = {
  /**
   * Prepares a file for encrypted chunk streaming.
   * Enforces 15MB size limit and restricts MIME types to safe raster images or octet-stream.
   */
  async prepareFile(file: File): Promise<{
    fileId: string;
    manifest: FileManifestPayload;
    rawChunks: Uint8Array[];
    thumbnail?: string;
  }> {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 15MB`);
    }

    const fileId = crypto.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    const fullBytes = new Uint8Array(arrayBuffer);
    const sha256 = await computeSHA256(fullBytes);
    const thumbnail = await generateThumbnail(file);

    // Sanitize MIME type: allow only verified raster images, force application/octet-stream for everything else
    const safeMimeType = ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())
      ? file.type.toLowerCase()
      : 'application/octet-stream';

    const rawChunks: Uint8Array[] = [];
    for (let offset = 0; offset < fullBytes.length; offset += CHUNK_SIZE) {
      rawChunks.push(fullBytes.slice(offset, offset + CHUNK_SIZE));
    }

    const manifest: FileManifestPayload = {
      fileId,
      fileName: file.name.replace(/[^\w.\- ]/g, '_'), // Sanitize file name
      fileSize: file.size,
      fileType: safeMimeType,
      totalChunks: rawChunks.length,
      sha256,
      thumbnail,
    };

    return { fileId, manifest, rawChunks, thumbnail };
  },

  /**
   * Encrypts a manifest payload with AES-256-GCM.
   */
  async encryptManifest(
    manifest: FileManifestPayload,
    sessionKey: Uint8Array,
    sessionId: string
  ): Promise<EncryptedManifestEnvelope> {
    const aad = new TextEncoder().encode(JSON.stringify({ fileId: manifest.fileId, sessionId, type: 'manifest' }));
    const plaintext = JSON.stringify(manifest);
    const { ciphertext, nonce } = await encryptMessage(plaintext, sessionKey, aad);
    return {
      fileId: manifest.fileId,
      ciphertext,
      nonce,
    };
  },

  /**
   * Decrypts an encrypted manifest envelope with AES-256-GCM.
   */
  async decryptManifest(
    envelope: EncryptedManifestEnvelope,
    sessionKey: Uint8Array,
    sessionId: string
  ): Promise<FileManifestPayload> {
    const aad = new TextEncoder().encode(JSON.stringify({ fileId: envelope.fileId, sessionId, type: 'manifest' }));
    const { plaintext } = await decryptMessage(envelope.ciphertext, sessionKey, aad);
    const manifest = JSON.parse(plaintext) as FileManifestPayload;

    if (manifest.fileSize > MAX_FILE_SIZE) {
      throw new Error('Peer manifest specifies file size exceeding 15MB limit');
    }
    if (!ALLOWED_IMAGE_TYPES.has(manifest.fileType.toLowerCase())) {
      manifest.fileType = 'application/octet-stream';
    }
    return manifest;
  },

  /**
   * Encrypts a single 32KB file chunk with AES-256-GCM.
   */
  async encryptChunk(
    chunkBytes: Uint8Array,
    fileId: string,
    chunkIndex: number,
    sessionId: string,
    sessionKey: Uint8Array
  ): Promise<FileChunkPayload> {
    const aad = new TextEncoder().encode(JSON.stringify({ fileId, chunkIndex, sessionId }));
    const plaintext = bytesToBase64(chunkBytes);
    const { ciphertext, nonce } = await encryptMessage(plaintext, sessionKey, aad);

    return {
      fileId,
      chunkIndex,
      totalChunks: 0,
      ciphertext,
      nonce,
    };
  },

  /**
   * Decrypts an encrypted chunk payload and returns the raw bytes.
   */
  async decryptChunkBytes(
    chunkPayload: FileChunkPayload,
    sessionId: string,
    sessionKey: Uint8Array
  ): Promise<Uint8Array> {
    const aad = new TextEncoder().encode(JSON.stringify({
      fileId: chunkPayload.fileId,
      chunkIndex: chunkPayload.chunkIndex,
      sessionId,
    }));
    const { plaintext } = await decryptMessage(chunkPayload.ciphertext, sessionKey, aad);
    return base64ToBytes(plaintext);
  },

  /**
   * Registers an incoming file manifest.
   */
  registerIncomingFile(
    manifest: FileManifestPayload,
    onProgress?: (progress: FileTransferProgress) => void
  ): void {
    if (manifest.fileSize > MAX_FILE_SIZE) {
      throw new Error('File exceeds maximum allowed size of 15MB');
    }
    pendingTransfers.set(manifest.fileId, {
      manifest,
      receivedChunks: new Map(),
      totalChunks: manifest.totalChunks,
      onProgress,
    });
  },

  /**
   * Ingests already-decrypted chunk bytes. Assembles the file if complete.
   */
  async ingestChunkBytes(
    fileId: string,
    chunkIndex: number,
    chunkBytes: Uint8Array
  ): Promise<FileAttachment | null> {
    const transfer = pendingTransfers.get(fileId);
    if (!transfer) return null;

    if (chunkIndex < 0 || chunkIndex >= transfer.totalChunks) {
      console.warn(`[FileTransfer] Received out-of-bounds chunk ${chunkIndex} (total: ${transfer.totalChunks})`);
      return null;
    }
    if (transfer.receivedChunks.has(chunkIndex)) {
      return null; // Ignore duplicate chunk
    }

    transfer.receivedChunks.set(chunkIndex, chunkBytes);

    if (transfer.onProgress) {
      transfer.onProgress({
        fileId: transfer.manifest.fileId,
        fileName: transfer.manifest.fileName,
        totalChunks: transfer.totalChunks,
        transferredChunks: transfer.receivedChunks.size,
        percentage: Math.round((transfer.receivedChunks.size / transfer.totalChunks) * 100),
        direction: 'receiving',
      });
    }

    if (transfer.receivedChunks.size === transfer.totalChunks) {
      const totalLength = transfer.manifest.fileSize;
      const completeBuffer = new Uint8Array(totalLength);
      let currentOffset = 0;

      for (let i = 0; i < transfer.totalChunks; i++) {
        const part = transfer.receivedChunks.get(i);
        if (part) {
          completeBuffer.set(part, currentOffset);
          currentOffset += part.length;
        }
      }

      const computedHash = await computeSHA256(completeBuffer);
      if (computedHash !== transfer.manifest.sha256) {
        console.error('[FileTransfer] SHA-256 integrity check failed for file:', transfer.manifest.fileName);
        pendingTransfers.delete(fileId);
        return null;
      }

      const safeBlobType = ALLOWED_IMAGE_TYPES.has(transfer.manifest.fileType)
        ? transfer.manifest.fileType
        : 'application/octet-stream';
      const blob = new Blob([completeBuffer], { type: safeBlobType });
      const blobUrl = URL.createObjectURL(blob);
      pendingTransfers.delete(fileId);

      return {
        fileId: transfer.manifest.fileId,
        fileName: transfer.manifest.fileName,
        fileSize: transfer.manifest.fileSize,
        fileType: safeBlobType,
        blobUrl,
        dataUrl: transfer.manifest.thumbnail,
        isImage: ALLOWED_IMAGE_TYPES.has(transfer.manifest.fileType),
      };
    }
    return null;
  },

  /**
   * Decrypts and ingests an incoming file chunk.
   * If all chunks have arrived, assembles and returns the completed FileAttachment.
   */
  async ingestChunk(
    chunkPayload: FileChunkPayload,
    sessionId: string,
    sessionKey: Uint8Array
  ): Promise<FileAttachment | null> {
    try {
      const chunkBytes = await this.decryptChunkBytes(chunkPayload, sessionId, sessionKey);
      return await this.ingestChunkBytes(chunkPayload.fileId, chunkPayload.chunkIndex, chunkBytes);
    } catch (err) {
      console.error('[FileTransfer] Failed to decrypt file chunk:', err);
      return null;
    }
  },
};
