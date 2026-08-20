import apiClient, { API_V1_BASE } from './client';

const RETENTION_OPTIONS = [1, 3, 7, 10, 30];
/** Согласовано с backend MAX_FILE_SIZE_BYTES (1 GiB). */
export const MY_FILES_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export const formatMyFilesUploadLimitLabel = () => '1 ГБ на файл, 5 ГБ всего';

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
  uploadFile: async ({ file, retentionDays = 1, onUploadProgress, signal } = {}) => {
    const response = await apiClient.post('/my-files', file, {
      params: {
        file_name: String(file?.name || 'file.bin'),
        file_size: Number(file?.size || 0),
        retention_days: normalizeRetentionDays(retentionDays),
      },
      headers: {
        'Content-Type': file?.type || 'application/octet-stream',
      },
      onUploadProgress,
      signal,
      timeout: 0,
    });
    return response.data;
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
