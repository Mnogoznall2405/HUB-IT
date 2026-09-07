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
  status: string;
  storage_mode: string;
  error_text: string;
  security_scan_status: string;
  preview_kind: string;
  preview_available: boolean;
  preview_status: string;
  preview_max_bytes: number;
  is_shared: boolean;
  share_expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
};

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
    status: asText(row.status).toLowerCase() || 'unknown',
    storage_mode: asText(row.storage_mode),
    error_text: asText(row.error_text),
    security_scan_status: asText(row.security_scan_status).toLowerCase() || 'pending',
    preview_kind: asText(row.preview_kind).toLowerCase() || 'unsupported',
    preview_available: asBoolean(row.preview_available),
    preview_status: asText(row.preview_status).toLowerCase() || 'unsupported',
    preview_max_bytes: Math.max(0, asNumber(row.preview_max_bytes)),
    is_shared: asBoolean(row.is_shared),
    share_expires_at: asText(row.share_expires_at) || null,
    created_at: asText(row.created_at) || null,
    updated_at: asText(row.updated_at) || null,
    expires_at: asText(row.expires_at) || null,
  };
}

export async function listMyFiles(signal?: AbortSignal): Promise<MyFileRecord[]> {
  const { data } = await apiClient.get('/my-files', { signal });
  return (Array.isArray(asRecord(data).items) ? asRecord(data).items as unknown[] : [])
    .map(normalizeMyFile)
    .filter((item): item is MyFileRecord => Boolean(item));
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
