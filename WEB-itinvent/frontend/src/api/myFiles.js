import apiClient, { API_V1_BASE } from './client';

const RETENTION_OPTIONS = [1, 3, 7, 10, 30];
/** Transient network blips on multi‑hundred‑MB uploads need more than two short retries. */
const UPLOAD_RETRY_DELAYS_MS = [1000, 2500, 5000, 10000, 20000];
/** Очередь на пользователя ограничена: сессию повторяем, пока воркер освобождает слот. */
const UPLOAD_SESSION_CAPACITY_MAX_RETRIES = 40;
const UPLOAD_SESSION_CAPACITY_FALLBACK_MS = 5000;
const UPLOAD_SESSION_CAPACITY_MAX_DELAY_MS = 15000;
/** 16 MB chunk over a slow link; keep above typical IIS/ARR defaults when raised to 10 min. */
const UPLOAD_CHUNK_TIMEOUT_MS = 300_000;
const UPLOAD_COMPLETE_TIMEOUT_MS = 120_000;
const UPLOAD_PARALLEL_CHUNKS = 4;
/** Согласовано с backend MY_FILES_MAX_FILE_BYTES; чанки идут отдельными запросами. */
export const MY_FILES_MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

export const formatMyFilesUploadLimitLabel = () => 'до 10 ГБ на файл, 50 ГБ всего';

const UPLOAD_RESUME_KEY = 'hubit-my-files-uploads';
/** Совпадает с backend upload_reservation_ttl_sec; старше — сессия уже сгнила. */
const UPLOAD_RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const readUploadResumeMap = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UPLOAD_RESUME_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeUploadResumeMap = (map) => {
  const cutoff = Date.now() - UPLOAD_RESUME_MAX_AGE_MS;
  const pruned = Object.fromEntries(
    Object.entries(map).filter(([, entry]) => Number(entry?.savedAt || 0) > cutoff),
  );
  try {
    window.localStorage.setItem(UPLOAD_RESUME_KEY, JSON.stringify(pruned));
  } catch {
    // Quota/приватный режим — просто не сохраняем resume.
  }
};

const uploadResumeKey = (file, folderId) => [
  String(file?.name || ''),
  Number(file?.size || 0),
  String(folderId || ''),
  Number(file?.lastModified || 0),
].join('|');

const findResumableSession = async ({ file, folderId, signal }) => {
  const key = uploadResumeKey(file, folderId);
  const entry = readUploadResumeMap()[key];
  if (!entry || typeof entry !== 'object') return null;
  if (Date.now() - Number(entry.savedAt || 0) > UPLOAD_RESUME_MAX_AGE_MS) return null;
  const fileId = String(entry.fileId || '');
  if (!fileId) return null;
  try {
    const status = await myFilesAPI.getUploadSession(fileId, { signal });
    if (Number(status?.file_size_bytes || 0) !== Number(file?.size || 0)) return null;
    if (status?.complete) return null;
    return {
      file_id: fileId,
      chunk_size_bytes: status?.chunk_size_bytes,
      uploaded_bytes: status?.uploaded_bytes,
      ranges: status?.ranges,
    };
  } catch {
    return null;
  }
};

const saveUploadResume = (file, folderId, fileId) => {
  const map = readUploadResumeMap();
  map[uploadResumeKey(file, folderId)] = { fileId, savedAt: Date.now() };
  writeUploadResumeMap(map);
};

const clearUploadResume = (file, folderId) => {
  const map = readUploadResumeMap();
  const key = uploadResumeKey(file, folderId);
  if (key in map) {
    delete map[key];
    writeUploadResumeMap(map);
  }
};

const normalizeRetentionDays = (value) => {
  const days = Number(value);
  return RETENTION_OPTIONS.includes(days) ? days : 1;
};

const buildPublicPath = (token) => {
  const rawBase = String(import.meta.env.BASE_URL || '/');
  const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
  const base = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
  return `${base}shared-files/${encodeURIComponent(token)}`;
};

const emitUploadProgress = (callback, loaded, total) => {
  if (typeof callback !== 'function') return;
  callback({
    loaded: Math.max(0, Math.min(Number(total || 0), Number(loaded || 0))),
    total: Math.max(0, Number(total || 0)),
  });
};

