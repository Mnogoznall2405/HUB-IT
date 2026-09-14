import { Platform } from 'react-native';
import { downloadAuthenticatedFile } from './authenticatedFileDownload';
import { clearAttachmentCache, cleanupAttachmentCache, downloadTrustedChatMedia } from './nativeAttachmentDownloads';
import { getSessionGeneration } from '../auth/tokenStore';

const mockFiles = new Map<string, { size: number; modifiedAt: number }>();
const mockDirectoryList = jest.fn();
let mockDirectoryListError: Error | null = null;

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;

    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = [base.replace(/\/$/, ''), ...segments].join('/');
    }

    create() {}

    list() {
      mockDirectoryList();
      if (mockDirectoryListError) throw mockDirectoryListError;
      const prefix = `${this.uri}/`;
      return [...mockFiles.entries()]
        .filter(([uri]) => uri.startsWith(prefix))
        .map(([uri]) => new MockFile(uri));
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
    get lastModified() { return mockFiles.get(this.uri)?.modifiedAt || 0; }
    get creationTime() { return this.lastModified; }
    delete() { mockFiles.delete(this.uri); }
    async copy(destination: MockFile, options?: { overwrite?: boolean }) {
      if (destination.exists && !options?.overwrite) throw new Error('Destination exists');
      mockFiles.set(destination.uri, mockFiles.get(this.uri) || { size: 0, modifiedAt: Date.now() });
    }
    async move(destination: MockFile, options?: { overwrite?: boolean }) {
      await this.copy(destination, options);
      this.delete();
      this.uri = destination.uri;
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: 'file:///cache', document: 'file:///document' },
  };
});

jest.mock('./authenticatedFileDownload', () => ({
  downloadAuthenticatedFile: jest.fn(),
}));

jest.mock('../auth/tokenStore', () => ({
  getSessionUserId: jest.fn(async () => 7),
  getSessionGeneration: jest.fn(() => 0),
}));

const mockedDownload = downloadAuthenticatedFile as jest.MockedFunction<typeof downloadAuthenticatedFile>;

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
});

beforeEach(() => {
  mockFiles.clear();
  mockDirectoryList.mockClear();
  mockDirectoryListError = null;
  mockedDownload.mockReset();
  jest.mocked(getSessionGeneration).mockReturnValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('scans once for repeated hits and once for a later small download', async () => {
  let now = 2_000_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockFiles.set('file:///document/hubit-attachments-v2/7-photo.img', {
    size: 1024,
    modifiedAt: now,
  });

  await downloadTrustedChatMedia(
    '/api/v1/chat/messages/m-1/attachments/a-1/file',
    'photo.img',
  );
  await downloadTrustedChatMedia(
    '/api/v1/chat/messages/m-1/attachments/a-1/file',
    'photo.img',
  );

  expect(mockedDownload).not.toHaveBeenCalled();
  expect(mockDirectoryList).toHaveBeenCalledTimes(1);

  now += 5 * 60 * 1000 + 1;
  mockedDownload.mockImplementation(async (_url, destination) => {
    mockFiles.set(destination.uri, { size: 2048, modifiedAt: now });
    return destination;
  });
  await downloadTrustedChatMedia(
    '/api/v1/chat/messages/m-1/attachments/a-2/file',
    'second.img',
  );

  expect(mockedDownload).toHaveBeenCalledTimes(1);
  expect(mockDirectoryList).toHaveBeenCalledTimes(2);
});

it('does not fail a valid cache hit when best-effort maintenance cannot list the directory', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(3_000_000_000_000);
  mockFiles.set('file:///document/hubit-attachments-v2/7-photo.img', {
    size: 1024,
    modifiedAt: Date.now(),
  });
  mockDirectoryListError = new Error('temporary filesystem error');

  await expect(downloadTrustedChatMedia(
    '/api/v1/chat/messages/m-1/attachments/a-1/file',
    'photo.img',
  )).resolves.toMatchObject({ uri: 'file:///document/hubit-attachments-v2/7-photo.img' });

  expect(mockedDownload).not.toHaveBeenCalled();
  expect(mockDirectoryList).toHaveBeenCalledTimes(1);
});

it('keeps an old opened file while the persistent cache stays within its size limit', () => {
  const now = 3_500_000_000_000;
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const uri = 'file:///document/hubit-attachments-v2/7-old-photo.img';
  mockFiles.set(uri, {
    size: 1024,
    modifiedAt: now - 30 * 24 * 60 * 60 * 1000,
  });

  cleanupAttachmentCache();

  expect(mockFiles.has(uri)).toBe(true);
});

it('limits simultaneous preview downloads to three', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(4_000_000_000_000);
  const releases: Array<() => void> = [];
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    releases.push(() => {
      mockFiles.set(destination.uri, { size: 1024, modifiedAt: Date.now() });
      resolve(destination);
    });
  }));

  const downloads = [1, 2, 3, 4].map((index) => downloadTrustedChatMedia(
    `/api/v1/chat/messages/m-1/attachments/a-${index}/file`,
    `photo-${index}.img`,
  ));
  await Promise.resolve();
  await Promise.resolve();
  const simultaneousDownloads = mockedDownload.mock.calls.length;

  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  for (const release of releases.splice(0)) release();
  await Promise.resolve();
  await Promise.resolve();
  for (const release of releases.splice(0)) release();
  await Promise.all(downloads);

  expect(simultaneousDownloads).toBe(3);
  expect(mockedDownload).toHaveBeenCalledTimes(4);
});

