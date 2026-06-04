import axios from 'axios';
import apiClient from './client';
import { chatUploadSessionsAPI } from './chatUploadSessions';

const CHAT_UPLOAD_SESSION_FALLBACK_STATUSES = new Set([404, 405, 500, 501, 502, 503, 504]);
const CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS = [1000, 3000, 7000];
const CHAT_UPLOAD_SESSION_MAX_CONCURRENCY = 2;
const CHAT_UPLOAD_SESSION_DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024;

const sleepWithSignal = async (ms, signal) => {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve, reject) => {
    let timeoutId = null;
    const scope = typeof globalThis !== 'undefined' ? globalThis : window;
    const cleanup = () => {
      if (timeoutId !== null) scope.clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(new axios.CanceledError('Chat upload aborted'));
    };
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    timeoutId = scope.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', handleAbort, { once: true });
  });
};

const isAbortError = (error) => (
  String(error?.code || '').trim() === 'ERR_CANCELED'
  || String(error?.name || '').trim() === 'AbortError'
  || String(error?.name || '').trim() === 'CanceledError'
);

const isChatUploadTransferFile = (value) => Boolean(value && typeof value.slice === 'function');

const normalizeChatUploadEntry = (value) => {
  if (!value) return null;

  if (isChatUploadTransferFile(value)) {
    const fileName = String(value?.name || '').trim() || 'file.bin';
    const mimeType = String(value?.type || '').trim() || undefined;
    const originalSize = Math.max(0, Number(value?.size || 0));
    return {
      file: value,
      transferFile: value,
      fileName,
      mimeType,
      size: originalSize,
      originalSize,
      transferEncoding: 'identity',
    };
  }

  const file = isChatUploadTransferFile(value?.file) ? value.file : null;
  const transferFile = isChatUploadTransferFile(value?.transferFile) ? value.transferFile : file;
  if (!transferFile) {
    return null;
  }

  const normalizedFile = file || transferFile;
  const fileName = String(normalizedFile?.name || transferFile?.name || value?.file_name || '').trim() || 'file.bin';
  const mimeType = String(normalizedFile?.type || transferFile?.type || value?.mime_type || '').trim() || undefined;
  const mediaKind = String(value?.media_kind || value?.mediaKind || '').trim().toLowerCase() || undefined;
  const rawDurationSeconds = value?.duration_seconds ?? value?.durationSeconds;
  const durationSeconds = rawDurationSeconds === undefined || rawDurationSeconds === null || String(rawDurationSeconds).trim() === ''
    ? undefined
    : Math.max(0, Math.min(86400, Math.round(Number(rawDurationSeconds) || 0)));
  const originalSize = Math.max(0, Number(value?.preparedSize ?? normalizedFile?.size ?? transferFile?.size ?? 0));
  const transferSize = Math.max(0, Number(value?.transferSize ?? transferFile?.size ?? originalSize));

  return {
    file: normalizedFile,
    transferFile,
    fileName,
    mimeType,
    mediaKind,
    durationSeconds,
    size: transferSize,
    originalSize,
    transferEncoding: String(value?.transferEncoding || 'identity').trim() === 'gzip' ? 'gzip' : 'identity',
  };
};

const canUseChatUploadSessions = (files) => (
  typeof Blob !== 'undefined'
  && typeof FormData !== 'undefined'
  && Array.isArray(files)
  && files.length > 0
  && files.every((file) => isChatUploadTransferFile(file?.transferFile || file))
);

const shouldFallbackChatUploadSession = (error) => {
  if (!error) return true;
  const status = Number(error?.response?.status || 0);
  if (!status) return true;
  if (status >= 500) return true;
  return CHAT_UPLOAD_SESSION_FALLBACK_STATUSES.has(status);
};

const emitChatUploadProgress = (callback, loaded, total) => {
  if (typeof callback !== 'function') return;
  callback({
    loaded: Math.max(0, Number(loaded || 0)),
    total: Math.max(0, Number(total || 0)),
  });
};

const buildChatUploadFileMeta = (file, base = {}) => {
  const payload = { ...base };
  if (file?.mediaKind) payload.media_kind = file.mediaKind;
  if (file?.durationSeconds !== undefined) payload.duration_seconds = file.durationSeconds;
  return payload;
};

