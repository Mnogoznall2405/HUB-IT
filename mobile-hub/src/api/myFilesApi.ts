import apiClient from './client';

export type MyFileRecord = {
  id: string;
  original_file_name: string;
  download_file_name: string;
  mime_type: string;
  download_mime_type: string;
  original_size_bytes: number;
  stored_size_bytes: number;
  saved_size_bytes: number;
  retention_days: number;
  folder_id: string | null;
  status: string;
  storage_mode: string;
  error_text: string;
  security_scan_status: string;
  preview_kind: string;
  preview_available: boolean;
  preview_status: string;
  preview_max_bytes: number;
  is_shared: boolean;
  is_favorite: boolean;
  share_expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
};

export type MyFileFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  file_count: number;
  is_shared: boolean;
  is_favorite: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type MyFileListPayload = {
  items: MyFileRecord[];
  folders: MyFileFolder[];
  breadcrumbs: MyFileFolder[];
  folder: MyFileFolder | null;
};

export type MyFilesView = '' | 'recent' | 'favorites';

export type MyFilesQuota = {
  used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
};

export type MyFileShare = {
  token: string;
  public_path: string;
  expires_at: string | null;
};

export type MyFileDownloadGrant = {
  download_path: string;
  expires_at: string | null;
  expires_in_seconds: number;
};

export type MyFilePreview = {
  preview_kind: string;
  source_kind: string;
  source_filename: string;
  pdf_filename: string;
  page_count: number;
  sheets: Record<string, unknown>[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(asText(value).toLowerCase());
}

export function normalizeMyFile(value: unknown): MyFileRecord | null {
  const row = asRecord(value);
  const id = asText(row.id);
  if (!id || id.length > 200) return null;
  return {
    id,
    original_file_name: asText(row.original_file_name),
    download_file_name: asText(row.download_file_name),
    mime_type: asText(row.mime_type) || 'application/octet-stream',
    download_mime_type: asText(row.download_mime_type) || asText(row.mime_type) || 'application/octet-stream',
    original_size_bytes: Math.max(0, asNumber(row.original_size_bytes)),
    stored_size_bytes: Math.max(0, asNumber(row.stored_size_bytes)),
    saved_size_bytes: Math.max(0, asNumber(row.saved_size_bytes)),
    retention_days: Math.max(0, asNumber(row.retention_days)),
    folder_id: asText(row.folder_id) || null,
    status: asText(row.status).toLowerCase() || 'unknown',
    storage_mode: asText(row.storage_mode),
    error_text: asText(row.error_text),
    security_scan_status: asText(row.security_scan_status).toLowerCase() || 'pending',
    preview_kind: asText(row.preview_kind).toLowerCase() || 'unsupported',
    preview_available: asBoolean(row.preview_available),
    preview_status: asText(row.preview_status).toLowerCase() || 'unsupported',
    preview_max_bytes: Math.max(0, asNumber(row.preview_max_bytes)),
    is_shared: asBoolean(row.is_shared),
    is_favorite: asBoolean(row.is_favorite),
    share_expires_at: asText(row.share_expires_at) || null,
    created_at: asText(row.created_at) || null,
    updated_at: asText(row.updated_at) || null,
    expires_at: asText(row.expires_at) || null,
  };
}

export function normalizeMyFileFolder(value: unknown): MyFileFolder | null {
  const row = asRecord(value);
  const id = asText(row.id);
  if (!id || id.length > 64) return null;
  return {
    id,
    name: asText(row.name) || 'Папка',
    parent_id: asText(row.parent_id) || null,
    file_count: Math.max(0, asNumber(row.file_count)),
    is_shared: asBoolean(row.is_shared),
    is_favorite: asBoolean(row.is_favorite),
    created_at: asText(row.created_at) || null,
    updated_at: asText(row.updated_at) || null,
  };
}

export async function listMyFiles(
  options: { folderId?: string | null; view?: MyFilesView; signal?: AbortSignal } = {},
): Promise<MyFileListPayload> {
  const params: Record<string, string> = {};
  if (options.folderId) params.folder_id = options.folderId;
  if (options.view === 'recent' || options.view === 'favorites') params.view = options.view;
  const { data } = await apiClient.get('/my-files', { params, signal: options.signal });
  const payload = asRecord(data);
  const mapRows = <T>(key: string, normalize: (value: unknown) => T | null): T[] =>
    (Array.isArray(payload[key]) ? payload[key] as unknown[] : [])
      .map(normalize)
      .filter((item): item is T => Boolean(item));
  return {
    items: mapRows('items', normalizeMyFile),
    folders: mapRows('folders', normalizeMyFileFolder),
    breadcrumbs: mapRows('breadcrumbs', normalizeMyFileFolder),
    folder: normalizeMyFileFolder(payload.folder),
  };
}

export async function listMyFileFolders(signal?: AbortSignal): Promise<MyFileFolder[]> {
  const { data } = await apiClient.get('/my-files/folders', { signal });
  return (Array.isArray(asRecord(data).items) ? asRecord(data).items as unknown[] : [])
    .map(normalizeMyFileFolder)
    .filter((item): item is MyFileFolder => Boolean(item));
}

export async function createMyFileFolder(input: {
  name: string;
  parentId?: string | null;
}): Promise<MyFileFolder> {
  const name = asText(input.name);
  if (!name) throw new Error('Введите название папки');
  const { data } = await apiClient.post('/my-files/folders', {
    name: name.slice(0, 255),
    parent_id: asText(input.parentId) || null,
  });
  const folder = normalizeMyFileFolder(data);
  if (!folder) throw new Error('Сервер вернул некорректную папку');
  return folder;
}

export async function updateMyFileFolder(
  folderId: string,
  patch: { name?: string; parentId?: string | null; isFavorite?: boolean },
): Promise<MyFileFolder> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = asText(patch.name);
  if (patch.parentId !== undefined) payload.parent_id = asText(patch.parentId) || null;
  if (patch.isFavorite !== undefined) payload.is_favorite = Boolean(patch.isFavorite);
  const { data } = await apiClient.patch(
    `/my-files/folders/${encodeURIComponent(normalized)}`,
    payload,
  );
  const folder = normalizeMyFileFolder(data);
  if (!folder) throw new Error('Сервер вернул некорректную папку');
  return folder;
}