it('drops an aborted preview while it is waiting for a download slot', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(5_000_000_000_000);
  const releases: Array<() => void> = [];
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    releases.push(() => resolve(destination));
  }));
  const active = [1, 2, 3].map((index) => downloadTrustedChatMedia(
    `/api/v1/chat/messages/m-2/attachments/a-${index}/file`,
    `queued-${index}.img`,
  ));
  const controller = new AbortController();
  const queued = downloadTrustedChatMedia(
    '/api/v1/chat/messages/m-2/attachments/a-4/file',
    'queued-4.img',
    { signal: controller.signal },
  );
  await Promise.resolve();
  await Promise.resolve();

  expect(mockedDownload).toHaveBeenCalledTimes(3);
  controller.abort();
  await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  for (const release of releases.splice(0)) release();
  await Promise.all(active);

  expect(mockedDownload).toHaveBeenCalledTimes(3);
});

it('replaces an empty cached media file instead of returning it for decoding', async () => {
  const uri = 'file:///document/hubit-attachments-v2/7-empty.img';
  mockFiles.set(uri, { size: 0, modifiedAt: Date.now() });
  mockedDownload.mockImplementation(async (_url, destination) => {
    mockFiles.set(destination.uri, { size: 1024, modifiedAt: Date.now() });
    return destination;
  });
  const file = await downloadTrustedChatMedia('/api/v1/chat/messages/m/attachments/a/file', 'empty.img');
  expect(file.size).toBe(1024);
  expect(mockedDownload).toHaveBeenCalledTimes(1);
});

it('waits for an active refresh rather than returning the stale cached image', async () => {
  const uri = 'file:///document/hubit-attachments-v2/7-refresh.img';
  mockFiles.set(uri, { size: 10, modifiedAt: Date.now() });
  let finish!: () => void;
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    finish = () => { mockFiles.set(destination.uri, { size: 100, modifiedAt: Date.now() }); resolve(destination); };
  }));
  const first = downloadTrustedChatMedia('/api/v1/chat/messages/m/attachments/a/file', 'refresh.img', { forceDownload: true });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  let completedEarly = false;
  const second = downloadTrustedChatMedia('/api/v1/chat/messages/m/attachments/a/file', 'refresh.img').then((file) => {
    completedEarly = true; return file;
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const early = completedEarly;
  finish();
  const results = await Promise.all([first, second]);
  expect(early).toBe(false);
  expect(results.map((file) => file.size)).toEqual([100, 100]);
  expect(mockedDownload).toHaveBeenCalledTimes(1);
});

it.each(['cache', 'session'] as const)('rejects late media completion after %s invalidation', async (kind) => {
  let finish!: () => void;
  let destinationUri = '';
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    destinationUri = destination.uri;
    finish = () => { mockFiles.set(destination.uri, { size: 100, modifiedAt: Date.now() }); resolve(destination); };
  }));
  const pending = downloadTrustedChatMedia('/api/v1/chat/messages/m/attachments/a/file', `late-${kind}.img`);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  if (kind === 'cache') clearAttachmentCache();
  else jest.mocked(getSessionGeneration).mockReturnValue(1);
  finish();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(mockFiles.has(destinationUri)).toBe(false);
});

it('does not restore a refreshed original after the attachment cache is cleared', async () => {
  const uri = 'file:///document/hubit-attachments-v2/7-cleared-refresh.img';
  mockFiles.set(uri, { size: 10, modifiedAt: Date.now() });
  let finish!: () => void;
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    finish = () => { mockFiles.set(destination.uri, { size: 100, modifiedAt: Date.now() }); resolve(destination); };
  }));
  const pending = downloadTrustedChatMedia('/api/v1/chat/messages/m/attachments/a/file', 'cleared-refresh.img', { forceDownload: true });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  clearAttachmentCache();
  finish();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(mockFiles.size).toBe(0);
});

it('does not start queued media transfers after their cache generation is cleared', async () => {
  const releases: Array<() => void> = [];
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    releases.push(() => { mockFiles.set(destination.uri, { size: 100, modifiedAt: Date.now() }); resolve(destination); });
  }));
  const pending = [1, 2, 3, 4].map((id) => downloadTrustedChatMedia(
    `/api/v1/chat/messages/m/attachments/a${id}/file`, `clear-queue-${id}.img`,
  ));
  const settled = Promise.allSettled(pending);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  clearAttachmentCache();
  releases.forEach((release) => release());
  const results = await settled;
  expect(results.every((result) => result.status === 'rejected')).toBe(true);
  expect(mockedDownload).toHaveBeenCalledTimes(3);
  expect(mockFiles.size).toBe(0);
});
