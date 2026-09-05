import apiClient, { API_V1_BASE } from './client';

const RETENTION_OPTIONS = [1, 3, 7, 10, 30];
const UPLOAD_RETRY_DELAYS_MS = [500, 1500];
/** Согласовано с backend MAX_FILE_SIZE_BYTES и uint32-пределом IIS. */
export const MY_FILES_MAX_UPLOAD_BYTES = (2 ** 32) - 1;

export const formatMyFilesUploadLimitLabel = () => 'до 4 ГБ на файл, 5 ГБ всего';

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

export const myFilesRetentionOptions = RETENTION_OPTIONS;

export const myFilesAPI = {
  listFiles: async () => {
    const response = await apiClient.get('/my-files');
    return response.data;
  },
  getQuota: async () => {
    const response = await apiClient.get('/my-files/quota');
    return response.data;
  },
  createUploadSession: async ({ file, retentionDays = 1, signal } = {}) => {
    const response = await apiClient.post('/my-files/upload-sessions', {
      file_name: String(file?.name || 'file.bin'),
      file_size: Number(file?.size || 0),
      retention_days: normalizeRetentionDays(retentionDays),
      mime_type: file?.type || 'application/octet-stream',
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
        timeout: 115_000,
      },
    );
    return response.data;
  },
  completeUploadSession: async (fileId, { signal } = {}) => {
    const response = await apiClient.post(
      `/my-files/upload-sessions/${encodeURIComponent(fileId)}/complete`,
      null,
      { signal },
    );
    return response.data;
  },
  cancelUploadSession: async (fileId) => {
    const response = await apiClient.delete(`/my-files/upload-sessions/${encodeURIComponent(fileId)}`);
    return response.data;
  },
  uploadFile: async ({ file, retentionDays = 1, onUploadProgress, signal } = {}) => {
    const totalBytes = Math.max(0, Number(file?.size || 0));
    let fileId = '';
    emitUploadProgress(onUploadProgress, 0, totalBytes);
    try {
      const session = await myFilesAPI.createUploadSession({ file, retentionDays, signal });
      fileId = String(session?.file_id || '').trim();
      const chunkSizeBytes = Number(session?.chunk_size_bytes || 0);
      let uploadedBytes = Math.max(0, Number(session?.uploaded_bytes || 0));
      if (!fileId || !Number.isFinite(chunkSizeBytes) || chunkSizeBytes <= 0 || uploadedBytes > totalBytes) {
        throw new Error('My files upload session response is invalid');
      }

      emitUploadProgress(onUploadProgress, uploadedBytes, totalBytes);
      while (uploadedBytes < totalBytes) {
        const chunkOffset = uploadedBytes;
        const chunk = file.slice(chunkOffset, Math.min(totalBytes, chunkOffset + chunkSizeBytes));
        let acknowledged = false;
        let lastError = null;

        for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            const result = await myFilesAPI.uploadChunk(fileId, chunk, {
              offset: chunkOffset,
              signal,
              onUploadProgress: (event) => {
                const sent = Math.min(Number(chunk?.size || 0), Number(event?.loaded || 0));
                emitUploadProgress(onUploadProgress, chunkOffset + sent, totalBytes);
              },
            });
            const nextUploadedBytes = Number(result?.uploaded_bytes || 0);
            if (nextUploadedBytes <= chunkOffset || nextUploadedBytes > totalBytes) {
              throw new Error('My files upload chunk acknowledgement is invalid');
            }
            uploadedBytes = nextUploadedBytes;
            acknowledged = true;
            break;
          } catch (error) {
            lastError = error;
            if (signal?.aborted) throw error;
            try {
              const status = await myFilesAPI.getUploadSession(fileId, { signal });
              const recoveredBytes = Number(status?.uploaded_bytes || 0);
              if (recoveredBytes > chunkOffset && recoveredBytes <= totalBytes) {
                uploadedBytes = recoveredBytes;
                acknowledged = true;
                break;
              }
            } catch (statusError) {
              if (signal?.aborted) throw statusError;
            }
            if (attempt < UPLOAD_RETRY_DELAYS_MS.length) {
              await waitForUploadRetry(UPLOAD_RETRY_DELAYS_MS[attempt], signal);
            }
          }
        }

        if (!acknowledged) throw lastError || new Error('My files upload chunk failed');
        emitUploadProgress(onUploadProgress, uploadedBytes, totalBytes);
      }

      const completed = await myFilesAPI.completeUploadSession(fileId, { signal });
      emitUploadProgress(onUploadProgress, totalBytes, totalBytes);
      return completed;
    } catch (error) {
      if (fileId) {
        try {
          await myFilesAPI.cancelUploadSession(fileId);
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
  downloadPreviewContent: async (fileId) => (
    apiClient.get(`/my-files/${encodeURIComponent(fileId)}/preview/content`, {
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
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.cssText = 'display:none;width:0;height:0;border:0';
    iframe.src = url;
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      iframe.remove();
    }, 120_000);
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
