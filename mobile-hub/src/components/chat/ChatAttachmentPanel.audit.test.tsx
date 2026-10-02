import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { TestInstance } from 'test-renderer';
import { MEDIA_PAGE_SIZE } from '../../chat/chatAttachmentPanel';
import type { NativePickedFile } from '../../files/nativeFilePicker';
import { ChatAttachmentPanel } from './ChatAttachmentPanel';

jest.mock('../../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

const getPermissionsAsync = jest.mocked(MediaLibrary.getPermissionsAsync);
let exeForMetadata: jest.SpyInstance<Promise<MediaLibrary.AssetMetadata[]>, []>;

const grantedPermission = (): MediaLibrary.PermissionResponse => ({
  canAskAgain: true,
  expires: 'never',
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

const mediaPage = (prefix: string, count: number) => (
  Array.from({ length: count }, (_, index) => mediaRow(`${prefix}${index}`))
);

const panelElement = (
  visible: boolean,
  onSendFiles: (files: NativePickedFile[], caption: string) => void = jest.fn(),
  onClose: () => void = jest.fn(),
) => (
  <ChatAttachmentPanel
    visible={visible}
    onClose={onClose}
    onSendFiles={onSendFiles}
    onOpenCamera={jest.fn()}
  />
);

const flush = () => act(async () => { await Promise.resolve(); });

type FiberLike = {
  memoizedProps?: Record<string, unknown> | null;
  return?: FiberLike | null;
} | null;

/** Walk the fiber tree upwards and return the first `prop` handler found —
 * fires it twice inside one act() to simulate a double dispatch landing before
 * React commits the first state update. */
const findPropUpFiber = (
  node: TestInstance,
  prop: string,
): ((...args: never[]) => unknown) => {
  let fiber = (node as unknown as { unstable_fiber?: FiberLike }).unstable_fiber ?? null;
  while (fiber) {
    const props = fiber.memoizedProps;
    if (props && typeof props[prop] === 'function') {
      return props[prop] as (...args: never[]) => unknown;
    }
    fiber = fiber.return ?? null;
  }
  throw new Error(`no ${prop} handler found`);
};

beforeEach(() => {
  getPermissionsAsync.mockResolvedValue(grantedPermission());
  exeForMetadata = jest.spyOn(MediaLibrary.Query.prototype, 'exeForMetadata').mockResolvedValue([]);
  jest.spyOn(MediaLibrary.Album, 'getAll').mockResolvedValue([]);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AUD-2 pagination dedup', () => {
  it('issues only one request for a repeated onEndReached while a page is in flight', async () => {
    let pageIndex = 0;
    exeForMetadata.mockImplementation(() => Promise.resolve(mediaPage(`pg${pageIndex++}-`, MEDIA_PAGE_SIZE)));
    const view = await render(panelElement(true));
    await flush();
    await flush();

    expect(view.getByLabelText('Фото pg0-0.jpg')).toBeTruthy();
    expect(exeForMetadata).toHaveBeenCalledTimes(1);

    let resolvePage: (rows: MediaLibrary.AssetMetadata[]) => void = () => {};
    exeForMetadata.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }));
    const onEndReached = findPropUpFiber(view.getByLabelText('Снять на камеру'), 'onEndReached');
    await act(async () => {
      onEndReached();
      onEndReached();
    });

    // The second endReached fired while the page-2 request was still in flight —
    // it must not queue a duplicate offset request.
    expect(exeForMetadata).toHaveBeenCalledTimes(2);

    await act(async () => { resolvePage(mediaPage('q', 10)); });
    await flush();
    // The appended page committed once — the grid grew past the first page.
    expect(view.getAllByLabelText(/^Снять на камеру$/)).toHaveLength(1);
  });

  it('loads the next page after the in-flight page commits', async () => {
    let pageIndex = 0;
    exeForMetadata.mockImplementation(() => Promise.resolve(mediaPage(`pg${pageIndex++}-`, MEDIA_PAGE_SIZE)));
    const view = await render(panelElement(true));
    await flush();
    await flush();

    const onEndReached = findPropUpFiber(view.getByLabelText('Снять на камеру'), 'onEndReached');
    await act(async () => { onEndReached(); });
    await flush();
    await flush();

    expect(exeForMetadata).toHaveBeenCalledTimes(2);
  });
});

