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

export interface FileManifestPayload {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  sha256: string;
  thumbnail?: string; // low-res base64 data URL for instant image preview
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
  if (!file.type.startsWith('image/')) return undefined;

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
   */
  async prepareFile(file: File): Promise<{
    fileId: string;
    manifest: FileManifestPayload;
    rawChunks: Uint8Array[];
    thumbnail?: string;
  }> {
    const fileId = crypto.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    const fullBytes = new Uint8Array(arrayBuffer);
    const sha256 = await computeSHA256(fullBytes);
    const thumbnail = await generateThumbnail(file);

    const rawChunks: Uint8Array[] = [];
    for (let offset = 0; offset < fullBytes.length; offset += CHUNK_SIZE) {
      rawChunks.push(fullBytes.slice(offset, offset + CHUNK_SIZE));
    }

    const manifest: FileManifestPayload = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      totalChunks: rawChunks.length,
      sha256,
      thumbnail,
    };

    return { fileId, manifest, rawChunks, thumbnail };
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
   * Registers an incoming file manifest.
   */
  registerIncomingFile(
    manifest: FileManifestPayload,
    onProgress?: (progress: FileTransferProgress) => void
  ): void {
    pendingTransfers.set(manifest.fileId, {
      manifest,
      receivedChunks: new Map(),
      totalChunks: manifest.totalChunks,
      onProgress,
    });
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
    const transfer = pendingTransfers.get(chunkPayload.fileId);
    if (!transfer) {
      console.warn('[FileTransfer] Chunk received for unknown file:', chunkPayload.fileId);
      return null;
    }

    const aad = new TextEncoder().encode(JSON.stringify({
      fileId: chunkPayload.fileId,
      chunkIndex: chunkPayload.chunkIndex,
      sessionId,
    }));

    try {
      const { plaintext } = await decryptMessage(chunkPayload.ciphertext, sessionKey, aad);
      const chunkBytes = base64ToBytes(plaintext);
      transfer.receivedChunks.set(chunkPayload.chunkIndex, chunkBytes);

      // Report progress
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

      // Check if all chunks received
      if (transfer.receivedChunks.size === transfer.totalChunks) {
        // Concatenate all chunks in order
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

        // Integrity verification
        const computedHash = await computeSHA256(completeBuffer);
        if (computedHash !== transfer.manifest.sha256) {
          console.error('[FileTransfer] SHA-256 integrity check failed for file:', transfer.manifest.fileName);
          pendingTransfers.delete(chunkPayload.fileId);
          return null;
        }

        // Create browser in-memory blob
        const blob = new Blob([completeBuffer], { type: transfer.manifest.fileType });
        const blobUrl = URL.createObjectURL(blob);
        pendingTransfers.delete(chunkPayload.fileId);

        return {
          fileId: transfer.manifest.fileId,
          fileName: transfer.manifest.fileName,
          fileSize: transfer.manifest.fileSize,
          fileType: transfer.manifest.fileType,
          blobUrl,
          dataUrl: transfer.manifest.thumbnail,
          isImage: transfer.manifest.fileType.startsWith('image/'),
        };
      }

      return null;
    } catch (err) {
      console.error('[FileTransfer] Failed to decrypt file chunk:', err);
      return null;
    }
  },
};
