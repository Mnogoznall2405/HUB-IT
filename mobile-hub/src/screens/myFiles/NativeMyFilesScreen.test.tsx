import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import * as myFilesApi from '../../api/myFilesApi';
import * as snapshotCache from '../../cache/nativeSnapshotCache';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import * as transfers from '../../myFiles/nativeMyFilesTransfers';
import * as offlineStore from '../../myFiles/nativeMyFilesOfflineStore';
import { shareNativeText } from '../../share/nativeOutgoingShare';
import { NativeMyFilesScreen } from './NativeMyFilesScreen';

let mockPermissions = ['my_files.read', 'my_files.write', 'my_files.share'];
let mockOfflineMode = false;
let mockUserId = 17;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    user: { id: mockUserId },
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
jest.mock('../../myFiles/nativeMyFilesOfflineStore', () => ({
  getNativeMyFilesOfflineFile: jest.fn(),
  getNativeMyFilesOfflineIds: jest.fn(),
  pinNativeMyFileOffline: jest.fn(),
  removeNativeMyFileOffline: jest.fn(async () => undefined),
}));
jest.mock('../../api/myFilesApi', () => ({
  listMyFiles: jest.fn(),
  getMyFilesQuota: jest.fn(),
  createMyFileShare: jest.fn(),
  getMyFilePreview: jest.fn(),
  revokeMyFileShare: jest.fn(),
  deleteMyFile: jest.fn(),
}));
jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(),
  writeNativeSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(),
  writeNativeEntitySnapshot: jest.fn(async () => true),
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
  mockUserId = 17;
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue(null);
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([readyFile]);
  (myFilesApi.getMyFilesQuota as jest.Mock).mockResolvedValue({ used_bytes: 1024, limit_bytes: 5 * 1024 ** 3, remaining_bytes: 5 * 1024 ** 3 - 1024 });
  (myFilesApi.createMyFileShare as jest.Mock).mockResolvedValue({ token: 'public-token', expires_at: readyFile.expires_at });
  (myFilesApi.getMyFilePreview as jest.Mock).mockResolvedValue({ preview_kind: 'pdf', source_filename: 'report.pdf', pdf_filename: 'report.pdf' });
  (transfers.downloadNativeMyFile as jest.Mock).mockResolvedValue({ uri: 'file://report.pdf' });
  (transfers.downloadNativeMyFilePreview as jest.Mock).mockResolvedValue({ file: { uri: 'file://preview.pdf' }, mimeType: 'application/pdf' });
  (transfers.readNativeMyFileTextPreview as jest.Mock).mockResolvedValue('plain text');
  (transfers.pickNativeMyFiles as jest.Mock).mockResolvedValue([]);
  (transfers.pickNativeMyFilesFolder as jest.Mock).mockResolvedValue(null);
  (offlineStore.getNativeMyFilesOfflineFile as jest.Mock).mockResolvedValue(null);
  (offlineStore.getNativeMyFilesOfflineIds as jest.Mock).mockResolvedValue(new Set());
  (offlineStore.pinNativeMyFileOffline as jest.Mock).mockResolvedValue({ uri: 'file://offline/report.pdf' });
});

it('loads quota and opens a ready file through the native viewer', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
  expect(view.getByText(/из 5\.0 ГБ/)).toBeTruthy();
  await pressAndFlush(view.getByTestId('native-my-file-open-f-1'));
  await waitFor(() => expect(openNativeFile).toHaveBeenCalled());
  expect(transfers.downloadNativeMyFile).toHaveBeenCalledWith(readyFile, { userId: 17 });
});

it('stores file metadata and quota after an online load', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());

  expect(snapshotCache.writeNativeSnapshot).toHaveBeenCalledWith('my-files-inbox', 17, {
    items: [readyFile],
    quota: expect.objectContaining({ used_bytes: 1024 }),
  });
});

it('searches file names without another API call and restores the list on clear', async () => {
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([readyFile, { ...readyFile, id: 'f-2', original_file_name: 'Отчёт.xlsx', download_file_name: 'report-export.xlsx' }]);
  const view = await render(<NativeMyFilesScreen />);
  await view.findByText('report-export.xlsx');
  const calls = (myFilesApi.listMyFiles as jest.Mock).mock.calls.length;
  await fireEvent.changeText(view.getByLabelText('Поиск файлов по названию'), 'ОТЧЁТ');
  expect(view.getByText('report-export.xlsx')).toBeTruthy();
  expect(view.queryByText('report.pdf')).toBeNull();
  expect(view.getByText('Найдено: 1 из 2')).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText('Поиск файлов по названию'), 'несуществующий');
  expect(view.getByText('Файлы не найдены')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Очистить поиск файлов'));
  expect(view.getByText('report.pdf')).toBeTruthy();
  expect(view.getByText('report-export.xlsx')).toBeTruthy();
  expect(myFilesApi.listMyFiles).toHaveBeenCalledTimes(calls);
});