const normalizeUploadRanges = (ranges, totalBytes) => {
  if (!Array.isArray(ranges)) return null;
  const normalized = ranges
    .map((item) => [Number(item?.[0] || 0), Number(item?.[1] || 0)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start)
    .map(([start, end]) => [start, Math.min(end, totalBytes)])
    .sort((a, b) => a[0] - b[0]);
  return normalized;
};

const rangeIsCovered = (ranges, start, end) => (
  Array.isArray(ranges) && ranges.some(([rs, re]) => rs <= start && re >= end)
);

const buildUploadTasks = (coveredRanges, totalBytes, chunkSizeBytes) => {
  const tasks = [];
  let cursor = 0;
  const sorted = [...coveredRanges].sort((a, b) => a[0] - b[0]);
  for (const [start, end] of sorted) {
    if (start > cursor) {
      for (let offset = cursor; offset < start; offset += chunkSizeBytes) {
        tasks.push({ offset, end: Math.min(start, offset + chunkSizeBytes) });
      }
    }
    cursor = Math.max(cursor, end);
  }
  for (let offset = cursor; offset < totalBytes; offset += chunkSizeBytes) {
    tasks.push({ offset, end: Math.min(totalBytes, offset + chunkSizeBytes) });
  }
  return tasks;
};

const waitForUploadRetry = (delayMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Upload aborted', 'AbortError'));
    return;
  }
  const onAbort = () => {
    window.clearTimeout(timer);
    reject(new DOMException('Upload aborted', 'AbortError'));
  };
  const timer = window.setTimeout(() => {
    signal?.removeEventListener?.('abort', onAbort);
    resolve();
  }, delayMs);
  signal?.addEventListener?.('abort', onAbort, { once: true });
});

const describeUploadFailure = (error, { aborted = false } = {}) => {
  if (aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
    return 'Upload cancelled';
  }
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim().slice(0, 2000);
  }
  if (Array.isArray(detail)) {
    const first = detail.find((item) => typeof item?.msg === 'string' && item.msg.trim());
    if (first?.msg) return String(first.msg).trim().slice(0, 2000);
  }
  const message = String(error?.message || '').trim();
  if (message) return message.slice(0, 2000);
  const status = Number(error?.response?.status || 0);
  if (status > 0) return `Upload failed (HTTP ${status})`;
  return 'Upload failed';
};

const isRetriableUploadError = (error) => {
  if (!error) return false;
  if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return false;
  const status = Number(error?.response?.status || 0);
  if (!status) return true; // network / timeout without HTTP status
  if (status === 400) {
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'string') return !detail.trim();
    return detail === undefined || detail === null;
  }
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  return false;
};

const capacityRetryDelayMs = (error) => {
  const retryAfterSeconds = Number(error?.response?.headers?.['retry-after'] || 0);
  const suggested = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : UPLOAD_SESSION_CAPACITY_FALLBACK_MS;
  return Math.min(Math.max(suggested, 2000), UPLOAD_SESSION_CAPACITY_MAX_DELAY_MS);
};

const createUploadSessionWithCapacityRetry = async ({ file, retentionDays, folderId, signal }) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await myFilesAPI.createUploadSession({ file, retentionDays, folderId, signal });
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status !== 429 || signal?.aborted || attempt >= UPLOAD_SESSION_CAPACITY_MAX_RETRIES) {
        throw error;
      }
      await waitForUploadRetry(capacityRetryDelayMs(error), signal);
    }
  }
};

export const myFilesRetentionOptions = RETENTION_OPTIONS;

