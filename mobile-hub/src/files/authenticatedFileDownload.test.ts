const mockDownload = jest.fn();
const mockHeaders = jest.fn();

jest.mock('expo-file-system', () => ({
  File: {
    downloadFileAsync: (...args: unknown[]) => mockDownload(...args),
  },
}));

jest.mock('./authenticatedRequestHeaders', () => ({
  getAuthenticatedRequestHeaders: (...args: unknown[]) => mockHeaders(...args),
}));

import { downloadAuthenticatedFile } from './authenticatedFileDownload';

beforeEach(() => {
  jest.clearAllMocks();
  mockHeaders
    .mockResolvedValueOnce({ Authorization: 'Bearer expired' })
    .mockResolvedValueOnce({ Authorization: 'Bearer refreshed' });
});

it('refreshes credentials and retries once after an authenticated download returns 401', async () => {
  const destination = { exists: false, delete: jest.fn() };
  const downloaded = { exists: true, size: 12, uri: 'file:///cache/report.pdf' };
  mockDownload
    .mockRejectedValueOnce(new Error('Unable to download file: server returned status code 401'))
    .mockResolvedValueOnce(downloaded);

  await expect(downloadAuthenticatedFile(
    'https://hub.test/api/v1/file',
    destination as never,
    { idempotent: true },
  )).resolves.toBe(downloaded);

  expect(mockHeaders).toHaveBeenNthCalledWith(1, { forceRefresh: false });
  expect(mockHeaders).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  expect(mockDownload).toHaveBeenCalledTimes(2);
  expect(mockDownload.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
    headers: { Authorization: 'Bearer refreshed' },
  }));
});

it('does not refresh or retry non-authenticated download failures', async () => {
  const destination = { exists: false, delete: jest.fn() };
  mockDownload.mockRejectedValueOnce(new Error('No space left on device'));

  await expect(downloadAuthenticatedFile(
    'https://hub.test/api/v1/file',
    destination as never,
  )).rejects.toThrow('No space left on device');

  expect(mockHeaders).toHaveBeenCalledTimes(1);
  expect(mockDownload).toHaveBeenCalledTimes(1);
});

it('preserves the app session while retrying an optional protected-media download', async () => {
  const destination = { exists: false, delete: jest.fn() };
  const downloaded = { exists: true, size: 12, uri: 'file:///cache/photo.jpg' };
  mockDownload
    .mockRejectedValueOnce(new Error('Unable to download file: server returned status code 401'))
    .mockResolvedValueOnce(downloaded);

  await expect(downloadAuthenticatedFile(
    'https://hub.test/api/v1/photo',
    destination as never,
    { preserveSessionOnAuthFailure: true } as never,
  )).resolves.toBe(downloaded);

  expect(mockHeaders).toHaveBeenNthCalledWith(1, {
    forceRefresh: false,
    preserveSessionOnRefreshFailure: true,
  });
  expect(mockHeaders).toHaveBeenNthCalledWith(2, {
    forceRefresh: true,
    preserveSessionOnRefreshFailure: true,
  });
});