const getChatChunkByteLength = (chunkIndex, size, chunkSizeBytes) => {
  const safeChunkIndex = Math.max(0, Number(chunkIndex || 0));
  const safeSize = Math.max(0, Number(size || 0));
  const safeChunkSize = Math.max(1, Number(chunkSizeBytes || CHAT_UPLOAD_SESSION_DEFAULT_CHUNK_BYTES));
  const start = safeChunkIndex * safeChunkSize;
  if (start >= safeSize) return 0;
  return Math.min(safeChunkSize, safeSize - start);
};

const uploadChatFilesMultipart = async (conversationId, files = [], options = {}) => {
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map((file) => normalizeChatUploadEntry(file))
    .filter(Boolean);
  const formData = new FormData();
  normalizedFiles.forEach((file) => {
    if (file?.transferFile) formData.append('files', file.transferFile);
  });
  if (normalizedFiles.length > 0) {
    formData.append('files_meta_json', JSON.stringify(
      normalizedFiles.map((file) => buildChatUploadFileMeta(file, {
        original_size: Number(file?.originalSize || 0),
        transfer_encoding: String(file?.transferEncoding || 'identity').trim() || 'identity',
      })),
    ));
  }
  const normalizedBody = String(options?.body || '').trim();
  if (normalizedBody) {
    formData.append('body', normalizedBody);
  }
  if (options?.reply_to_message_id) {
    formData.append('reply_to_message_id', options.reply_to_message_id);
  }
  const response = await apiClient.post(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages/files`,
    formData,
    {
      onUploadProgress: options?.onUploadProgress,
      signal: options?.signal,
    },
  );
  return response.data;
};

export const chatFileUploadsAPI = {
  sendFiles: async (conversationId, files = [], options = {}) => {
    const normalizedFiles = (Array.isArray(files) ? files : [])
      .map((file) => normalizeChatUploadEntry(file))
      .filter(Boolean);
    const totalBytes = normalizedFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
    if (normalizedFiles.length === 0) {
      return uploadChatFilesMultipart(conversationId, normalizedFiles, options);
    }

    if (!canUseChatUploadSessions(normalizedFiles)) {
      return uploadChatFilesMultipart(conversationId, normalizedFiles, options);
    }

    let session = null;
    let sessionId = '';
    let completed = false;
    let loadedBytes = 0;
    const signal = options?.signal;
    emitChatUploadProgress(options?.onUploadProgress, 0, totalBytes);

    try {
      session = await chatUploadSessionsAPI.createUploadSession(
        conversationId,
        {
          body: String(options?.body || '').trim() || undefined,
          reply_to_message_id: options?.reply_to_message_id || undefined,
          files: normalizedFiles.map((file) => buildChatUploadFileMeta(file, {
            file_name: String(file?.fileName || '').trim() || 'file.bin',
            mime_type: String(file?.mimeType || '').trim() || undefined,
            size: Number(file?.size || 0),
            original_size: Number(file?.originalSize || 0),
            transfer_encoding: String(file?.transferEncoding || 'identity').trim() || 'identity',
          })),
        },
        { signal },
      );
      sessionId = String(session?.session_id || '').trim();
      if (!sessionId || !Array.isArray(session?.files) || session.files.length !== normalizedFiles.length) {
        throw new Error('Chat upload session response is invalid');
      }
    } catch (error) {
      if (!signal?.aborted && shouldFallbackChatUploadSession(error)) {
        return uploadChatFilesMultipart(conversationId, normalizedFiles, options);
      }
      throw error;
    }

    const chunkSizeBytes = Math.max(1, Number(session?.chunk_size_bytes || CHAT_UPLOAD_SESSION_DEFAULT_CHUNK_BYTES));
    const uploadEntries = session.files.map((sessionFile, index) => ({
      file: normalizedFiles[index]?.transferFile,
      fileId: String(sessionFile?.file_id || '').trim(),
      size: Number(sessionFile?.size || normalizedFiles[index]?.size || 0),
      chunkCount: Math.max(1, Number(sessionFile?.chunk_count || Math.ceil((Number(sessionFile?.size || normalizedFiles[index]?.size || 0)) / chunkSizeBytes))),
      acknowledgedChunks: new Set(
        Array.isArray(sessionFile?.received_chunks)
          ? sessionFile.received_chunks.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
          : [],
      ),
    }));

    const syncLoadedBytes = () => {
      loadedBytes = uploadEntries.reduce((sum, entry) => (
        sum + Array.from(entry.acknowledgedChunks).reduce(
          (entrySum, chunkIndex) => entrySum + getChatChunkByteLength(chunkIndex, entry.size, chunkSizeBytes),
          0,
        )
      ), 0);
      emitChatUploadProgress(options?.onUploadProgress, loadedBytes, totalBytes);
    };

    const applySessionStatus = (statusPayload) => {
      const statusFiles = Array.isArray(statusPayload?.files) ? statusPayload.files : [];
      statusFiles.forEach((statusFile) => {
        const entry = uploadEntries.find((item) => item.fileId === String(statusFile?.file_id || '').trim());
        if (!entry) return;
        const receivedChunks = Array.isArray(statusFile?.received_chunks)
          ? statusFile.received_chunks.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
          : [];
        entry.acknowledgedChunks = new Set(receivedChunks);
      });
      syncLoadedBytes();
    };

    applySessionStatus(session);

    const uploadEntryChunks = async (entry) => {
      if (!entry.fileId) {
        throw new Error('Chat upload session file id is missing');
      }
      while (entry.acknowledgedChunks.size < entry.chunkCount) {
        let chunkIndex = -1;
        for (let index = 0; index < entry.chunkCount; index += 1) {
          if (!entry.acknowledgedChunks.has(index)) {
            chunkIndex = index;
            break;
          }
        }
        if (chunkIndex < 0) break;

        const offset = chunkIndex * chunkSizeBytes;
        const nextOffset = Math.min(entry.size, offset + chunkSizeBytes);
        const chunk = entry.file.slice(offset, nextOffset);
        let uploadSucceeded = false;

        for (let attempt = 0; attempt <= CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            const chunkResult = await chatUploadSessionsAPI.uploadFileChunk(
              sessionId,
              entry.fileId,
              chunkIndex,
              chunk,
              { offset, signal },
            );
            const receivedChunks = Array.isArray(chunkResult?.received_chunks)
              ? chunkResult.received_chunks.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
              : [chunkIndex];
            entry.acknowledgedChunks = new Set([
              ...Array.from(entry.acknowledgedChunks),
              ...receivedChunks,
            ]);
            syncLoadedBytes();
            uploadSucceeded = true;
            break;
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }
            try {
              const statusPayload = await chatUploadSessionsAPI.getUploadSession(sessionId, { signal });
              applySessionStatus(statusPayload);
              if (entry.acknowledgedChunks.has(chunkIndex)) {
                uploadSucceeded = true;
                break;
              }
            } catch (statusError) {
              if (isAbortError(statusError)) {
                throw statusError;
              }
            }
            if (attempt >= CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS.length) {
              throw error;
            }
            await sleepWithSignal(CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS[attempt], signal);
          }
        }

        if (!uploadSucceeded) {
          throw new Error('Chat upload chunk failed');
        }
      }
    };

    try {
      let cursor = 0;
      const workerCount = Math.min(CHAT_UPLOAD_SESSION_MAX_CONCURRENCY, uploadEntries.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < uploadEntries.length) {
          const currentIndex = cursor;
          cursor += 1;
          await uploadEntryChunks(uploadEntries[currentIndex]);
        }
      });
      await Promise.all(workers);
      syncLoadedBytes();
      const message = await chatUploadSessionsAPI.completeUploadSession(sessionId, { signal });
      completed = true;
      emitChatUploadProgress(options?.onUploadProgress, totalBytes, totalBytes);
      return message;
    } catch (error) {
      if (sessionId && !completed && isAbortError(error)) {
        try {
          await chatUploadSessionsAPI.cancelUploadSession(sessionId);
        } catch {
          // Ignore session cleanup failures on the client side.
        }
      }
      throw error;
    }
  },
};

export default chatFileUploadsAPI;