export async function deleteMyFileFolder(folderId: string): Promise<void> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  await apiClient.delete(`/my-files/folders/${encodeURIComponent(normalized)}`);
}

export async function updateMyFile(
  fileId: string,
  patch: { name?: string; folderId?: string | null; isFavorite?: boolean },
): Promise<MyFileRecord> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = asText(patch.name);
  if (patch.folderId !== undefined) payload.folder_id = asText(patch.folderId) || null;
  if (patch.isFavorite !== undefined) payload.is_favorite = Boolean(patch.isFavorite);
  const { data } = await apiClient.patch(
    `/my-files/${encodeURIComponent(normalized)}`,
    payload,
  );
  const record = normalizeMyFile(data);
  if (!record) throw new Error('Сервер вернул некорректную карточку файла');
  return record;
}

export type MyFilesTrash = {
  items: MyFileRecord[];
  folders: MyFileFolder[];
};

export async function listMyFilesTrash(signal?: AbortSignal): Promise<MyFilesTrash> {
  const { data } = await apiClient.get('/my-files/trash', { signal });
  const payload = asRecord(data);
  return {
    items: (Array.isArray(payload.items) ? payload.items as unknown[] : [])
      .map(normalizeMyFile)
      .filter((item): item is MyFileRecord => Boolean(item)),
    folders: (Array.isArray(payload.folders) ? payload.folders as unknown[] : [])
      .map(normalizeMyFileFolder)
      .filter((item): item is MyFileFolder => Boolean(item)),
  };
}

export async function restoreMyFile(fileId: string): Promise<void> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  await apiClient.post(`/my-files/trash/files/${encodeURIComponent(normalized)}/restore`);
}

export async function restoreMyFileFolder(folderId: string): Promise<void> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  await apiClient.post(`/my-files/trash/folders/${encodeURIComponent(normalized)}/restore`);
}

