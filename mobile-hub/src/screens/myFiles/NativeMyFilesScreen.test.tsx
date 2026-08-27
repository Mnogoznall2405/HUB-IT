import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as myFilesApi from '../../api/myFilesApi';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import * as transfers from '../../myFiles/nativeMyFilesTransfers';
import { shareNativeText } from '../../share/nativeOutgoingShare';
import { NativeMyFilesScreen } from './NativeMyFilesScreen';

let mockPermissions = ['my_files.read', 'my_files.write', 'my_files.share'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { theme_mode: 'system' } }) }));
jest.mock('../../share/nativeOutgoingShare', () => ({ shareNativeText: jest.fn() }));
jest.mock('../../files/nativeAttachmentDownloads', () => ({ openNativeFile: jest.fn(), shareNativeFile: jest.fn() }));
jest.mock('../../myFiles/nativeMyFilesTransfers', () => ({
  downloadNativeMyFile: jest.fn(),
  downloadNativeMyFilePreview: jest.fn(),
  pickNativeMyFiles: jest.fn(),
  pickNativeMyFilesFolder: jest.fn(),
  readNativeMyFileTextPreview: jest.fn(),
  uploadNativeMyFile: jest.fn(),
}));
jest.mock('../../api/myFilesApi', () => ({
  listMyFiles: jest.fn(),
  getMyFilesQuota: jest.fn(),
  createMyFileShare: jest.fn(),
  getMyFilePreview: jest.fn(),
  revokeMyFileShare: jest.fn(),
  deleteMyFile: jest.fn(),
}));

const readyFile = {
  id: 'f-1', original_file_name: 'report.pdf', download_file_name: 'report.pdf',
  mime_type: 'application/pdf', download_mime_type: 'application/pdf', original_size_bytes: 1024,
  stored_size_bytes: 900, saved_size_bytes: 124, retention_days: 7, status: 'ready', storage_mode: 'stored',
  error_text: '', security_scan_status: 'clean', preview_kind: 'pdf', preview_available: true,
  preview_status: 'ready', preview_max_bytes: 0, is_shared: false, share_expires_at: null,
  created_at: null, updated_at: null, expires_at: '2026-09-01T10:00:00Z',
};

async function pressAndFlush(target: Parameters<typeof fireEvent.press>[0]): Promise<void> {
  await act(async () => {
    fireEvent.press(target);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['my_files.read', 'my_files.write', 'my_files.share'];
  mockOfflineMode = false;
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([readyFile]);
  (myFilesApi.getMyFilesQuota as jest.Mock).mockResolvedValue({ used_bytes: 1024, limit_bytes: 5 * 1024 ** 3, remaining_bytes: 5 * 1024 ** 3 - 1024 });
  (myFilesApi.createMyFileShare as jest.Mock).mockResolvedValue({ token: 'public-token', expires_at: readyFile.expires_at });
  (myFilesApi.getMyFilePreview as jest.Mock).mockResolvedValue({ preview_kind: 'pdf', source_filename: 'report.pdf', pdf_filename: 'report.pdf' });
  (transfers.downloadNativeMyFile as jest.Mock).mockResolvedValue({ uri: 'file://report.pdf' });
  (transfers.downloadNativeMyFilePreview as jest.Mock).mockResolvedValue({ file: { uri: 'file://preview.pdf' }, mimeType: 'application/pdf' });
  (transfers.readNativeMyFileTextPreview as jest.Mock).mockResolvedValue('plain text');
  (transfers.pickNativeMyFiles as jest.Mock).mockResolvedValue([]);
  (transfers.pickNativeMyFilesFolder as jest.Mock).mockResolvedValue(null);
});

it('loads quota and opens a ready file through the native viewer', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
  expect(view.getByText(/из 5\.0 ГБ/)).toBeTruthy();
  await pressAndFlush(view.getByTestId('native-my-file-open-f-1'));
  await waitFor(() => expect(openNativeFile).toHaveBeenCalled());
  expect(transfers.downloadNativeMyFile).toHaveBeenCalledWith(readyFile);
});

it('creates a public link only with share permission and opens Android share', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-share-link-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-share-link-f-1'));
  await waitFor(() => expect(shareNativeText).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/shared-files/public-token') })));
  expect(myFilesApi.createMyFileShare).toHaveBeenCalledWith('f-1', false);
});

it('uses the authenticated server preview for PDF without putting credentials in a URL', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-preview-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-preview-f-1'));
  await waitFor(() => expect(myFilesApi.getMyFilePreview).toHaveBeenCalledWith('f-1'));
  expect(transfers.downloadNativeMyFilePreview).toHaveBeenCalledWith(
    readyFile,
    expect.objectContaining({ preview_kind: 'pdf' }),
  );
  expect(openNativeFile).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file://preview.pdf' }), 'application/pdf');
});