describe('AUD-3 double-send guard', () => {
  it('calls onSendFiles once for a rapid double tap on «Отправить»', async () => {
    const onSendFiles = jest.fn();
    const onClose = jest.fn();
    exeForMetadata.mockResolvedValue([mediaRow('s1')]);
    const view = await render(panelElement(true, onSendFiles, onClose));
    await flush();
    await flush();

    await fireEvent.press(view.getByLabelText('Фото s1.jpg'));
    const onPress = findPropUpFiber(view.getByLabelText('Отправить 1'), 'onPress');
    await act(async () => {
      onPress();
      onPress();
    });

    expect(onSendFiles).toHaveBeenCalledTimes(1);
    expect(onSendFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ uri: 'content://media/s1' })],
      '',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows sending again after the panel reopens', async () => {
    const onSendFiles = jest.fn();
    const onClose = jest.fn();
    exeForMetadata.mockResolvedValue([mediaRow('s1')]);
    const view = await render(panelElement(true, onSendFiles, onClose));
    await flush();
    await flush();

    await fireEvent.press(view.getByLabelText('Фото s1.jpg'));
    await act(async () => { findPropUpFiber(view.getByLabelText('Отправить 1'), 'onPress')(); });
    expect(onSendFiles).toHaveBeenCalledTimes(1);

    await view.rerender(panelElement(false, onSendFiles, onClose));
    await view.rerender(panelElement(true, onSendFiles, onClose));
    await flush();
    await flush();

    await fireEvent.press(view.getByLabelText('Фото s1.jpg'));
    await act(async () => { findPropUpFiber(view.getByLabelText('Отправить 1'), 'onPress')(); });
    expect(onSendFiles).toHaveBeenCalledTimes(2);
  });
});

describe('AUD-4 preview reset', () => {
  it('drops the full-screen preview when the panel closes and reopens', async () => {
    exeForMetadata.mockResolvedValue([mediaRow('v1')]);
    const view = await render(panelElement(true));
    await flush();
    await flush();

    await fireEvent.press(view.getByLabelText('Фото v1.jpg'));
    await fireEvent.press(view.getByLabelText('Предпросмотр 1 из 1'));
    expect(view.getByLabelText('Закрыть предпросмотр')).toBeTruthy();

    await view.rerender(panelElement(false));
    await view.rerender(panelElement(true));
    await flush();
    await flush();

    expect(view.queryByLabelText('Закрыть предпросмотр')).toBeNull();
  });
});

describe('AUD-8 preview insets', () => {
  it('keeps the preview controls clear of the system bars', async () => {
    exeForMetadata.mockResolvedValue([mediaRow('i1')]);
    const insets = { top: 72, bottom: 48, left: 0, right: 44 };
    const view = await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        {panelElement(true)}
      </SafeAreaInsetsContext.Provider>,
    );
    await flush();
    await flush();

    await fireEvent.press(view.getByLabelText('Фото i1.jpg'));
    await fireEvent.press(view.getByLabelText('Предпросмотр 1 из 1'));

    const closeStyle = StyleSheet.flatten(view.getByLabelText('Закрыть предпросмотр').props.style);
    expect(closeStyle.top).toBeGreaterThanOrEqual(insets.top);
    expect(closeStyle.right).toBeGreaterThanOrEqual(insets.right);
    const removeStyle = StyleSheet.flatten(view.getByLabelText('Убрать из отправки').props.style);
    expect(removeStyle.bottom).toBeGreaterThanOrEqual(insets.bottom);
  });
});
