import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { getMailMessages } from '../api/mailApi';
import { useMailList, type NativeMailAdvancedFilters } from './useMailList';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../api/mailApi', () => ({
  getMailConversations: jest.fn(),
  getMailFolderSummary: jest.fn(),
  getMailFolderTree: jest.fn(),
  getMailMessages: jest.fn(),
}));
jest.mock('../api/mailConfigApi', () => ({
  DEFAULT_NATIVE_MAIL_PREFERENCES: {},
  getNativeMailPreferences: jest.fn(async () => null),
}));
jest.mock('../api/mailMailboxesApi', () => ({ listMailboxes: jest.fn(async () => []) }));
jest.mock('../cache/nativeSnapshotCache', () => ({
  nativeCollectionSignature: (value: unknown) => JSON.stringify(value),
  readNativeCollectionSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => undefined),
}));
jest.mock('../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    on: jest.fn(() => () => undefined),
    onMailChanged: jest.fn(() => () => undefined),
  },
}));

const mockedMessages = getMailMessages as jest.Mock;

const FILTERS: NativeMailAdvancedFilters = {
  dateFrom: '',
  dateTo: '',
  from: '',
  to: '',
  subject: '',
  body: '',
  importance: '',
  folderScope: 'current',
};

function Harness() {
  const list = useMailList({
    allowed: true,
    offlineMode: false,
    userId: 1,
    mailboxId: 'box-1',
    folder: 'inbox',
    view: 'messages',
    debouncedQuery: '',
    unreadOnly: false,
    hasAttachments: false,
    advancedFilters: FILTERS,
  });
  return (
    <>
      <Pressable testID="reset" onPress={() => { void list.load({ reset: true }); }} />
      <Pressable testID="more" onPress={() => { void list.load({ reset: false }); }} />
      <Text testID="error">{list.error}</Text>
      <Text testID="count">{list.items.length}</Text>
    </>
  );
}

function page(overrides: Record<string, unknown>) {
  return {
    items: [],
    folder: 'inbox',
    limit: 50,
    offset: 0,
    total: 0,
    has_more: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('asks for the next page at the server-provided next_offset', async () => {
  mockedMessages
    .mockResolvedValueOnce(page({
      items: [{ id: 'm1', folder: 'inbox' }],
      total: 7,
      has_more: true,
      next_offset: 5,
    }))
    .mockResolvedValueOnce(page({ items: [], offset: 5, total: 7, has_more: false }));
  const view = await render(<Harness />);
  await act(async () => { fireEvent.press(view.getByTestId('reset')); });
  await act(async () => { fireEvent.press(view.getByTestId('more')); });
  expect(mockedMessages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5 }));
});

it('falls back to the local cursor when the server omits next_offset', async () => {
  mockedMessages
    .mockResolvedValueOnce(page({
      items: [{ id: 'm1', folder: 'inbox' }, { id: 'm2', folder: 'inbox' }],
      total: 4,
      has_more: true,
    }))
    .mockResolvedValueOnce(page({ items: [], offset: 2, total: 4, has_more: false }));
  const view = await render(<Harness />);
  await act(async () => { fireEvent.press(view.getByTestId('reset')); });
  await act(async () => { fireEvent.press(view.getByTestId('more')); });
  expect(mockedMessages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }));
});

it('drops the server cursor after a failed reload instead of skipping the list head', async () => {
  mockedMessages
    .mockResolvedValueOnce(page({ items: [{ id: 'm1', folder: 'inbox' }], total: 9, has_more: true, next_offset: 5 }))
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(page({ items: [{ id: 'm2', folder: 'inbox' }], total: 9, has_more: true, next_offset: 1 }));
  const view = await render(<Harness />);
  await act(async () => { fireEvent.press(view.getByTestId('reset')); });
  await act(async () => { fireEvent.press(view.getByTestId('reset')); });
  await act(async () => { fireEvent.press(view.getByTestId('more')); });
  expect(mockedMessages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
});

it('warns when the server skipped folders during search', async () => {
  mockedMessages.mockResolvedValueOnce(page({
    items: [{ id: 'm1', folder: 'inbox' }],
    total: 1,
    skipped_folders: 2,
  }));
  const view = await render(<Harness />);
  await act(async () => { fireEvent.press(view.getByTestId('reset')); });
  expect(view.getByTestId('error').props.children).toContain('недоступн');
});