export async function purgeMyFile(fileId: string): Promise<void> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  await apiClient.delete(`/my-files/trash/files/${encodeURIComponent(normalized)}`);
}

export async function purgeMyFileFolder(folderId: string): Promise<void> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  await apiClient.delete(`/my-files/trash/folders/${encodeURIComponent(normalized)}`);
}

export async function emptyMyFilesTrash(): Promise<void> {
  await apiClient.post('/my-files/trash/empty');
}

export async function createMyFileFolderShare(folderId: string, rotate = false): Promise<MyFileShare> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  const { data } = await apiClient.post(
    `/my-files/folders/${encodeURIComponent(normalized)}/share`,
    undefined,
    { params: rotate ? { rotate: true } : {} },
  );
  const row = asRecord(data);
  const token = asText(row.token);
  if (!token || token.length > 512) throw new Error('Сервер не вернул публичную ссылку');
  return {
    token,
    public_path: asText(row.public_path),
    expires_at: asText(row.expires_at) || null,
  };
}

export async function revokeMyFileFolderShare(folderId: string): Promise<void> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  await apiClient.delete(`/my-files/folders/${encodeURIComponent(normalized)}/share`);
}

export async function createMyFileFolderArchiveGrant(folderId: string): Promise<MyFileDownloadGrant> {
  const normalized = asText(folderId);
  if (!normalized) throw new Error('Не выбрана папка');
  const { data } = await apiClient.post(`/my-files/folders/${encodeURIComponent(normalized)}/archive-grant`);
  const row = asRecord(data);
  const downloadPath = asText(row.download_path);
  if (!downloadPath) throw new Error('Сервер не вернул ссылку для скачивания');
  return {
    download_path: downloadPath,
    expires_at: asText(row.expires_at) || null,
    expires_in_seconds: Math.max(0, asNumber(row.expires_in_seconds)),
  };
}

export async function getMyFilesQuota(signal?: AbortSignal): Promise<MyFilesQuota> {
  const { data } = await apiClient.get('/my-files/quota', { signal });
  const row = asRecord(data);
  const used = Math.max(0, asNumber(row.used_bytes));
  const limit = Math.max(0, asNumber(row.limit_bytes));
  return {
    used_bytes: used,
    limit_bytes: limit,
    remaining_bytes: Math.max(0, asNumber(row.remaining_bytes ?? limit - used)),
  };
}

export async function createMyFileDownloadGrant(fileId: string): Promise<MyFileDownloadGrant> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  const { data } = await apiClient.post(`/my-files/${encodeURIComponent(normalized)}/download-grant`);
  const row = asRecord(data);
  const downloadPath = asText(row.download_path);
  if (!downloadPath) throw new Error('Сервер не вернул ссылку для скачивания');
  return {
    download_path: downloadPath,
    expires_at: asText(row.expires_at) || null,
    expires_in_seconds: Math.max(0, asNumber(row.expires_in_seconds)),
  };
}

export async function getMyFilePreview(fileId: string): Promise<MyFilePreview> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  const { data } = await apiClient.get(`/my-files/${encodeURIComponent(normalized)}/preview`);
  const row = asRecord(data);
  return {
    preview_kind: asText(row.preview_kind).toLowerCase(),
    source_kind: asText(row.source_kind).toLowerCase(),
    source_filename: asText(row.source_filename),
    pdf_filename: asText(row.pdf_filename),
    page_count: Math.max(0, asNumber(row.page_count)),
    sheets: (Array.isArray(row.sheets) ? row.sheets : [])
      .map(asRecord)
      .filter((sheet) => Object.keys(sheet).length > 0),
  };
}

export async function createMyFileShare(fileId: string, rotate = false): Promise<MyFileShare> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  const { data } = await apiClient.post(
    `/my-files/${encodeURIComponent(normalized)}/share`,
    undefined,
    { params: rotate ? { rotate: true } : {} },
  );
  const row = asRecord(data);
  const token = asText(row.token);
  if (!token || token.length > 512) throw new Error('Сервер не вернул публичную ссылку');
  return {
    token,
    public_path: asText(row.public_path),
    expires_at: asText(row.expires_at) || null,
  };
}