it('shows a downloaded raster preview in an accessible native modal', async () => {
  const imageFile = {
    ...readyFile,
    original_file_name: 'photo.png',
    download_file_name: 'photo.png',
    mime_type: 'image/png',
    download_mime_type: 'image/png',
    preview_kind: 'image',
  };
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([imageFile]);
  (myFilesApi.getMyFilePreview as jest.Mock).mockResolvedValue({ preview_kind: 'image', source_filename: 'photo.png' });
  (transfers.downloadNativeMyFilePreview as jest.Mock).mockResolvedValue({ file: { uri: 'file://preview.png' }, mimeType: 'image/png' });
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-preview-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-preview-f-1'));
  await waitFor(() => expect(view.getByTestId('native-my-file-preview-image')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-my-file-preview-close'));
  await waitFor(() => expect(view.queryByTestId('native-my-file-preview-image')).toBeNull());
});

it('renders small clean text as inert native text instead of HTML or JavaScript', async () => {
  const textFile = {
    ...readyFile,
    original_file_name: 'notes.html',
    download_file_name: 'notes.html',
    mime_type: 'text/html',
    download_mime_type: 'text/html',
    original_size_bytes: 64,
    preview_kind: 'unsupported',
    preview_available: false,
    preview_status: 'unsupported',
  };
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([textFile]);
  (transfers.downloadNativeMyFile as jest.Mock).mockResolvedValue({ uri: 'file://notes.html' });
  (transfers.readNativeMyFileTextPreview as jest.Mock).mockResolvedValue('<script>bad()</script>');
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-preview-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-preview-f-1'));
  await waitFor(() => expect(view.getByTestId('native-my-file-preview-text')).toBeTruthy());
  expect(view.getByText('<script>bad()</script>')).toBeTruthy();
  expect(myFilesApi.getMyFilePreview).not.toHaveBeenCalled();
});

it('offers public-link rotation only after confirmation and reports its expiry', async () => {
  jest.spyOn(Alert, 'alert');
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([{ ...readyFile, is_shared: true, share_expires_at: readyFile.expires_at }]);
  (myFilesApi.createMyFileShare as jest.Mock).mockResolvedValue({ token: 'rotated-token', expires_at: readyFile.expires_at });
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-rotate-link-f-1')).toBeTruthy());
  expect(view.getByText(/Публичная ссылка действует до/)).toBeTruthy();
  fireEvent.press(view.getByTestId('native-my-file-rotate-link-f-1'));
  expect(Alert.alert).toHaveBeenCalledWith(
    'Создать новую ссылку?',
    expect.stringContaining('Предыдущая публичная ссылка сразу перестанет работать'),
    expect.arrayContaining([expect.objectContaining({ text: 'Создать новую', onPress: expect.any(Function) })]),
  );
  expect(myFilesApi.createMyFileShare).not.toHaveBeenCalled();
});

it('streams picked files with the selected retention and refreshes the list', async () => {
  (transfers.pickNativeMyFiles as jest.Mock).mockResolvedValue([{ uri: 'file://a.txt', name: 'a.txt', mimeType: 'text/plain', size: 10 }]);
  (transfers.uploadNativeMyFile as jest.Mock).mockResolvedValue({ ...readyFile, id: 'f-2', status: 'queued' });
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-files-upload')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-files-upload'));
  await waitFor(() => expect(transfers.uploadNativeMyFile).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'a.txt' }),
    1,
    expect.objectContaining({ signal: expect.anything(), onProgress: expect.any(Function) }),
  ));
  await waitFor(() => expect(view.getByText(/Файлов добавлено в очередь: 1/)).toBeTruthy());
});

it('packs a selected Android folder as ZIP and uploads the resulting archive', async () => {
  (transfers.pickNativeMyFilesFolder as jest.Mock).mockResolvedValue({
    uri: 'file://folder.zip', name: 'Проект.zip', mimeType: 'application/zip', size: 120,
  });
  (transfers.uploadNativeMyFile as jest.Mock).mockResolvedValue({ ...readyFile, id: 'f-folder', status: 'queued' });
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-files-upload-folder')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-files-upload-folder'));
  await waitFor(() => expect(transfers.uploadNativeMyFile).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Проект.zip', mimeType: 'application/zip' }),
    1,
    expect.objectContaining({ signal: expect.anything(), onProgress: expect.any(Function) }),
  ));
});

it('does not load data without read permission or expose a web fallback', async () => {
  mockPermissions = [];
  const denied = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(denied.getByText('Нет доступа')).toBeTruthy());
  expect(myFilesApi.listMyFiles).not.toHaveBeenCalled();
  denied.unmount();

  mockPermissions = ['my_files.read'];
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-files-list')).toBeTruthy());
  expect(view.queryByTestId('native-my-files-open-web')).toBeNull();
});
