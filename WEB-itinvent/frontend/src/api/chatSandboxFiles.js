import apiClient from './client';
import { myFilesAPI } from './myFiles';

export const SANDBOX_INPUT_MAX_BYTES = 256 * 1024 * 1024;

// A one-time owner-authorized grant returns materialized file contents,
// including storage-v2 decompression. Never fetch a model-supplied URL.
export async function loadSandboxInputFile(item, { signal } = {}) {
  if (item?.status !== 'ready' || !item?.id) throw new Error('Файл ещё не готов.');
  if (Number(item.original_size_bytes) > SANDBOX_INPUT_MAX_BYTES) {
    throw new Error('Для OpenCode можно выбрать файл до 256 МБ.');
  }
  const { data: grant } = await apiClient.post(
    `/my-files/${encodeURIComponent(item.id)}/download-grant`, null, { signal },
  );
  const url = new URL(myFilesAPI.buildDownloadGrantUrl(grant?.download_path), window.location.origin);
  if (url.origin !== window.location.origin || !/\/my-files\/download-grant\/[^/]+$/.test(url.pathname)
      || url.search || url.hash || url.username || url.password) {
    throw new Error('Некорректный адрес загрузки файла.');
  }
  const response = await fetch(url.href, { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('Не удалось получить файл из хранилища.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SANDBOX_INPUT_MAX_BYTES) throw new Error('Размер файла превышает 256 МБ.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const name = String(item.download_file_name || item.original_file_name || 'file').split(/[\\/]/).pop();
  return new File(chunks, name || 'file', { type: item.download_mime_type || item.mime_type || 'application/octet-stream' });
}