export async function revokeMyFileShare(fileId: string): Promise<void> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  await apiClient.delete(`/my-files/${encodeURIComponent(normalized)}/share`);
}

export async function deleteMyFile(fileId: string): Promise<void> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не выбран файл');
  await apiClient.delete(`/my-files/${encodeURIComponent(normalized)}`);
}

export type MyFileUploadSession = {
  file_id: string;
  chunk_size_bytes: number;
  uploaded_bytes: number;
  file_size_bytes: number;
  complete: boolean;
};

export function normalizeMyFileUploadSession(value: unknown): MyFileUploadSession {
  const row = asRecord(value);
  return {
    file_id: asText(row.file_id),
    chunk_size_bytes: Math.max(0, asNumber(row.chunk_size_bytes)),
    uploaded_bytes: Math.max(0, asNumber(row.uploaded_bytes)),
    file_size_bytes: Math.max(0, asNumber(row.file_size_bytes)),
    complete: asBoolean(row.complete),
  };
}

export async function createMyFileUploadSession(input: {
  fileName: string;
  fileSize: number;
  retentionDays: number;
  mimeType: string;
  folderId?: string | null;
  signal?: AbortSignal;
}): Promise<MyFileUploadSession> {
  const { data } = await apiClient.post('/my-files/upload-sessions', {
    file_name: asText(input.fileName) || 'file.bin',
    file_size: Math.max(0, Math.trunc(Number(input.fileSize) || 0)),
    retention_days: Math.trunc(Number(input.retentionDays) || 1),
    mime_type: asText(input.mimeType) || 'application/octet-stream',
    folder_id: asText(input.folderId) || null,
  }, { signal: input.signal });
  const session = normalizeMyFileUploadSession(data);
  if (!session.file_id || session.chunk_size_bytes <= 0) {
    throw new Error('Сервер вернул некорректную сессию загрузки');
  }
  return session;
}

export async function getMyFileUploadSession(
  fileId: string,
  signal?: AbortSignal,
): Promise<MyFileUploadSession> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не найдена сессия загрузки');
  const { data } = await apiClient.get(
    `/my-files/upload-sessions/${encodeURIComponent(normalized)}`,
    { signal },
  );
  return normalizeMyFileUploadSession(data);
}

export async function uploadMyFileChunk(
  fileId: string,
  chunk: Blob,
  options: {
    offset: number;
    signal?: AbortSignal;
    onUploadProgress?: (event: { loaded: number }) => void;
  },
): Promise<MyFileUploadSession> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не найдена сессия загрузки');
  const { data } = await apiClient.put(
    `/my-files/upload-sessions/${encodeURIComponent(normalized)}/chunks`,
    chunk,
    {
      params: { offset: Math.max(0, Math.trunc(Number(options.offset) || 0)) },
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: options.signal,
      timeout: 300_000,
      onUploadProgress: (event) => {
        options.onUploadProgress?.({ loaded: Math.max(0, Number(event?.loaded) || 0) });
      },
    },
  );
  return normalizeMyFileUploadSession(data);
}

export async function completeMyFileUploadSession(
  fileId: string,
  signal?: AbortSignal,
): Promise<MyFileRecord> {
  const normalized = asText(fileId);
  if (!normalized) throw new Error('Не найдена сессия загрузки');
  const { data } = await apiClient.post(
    `/my-files/upload-sessions/${encodeURIComponent(normalized)}/complete`,
    null,
    { signal, timeout: 120_000 },
  );
  const record = normalizeMyFile(data);
  if (!record) throw new Error('Сервер вернул некорректную карточку файла');
  return record;
}

export async function cancelMyFileUploadSession(
  fileId: string,
  reason?: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalized = asText(fileId);
  if (!normalized) return;
  await apiClient.delete(`/my-files/upload-sessions/${encodeURIComponent(normalized)}`, {
    params: reason ? { reason: asText(reason).slice(0, 2000) } : undefined,
    signal,
  });
}
