import {
  cancelMyFileUploadSession,
  completeMyFileUploadSession,
  createMyFileDownloadGrant,
  createMyFileUploadSession,
  getMyFileUploadSession,
  uploadMyFileChunk,
} from '../api/myFilesApi';
import { getNativeMyFilesOfflineFile } from './nativeMyFilesOfflineStore';
import {
  downloadNativeMyFile,
  readNativeMyFileTextPreview,
  resolveMyFileDownloadGrantUrl,
  resolveMyFilePreviewContentUrl,
  uploadNativeMyFile,
} from './nativeMyFilesTransfers';

const mockFiles = new Map<string, { size: number; text?: string; mtime?: number }>();

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
    get modificationTime() { return mockFiles.get(this.uri)?.mtime ?? 1; }
    async text() { return mockFiles.get(this.uri)?.text || ''; }
    slice(start?: number, end?: number) {
      const size = Math.max(0, Math.min(this.size, end ?? this.size) - Math.max(0, start ?? 0));
      return { size } as Blob;
    }
    create() { if (!mockFiles.has(this.uri)) mockFiles.set(this.uri, { size: 0, text: '' }); }
    write(content: string | Uint8Array) {
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
      mockFiles.set(this.uri, { size: text.length, text });
    }
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
  createMyFileUploadSession: jest.fn(),
  getMyFileUploadSession: jest.fn(),
  uploadMyFileChunk: jest.fn(),
  completeMyFileUploadSession: jest.fn(),
  cancelMyFileUploadSession: jest.fn(),
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
    folder_id: null,
    status: 'ready',
    storage_mode: 'stored',
    error_text: '',
    security_scan_status: 'clean',
    preview_kind: 'pdf',
    preview_available: true,
    preview_status: 'ready',
    preview_max_bytes: 0,
    is_shared: false,
    is_favorite: false,
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
    stored_size_bytes: 1024, saved_size_bytes: 0, retention_days: 7, folder_id: null, status: 'ready', storage_mode: 'stored',
    error_text: '', security_scan_status: 'clean', preview_kind: 'pdf', preview_available: true,
    preview_status: 'ready', preview_max_bytes: 0, is_shared: false, is_favorite: false, share_expires_at: null,
    created_at: null, updated_at: null, expires_at: null,
  }, { userId: 7 });

  expect(file).toBe(persistent);
  expect(getNativeMyFilesOfflineFile).toHaveBeenCalledWith(7, expect.objectContaining({ id: 'f-1' }));
  expect(createMyFileDownloadGrant).not.toHaveBeenCalled();
});

const uploadedFile = {
  id: 'sess-1',
  original_file_name: 'report.pdf',
  download_file_name: 'report.pdf',
  mime_type: 'application/pdf',
  download_mime_type: 'application/pdf',
  original_size_bytes: 20,
  stored_size_bytes: 0,
  saved_size_bytes: 0,
  retention_days: 7,
  status: 'queued',
  storage_mode: '',
  error_text: '',
  security_scan_status: 'pending',
  preview_kind: 'unsupported',
  preview_available: false,
  preview_status: 'unsupported',
  preview_max_bytes: 0,
  is_shared: false,
    is_favorite: false,
  share_expires_at: null,
  created_at: null,
  updated_at: null,
  expires_at: null,
};

const uploadSession = (overrides: Record<string, unknown> = {}) => ({
  file_id: 'sess-1',
  chunk_size_bytes: 8,
  uploaded_bytes: 0,
  file_size_bytes: 20,
  complete: false,
  ...overrides,
});