export const myFilesAPI = {
  listFiles: async ({ folderId = null, view = '', signal } = {}) => {
    const params = {};
    if (folderId) params.folder_id = folderId;
    if (view) params.view = view;
    const response = await apiClient.get('/my-files', { params, signal });
    return response.data;
  },
  listFolders: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/folders', { signal });
    return response.data;
  },
  createFolder: async ({ name, parentId = null } = {}) => {
    const response = await apiClient.post('/my-files/folders', {
      name: String(name || '').trim(),
      parent_id: parentId || null,
    });
    return response.data;
  },
  updateFolder: async (folderId, { name, parentId, isFavorite } = {}) => {
    const payload = {};
    if (name !== undefined) payload.name = String(name || '').trim();
    if (parentId !== undefined) payload.parent_id = parentId || null;
    if (isFavorite !== undefined) payload.is_favorite = Boolean(isFavorite);
    const response = await apiClient.patch(
      `/my-files/folders/${encodeURIComponent(folderId)}`,
      payload,
    );
    return response.data;
  },
  deleteFolder: async (folderId) => {
    await apiClient.delete(`/my-files/folders/${encodeURIComponent(folderId)}`);
  },
  updateFile: async (fileId, { name, folderId, isFavorite } = {}) => {
    const payload = {};
    if (name !== undefined) payload.name = String(name || '').trim();
    if (folderId !== undefined) payload.folder_id = folderId || null;
    if (isFavorite !== undefined) payload.is_favorite = Boolean(isFavorite);
    const response = await apiClient.patch(
      `/my-files/${encodeURIComponent(fileId)}`,
      payload,
    );
    return response.data;
  },
  listTrash: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/trash', { signal });
    return response.data;
  },
  restoreFile: async (fileId) => {
    await apiClient.post(`/my-files/trash/files/${encodeURIComponent(fileId)}/restore`);
  },
  restoreFolder: async (folderId) => {
    await apiClient.post(`/my-files/trash/folders/${encodeURIComponent(folderId)}/restore`);
  },
  purgeFile: async (fileId) => {
    await apiClient.delete(`/my-files/trash/files/${encodeURIComponent(fileId)}`);
  },
  purgeFolder: async (folderId) => {
    await apiClient.delete(`/my-files/trash/folders/${encodeURIComponent(folderId)}`);
  },
  emptyTrash: async () => {
    await apiClient.post('/my-files/trash/empty');
  },
  createFolderShare: async (folderId, { rotate = false } = {}) => {
    const response = await apiClient.post(
      `/my-files/folders/${encodeURIComponent(folderId)}/share`,
      undefined,
      { params: rotate ? { rotate: true } : {} },
    );
    return response.data;
  },
  revokeFolderShare: async (folderId) => {
    await apiClient.delete(`/my-files/folders/${encodeURIComponent(folderId)}/share`);
  },
  getPublicFolder: async (token) => {
    const response = await apiClient.get(`/my-files/public-folders/${encodeURIComponent(token)}`, {
      suppressAuthRequired: true,
    });
    return response.data;
  },
  createPublicFolderDownloadGrant: async (token, fileId) => {
    const response = await apiClient.post(
      `/my-files/public-folders/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/download-grant`,
      undefined,
      { suppressAuthRequired: true },
    );
    return response.data;
  },
  createFolderArchiveGrant: async (folderId) => {
    const response = await apiClient.post(
      `/my-files/folders/${encodeURIComponent(folderId)}/archive-grant`,
    );
    return response.data;
  },
  buildPublicFolderPreviewUrl: (token, fileId) => (
    `${API_V1_BASE}/my-files/public-folders/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/preview/content`
  ),
  buildPublicFolderUrl: (token) => {
    const rawBase = String(import.meta.env.BASE_URL || '/');
    const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
    const base = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
    const publicPath = `${base}shared-folders/${encodeURIComponent(token)}`;
    if (typeof window === 'undefined') return publicPath;
    return new URL(publicPath, window.location.origin).href;
  },
  getQuota: async () => {
    const response = await apiClient.get('/my-files/quota');
    return response.data;
  },
  createUploadSession: async ({ file, retentionDays = 1, folderId = null, signal } = {}) => {
    const response = await apiClient.post('/my-files/upload-sessions', {
      file_name: String(file?.name || 'file.bin'),
      file_size: Number(file?.size || 0),
      retention_days: normalizeRetentionDays(retentionDays),
      mime_type: file?.type || 'application/octet-stream',
      folder_id: folderId || null,
    }, { signal });
    return response.data;
  },
  getUploadSession: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(
      `/my-files/upload-sessions/${encodeURIComponent(fileId)}`,
      { signal },
    );
    return response.data;
  },
  uploadChunk: async (fileId, chunk, { offset = 0, signal, onUploadProgress } = {}) => {
    const response = await apiClient.put(
      `/my-files/upload-sessions/${encodeURIComponent(fileId)}/chunks`,
      chunk,
      {
        params: { offset: Math.max(0, Number(offset || 0)) },
        headers: { 'Content-Type': 'application/octet-stream' },
        onUploadProgress,
        signal,
        timeout: UPLOAD_CHUNK_TIMEOUT_MS,
      },
    );
    return response.data;
  },
  completeUploadSession: async (fileId, { signal } = {}) => {
    const response = await apiClient.post(
      `/my-files/upload-sessions/${encodeURIComponent(fileId)}/complete`,
      null,
      { signal, timeout: UPLOAD_COMPLETE_TIMEOUT_MS },
    );
    return response.data;
  },
  cancelUploadSession: async (fileId, { reason, signal } = {}) => {
    const response = await apiClient.delete(
      `/my-files/upload-sessions/${encodeURIComponent(fileId)}`,
      {
        params: reason ? { reason: String(reason).slice(0, 2000) } : undefined,
        signal,
      },
    );
    return response.data;
  },
  uploadFile: async ({ file, retentionDays = 1, folderId = null, onUploadProgress, signal, parallelChunks = UPLOAD_PARALLEL_CHUNKS } = {}) => {
    const totalBytes = Math.max(0, Number(file?.size || 0));
    let fileId = '';
    emitUploadProgress(onUploadProgress, 0, totalBytes);
    try {
      const session = (await findResumableSession({ file, folderId, signal }))
        || await createUploadSessionWithCapacityRetry({ file, retentionDays, folderId, signal });
      fileId = String(session?.file_id || '').trim();
      saveUploadResume(file, folderId, fileId);
      const chunkSizeBytes = Number(session?.chunk_size_bytes || 0);
      if (!fileId || !Number.isFinite(chunkSizeBytes) || chunkSizeBytes <= 0) {
        throw new Error('My files upload session response is invalid');
      }

      const coveredRanges = normalizeUploadRanges(session?.ranges, totalBytes)
        || (Number(session?.uploaded_bytes || 0) > 0
          ? [[0, Math.min(totalBytes, Number(session.uploaded_bytes))]]
          : []);
      const tasks = buildUploadTasks(coveredRanges, totalBytes, chunkSizeBytes);
      let confirmedBytes = coveredRanges.reduce((sum, [start, end]) => sum + (end - start), 0);
      const inFlight = new Map();
      const emitAggregate = () => {
        let sent = confirmedBytes;
        inFlight.forEach((loaded) => { sent += loaded; });
        emitUploadProgress(onUploadProgress, sent, totalBytes);
      };
      emitAggregate();

      let nextTaskIndex = 0;
      const uploadTask = async (taskIndex) => {
        const { offset, end } = tasks[taskIndex];
        const chunk = file.slice(offset, end);
        for (let attempt = 0; ; attempt += 1) {
          try {
            await myFilesAPI.uploadChunk(fileId, chunk, {
              offset,
              signal,
              onUploadProgress: (event) => {
                inFlight.set(taskIndex, Math.min(end - offset, Number(event?.loaded || 0)));
                emitAggregate();
              },
            });
            inFlight.delete(taskIndex);
            confirmedBytes += end - offset;
            emitAggregate();
            return;
          } catch (error) {
            inFlight.delete(taskIndex);
            if (signal?.aborted) throw error;
            try {
              const status = await myFilesAPI.getUploadSession(fileId, { signal });
              const ranges = normalizeUploadRanges(status?.ranges, totalBytes);
              if (ranges && rangeIsCovered(ranges, offset, end)) {
                confirmedBytes += end - offset;
                emitAggregate();
                return;
              }
            } catch (statusError) {
              if (signal?.aborted) throw statusError;
            }
            if (!isRetriableUploadError(error) || attempt >= UPLOAD_RETRY_DELAYS_MS.length) {
              throw error;
            }
            await waitForUploadRetry(UPLOAD_RETRY_DELAYS_MS[attempt], signal);
          }
        }
      };

      const requestedWorkers = Math.trunc(Number(parallelChunks) || UPLOAD_PARALLEL_CHUNKS);
      const workers = Array.from(
        { length: Math.min(Math.max(1, requestedWorkers), UPLOAD_PARALLEL_CHUNKS, tasks.length) },
        async () => {
          while (nextTaskIndex < tasks.length) {
            const taskIndex = nextTaskIndex;
            nextTaskIndex += 1;
            await uploadTask(taskIndex);
          }
        },
      );
      await Promise.all(workers);

      const completed = await myFilesAPI.completeUploadSession(fileId, { signal });
      emitUploadProgress(onUploadProgress, totalBytes, totalBytes);
      clearUploadResume(file, folderId);
      return completed;
    } catch (error) {
      const aborted = Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';
      if (fileId && (aborted || !isRetriableUploadError(error))) {
        // Отменяем только точные провалы; сетевые сбои оставляем на resume в течение TTL сессии.
        clearUploadResume(file, folderId);
        try {
          await myFilesAPI.cancelUploadSession(fileId, {
            reason: describeUploadFailure(error, { aborted }),
          });
        } catch {
          // The server expires incomplete reservations if cleanup is unavailable.
        }
      }
      throw error;
    }
  },
  createDownloadGrant: async (fileId) => {
    const response = await apiClient.post(`/my-files/${encodeURIComponent(fileId)}/download-grant`);
    return response.data;
  },
  getPreviewMeta: async (fileId) => {
    const response = await apiClient.get(`/my-files/${encodeURIComponent(fileId)}/preview`);
    return response.data;
  },
  downloadPreviewContent: async (fileId, { variant = '' } = {}) => (
    apiClient.get(`/my-files/${encodeURIComponent(fileId)}/preview/content`, {
      params: variant ? { variant } : {},
      responseType: 'blob',
    })
  ),
  downloadPreviewSource: async (fileId) => (
    apiClient.get(`/my-files/${encodeURIComponent(fileId)}/preview/source`, {
      responseType: 'blob',
    })
  ),
  /** Совместимость: всегда grant + нативное скачивание (без blob/XHR). */
  downloadFile: async (fileId) => {
    const grant = await myFilesAPI.createDownloadGrant(fileId);
    const downloadUrl = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
    if (!downloadUrl || !myFilesAPI.triggerNativeDownload(downloadUrl)) {
      throw new Error('Не удалось начать скачивание');
    }
    return null;
  },
  buildDownloadGrantUrl: (downloadPath) => {
    const path = String(downloadPath || '').trim();
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const base = String(API_V1_BASE || '/api/v1').replace(/\/$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    if (typeof window === 'undefined') return `${base}${suffix}`;
    return new URL(`${base}${suffix}`, window.location.origin).href;
  },
  triggerNativeDownload: (absoluteUrl) => {
    const url = String(absoluteUrl || '').trim();
    if (!url || typeof document === 'undefined') return false;
    const anchor = document.createElement('a');
    anchor.setAttribute('aria-hidden', 'true');
    anchor.setAttribute('tabindex', '-1');
    anchor.style.display = 'none';
    anchor.href = url;
    anchor.download = '';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  },
  createShare: async (fileId, { rotate = false } = {}) => {
    const response = await apiClient.post(
      `/my-files/${encodeURIComponent(fileId)}/share`,
      undefined,
      { params: rotate ? { rotate: true } : {} },
    );
    return response.data;
  },
  revokeShare: async (fileId) => {
    const response = await apiClient.delete(`/my-files/${encodeURIComponent(fileId)}/share`);
    return response.data;
  },
  deleteFile: async (fileId) => {
    const response = await apiClient.delete(`/my-files/${encodeURIComponent(fileId)}`);
    return response.data;
  },
  getPublicFile: async (token) => {
    const response = await apiClient.get(`/my-files/public/${encodeURIComponent(token)}`, {
      suppressAuthRequired: true,
    });
    return response.data;
  },
  getPublicPreviewMeta: async (token) => {
    const response = await apiClient.get(`/my-files/public/${encodeURIComponent(token)}/preview`, {
      suppressAuthRequired: true,
    });
    return response.data;
  },
  buildPublicPreviewContentUrl: (token) => (
    `${API_V1_BASE}/my-files/public/${encodeURIComponent(token)}/preview/content`
  ),
  buildPublicUrl: (token) => {
    const publicPath = buildPublicPath(token);
    if (typeof window === 'undefined') return publicPath;
    return new URL(publicPath, window.location.origin).href;
  },
  buildPublicDownloadUrl: (token) => `${API_V1_BASE}/my-files/public/${encodeURIComponent(token)}/download`,
};

export default myFilesAPI;
