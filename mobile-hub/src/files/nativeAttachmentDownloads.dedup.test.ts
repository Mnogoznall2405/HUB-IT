import { Platform } from 'react-native';
import { downloadAuthenticatedFile } from './authenticatedFileDownload';
import { downloadTrustedChatMedia } from './nativeAttachmentDownloads';
import { getSessionGeneration } from '../auth/tokenStore';

const mockFiles = new Map<string, { size: number; modifiedAt: number }>();

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
const MEDIA_URL = '/api/v1/chat/messages/m-9/attachments/a-9/file';

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
});

beforeEach(() => {
  mockFiles.clear();
  mockedDownload.mockReset();
  jest.mocked(getSessionGeneration).mockReturnValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flushMicrotasks(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

it('keeps a shared download alive for other callers when the first subscriber aborts', async () => {
  let finish: () => void = () => undefined;
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    finish = () => {
      mockFiles.set(destination.uri, { size: 100, modifiedAt: Date.now() });
      resolve(destination);
    };
  }));

  const abortFirst = new AbortController();
  const first = downloadTrustedChatMedia(MEDIA_URL, 'shared.img', { signal: abortFirst.signal });
  const second = downloadTrustedChatMedia(MEDIA_URL, 'shared.img');
  await flushMicrotasks();

  abortFirst.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });

  finish();
  await expect(second).resolves.toMatchObject({ uri: expect.stringContaining('shared.img') });
  expect(mockedDownload).toHaveBeenCalledTimes(1);
});

it('aborts the underlying transfer only after every subscriber aborted', async () => {
  let finish: () => void = () => undefined;
  let transferAborted = false;
  mockedDownload.mockImplementation((_url, destination, options) => new Promise((resolve, reject) => {
    options?.signal?.addEventListener('abort', () => {
      transferAborted = true;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    finish = () => {
      mockFiles.set(destination.uri, { size: 100, modifiedAt: Date.now() });
      resolve(destination);
    };
  }));

  const abortA = new AbortController();
  const abortB = new AbortController();
  const first = downloadTrustedChatMedia(MEDIA_URL, 'all-abort.img', { signal: abortA.signal });
  const second = downloadTrustedChatMedia(MEDIA_URL, 'all-abort.img', { signal: abortB.signal });
  await flushMicrotasks();

  abortA.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(transferAborted).toBe(false);

  abortB.abort();
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  await flushMicrotasks();
  expect(transferAborted).toBe(true);
  expect(mockedDownload).toHaveBeenCalledTimes(1);
  void finish;
});

it('lets a later caller keep the file when the signaled owner leaves', async () => {
  let finish: () => void = () => undefined;
  mockedDownload.mockImplementation((_url, destination) => new Promise((resolve) => {
    finish = () => {
      mockFiles.set(destination.uri, { size: 64, modifiedAt: Date.now() });
      resolve(destination);
    };
  }));

  const abortOwner = new AbortController();
  const owner = downloadTrustedChatMedia(MEDIA_URL, 'late-joiner.img', { signal: abortOwner.signal });
  await flushMicrotasks();
  const late = downloadTrustedChatMedia(MEDIA_URL, 'late-joiner.img');
  await flushMicrotasks();

  abortOwner.abort();
  await expect(owner).rejects.toMatchObject({ name: 'AbortError' });

  finish();
  const file = await late;
  expect(file.size).toBe(64);
  expect(mockedDownload).toHaveBeenCalledTimes(1);
});
