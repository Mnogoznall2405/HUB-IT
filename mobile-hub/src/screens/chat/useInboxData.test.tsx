import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as chatApi from '../../api/chatApi';
import type { ChatConversationSummary } from '../../api/types';
import { chatSocket, type ChatSocketStatus } from '../../chat/chatSocket';
import { readNativeChatInboxSnapshot } from '../../chat/nativeChatInboxSnapshot';
import { getChatDeviceLogSnapshot, resetChatDeviceLog } from '../../diagnostics/chatDeviceLog';
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

describe('inbox stale pages after conversation.removed', () => {
  const emitRemoved = (conversationId: string) => {
    mockSocketHandlers.get('chat.conversation.removed')
      ?.forEach((handler) => handler({ payload: { conversation_id: conversationId } }));
  };

  it('discards a first page that resolves after the removal tombstone', async () => {
    await resetChatDeviceLog();
    const deferreds: Array<(page: ReturnType<typeof pageOf>) => void> = [];
    api.getConversationPage.mockImplementation(
      () => new Promise((resolve) => { deferreds.push(resolve); }),
    );
    const { view } = await setup();
    expect(deferreds).toHaveLength(1);

    // c1 is deleted elsewhere while the first page is still in flight.
    await act(async () => emitRemoved('c1'));
    await act(async () => {
      deferreds[0](pageOf([conv('c1'), conv('c2')]));
      await Promise.resolve();
    });

    // The stale page must be dropped and a fresh first page requested.
    await waitFor(() => expect(api.getConversationPage).toHaveBeenCalledTimes(2));
    await act(async () => {
      deferreds[1](pageOf([conv('c2')]));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c2']));
    expect(api.getConversationPage).toHaveBeenLastCalledWith({ limit: 50 });
    const pageOutcomes = getChatDeviceLogSnapshot()
      .filter((entry) => entry.e === 'inbox_page')
      .map((entry) => entry.f?.outcome);
    expect(pageOutcomes).toEqual(['stale', 'ok']);
  });

  it('discards a loadMore page that resolves after the removal tombstone', async () => {
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1'), conv('c2')], true));
    const { view } = await setup();
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1', 'c2']));

    let releaseMore!: (page: ReturnType<typeof pageOf>) => void;
    api.getConversationPage.mockImplementation(
      () => new Promise((resolve) => { releaseMore = resolve; }),
    );
    let loadMoreDone: Promise<void> | undefined;
    await act(async () => {
      loadMoreDone = view.result.current.loadMore();
      await Promise.resolve();
    });
    expect(api.getConversationPage).toHaveBeenLastCalledWith({ cursor: 'cursor-next', limit: 50 });

    // c2 is deleted elsewhere while the next page is still in flight.
    await act(async () => emitRemoved('c2'));
    expect(view.result.current.items.map((item) => item.id)).toEqual(['c1']);
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1')]));
    await act(async () => {
      releaseMore(pageOf([conv('c2'), conv('c3')], true));
      await loadMoreDone;
    });

    // The stale page resurrects nothing and its cursor is never committed —
    // the list is rebuilt from a fresh first page instead.
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1']));
    expect(api.getConversationPage).toHaveBeenLastCalledWith({ limit: 50 });
    expect(view.result.current.hasMore).toBe(false);
  });
});

// S11: the inbox fallback poll runs only while the socket is down, the inbox is
// focused and the app is foregrounded. A reconnect still runs one gap reload.
describe('S11: inbox fallback poll', () => {
  const appStateHandlers = new Set<(state: string) => void>();

  beforeEach(() => {
    appStateHandlers.clear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((type: string, handler: (state: string) => void) => {
      if (type === 'change') appStateHandlers.add(handler);
      return { remove: () => appStateHandlers.delete(handler) };
    }) as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('polls only while disconnected and foregrounded, and runs one gap reload on reconnect', async () => {
    const { view } = await setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    jest.useFakeTimers();
    try {
      await act(async () => emitStatus('connected'));
      api.getConversationPage.mockClear();

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(api.getConversationPage).not.toHaveBeenCalled();

      await act(async () => emitStatus('reconnecting'));
      expect(api.getConversationPage).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });
      expect(api.getConversationPage).toHaveBeenCalledTimes(2);

      await act(async () => {
        appStateHandlers.forEach((handler) => handler('background'));
      });
      api.getConversationPage.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(api.getConversationPage).not.toHaveBeenCalled();

      await act(async () => {
        appStateHandlers.forEach((handler) => handler('active'));
      });
      expect(api.getConversationPage).toHaveBeenCalledTimes(1);

      api.getConversationPage.mockClear();
      await act(async () => emitStatus('connected'));
      expect(api.getConversationPage).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(api.getConversationPage).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('inbox stage events', () => {
  beforeEach(async () => {
    await resetChatDeviceLog();
  });

  it('logs inbox_cache hit and inbox_page ok with stage fields only', async () => {
    jest.mocked(readNativeChatInboxSnapshot).mockResolvedValueOnce({
      savedAt: Date.now(),
      data: { items: [conv('cached')], has_more: false, next_cursor: null },
    } as never);
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1'), conv('c2')]));
    await setup();
    await waitFor(() => {
      expect(getChatDeviceLogSnapshot().some((entry) => entry.e === 'inbox_page')).toBe(true);
    });
    const entries = getChatDeviceLogSnapshot();
    const cache = entries.find((entry) => entry.e === 'inbox_cache');
    const page = entries.find((entry) => entry.e === 'inbox_page');
    expect(cache?.f).toMatchObject({ hit: true });
    expect(Number.isInteger(cache?.f?.ms)).toBe(true);
    expect(Number.isInteger(page?.f?.ms)).toBe(true);
    expect(page?.f).toMatchObject({ count: 2, outcome: 'ok' });
    // Stage fields carry timings and counts only — no ids, titles or text.
    const stageFields = JSON.stringify(
      entries.filter((entry) => entry.e.startsWith('inbox_')).map((entry) => entry.f ?? null),
    );
    expect(stageFields).not.toContain('cached');
    expect(stageFields).not.toContain('Chat c');
  });

  it('logs a cache miss and an error page outcome on a failed initial load', async () => {
    api.getConversationPage.mockRejectedValue(new Error('network down'));
    await setup();
    await waitFor(() => {
      expect(getChatDeviceLogSnapshot().some(
        (entry) => entry.e === 'inbox_page' && entry.f?.outcome === 'error',
      )).toBe(true);
    });
    const cache = getChatDeviceLogSnapshot().find((entry) => entry.e === 'inbox_cache');
    expect(cache?.f).toMatchObject({ hit: false });
  });

  it('keeps silent reloads out of the page stage log', async () => {
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1')]));
    const { view } = await setup();
    await waitFor(() => {
      expect(getChatDeviceLogSnapshot().filter((entry) => entry.e === 'inbox_page')).toHaveLength(1);
    });
    await act(async () => {
      await view.result.current.load('silent');
    });
    expect(getChatDeviceLogSnapshot().filter((entry) => entry.e === 'inbox_page')).toHaveLength(1);
    view.unmount();
  });

  it('logs only the cache stage offline and never requests a page', async () => {
    await setup({ offlineMode: true });
    await waitFor(() => {
      expect(getChatDeviceLogSnapshot().some((entry) => entry.e === 'inbox_cache')).toBe(true);
    });
    expect(getChatDeviceLogSnapshot().filter((entry) => entry.e === 'inbox_page')).toHaveLength(0);
    expect(api.getConversationPage).not.toHaveBeenCalled();
  });
});

describe('inbox initial load runs the first page in parallel with the snapshot', () => {
  const emitRemoved = (conversationId: string) => {
    mockSocketHandlers.get('chat.conversation.removed')
      ?.forEach((handler) => handler({ payload: { conversation_id: conversationId } }));
  };
  const deferredOf = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  };

  beforeEach(async () => {
    await resetChatDeviceLog();
  });

  it('starts the first page request before the snapshot read resolves', async () => {
    const snapshot = deferredOf<{ savedAt: number; data: unknown } | null>();
    jest.mocked(readNativeChatInboxSnapshot).mockImplementationOnce(() => snapshot.promise as never);
    const page = deferredOf<ReturnType<typeof pageOf>>();
    api.getConversationPage.mockImplementation(() => page.promise);

    let now = 1_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { view } = await setup();
      // Online initial load: the GET is in flight while the snapshot is pending.
      expect(api.getConversationPage).toHaveBeenCalledTimes(1);

      now = 1_400; // the HTTP page finishes after 400 ms
      await act(async () => {
        page.resolve(pageOf([conv('c1')]));
        await Promise.resolve();
      });
      now = 2_500; // the snapshot read takes 1.5 s in total
      await act(async () => {
        snapshot.resolve({
          savedAt: now,
          data: { items: [conv('cached')], has_more: false, next_cursor: null },
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1']));
      const cache = getChatDeviceLogSnapshot().find((entry) => entry.e === 'inbox_cache');
      const pageEvent = getChatDeviceLogSnapshot().find((entry) => entry.e === 'inbox_page');
      // The cache stage reports the real read time; the page stage reports only
      // the HTTP wait even though the slower snapshot resolved last.
      expect(cache?.f).toMatchObject({ ms: 1_500, hit: true });
      expect(pageEvent?.f).toMatchObject({ ms: 400, count: 1, outcome: 'ok' });
      view.unmount();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('performs zero requests offline while the snapshot is still pending', async () => {
    const snapshot = deferredOf<null>();
    jest.mocked(readNativeChatInboxSnapshot).mockImplementationOnce(() => snapshot.promise as never);
    const { view } = await setup({ offlineMode: true });
    expect(api.getConversationPage).not.toHaveBeenCalled();
    await act(async () => {
      snapshot.resolve(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(getChatDeviceLogSnapshot().some((entry) => entry.e === 'inbox_cache')).toBe(true);
    });
    expect(api.getConversationPage).not.toHaveBeenCalled();
    expect(getChatDeviceLogSnapshot().filter((entry) => entry.e === 'inbox_page')).toHaveLength(0);
    expect(view.result.current.loading).toBe(false);
    view.unmount();
  });

  it('still applies the live page and logs a cache error when the snapshot read fails', async () => {
    jest.mocked(readNativeChatInboxSnapshot).mockRejectedValueOnce(
      new Error('corrupt snapshot of chat c-secret'),
    );
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1')]));
    const { view } = await setup();
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1']));
    expect(api.getConversationPage).toHaveBeenCalledTimes(1);
    expect(view.result.current.loading).toBe(false);
    const cache = getChatDeviceLogSnapshot().find((entry) => entry.e === 'inbox_cache');
    expect(cache?.f).toMatchObject({ outcome: 'error' });
    expect(Number.isInteger(cache?.f?.ms)).toBe(true);
    expect(JSON.stringify(cache?.f ?? null)).not.toContain('c-secret');
    view.unmount();
  });

  it('never renders a cached removed row while the fresh first page is pending', async () => {
    const snapshot = deferredOf<{ savedAt: number; data: unknown } | null>();
    jest.mocked(readNativeChatInboxSnapshot).mockImplementationOnce(() => snapshot.promise as never);
    const deferreds: Array<(page: ReturnType<typeof pageOf>) => void> = [];
    api.getConversationPage.mockImplementation(
      () => new Promise((resolve) => { deferreds.push(resolve); }),
    );
    const { view } = await setup();
    expect(deferreds).toHaveLength(1);

    // c1 is deleted elsewhere while both the snapshot and the page are pending.
    await act(async () => emitRemoved('c1'));
    await act(async () => {
      deferreds[0](pageOf([conv('c1'), conv('c2')]));
      await Promise.resolve();
    });
    // The cache still holds c1 — applying it here would resurrect the row.
    await act(async () => {
      snapshot.resolve({
        savedAt: 1,
        data: { items: [conv('c1'), conv('c2')], has_more: false, next_cursor: null },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Between the stale snapshot resolution and the fresh first page the list
    // must not expose c1 at all.
    await waitFor(() => expect(deferreds).toHaveLength(2));
    expect(view.result.current.items.map((item) => item.id)).not.toContain('c1');
    await act(async () => {
      deferreds[1](pageOf([conv('c2')]));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c2']));
    view.unmount();
  });

  it('filters previously tombstoned rows out of a snapshot when the revision is stable', async () => {
    jest.mocked(readNativeChatInboxSnapshot).mockResolvedValue({
      savedAt: 1,
      data: { items: [conv('c1'), conv('c2')], has_more: false, next_cursor: null },
    } as never);
    api.getConversationPage.mockResolvedValue(pageOf([conv('c1'), conv('c2')]));
    const { view } = await setup();
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c1', 'c2']));

    // c1 is deleted elsewhere while online — the tombstone is live now.
    await act(async () => emitRemoved('c1'));
    expect(view.result.current.items.map((item) => item.id)).toEqual(['c2']);

    // A reload reads the stale snapshot while its GET is pending: the live
    // tombstone must keep c1 out of the cached rows too.
    const page = deferredOf<ReturnType<typeof pageOf>>();
    api.getConversationPage.mockImplementation(() => page.promise);
    let loadDone!: Promise<void>;
    await act(async () => {
      loadDone = view.result.current.load('initial');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.items.map((item) => item.id)).toEqual(['c2']);
    await act(async () => {
      page.resolve(pageOf([conv('c2')]));
      await loadDone;
    });
    expect(view.result.current.items.map((item) => item.id)).toEqual(['c2']);
    view.unmount();
  });

  it('drops a first page resolved after conversation.removed while the snapshot was pending', async () => {
    const snapshot = deferredOf<null>();
    jest.mocked(readNativeChatInboxSnapshot).mockImplementationOnce(() => snapshot.promise as never);
    const deferreds: Array<(page: ReturnType<typeof pageOf>) => void> = [];
    api.getConversationPage.mockImplementation(
      () => new Promise((resolve) => { deferreds.push(resolve); }),
    );
    const { view } = await setup();
    // The page request is already in flight before the snapshot resolves.
    expect(deferreds).toHaveLength(1);

    // c1 is deleted elsewhere while both the snapshot and the page are pending.
    await act(async () => emitRemoved('c1'));
    await act(async () => {
      deferreds[0](pageOf([conv('c1'), conv('c2')]));
      await Promise.resolve();
    });
    await act(async () => {
      snapshot.resolve(null);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale page is dropped and exactly one fresh first page is requested.
    await waitFor(() => expect(deferreds).toHaveLength(2));
    await act(async () => {
      deferreds[1](pageOf([conv('c2')]));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.result.current.items.map((item) => item.id)).toEqual(['c2']));
    expect(api.getConversationPage).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
