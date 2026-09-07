import type { MyFileRecord } from '../api/myFilesApi';
import {
  buildMyFilePublicUrl,
  formatMyFileSize,
  isMyFileProcessing,
  isMyFileReady,
  MY_FILES_MAX_FILE_BYTES,
  myFileIcon,
  nativeMyFilePreviewKind,
  myFileStatusLabel,
  normalizeMyFilesRetention,
} from './nativeMyFilesModel';

const file = (overrides: Partial<MyFileRecord> = {}) => ({
  id: 'f-1',
  original_file_name: 'report.pdf',
  download_file_name: '',
  mime_type: 'application/pdf',
  download_mime_type: 'application/pdf',
  original_size_bytes: 1024,
  stored_size_bytes: 900,
  saved_size_bytes: 124,
  retention_days: 7,
  status: 'ready',
  storage_mode: 'stored',
  error_text: '',
  security_scan_status: 'clean',
  preview_kind: 'pdf',
  preview_available: true,
  preview_status: 'ready',
  preview_max_bytes: 0,
  is_shared: false,
  share_expires_at: null,
  created_at: null,
  updated_at: null,
  expires_at: null,
  ...overrides,
} satisfies MyFileRecord);

it('formats sizes and maps status/type metadata', () => {
  expect(formatMyFileSize(1536)).toBe('1.5 КБ');
  expect(myFileIcon(file())).toBe('file-pdf-box');
  expect(myFileStatusLabel(file({ status: 'scanning' }))).toBe('Проверка безопасности');
  expect(isMyFileProcessing(file({ status: 'processing' }))).toBe(true);
});

it('keeps the server retention allowlist', () => {
  expect(normalizeMyFilesRetention(30)).toBe(30);
  expect(normalizeMyFilesRetention(14)).toBe(1);
});

it('uses the IIS uint32 maximum instead of the former one-gigabyte limit', () => {
  expect(MY_FILES_MAX_FILE_BYTES).toBe((2 ** 32) - 1);
});

it('builds only a trusted public HUB path', () => {
  expect(buildMyFilePublicUrl('token-1', 'https://hubit.example')).toBe('https://hubit.example/shared-files/token-1');
  expect(() => buildMyFilePublicUrl('../escape', 'https://hubit.example')).toThrow('Некорректная');
  expect(() => buildMyFilePublicUrl('token-1', 'http://hubit.example')).toThrow('HTTPS');
});

it('allows only clean bounded native previews without executable markup rendering', () => {
  expect(nativeMyFilePreviewKind(file())).toBe('pdf');
  expect(nativeMyFilePreviewKind(file({
    original_file_name: 'photo.png', download_file_name: 'photo.png', mime_type: 'image/png',
    download_mime_type: 'image/png', preview_kind: 'image',
  }))).toBe('image');
  expect(nativeMyFilePreviewKind(file({
    original_file_name: 'notes.html', download_file_name: 'notes.html', mime_type: 'text/html',
    download_mime_type: 'text/html', preview_kind: 'unsupported', preview_available: false,
    preview_status: 'unsupported', original_size_bytes: 120,
  }))).toBe('text');
  expect(nativeMyFilePreviewKind(file({ security_scan_status: 'pending' }))).toBeNull();
  expect(nativeMyFilePreviewKind(file({
    original_file_name: 'vector.svg', download_file_name: 'vector.svg', mime_type: 'image/svg+xml',
    download_mime_type: 'image/svg+xml', preview_kind: 'image',
  }))).toBeNull();
  expect(nativeMyFilePreviewKind(file({
    original_file_name: 'large.txt', download_file_name: 'large.txt', mime_type: 'text/plain',
    download_mime_type: 'text/plain', preview_kind: 'unsupported', preview_available: false,
    preview_status: 'unsupported', original_size_bytes: 2 * 1024 * 1024,
  }))).toBeNull();
});

it('distinguishes blocked and unavailable security scans from a clean ready file', () => {
  expect(myFileStatusLabel(file({ status: 'failed', security_scan_status: 'blocked', error_text: 'File blocked by security scan' }))).toBe('Заблокирован проверкой безопасности');
  expect(isMyFileReady(file({ security_scan_status: 'blocked' }))).toBe(false);
  expect(myFileStatusLabel(file({ security_scan_status: 'error' }))).toBe('Готов · проверка безопасности недоступна');
  expect(myFileStatusLabel(file({ security_scan_status: 'skipped' }))).toBe('Готов · проверка безопасности пропущена');
  expect(isMyFileReady(file({ security_scan_status: 'error' }))).toBe(true);
});
