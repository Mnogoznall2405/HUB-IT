import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as chatApi from '../../api/chatApi';
import type { ChatFolderListResponse } from '../../api/types';
import { getActiveChatFolderKey } from '../../chat/chatActiveFolder';
import { useInboxFolders } from './useInboxFolders';

jest.mock('../../api/chatApi', () => ({
  listChatFolders: jest.fn(),
  createChatFolder: jest.fn(),
  updateChatFolder: jest.fn(),
  deleteChatFolder: jest.fn(),
  addFolderConversation: jest.fn(),
  removeFolderConversation: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
}));

jest.mock('../../components/nativeToast', () => ({
  showNativeToast: jest.fn(),
}));

const api = chatApi as jest.Mocked<typeof chatApi>;

// chatActiveFolder runs against the globally mocked in-memory SecureStore.
const ACTIVE_FOLDER_STORAGE_KEY = 'hubit_native_chat_active_folder_v1';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const folderList = (
  items: { id: string; name: string }[],
  conversationIdsByFolder: Record<string, string[]> = {},
): ChatFolderListResponse => ({
  items,
  conversation_ids_by_folder: conversationIdsByFolder,
  folder_unread_counts: {},
});

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(options: { userId?: number; offlineMode?: boolean } = {}) {
  const userId = options.userId ?? 1;
  const mountedRef = { current: true };
  const ownerRef = { current: userId };
  const view = await renderHook(() => useInboxFolders({
    userId,
    offlineMode: options.offlineMode ?? false,
    mountedRef,
    ownerRef,
    workspace: 'chats',
  }));
  return { view, mountedRef, ownerRef };
}

beforeEach(async () => {
  api.listChatFolders.mockResolvedValue(folderList([]));
  await SecureStore.deleteItemAsync(ACTIVE_FOLDER_STORAGE_KEY);
});

describe('CHAT-INBOX-04: stored folder validation', () => {
  it('falls back to the default tab when the restored folder no longer exists', async () => {
    api.listChatFolders.mockResolvedValue(folderList([{ id: 'f1', name: 'Work' }]));
    const { view } = await setup();
    await act(async () => {
      await view.result.current.loadFolders();
    });
    // Mirrors useInboxData restoring the persisted key after folders synced.
    await act(async () => {
      view.result.current.setActiveFolderKey('ghost-folder');
    });
    expect(view.result.current.activeFolderKey).toBe('personal');
    await waitFor(async () => expect(await getActiveChatFolderKey(1)).toBe('personal'));
  });

  it('keeps the restored folder while it still exists on the server', async () => {
    api.listChatFolders.mockResolvedValue(folderList([{ id: 'f1', name: 'Work' }]));
    const { view } = await setup();
    await act(async () => {
      await view.result.current.loadFolders();
    });
    await act(async () => {
      view.result.current.setActiveFolderKey('f1');
    });
    expect(view.result.current.activeFolderKey).toBe('f1');
  });
});

describe('CHAT-INBOX-05: post-mutation folder reload', () => {
  it('refetches when createFolder collides with an in-flight load', async () => {
    const first = deferred<ChatFolderListResponse>();
    api.listChatFolders.mockReturnValueOnce(first.promise);
    const { view } = await setup();

    let initialLoad!: Promise<void>;
    await act(async () => {
      initialLoad = view.result.current.loadFolders();
      await flushMacrotask();
    });
    expect(api.listChatFolders).toHaveBeenCalledTimes(1);

    api.createChatFolder.mockResolvedValue({ id: 'f-new', name: 'New' });
    api.listChatFolders.mockResolvedValue(folderList([{ id: 'f-new', name: 'New' }]));
    let created!: Promise<void>;
    await act(async () => {
      created = view.result.current.createFolder('New');
      await flushMacrotask();
    });

    await act(async () => {
      first.resolve(folderList([]));
      await initialLoad;
      await created;
    });

    // The deduped post-mutation reload marked the scope dirty — a second
    // fetch must follow instead of leaving the stale pre-create list.
    await waitFor(() => expect(api.listChatFolders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.customFolders).toEqual([{ id: 'f-new', name: 'New' }]));
  });

  it('reverts the optimistic membership map when the toggle request fails', async () => {
    api.listChatFolders.mockResolvedValue(folderList([{ id: 'f1', name: 'Work' }], { f1: ['c1'] }));
    const { view } = await setup();
    await act(async () => {
      await view.result.current.loadFolders();
    });
    expect(view.result.current.conversationIdsByFolder).toEqual({ f1: ['c1'] });

    await act(async () => {
      view.result.current.setAssignConversation({ id: 'c1' });
    });

    // Hold both the API call and the resync fetch so the optimistic edit and
    // its rollback are observable in isolation.
    const apiCall = deferred<void>();
    const resync = deferred<ChatFolderListResponse>();
    api.listChatFolders.mockReturnValue(resync.promise);
    api.removeFolderConversation.mockReturnValue(apiCall.promise);

    let toggle!: Promise<void>;
    await act(async () => {
      toggle = view.result.current.toggleFolderMembership('f1', false);
    });
    // Optimistic state: the conversation is out of the folder.
    expect(view.result.current.conversationIdsByFolder).toEqual({ f1: [] });

    await act(async () => {
      apiCall.reject(new Error('denied'));
      await flushMacrotask();
    });
    // Rolled back to the pre-toggle map before the resync resolves.
    expect(view.result.current.conversationIdsByFolder).toEqual({ f1: ['c1'] });

    await act(async () => {
      resync.resolve(folderList([{ id: 'f1', name: 'Work' }], { f1: ['c1'] }));
      await toggle;
    });
    expect(view.result.current.conversationIdsByFolder).toEqual({ f1: ['c1'] });
  });
});
