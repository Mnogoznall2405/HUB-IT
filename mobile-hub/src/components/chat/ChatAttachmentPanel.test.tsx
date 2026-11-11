import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { ChatAttachmentPanel } from './ChatAttachmentPanel';

jest.mock('../../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

const getPermissionsAsync = jest.mocked(MediaLibrary.getPermissionsAsync);
const requestPermissionsAsync = jest.mocked(MediaLibrary.requestPermissionsAsync);
const appStateListeners = new Set<(state: AppStateStatus) => void>();
let exeForMetadata: jest.SpyInstance<Promise<MediaLibrary.AssetMetadata[]>, []>;

const permissionResponse = (
  overrides: Partial<MediaLibrary.PermissionResponse> = {},
): MediaLibrary.PermissionResponse => ({
  canAskAgain: true,
  expires: 'never',
  granted: false,
  status: 'undetermined' as MediaLibrary.PermissionStatus,
  accessPrivileges: 'none',
  ...overrides,
});

const grantedPermission = () => permissionResponse({
  granted: true,
  status: 'granted' as MediaLibrary.PermissionStatus,
  accessPrivileges: 'all',
});

const mediaRow = (id: string): MediaLibrary.AssetMetadata => ({
  id: `content://media/${id}`,
  filename: `${id}.jpg`,
  mediaType: MediaLibrary.MediaType.IMAGE,
  width: 400,
  height: 400,
  duration: 0,
  creationTime: 1,
  modificationTime: 1,
  isFavorite: false,
});

const panelElement = (visible: boolean) => (
  <ChatAttachmentPanel
    visible={visible}
    onClose={jest.fn()}
    onSendFiles={jest.fn()}
    onOpenCamera={jest.fn()}
    onOpenGallery={jest.fn()}
    onOpenDocument={jest.fn()}
    onOpenTask={jest.fn()}
    onSendLocation={jest.fn()}
    onSendContact={jest.fn()}
    onOpenPoll={jest.fn()}
  />
);

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  appStateListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListeners.add(listener);
    return { remove: () => { appStateListeners.delete(listener); } };
  });
  getPermissionsAsync.mockResolvedValue(grantedPermission());
  requestPermissionsAsync.mockResolvedValue(grantedPermission());
  exeForMetadata = jest.spyOn(MediaLibrary.Query.prototype, 'exeForMetadata').mockResolvedValue([]);
  jest.spyOn(MediaLibrary.Album, 'getAll').mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('BUG-GALLERY permission flow', () => {
  it('turns a hung permission check into a retryable error instead of an endless spinner', async () => {
    jest.useFakeTimers();
    getPermissionsAsync.mockImplementation(() => new Promise(() => {}));
    requestPermissionsAsync.mockImplementation(() => new Promise(() => {}));
    const view = await render(panelElement(true));

    expect(view.queryByLabelText('Загрузка медиа')).toBeTruthy();
    expect(view.queryByLabelText('Повторить')).toBeNull();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(9000);
    });

    expect(view.queryByLabelText('Повторить')).toBeTruthy();
    expect(view.queryByLabelText('Загрузка медиа')).toBeNull();

    getPermissionsAsync.mockResolvedValue(grantedPermission());
    exeForMetadata.mockResolvedValue([mediaRow('1')]);
    await act(async () => {
      fireEvent.press(view.getByLabelText('Повторить'));
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(view.getByLabelText('Фото 1.jpg')).toBeTruthy();
  });

  it('shows the error state instead of a spinner when the permission check rejects', async () => {
    getPermissionsAsync.mockRejectedValue(new Error('perm-crash'));
    requestPermissionsAsync.mockRejectedValue(new Error('perm-crash'));
    const view = await render(panelElement(true));
    await flush();
    await flush();

    expect(view.getByLabelText('Повторить')).toBeTruthy();
    expect(view.queryByLabelText('Загрузка медиа')).toBeNull();
    // The bottom action row stays available in every grid state.
    ['Галерея', 'Файл', 'Геопозиция', 'Контакт', 'Опрос', 'Задача'].forEach((label) => {
      expect(view.getByLabelText(label)).toBeTruthy();
    });
  });

  it('turns a hung first page load into the same retryable error', async () => {
    jest.useFakeTimers();
    exeForMetadata.mockImplementation(() => new Promise(() => {}));
    const view = await render(panelElement(true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(9000);
    });

    expect(view.getByLabelText('Повторить')).toBeTruthy();
    expect(view.queryByLabelText('Загрузка медиа')).toBeNull();
  });

  it('offers «Открыть настройки» when access is denied and cannot be asked again', async () => {
    const denied = permissionResponse({ granted: false, canAskAgain: false, status: 'denied' as MediaLibrary.PermissionStatus });
    getPermissionsAsync.mockResolvedValue(denied);
    requestPermissionsAsync.mockResolvedValue(denied);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockImplementation(() => Promise.resolve());
    const view = await render(panelElement(true));
    await flush();
    await flush();

    expect(view.queryByLabelText('Разрешить доступ к фото')).toBeNull();
    await fireEvent.press(view.getByLabelText('Открыть настройки'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('requests access only after pressing the banner button', async () => {
    const denied = permissionResponse({ granted: false, canAskAgain: true });
    getPermissionsAsync.mockResolvedValue(denied);
    requestPermissionsAsync.mockResolvedValue(grantedPermission());
    exeForMetadata.mockResolvedValue([mediaRow('7')]);
    const view = await render(panelElement(true));
    await flush();
    await flush();

    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('Разрешить доступ к фото'));
    await flush();
    await flush();

    expect(requestPermissionsAsync).toHaveBeenCalledWith(false, ['photo', 'video']);
    expect(view.getByLabelText('Фото 7.jpg')).toBeTruthy();
  });

  it('rechecks access and reloads the grid when the app returns active', async () => {
    getPermissionsAsync.mockResolvedValue(permissionResponse({ granted: false, canAskAgain: true }));
    const view = await render(panelElement(true));
    await flush();
    await flush();
    expect(view.getByLabelText('Разрешить доступ к фото')).toBeTruthy();

    // The user granted access in system settings while the app was backgrounded.
    getPermissionsAsync.mockResolvedValue(grantedPermission());
    exeForMetadata.mockResolvedValue([mediaRow('9')]);
    await act(async () => {
      appStateListeners.forEach((listener) => listener('background'));
      appStateListeners.forEach((listener) => listener('active'));
    });
    await flush();
    await flush();

    expect(view.getByLabelText('Фото 9.jpg')).toBeTruthy();
  });

  it('reopening the panel while a page load is in-flight still fills the grid', async () => {
    let resolveFirst: (rows: MediaLibrary.AssetMetadata[]) => void = () => {};
    exeForMetadata
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue([mediaRow('5')]);
    const view = await render(panelElement(true));
    await flush();
    await flush();

    await view.rerender(panelElement(false));
    await view.rerender(panelElement(true));
    await flush();

    resolveFirst([mediaRow('4')]);
    await flush();
    await flush();
    await flush();

    expect(view.getByLabelText('Фото 5.jpg')).toBeTruthy();
  });
});
