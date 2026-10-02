import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import type { ChatConversationSummary } from '../../api/types';
import { chatSocket, type ChatSocketStatus } from '../../chat/chatSocket';
import { useInboxData } from './useInboxData';

const mockSocketStatus: { current: ChatSocketStatus } = { current: 'disconnected' };
const mockSocketHandlers = new Map<string, Set<(payload: unknown) => void>>();

jest.mock('../../chat/chatSocket', () => ({
  shouldUseChatHttpFallback: (status: string) => (
    status === 'offline' || status === 'error' || status === 'reconnecting'
  ),
  chatSocket: {
    getStatus: () => mockSocketStatus.current,
    on: jest.fn((event: string, handler: (payload: unknown) => void) => {
      if (!mockSocketHandlers.has(event)) mockSocketHandlers.set(event, new Set());
      mockSocketHandlers.get(event)!.add(handler);
      return () => mockSocketHandlers.get(event)?.delete(handler);
    }),
    connect: jest.fn(async () => undefined),
    subscribeInbox: jest.fn(),
  },
}));

jest.mock('../../api/chatApi', () => ({
  getConversationPage: jest.fn(),
}));

jest.mock('../../chat/chatActiveConversation', () => ({
  getActiveNativeChatConversationId: jest.fn(() => null),
  subscribeNativeChatConversationRead: jest.fn(() => jest.fn()),
}));

jest.mock('../../chat/nativeChatInboxSnapshot', () => ({
  readNativeChatInboxSnapshot: jest.fn(async () => null),
  writeNativeChatInboxSnapshot: jest.fn(async () => true),
}));

jest.mock('../../chat/chatActiveFolder', () => ({
  getActiveChatFolderKey: jest.fn(async () => 'personal'),
}));

jest.mock('../../chat/chatDrafts', () => ({
  listNativeChatDraftPreviews: jest.fn(async () => new Map<string, string>()),
}));

const api = chatApi as jest.Mocked<typeof chatApi>;

const conv = (id: string, seq = 1): ChatConversationSummary => ({
  id,
  kind: 'direct',
  title: `Chat ${id}`,
  last_message_seq: seq,
  unread_count: 0,
});

const pageOf = (items: ChatConversationSummary[], hasMore = false) => ({
  items,
  has_more: hasMore,
  next_cursor: hasMore ? 'cursor-next' : null,
});

function emitStatus(status: ChatSocketStatus) {
  mockSocketStatus.current = status;
  mockSocketHandlers.get('status')?.forEach((handler) => handler(status));
}

async function setup(options: { userId?: number; offlineMode?: boolean } = {}) {
  const userId = options.userId ?? 1;
  const mountedRef = { current: true };
  const ownerRef = { current: userId };
  const setActiveFolderKey = jest.fn();
  const loadFolders = jest.fn(async () => undefined);
  const view = await renderHook(() => useInboxData({
    userId,
    offlineMode: options.offlineMode ?? false,
    mountedRef,
    ownerRef,
    setActiveFolderKey,
    loadFolders,
  }));
  return { view, mountedRef, ownerRef, setActiveFolderKey, loadFolders };
}

beforeEach(() => {
  mockSocketStatus.current = 'disconnected';
  mockSocketHandlers.clear();
  api.getConversationPage.mockResolvedValue(pageOf([]));
});

describe('CHAT-INBOX-02: inbox resubscription after reconnect', () => {
  it('re-arms subscribeInbox on every transition into connected', async () => {
    await setup();
    const subscribeInbox = jest.mocked(chatSocket.subscribeInbox);
    // Mount subscribes once up-front.
    expect(subscribeInbox).toHaveBeenCalledTimes(1);
    subscribeInbox.mockClear();

    await act(async () => emitStatus('connected'));
    expect(subscribeInbox).toHaveBeenCalledTimes(1);

    // A repeated emit of the same status must not send another frame.
    await act(async () => emitStatus('connected'));
    expect(subscribeInbox).toHaveBeenCalledTimes(1);

    // Simulates AppLifecycle disconnect(clearSubscriptions) on tab blur and a
    // reconnect on return while this screen stays mounted (freezeOnBlur).
    await act(async () => emitStatus('disconnected'));
    await act(async () => emitStatus('connected'));
    expect(subscribeInbox).toHaveBeenCalledTimes(2);
  });

  it('still runs the silent reload path after the first connect', async () => {
    const { loadFolders } = await setup();
    loadFolders.mockClear();
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1')]));
    api.getConversationPage.mockClear();

    await act(async () => emitStatus('connected'));
    expect(loadFolders).not.toHaveBeenCalled();

    await act(async () => emitStatus('disconnected'));
    await act(async () => emitStatus('connected'));
    await waitFor(() => expect(loadFolders).toHaveBeenCalled());
    await waitFor(() => expect(api.getConversationPage).toHaveBeenCalledTimes(1));
  });
});

describe('CHAT-INBOX-07: silent merge drops server-deleted rows', () => {
  it('removes conversations missing from a complete silent page', async () => {
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1'), conv('c2')]));
    const { view } = await setup();
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1', 'c2']));

    api.getConversationPage.mockResolvedValue(pageOf([conv('c1')]));
    await act(async () => {
      await view.result.current.load('silent');
    });
    expect(view.result.current.items.map((item) => item.id)).toEqual(['c1']);
  });

  it('keeps unlisted rows while the silent page is still paginated', async () => {
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1'), conv('c2')]));
    const { view } = await setup();
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1', 'c2']));

    api.getConversationPage.mockResolvedValue(pageOf([conv('c1')], true));
    await act(async () => {
      await view.result.current.load('silent');
    });
    expect(view.result.current.items.map((item) => item.id)).toEqual(['c1', 'c2']);
  });
});