it('opens the cached file list offline without calling the API', async () => {
  mockOfflineMode = true;
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      items: [readyFile],
      quota: { used_bytes: 1024, limit_bytes: 5 * 1024 ** 3, remaining_bytes: 5 * 1024 ** 3 - 1024 },
    },
  });

  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
  expect(myFilesApi.listMyFiles).not.toHaveBeenCalled();
  expect(myFilesApi.getMyFilesQuota).not.toHaveBeenCalled();
});

it('opens an already downloaded file offline instead of disabling the local action', async () => {
  mockOfflineMode = true;
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: { items: [readyFile], quota: null },
  });

  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-open-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-open-f-1'));

  expect(transfers.downloadNativeMyFile).toHaveBeenCalledWith(readyFile, { userId: 17 });
  expect(openNativeFile).toHaveBeenCalled();
});

it('saves a file persistently for offline use and can remove only the local copy', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-save-offline-f-1')).toBeTruthy());

  await pressAndFlush(view.getByTestId('native-my-file-save-offline-f-1'));

  await waitFor(() => expect(offlineStore.pinNativeMyFileOffline).toHaveBeenCalledWith(
    17,
    readyFile,
    expect.objectContaining({ uri: 'file://report.pdf' }),
  ));
  await waitFor(() => expect(view.getByText('Офлайн')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-remove-offline-f-1'));
  await waitFor(() => expect(offlineStore.removeNativeMyFileOffline).toHaveBeenCalledWith(17, 'f-1'));
  await waitFor(() => expect(view.queryByText('Офлайн')).toBeNull());
});

it('uses cached preview metadata offline without requesting a new preview grant', async () => {
  mockOfflineMode = true;
  const previewMetadata = { preview_kind: 'pdf', source_filename: 'report.pdf', pdf_filename: 'report.pdf' };
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: { items: [readyFile], quota: null },
  });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: { preview: previewMetadata },
  });

  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-preview-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-preview-f-1'));

  expect(myFilesApi.getMyFilePreview).not.toHaveBeenCalled();
  expect(transfers.downloadNativeMyFilePreview).toHaveBeenCalledWith(readyFile, previewMetadata);
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
  expect(view.queryByTestId('native-my-files-upload')).toBeNull();
  await pressAndFlush(view.getByTestId('native-my-files-open-upload'));
  await pressAndFlush(view.getByText('7 дней'));
  await waitFor(() => expect(view.getByTestId('native-my-files-upload')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-files-upload'));
  await waitFor(() => expect(transfers.uploadNativeMyFile).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'a.txt' }),
    7,
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
  await pressAndFlush(view.getByTestId('native-my-files-open-upload'));
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
  await denied.unmount();

  mockPermissions = ['my_files.read'];
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-files-list')).toBeTruthy());
  expect(view.queryByTestId('native-my-files-open-web')).toBeNull();
});

it('polls without rereading the cache, skips overlapping polls and stops on blur', async () => {
  jest.useFakeTimers();
  const initialState = AppState.currentState;
  AppState.currentState = 'active';
  let focused = true;
  const focus = jest.spyOn(require('expo-router') as typeof import('expo-router'), 'useFocusEffect').mockImplementation((callback) => {
    useEffect(() => focused ? callback() : undefined, [callback, focused]);
  });
  try {
    (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([{ ...readyFile, status: 'processing' }]);
    const view = await render(<NativeMyFilesScreen />);
    await waitFor(() => expect(myFilesApi.listMyFiles).toHaveBeenCalledTimes(1));
    await act(async () => { jest.advanceTimersByTime(4_000); });
    expect(myFilesApi.listMyFiles).toHaveBeenCalledTimes(2);
    expect(snapshotCache.readNativeSnapshot).toHaveBeenCalledTimes(1);
    let finish: (value: unknown) => void = () => {};
    (myFilesApi.listMyFiles as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { jest.advanceTimersByTime(4_000); });
    await act(async () => { jest.advanceTimersByTime(12_000); });
    expect(myFilesApi.listMyFiles).toHaveBeenCalledTimes(3);
    focused = false;
    await view.rerender(<NativeMyFilesScreen />);
    await act(async () => { finish([{ ...readyFile, original_file_name: 'obsolete.pdf', download_file_name: 'obsolete.pdf' }]); jest.advanceTimersByTime(12_000); });
    expect(myFilesApi.listMyFiles).toHaveBeenCalledTimes(3);
    expect(view.queryByText('obsolete.pdf')).toBeNull();
    await view.unmount();
  } finally { focus.mockRestore(); AppState.currentState = initialState; jest.useRealTimers(); }
});

it('does not let an older response overwrite an explicit refresh', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
  let finish: (value: unknown) => void = () => {};
  (myFilesApi.listMyFiles as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce([{ ...readyFile, original_file_name: 'new.pdf', download_file_name: 'new.pdf' }]);
  await act(async () => { fireEvent(view.getByTestId('native-my-files-list'), 'refresh'); });
  await act(async () => { fireEvent(view.getByTestId('native-my-files-list'), 'refresh'); });
  await waitFor(() => expect(view.getByText('new.pdf')).toBeTruthy());
  await act(async () => { finish([{ ...readyFile, original_file_name: 'obsolete.pdf', download_file_name: 'obsolete.pdf' }]); });
  expect(view.getByText('new.pdf')).toBeTruthy();
  expect(view.queryByText('obsolete.pdf')).toBeNull();
});

it('expands and collapses the full filename without loading data again', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
  const calls = (myFilesApi.listMyFiles as jest.Mock).mock.calls.length;
  await fireEvent.press(view.getByLabelText('Показать полное название файла: report.pdf'));
  expect(view.getByLabelText('Свернуть название файла: report.pdf').props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(view.getByLabelText('Свернуть название файла: report.pdf'));
  expect(view.getByLabelText('Показать полное название файла: report.pdf').props.accessibilityState.expanded).toBe(false);
  expect(myFilesApi.listMyFiles).toHaveBeenCalledTimes(calls);
  await view.unmount();
});

it('does not offer download or sharing for a blocked file reported as ready', async () => {
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([{ ...readyFile, security_scan_status: 'blocked' }]);
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('Заблокирован проверкой безопасности')).toBeTruthy());
  expect(view.queryByTestId('native-my-file-open-f-1')).toBeNull();
  expect(view.queryByTestId('native-my-file-save-offline-f-1')).toBeNull();
  expect(view.queryByTestId('native-my-file-share-link-f-1')).toBeNull();
  expect(view.getByTestId('native-my-file-delete-f-1')).toBeTruthy();
  await view.unmount();
});

