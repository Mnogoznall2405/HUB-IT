const mockDownload = jest.fn();
const mockHeaders = jest.fn();
const mockFiles = new Map<string, number>();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri) || 0; }
    delete() { mockFiles.delete(this.uri); }
    async move(destination: MockFile) {
      mockFiles.set(destination.uri, this.size);
      this.delete();
      this.uri = destination.uri;
    }
    static downloadFileAsync(...args: unknown[]) { return mockDownload(...args); }
  }
  return { File: MockFile };
});

jest.mock('./authenticatedRequestHeaders', () => ({
  getAuthenticatedRequestHeaders: (...args: unknown[]) => mockHeaders(...args),
}));

import { downloadAuthenticatedFile } from './authenticatedFileDownload';

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockHeaders
    .mockResolvedValueOnce({ Authorization: 'Bearer expired' })
    .mockResolvedValueOnce({ Authorization: 'Bearer refreshed' });
});

it('refreshes credentials and retries once after an authenticated download returns 401', async () => {
  const { File } = jest.requireMock('expo-file-system') as { File: new (uri: string) => { uri: string } };
  const destination = new File('file:///cache/report.pdf');
  const pending = new File('file:///cache/report.pdf.part');
  mockFiles.set(pending.uri, 12);
  mockDownload
    .mockRejectedValueOnce(new Error('Unable to download file: server returned status code 401'))
    .mockImplementationOnce(async (_url, target) => {
      mockFiles.set(target.uri, 12);
      return target;
    });

  await expect(downloadAuthenticatedFile(
    'https://hub.test/api/v1/file',
    destination as never,
    { idempotent: true },
  )).resolves.toBe(destination);

  expect(mockHeaders).toHaveBeenNthCalledWith(1, { forceRefresh: false });
  expect(mockHeaders).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  expect(mockDownload).toHaveBeenCalledTimes(2);
  expect(mockDownload.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
    headers: { Authorization: 'Bearer refreshed' },
  }));
});

it('does not refresh or retry non-authenticated download failures', async () => {
  const { File } = jest.requireMock('expo-file-system') as { File: new (uri: string) => unknown };
  const destination = new File('file:///cache/report.pdf');
  mockDownload.mockRejectedValueOnce(new Error('No space left on device'));

  await expect(downloadAuthenticatedFile(
    'https://hub.test/api/v1/file',
    destination as never,
  )).rejects.toThrow('No space left on device');

  expect(mockHeaders).toHaveBeenCalledTimes(1);
  expect(mockDownload).toHaveBeenCalledTimes(1);
});

it('preserves the app session while retrying an optional protected-media download', async () => {
  const { File } = jest.requireMock('expo-file-system') as { File: new (uri: string) => { uri: string } };
  const destination = new File('file:///cache/photo.jpg');
  mockDownload
    .mockRejectedValueOnce(new Error('Unable to download file: server returned status code 401'))
    .mockImplementationOnce(async (_url, target) => {
      mockFiles.set(target.uri, 12);
      return target;
    });

  await expect(downloadAuthenticatedFile(
    'https://hub.test/api/v1/photo',
    destination as never,
    { preserveSessionOnAuthFailure: true } as never,
  )).resolves.toBe(destination);

  expect(mockHeaders).toHaveBeenNthCalledWith(1, {
    forceRefresh: false,
    preserveSessionOnRefreshFailure: true,
  });
  expect(mockHeaders).toHaveBeenNthCalledWith(2, {
    forceRefresh: true,
    preserveSessionOnRefreshFailure: true,
  });
});

it('does not replace a complete cached file when a new download fails', async () => {
  const { File } = jest.requireMock('expo-file-system') as { File: new (uri: string) => { uri: string; size: number } };
  const destination = new File('file:///cache/report.pdf');
  mockFiles.set(destination.uri, 64);
  mockDownload.mockRejectedValueOnce(new Error('connection lost'));

  await expect(downloadAuthenticatedFile('https://hub.test/api/v1/file', destination as never))
    .rejects.toThrow('connection lost');

  expect(destination.size).toBe(64);
  expect(mockFiles.has(`${destination.uri}.part`)).toBe(false);
});
