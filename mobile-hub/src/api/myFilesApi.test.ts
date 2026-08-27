import apiClient from './client';
import {
  createMyFileDownloadGrant,
  createMyFileShare,
  deleteMyFile,
  getMyFilePreview,
  getMyFilesQuota,
  listMyFiles,
  revokeMyFileShare,
} from './myFilesApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock; delete: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes the owner file list and quota', async () => {
  client.get
    .mockResolvedValueOnce({ data: { items: [{ id: 'f-1', original_file_name: 'report.pdf', status: 'READY', original_size_bytes: '1200', is_shared: 1 }] } })
    .mockResolvedValueOnce({ data: { used_bytes: '1200', limit_bytes: 5000, remaining_bytes: 3800 } });
  const files = await listMyFiles();
  const quota = await getMyFilesQuota();
  expect(files[0]).toMatchObject({ id: 'f-1', original_file_name: 'report.pdf', status: 'ready', original_size_bytes: 1200, is_shared: true });
  expect(quota).toEqual({ used_bytes: 1200, limit_bytes: 5000, remaining_bytes: 3800 });
});

it('encodes file identifiers for grant, share, revoke and delete', async () => {
  client.post
    .mockResolvedValueOnce({ data: { download_path: '/my-files/download-grant/token_1234567890123456', expires_in_seconds: 120 } })
    .mockResolvedValueOnce({ data: { token: 'public-token', public_path: '/shared-files/public-token' } });
  client.delete.mockResolvedValue({ data: null });
  await expect(createMyFileDownloadGrant('file/1')).resolves.toMatchObject({ expires_in_seconds: 120 });
  await expect(createMyFileShare('file/1')).resolves.toMatchObject({ token: 'public-token' });
  await revokeMyFileShare('file/1');
  await deleteMyFile('file/1');
  expect(client.post).toHaveBeenNthCalledWith(1, '/my-files/file%2F1/download-grant');
  expect(client.post).toHaveBeenNthCalledWith(2, '/my-files/file%2F1/share', undefined, { params: {} });
  expect(client.delete).toHaveBeenNthCalledWith(1, '/my-files/file%2F1/share');
  expect(client.delete).toHaveBeenNthCalledWith(2, '/my-files/file%2F1');
});

it('sends rotate only when a new public token is explicitly requested', async () => {
  client.post.mockResolvedValue({ data: { token: 'rotated-token' } });
  await createMyFileShare('f-2', true);
  expect(client.post).toHaveBeenCalledWith('/my-files/f-2/share', undefined, { params: { rotate: true } });
});

it('loads and normalizes owner preview metadata without trusting a server URL', async () => {
  client.get.mockResolvedValue({
    data: {
      preview_kind: 'OFFICE_PDF', source_kind: 'excel', source_filename: 'book.xlsx',
      pdf_filename: 'book.pdf', page_count: '3', sheets: [{ name: 'Sheet1' }],
      preview_url: 'https://evil.example/token',
    },
  });
  await expect(getMyFilePreview('file/1')).resolves.toEqual({
    preview_kind: 'office_pdf', source_kind: 'excel', source_filename: 'book.xlsx',
    pdf_filename: 'book.pdf', page_count: 3, sheets: [{ name: 'Sheet1' }],
  });
  expect(client.get).toHaveBeenCalledWith('/my-files/file%2F1/preview');
});