it.each(['failed', 'blocked'])('allows removing an existing local copy of a %s file', async (state) => {
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([{ ...readyFile, status: state === 'failed' ? 'failed' : 'ready', security_scan_status: state === 'blocked' ? 'blocked' : 'clean' }]);
  (offlineStore.getNativeMyFilesOfflineIds as jest.Mock).mockResolvedValue(new Set(['f-1']));
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByTestId('native-my-file-remove-offline-f-1')).toBeTruthy());
  await pressAndFlush(view.getByTestId('native-my-file-remove-offline-f-1'));
  expect(offlineStore.removeNativeMyFileOffline).toHaveBeenCalledWith(17, 'f-1');
  expect(myFilesApi.deleteMyFile).not.toHaveBeenCalled();
  await view.unmount();
});

it('does not report a list failure when only quota loading failed', async () => {
  (myFilesApi.listMyFiles as jest.Mock).mockResolvedValue([]);
  (myFilesApi.getMyFilesQuota as jest.Mock).mockRejectedValue(new Error('Synthetic quota failure'));
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('Файлов пока нет')).toBeTruthy());
  expect(view.queryByText('Список не загрузился')).toBeNull();
  await view.unmount();
});

it('shows an actual list failure and clears it after retry succeeds', async () => {
  (myFilesApi.listMyFiles as jest.Mock).mockRejectedValueOnce(new Error('Synthetic list failure')).mockResolvedValue([]);
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('Список не загрузился')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Обновить список файлов'));
  await waitFor(() => expect(view.getByText('Файлов пока нет')).toBeTruthy());
  expect(view.queryByText('Список не загрузился')).toBeNull();
  await view.unmount();
});

it.each(['unmount', 'offline'])('does not upload a late picker result after %s', async (change) => {
  let finish!: (value: unknown) => void;
  (transfers.pickNativeMyFiles as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = await render(<NativeMyFilesScreen />);
  await fireEvent.press(view.getByTestId('native-my-files-open-upload'));
  await fireEvent.press(view.getByLabelText('Выбрать и загрузить файлы'));
  if (change === 'unmount') await view.unmount();
  else { mockOfflineMode = true; await view.rerender(<NativeMyFilesScreen />); }
  await act(async () => { finish([{ uri: 'file://synthetic.txt', name: 'synthetic.txt', size: 10, mimeType: 'text/plain' }]); });
  expect(transfers.uploadNativeMyFile).not.toHaveBeenCalled();
  if (change !== 'unmount') await view.unmount();
});

it.each(['unmount', 'account'])('does not open a delayed file after %s', async (change) => {
  let finish!: (value: unknown) => void;
  (transfers.downloadNativeMyFile as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = await render(<NativeMyFilesScreen />);
  await fireEvent.press(view.getByTestId('native-my-file-open-f-1'));
  if (change === 'unmount') await view.unmount();
  else { mockUserId = 18; await view.rerender(<NativeMyFilesScreen />); }
  await act(async () => { finish({ uri: 'file://synthetic.pdf' }); });
  expect(openNativeFile).not.toHaveBeenCalled();
  if (change !== 'unmount') await view.unmount();
});

it('does not present a delayed share link after leaving the screen', async () => {
  let finish!: (value: unknown) => void;
  (myFilesApi.createMyFileShare as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = await render(<NativeMyFilesScreen />);
  await fireEvent.press(view.getByTestId('native-my-file-share-link-f-1'));
  await view.unmount();
  await act(async () => { finish({ token: 'synthetic-public-token', expires_at: readyFile.expires_at }); });
  expect(shareNativeText).not.toHaveBeenCalled();
});