const pickedFile = { uri: 'file:///picked/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 20 };
const resumeMapUri = 'file:///document/hubit-my-files-upload-resume.json';

function seedResumeMap(map: Record<string, { fileId: string; savedAt: number }>): void {
  mockFiles.set(resumeMapUri, { size: 2, text: JSON.stringify(map) });
}

function readResumeMap(): Record<string, { fileId: string; savedAt: number }> {
  return JSON.parse(mockFiles.get(resumeMapUri)?.text || '{}');
}

describe('resumable upload sessions', () => {
  beforeEach(() => {
    mockFiles.set('file:///picked/report.pdf', { size: 20, mtime: 123 });
    jest.mocked(createMyFileUploadSession).mockResolvedValue(uploadSession());
    jest.mocked(getMyFileUploadSession).mockResolvedValue(uploadSession());
    jest.mocked(uploadMyFileChunk).mockImplementation(async (_id, chunk, options) =>
      uploadSession({ uploaded_bytes: options.offset + chunk.size }));
    jest.mocked(completeMyFileUploadSession).mockResolvedValue(uploadedFile as never);
    jest.mocked(cancelMyFileUploadSession).mockResolvedValue(undefined);
  });

  it('uploads a file in chunks and completes the session', async () => {
    const progress: Array<{ loaded: number; total: number | null; progress: number | null }> = [];

    const record = await uploadNativeMyFile(pickedFile, 7, {
      onProgress: (event) => progress.push(event),
    });

    expect(record.id).toBe('sess-1');
    expect(createMyFileUploadSession).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'report.pdf',
      fileSize: 20,
      retentionDays: 7,
      mimeType: 'application/pdf',
    }));
    expect(jest.mocked(uploadMyFileChunk).mock.calls.map((call) => call[2].offset)).toEqual([0, 8, 16]);
    expect(completeMyFileUploadSession).toHaveBeenCalledWith('sess-1', undefined);
    expect(progress.at(-1)?.progress).toBe(1);
    expect(readResumeMap()).toEqual({});
  });

  it('resumes a matching unfinished session instead of reserving a new upload', async () => {
    seedResumeMap({ 'report.pdf|20||123': { fileId: 'sess-2', savedAt: Date.now() } });
    jest.mocked(getMyFileUploadSession).mockResolvedValue(uploadSession({
      file_id: 'sess-2', uploaded_bytes: 16,
    }));

    await uploadNativeMyFile(pickedFile, 7, {});

    expect(createMyFileUploadSession).not.toHaveBeenCalled();
    expect(jest.mocked(uploadMyFileChunk).mock.calls.map((call) => call[2].offset)).toEqual([16]);
    expect(completeMyFileUploadSession).toHaveBeenCalledWith('sess-2', undefined);
  });

  it('ignores an expired resume entry and reserves a fresh session', async () => {
    seedResumeMap({ 'report.pdf|20||123': { fileId: 'stale', savedAt: Date.now() - 3 * 60 * 60 * 1000 } });

    await uploadNativeMyFile(pickedFile, 7, {});

    expect(createMyFileUploadSession).toHaveBeenCalledTimes(1);
    expect(getMyFileUploadSession).not.toHaveBeenCalledWith('stale', undefined);
  });

  it('recovers an acknowledged chunk through the session status after a transport failure', async () => {
    jest.mocked(uploadMyFileChunk)
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK', response: undefined }))
      .mockImplementation(async (_id, chunk, options) => uploadSession({ uploaded_bytes: options.offset + chunk.size }));
    jest.mocked(getMyFileUploadSession).mockResolvedValueOnce(uploadSession({ uploaded_bytes: 8 }));

    const record = await uploadNativeMyFile(pickedFile, 7, {});

    expect(record.id).toBe('sess-1');
    expect(jest.mocked(uploadMyFileChunk).mock.calls.map((call) => call[2].offset)).toEqual([0, 8, 16]);
    expect(cancelMyFileUploadSession).not.toHaveBeenCalled();
  });

  it('cancels the session and clears resume after a definitive failure', async () => {
    jest.mocked(uploadMyFileChunk).mockRejectedValue(Object.assign(new Error('bad'), {
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Upload chunk is invalid' } },
    }));

    await expect(uploadNativeMyFile(pickedFile, 7, {})).rejects.toThrow('bad');
    expect(cancelMyFileUploadSession).toHaveBeenCalledWith('sess-1', 'Upload chunk is invalid');
    expect(readResumeMap()).toEqual({});
  });

  it('waits for a free upload slot when the server limits concurrency', async () => {
    jest.useFakeTimers();
    jest.mocked(createMyFileUploadSession)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), {
        isAxiosError: true,
        response: { status: 429, headers: { 'retry-after': '2' }, data: {} },
      }))
      .mockResolvedValueOnce(uploadSession());

    const promise = uploadNativeMyFile(pickedFile, 7, {});
    await jest.advanceTimersByTimeAsync(2_100);
    const record = await promise;
    jest.useRealTimers();

    expect(record.id).toBe('sess-1');
    expect(createMyFileUploadSession).toHaveBeenCalledTimes(2);
  });

  it('cancels the session when the upload is aborted', async () => {
    const controller = new AbortController();
    jest.mocked(uploadMyFileChunk).mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error('canceled'), { isAxiosError: true, code: 'ERR_CANCELED', name: 'CanceledError' });
    });

    await expect(uploadNativeMyFile(pickedFile, 7, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelMyFileUploadSession).toHaveBeenCalledWith('sess-1', 'Upload cancelled');
  });
});
