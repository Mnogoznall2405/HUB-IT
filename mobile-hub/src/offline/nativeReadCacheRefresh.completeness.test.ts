import { getConversationPage, listChatFolders } from '../api/chatApi';
import { pollHubNotifications } from '../api/notificationApi';
import { readNativeSnapshot } from '../cache/nativeSnapshotCache';
import { readNativeChatInboxSnapshot, writeNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import { refreshNativeReadCaches } from './nativeReadCacheRefresh';

jest.mock('../api/chatApi', () => ({ getConversationPage: jest.fn(), listChatFolders: jest.fn() }));
jest.mock('../api/notificationApi', () => ({ pollHubNotifications: jest.fn(), getMailNotificationFeed: jest.fn() }));
jest.mock('../api/addressBookApi', () => ({}));
jest.mock('../api/databaseApi', () => ({}));
jest.mock('../cache/nativeAddressBookSnapshot', () => ({}));
jest.mock('../cache/nativeEquipmentCatalogSnapshot', () => ({}));
jest.mock('../database/nativeDatabaseSnapshot', () => ({}));
jest.mock('../diagnostics/diagnostics', () => ({ recordSnapshotFailure: jest.fn(async () => undefined) }));
jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(), writeNativeSnapshot: jest.fn(async () => true),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
}));
jest.mock('../chat/nativeChatInboxSnapshot', () => ({
  readNativeChatInboxSnapshot: jest.fn(), writeNativeChatInboxSnapshot: jest.fn(async () => true),
}));
jest.mock('./nativeOfflineCoverage', () => ({
  recordNativeOfflineCoverageSuccess: jest.fn(async () => true),
  recordNativeOfflineCoverageFailure: jest.fn(async () => true),
}));

const folders = { items: [], conversation_ids_by_folder: {}, folder_unread_counts: {} };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listChatFolders).mockResolvedValue(folders);
  jest.mocked(pollHubNotifications).mockResolvedValue({ items: [], unread_counts: {}, limit: 200, unread_only: false });
  jest.mocked(getConversationPage).mockImplementation(async (options = {}) => options.cursor
    ? { items: [{ id: 'c2', kind: 'direct' }], has_more: false, next_cursor: null }
    : { items: [{ id: 'c1', kind: 'direct' }], has_more: true, next_cursor: 'page2' });
});

it.each([
  { name: 'fresh partial', partial: true, force: false, stale: false, requests: 2 },
  { name: 'fresh complete', partial: false, force: false, stale: false, requests: 0 },
  { name: 'forced complete', partial: false, force: true, stale: false, requests: 2 },
  { name: 'stale complete', partial: false, force: false, stale: true, requests: 2 },
])('handles a $name catalog without mistaking freshness for completeness', async ({ partial, force, stale, requests }) => {
  const now = Date.now();
  const savedAt = stale ? now - 7 * 60 * 60 * 1000 : now;
  jest.mocked(readNativeChatInboxSnapshot).mockResolvedValue({ savedAt, data: {
    items: [{ id: 'cached', kind: 'direct' }], has_more: partial, next_cursor: partial ? 'old-cursor' : null,
  } });
  jest.mocked(readNativeSnapshot).mockImplementation(async (scope) => ({
    savedAt: scope === 'chat-folders' ? savedAt : now,
    data: scope === 'chat-folders' ? folders : { hubItems: [], mailItems: [] },
  }) as never);

  const result = await refreshNativeReadCaches({ userId: 7, permissions: ['chat.read'], force });
  expect(result.failed).toEqual([]);
  expect(getConversationPage).toHaveBeenCalledTimes(requests);
  if (requests) {
    expect(writeNativeChatInboxSnapshot).toHaveBeenCalledWith(7, {
      items: [{ id: 'c1', kind: 'direct' }, { id: 'c2', kind: 'direct' }],
      has_more: false, next_cursor: null,
    });
  } else {
    expect(writeNativeChatInboxSnapshot).not.toHaveBeenCalled();
  }
});
