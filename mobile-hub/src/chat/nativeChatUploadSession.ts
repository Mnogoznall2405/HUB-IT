import { File, FileMode } from 'expo-file-system';
import * as chatApi from '../api/chatApi';
import type { ChatMessage } from '../api/types';
import { buildAttachmentsFormData, inferNativeUploadMediaKind } from '../files/nativeFilePicker';
import type { NativeChatDeliveryHelpers, NativeChatOutboxEntry } from './nativeChatOutbox';

// Chunks must arrive in order, so a failed chunk gets bounded in-place retries
// (with a server-side status refresh before each one) instead of restarting the
// whole file. The durable outbox retry still owns the outer attempt budget.
const CHUNK_RETRY_DELAYS_MS = [1000, 2500, 5000];
const CHUNK_SIZE_FALLBACK_BYTES = 2 * 1024 * 1024;
// Endpoint missing or down server-side → the old multipart path still works.
const SESSION_FALLBACK_STATUSES = new Set([404, 405, 500, 501, 502, 503, 504]);

export type NativeChatUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number | null) => void;
  helpers?: NativeChatDeliveryHelpers;
};

function errorStatus(error: unknown): number {
  return Number((error as { response?: { status?: unknown } })?.response?.status || 0);
}

function shouldFallbackToMultipart(error: unknown): boolean {
  const status = errorStatus(error);
  return !status || SESSION_FALLBACK_STATUSES.has(status);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// File.slice() builds an RN Blob from a Uint8Array part, which RN's BlobManager
// rejects ("ArrayBufferView parts are not supported"). Reading the range through
// FileHandle and copying to an exact ArrayBuffer gives axios/RN XHR a body it
// sends natively; passing the view itself would leak the whole backing buffer.
function readChunkBytes(source: File, offset: number, length: number): ArrayBuffer {
  const handle = source.open(FileMode.ReadOnly);
  try {
    handle.offset = Math.max(0, Math.trunc(offset));
    const bytes = handle.readBytes(Math.max(0, Math.trunc(length)));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } finally {
    try { handle.close(); } catch { /* no-op */ }
  }
}

async function deliverMultipart(
  entry: NativeChatOutboxEntry,
  options: NativeChatUploadOptions,
): Promise<ChatMessage> {
  const upload = entry.upload!;
  return chatApi.sendFileMessage(entry.message.conversation_id, buildAttachmentsFormData(upload.files, {
    body: upload.body,
    clientMessageId: entry.message.client_message_id || undefined,
    replyToMessageId: upload.replyToMessageId,
    mediaKind: upload.mediaKind,
    durationSeconds: upload.durationSeconds,
  }), { signal: options.signal, onProgress: options.onProgress });
}

/**
 * S8-B: resumable attachment delivery. The session id is persisted on the
 * outbox row, so an interrupted upload reattaches and skips chunks the server
 * already acknowledged; a lost session falls back to a new one with the same
 * client_message_id, which the backend deduplicates.
 */
export async function deliverNativeChatUpload(
  entry: NativeChatOutboxEntry,
  options: NativeChatUploadOptions = {},
): Promise<ChatMessage> {
  const upload = entry.upload;
  const conversationId = entry.message.conversation_id;
  const clientMessageId = String(entry.message.client_message_id || '').trim();
  const sources = (upload?.files || []).map((picked) => {
    const source = new File(picked.uri);
    let size = Math.max(0, Number(picked.size || 0));
    try {
      const localSize = Number(source.size || 0);
      if (Number.isFinite(localSize) && localSize > 0) size = localSize;
    } catch {
      // content:// and synthetic URIs may not expose a size through File.
    }
    if (size <= 0) throw new Error('Файл вложения недоступен. Отправьте его снова.');
    return { picked, source, size };
  });
  if (!upload) throw new Error('Некорректное исходящее сообщение');
  if (!sources.length) return deliverMultipart(entry, options);
  const totalBytes = sources.reduce((sum, item) => sum + item.size, 0);

  const patchUpload = async (patch: { sessionId?: string }) => {
    if (!options.helpers) return;
    await Promise.resolve(options.helpers.patchUpload(patch)).catch(() => undefined);
  };

  let session: chatApi.ChatUploadSession | null = null;
  let sessionId = String(upload.sessionId || '').trim();
  if (sessionId) {
    try {
      session = await chatApi.getChatUploadSession(sessionId, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (errorStatus(error) !== 404) throw error;
      session = null;
      sessionId = '';
      await patchUpload({ sessionId: undefined });
    }
  }
  // The durable file list is immutable; a manifest that disagrees about sizes
  // can never complete, so it is abandoned rather than retried.
  if (session && (session.files.length !== sources.length
      || session.files.some((item, index) => Number(item.size) !== sources[index].size))) {
    session = null;
    sessionId = '';
    await patchUpload({ sessionId: undefined });
  }
  if (session?.status === 'completed') {
    return chatApi.completeChatUploadSession(session.session_id, { signal: options.signal });
  }
  if (!session) {
    try {
      session = await chatApi.createChatUploadSession(conversationId, {
        body: upload.body,
        replyToMessageId: upload.replyToMessageId,
        clientMessageId,
        files: sources.map((item, index) => ({
          file_name: item.picked.name,
          mime_type: item.picked.mimeType,
          // Per-file kind: mixed batches keep their own media type instead of
          // silently dropping metadata for every file after the first.
          media_kind: inferNativeUploadMediaKind(item.picked, upload.mediaKind, index),
          duration_seconds: index === 0 ? upload.durationSeconds : undefined,
          size: item.size,
          original_size: item.size,
          transfer_encoding: 'identity' as const,
        })),
      }, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (shouldFallbackToMultipart(error)) return deliverMultipart(entry, options);
      throw error;
    }
    sessionId = session.session_id;
    await patchUpload({ sessionId });
  }

  const chunkSize = Math.max(1, Number(session.chunk_size_bytes) || CHUNK_SIZE_FALLBACK_BYTES);
  const emitProgress = (ackedBytes: number, inFlight: number) => {
    options.onProgress?.(Math.min(ackedBytes + inFlight, totalBytes), totalBytes);
  };

  for (let index = 0; index < sources.length; index += 1) {
    const sessionFile = session.files[index];
    const received = new Set<number>(sessionFile.received_chunks);
    const ackedBytes = () => sources.slice(0, index).reduce((sum, item) => sum + item.size, 0)
      + [...received].reduce((sum, chunkIndex) => sum
        + Math.max(0, Math.min(chunkSize, sources[index].size - chunkIndex * chunkSize)), 0);
    emitProgress(ackedBytes(), 0);
    while (received.size < sessionFile.chunk_count) {
      let chunkIndex = -1;
      for (let candidate = 0; candidate < sessionFile.chunk_count; candidate += 1) {
        if (!received.has(candidate)) { chunkIndex = candidate; break; }
      }
      if (chunkIndex < 0) break;
      const offset = chunkIndex * chunkSize;
      const chunk = readChunkBytes(sources[index].source, offset,
        Math.min(chunkSize, sources[index].size - offset));
      let uploaded = false;
      for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS_MS.length && !uploaded; attempt += 1) {
        if (options.signal?.aborted) {
          throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        }
        try {
          const result = await chatApi.uploadChatFileChunk(sessionId, sessionFile.file_id, chunkIndex, chunk, {
            offset,
            signal: options.signal,
            onUploadProgress: (event) => emitProgress(ackedBytes(), Math.min(Number(event.loaded) || 0, chunk.byteLength || Number.MAX_SAFE_INTEGER)),
          });
          (result.received_chunks.length ? result.received_chunks : [result.chunk_index])
            .forEach((item) => received.add(item));
          uploaded = true;
        } catch (error) {
          if (options.signal?.aborted) throw error;
          // The chunk may have landed while the response was lost; refresh the
          // authoritative state before deciding whether to resend it.
          try {
            const latest = await chatApi.getChatUploadSession(sessionId, { signal: options.signal });
            latest.files[index]?.received_chunks.forEach((item) => received.add(item));
            if (received.has(chunkIndex)) break;
          } catch (statusError) {
            if (options.signal?.aborted) throw statusError;
          }
          if (attempt >= CHUNK_RETRY_DELAYS_MS.length) throw error;
          await wait(CHUNK_RETRY_DELAYS_MS[attempt], options.signal);
        }
      }
      emitProgress(ackedBytes(), 0);
    }
  }

  return chatApi.completeChatUploadSession(sessionId, { signal: options.signal });
}
