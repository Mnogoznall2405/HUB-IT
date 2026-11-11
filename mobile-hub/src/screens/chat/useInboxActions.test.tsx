import { act, renderHook } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import { useInboxActions } from './useInboxActions';
import type { ChatConversationSummary } from '../../api/types';

jest.mock('../../api/chatApi', () => ({
  markConversationRead: jest.fn(async () => true),
}));

const mockedMarkRead = chatApi.markConversationRead as jest.Mock;

function buildParams(overrides: Record<string, unknown> = {}) {
  const ref = <T,>(value: T) => ({ current: value });
  return {
    userId: 1,
    offlineMode: false,
    mountedRef: ref(true),
    ownerRef: ref(1),
    workspace: 'chats',
    items: [],
    itemsRef: ref([]),
    remoteSearchItemsRef: ref([]),
    setItems: jest.fn(),
    setError: jest.fn(),
    load: jest.fn(async () => undefined),
    loadMore: jest.fn(async () => undefined),
    loadFolders: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as Parameters<typeof useInboxActions>[0];
}

describe('useInboxActions swipe mark-read (CHAT-INBOX-01)', () => {
  it('marks the conversation read on the server with the last message id', async () => {
    const setItems = jest.fn();
    // Params must be built once: ref objects inside them feed hook effects.
    const params = buildParams({ setItems });
    const item = {
      id: 'c-1', kind: 'direct', title: 'Личный', unread_count: 3, last_message_id: 'm-9',
    } as ChatConversationSummary;
    const view = await renderHook(() => useInboxActions(params));

    await act(async () => {
      await view.result.current.toggleReadConversation(item);
    });

    expect(mockedMarkRead).toHaveBeenCalledWith('c-1', 'm-9');
    const updater = setItems.mock.calls[0]?.[0] as (
      rows: ChatConversationSummary[],
    ) => ChatConversationSummary[];
    expect(typeof updater).toBe('function');
    expect(updater([item, { id: 'other', unread_count: 5 } as ChatConversationSummary]))
      .toEqual([{ ...item, unread_count: 0 }, { id: 'other', unread_count: 5 }]);
    await view.unmount();
  });

  it('keeps the badge and skips the request when the summary has no last message id', async () => {
    const setItems = jest.fn();
    const params = buildParams({ setItems });
    const item = {
      id: 'c-2', kind: 'direct', title: 'Без id', unread_count: 2,
    } as ChatConversationSummary;
    const view = await renderHook(() => useInboxActions(params));

    await act(async () => {
      await view.result.current.toggleReadConversation(item);
    });

    expect(setItems).not.toHaveBeenCalled();
    expect(mockedMarkRead).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('keeps the badge when last_message_id is blank and when nothing is unread', async () => {
    const setItems = jest.fn();
    const params = buildParams({ setItems });
    const blank = {
      id: 'c-3', kind: 'direct', unread_count: 4, last_message_id: '   ',
    } as ChatConversationSummary;
    const read = {
      id: 'c-4', kind: 'direct', unread_count: 0, last_message_id: 'm-1',
    } as ChatConversationSummary;
    const view = await renderHook(() => useInboxActions(params));

    await act(async () => {
      await view.result.current.toggleReadConversation(blank);
      await view.result.current.toggleReadConversation(read);
    });

    expect(setItems).not.toHaveBeenCalled();
    expect(mockedMarkRead).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('restores state through a silent reload when mark-read fails', async () => {
    const setItems = jest.fn();
    const load = jest.fn(async () => undefined);
    const params = buildParams({ setItems, load });
    mockedMarkRead.mockRejectedValueOnce(new Error('boom'));
    const item = {
      id: 'c-5', kind: 'direct', unread_count: 1, last_message_id: 'm-5',
    } as ChatConversationSummary;
    const view = await renderHook(() => useInboxActions(params));

    await act(async () => {
      await view.result.current.toggleReadConversation(item);
    });

    expect(mockedMarkRead).toHaveBeenCalledWith('c-5', 'm-5');
    expect(load).toHaveBeenCalledWith('silent');
    await view.unmount();
  });
});
