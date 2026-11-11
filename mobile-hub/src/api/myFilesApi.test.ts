import apiClient from './client';
import {
  createMyFileDownloadGrant,
  createMyFileFolder,
  createMyFileFolderArchiveGrant,
  createMyFileFolderShare,
  createMyFileShare,
  createMyFileUploadSession,
  deleteMyFile,
  deleteMyFileFolder,
  emptyMyFilesTrash,
  getMyFilePreview,
  getMyFilesQuota,
  listMyFiles,
  purgeMyFile,
  purgeMyFileFolder,
  restoreMyFile,
  restoreMyFileFolder,
  revokeMyFileFolderShare,
  revokeMyFileShare,
  updateMyFile,
  updateMyFileFolder,
} from './myFilesApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), patch: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock; delete: jest.Mock; patch: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes the owner file list and quota', async () => {
  client.get
    .mockResolvedValueOnce({ data: { items: [{ id: 'f-1', original_file_name: 'report.pdf', status: 'READY', original_size_bytes: '1200', is_shared: 1 }] } })
    .mockResolvedValueOnce({ data: { used_bytes: '1200', limit_bytes: 5000, remaining_bytes: 3800 } });
  const files = await listMyFiles();
  const quota = await getMyFilesQuota();
  expect(files.items[0]).toMatchObject({ id: 'f-1', original_file_name: 'report.pdf', status: 'ready', original_size_bytes: 1200, is_shared: true });
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

it('passes folder and view filters to the owner file list', async () => {
  client.get.mockResolvedValue({ data: { items: [], folders: [{ id: 'd-1', name: 'Docs', file_count: '3', is_favorite: 1 }], breadcrumbs: [{ id: 'd-0', name: 'Root' }], folder: { id: 'd-1', name: 'Docs' } } });
  const payload = await listMyFiles({ folderId: 'd-1', view: 'favorites' });
  expect(client.get).toHaveBeenCalledWith('/my-files', { params: { folder_id: 'd-1', view: 'favorites' }, signal: undefined });
  expect(payload.folders[0]).toMatchObject({ id: 'd-1', name: 'Docs', file_count: 3, is_favorite: true });
  expect(payload.breadcrumbs[0].id).toBe('d-0');
  expect(payload.folder).toMatchObject({ id: 'd-1', name: 'Docs' });
});

it('creates and patches folders with the server field names', async () => {
  client.post.mockResolvedValue({ data: { id: 'd-2', name: 'Договоры', parent_id: 'd-1' } });
  client.patch.mockResolvedValue({ data: { id: 'd-2', name: 'Архив', is_favorite: true } });
  await expect(createMyFileFolder({ name: '  Договоры ', parentId: 'd-1' })).resolves.toMatchObject({ id: 'd-2', parent_id: 'd-1' });
  expect(client.post).toHaveBeenCalledWith('/my-files/folders', { name: 'Договоры', parent_id: 'd-1' });
  await expect(updateMyFileFolder('d-2', { name: 'Архив', isFavorite: true })).resolves.toMatchObject({ is_favorite: true });
  expect(client.patch).toHaveBeenCalledWith('/my-files/folders/d-2', { name: 'Архив', is_favorite: true });
});

it('rejects an empty folder name without a request', async () => {
  await expect(createMyFileFolder({ name: '   ' })).rejects.toThrow('Введите название папки');
  expect(client.post).not.toHaveBeenCalled();
});

it('patches files for rename, move and favorite', async () => {
  client.patch.mockResolvedValue({ data: { id: 'f-9', original_file_name: 'new.pdf', folder_id: 'd-1', is_favorite: true } });
  await updateMyFile('f-9', { name: 'new.pdf', folderId: 'd-1', isFavorite: true });
  expect(client.patch).toHaveBeenCalledWith('/my-files/f-9', { name: 'new.pdf', folder_id: 'd-1', is_favorite: true });
  client.patch.mockClear();
  client.patch.mockResolvedValue({ data: { id: 'f-9', original_file_name: 'new.pdf', folder_id: null } });
  await updateMyFile('f-9', { folderId: null });
  expect(client.patch).toHaveBeenCalledWith('/my-files/f-9', { folder_id: null });
});

it('drives trash restore, purge and empty operations', async () => {
  client.post.mockResolvedValue({ data: null });
  client.delete.mockResolvedValue({ data: null });
  await restoreMyFile('f-1');
  await restoreMyFileFolder('d-1');
  await purgeMyFile('f-2');
  await purgeMyFileFolder('d-2');
  await emptyMyFilesTrash();
  expect(client.post).toHaveBeenNthCalledWith(1, '/my-files/trash/files/f-1/restore');
  expect(client.post).toHaveBeenNthCalledWith(2, '/my-files/trash/folders/d-1/restore');
  expect(client.delete).toHaveBeenNthCalledWith(1, '/my-files/trash/files/f-2');
  expect(client.delete).toHaveBeenNthCalledWith(2, '/my-files/trash/folders/d-2');
  expect(client.post).toHaveBeenNthCalledWith(3, '/my-files/trash/empty');
});

it('shares, rotates, revokes and archives folders', async () => {
  client.post
    .mockResolvedValueOnce({ data: { token: 'folder-token', public_path: '/shared-folders/folder-token', expires_at: null } })
    .mockResolvedValueOnce({ data: { download_path: '/my-files/download-grant/zip-token', expires_in_seconds: 120 } });
  client.delete.mockResolvedValue({ data: null });
  await expect(createMyFileFolderShare('d/1', true)).resolves.toMatchObject({ token: 'folder-token' });
  expect(client.post).toHaveBeenNthCalledWith(1, '/my-files/folders/d%2F1/share', undefined, { params: { rotate: true } });
  await expect(createMyFileFolderArchiveGrant('d-1')).resolves.toMatchObject({ expires_in_seconds: 120 });
  expect(client.post).toHaveBeenNthCalledWith(2, '/my-files/folders/d-1/archive-grant');
  await revokeMyFileFolderShare('d-1');
  await deleteMyFileFolder('d-1');
  expect(client.delete).toHaveBeenNthCalledWith(1, '/my-files/folders/d-1/share');
  expect(client.delete).toHaveBeenNthCalledWith(2, '/my-files/folders/d-1');
});

it('sends the folder id when reserving an upload session', async () => {
  client.post.mockResolvedValue({ data: { file_id: 'sess-9', chunk_size_bytes: 1024, uploaded_bytes: 0, file_size_bytes: 2048 } });
  await createMyFileUploadSession({ fileName: 'a.pdf', fileSize: 2048, retentionDays: 7, mimeType: 'application/pdf', folderId: 'd-7' });
  expect(client.post).toHaveBeenCalledWith('/my-files/upload-sessions', {
    file_name: 'a.pdf', file_size: 2048, retention_days: 7, mime_type: 'application/pdf', folder_id: 'd-7',
  }, { signal: undefined });
  await createMyFileUploadSession({ fileName: 'b.pdf', fileSize: 1, retentionDays: 1, mimeType: 'application/pdf' });
  expect(client.post).toHaveBeenLastCalledWith('/my-files/upload-sessions', {
    file_name: 'b.pdf', file_size: 1, retention_days: 1, mime_type: 'application/pdf', folder_id: null,
  }, { signal: undefined });
});
