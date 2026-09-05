import { createMyFileDownloadGrant } from '../api/myFilesApi';
import { getNativeMyFilesOfflineFile } from './nativeMyFilesOfflineStore';
import {
  downloadNativeMyFile,
  readNativeMyFileTextPreview,
  resolveMyFileDownloadGrantUrl,
  resolveMyFilePreviewContentUrl,
} from './nativeMyFilesTransfers';

const mockFiles = new Map<string, { size: number; text?: string }>();

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;
    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = [base.replace(/\/$/, ''), ...segments].join('/');
    }
    create() {}
    list() {
      const prefix = `${this.uri}/`;
      return [...mockFiles.keys()]
        .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map((uri) => new MockFile(uri));
    }
  }
  class MockFile {
    uri: string;
    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = segments.length ? [base.replace(/\/$/, ''), ...segments].join('/') : base;
    }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.size || 0; }
    get name() { return this.uri.split('/').pop() || ''; }
    get type() { return 'application/octet-stream'; }
    get lastModified() { return 1; }
    get creationTime() { return 1; }
    async text() { return mockFiles.get(this.uri)?.text || ''; }
    delete() { mockFiles.delete(this.uri); }
    createUploadTask() { throw new Error('not implemented'); }
    static downloadFileAsync = jest.fn();
  }
  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: 'file:///cache', document: 'file:///document' },
    UploadType: { BINARY_CONTENT: 0 },
  };
});

jest.mock('../api/myFilesApi', () => ({
  ...jest.requireActual('../api/myFilesApi'),
  createMyFileDownloadGrant: jest.fn(),
}));
jest.mock('./nativeMyFilesOfflineStore', () => ({
  getNativeMyFilesOfflineFile: jest.fn(),
}));

beforeEach(() => {
  mockFiles.clear();
  jest.clearAllMocks();
  jest.mocked(getNativeMyFilesOfflineFile).mockResolvedValue(null);
});

it('accepts only an exact relative one-time My Files grant path', () => {
  const url = resolveMyFileDownloadGrantUrl('/my-files/download-grant/token_1234567890123456');
  expect(url).toContain('/api/v1/my-files/download-grant/token_1234567890123456');
  expect(() => resolveMyFileDownloadGrantUrl('https://evil.example/file')).toThrow('недопустимую');
  expect(() => resolveMyFileDownloadGrantUrl('/my-files/public/token/download')).toThrow('недопустимую');
});

it('builds preview content only on the trusted authenticated API origin', () => {
  expect(resolveMyFilePreviewContentUrl('file/1')).toContain('/api/v1/my-files/file%2F1/preview/content');
  expect(() => resolveMyFilePreviewContentUrl('')).toThrow('Не выбран');
});

it('renders text as inert plain content and replaces null bytes', async () => {
  const file = { exists: true, size: 12, text: jest.fn().mockResolvedValue('<script>bad()</script>\0') };
  await expect(readNativeMyFileTextPreview(file as never)).resolves.toBe('<script>bad()</script>�');
});

it('returns a valid cached file before requesting a network download grant', async () => {
  mockFiles.set('file:///cache/hubit-my-files/f-1-report.pdf', { size: 1024 });

  const file = await downloadNativeMyFile({
    id: 'f-1',
    original_file_name: 'report.pdf',
    download_file_name: 'report.pdf',
    mime_type: 'application/pdf',
    download_mime_type: 'application/pdf',
    original_size_bytes: 1024,
    stored_size_bytes: 1024,
    saved_size_bytes: 0,
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
  });

  expect(file.uri).toBe('file:///cache/hubit-my-files/f-1-report.pdf');
  expect(createMyFileDownloadGrant).not.toHaveBeenCalled();
});

it('prefers the persistent user-scoped offline copy over cache and network', async () => {
  const persistent = { uri: 'file:///document/hubit-my-files-offline/user-7/f-1-report.pdf', size: 1024 };
  jest.mocked(getNativeMyFilesOfflineFile).mockResolvedValue(persistent as never);

  const file = await downloadNativeMyFile({
    id: 'f-1', original_file_name: 'report.pdf', download_file_name: 'report.pdf',
    mime_type: 'application/pdf', download_mime_type: 'application/pdf', original_size_bytes: 1024,
    stored_size_bytes: 1024, saved_size_bytes: 0, retention_days: 7, status: 'ready', storage_mode: 'stored',
    error_text: '', security_scan_status: 'clean', preview_kind: 'pdf', preview_available: true,
    preview_status: 'ready', preview_max_bytes: 0, is_shared: false, share_expires_at: null,
    created_at: null, updated_at: null, expires_at: null,
  }, { userId: 7 });

  expect(file).toBe(persistent);
  expect(getNativeMyFilesOfflineFile).toHaveBeenCalledWith(7, expect.objectContaining({ id: 'f-1' }));
  expect(createMyFileDownloadGrant).not.toHaveBeenCalled();
});
