import type { ChatMessage } from '../api/types';
import { getConversationPage, getMessagesPage, listChatFolders } from '../api/chatApi';
import {
  bumpNativeChatThreadHistoryGeneration,
  mergeNativeChatThreadHistory,
  scheduleNativeChatThreadSnapshotWrite,
  waitForNativeChatThreadSnapshotWrites,
  type NativeChatThreadSnapshot,
} from '../chat/nativeChatThreadHistory';
import { writeNativeEntitySnapshot } from '../cache/nativeSnapshotCache';
import { prepareNativeOfflineData } from './nativeOfflinePreparation';

// Keep the real preparation, history writer and mergeMessages wired together.
// Only API and persistence boundaries are replaced; no filesystem or HUB access.
const mockSnapshots = new Map<string, NativeChatThreadSnapshot>();
const mockSnapshotKey = (scope: string, userId: number, key: string) => JSON.stringify([scope, userId, key]);
jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(async (scope: string, userId: number, key: string) => {
    const data = mockSnapshots.get(mockSnapshotKey(scope, userId, key));
    return data ? { savedAt: 1, data: JSON.parse(JSON.stringify(data)) } : null;
  }),
  writeNativeEntitySnapshot: jest.fn(async (scope: string, userId: number, key: string, data: NativeChatThreadSnapshot) => {
    mockSnapshots.set(mockSnapshotKey(scope, userId, key), JSON.parse(JSON.stringify(data)));
  }),
}));
jest.mock('../api/chatApi', () => ({ getConversationPage: jest.fn(), getMessagesPage: jest.fn(), listChatFolders: jest.fn() }));
jest.mock('../api/hubApi', () => ({}));
jest.mock('../api/mailApi', () => ({}));
jest.mock('../api/mailConfigApi', () => ({}));
jest.mock('../api/mailMailboxesApi', () => ({}));
jest.mock('../api/notificationApi', () => ({}));
jest.mock('../api/taskApi', () => ({}));
jest.mock('../api/docflowApi', () => ({}));
jest.mock('../api/addressBookApi', () => ({}));
jest.mock('../api/feedApi', () => ({}));
jest.mock('../api/myFilesApi', () => ({}));
jest.mock('../api/companyStructureApi', () => ({}));
jest.mock('../cache/nativeAddressBookSnapshot', () => ({}));
jest.mock('../chat/nativeChatInboxSnapshot', () => ({ writeNativeChatInboxSnapshot: jest.fn(async () => true) }));
jest.mock('./nativeReadCacheRefresh', () => ({ refreshNativeReadCaches: jest.fn() }));
jest.mock('../diagnostics/diagnostics', () => ({ recordDiagnosticEvent: jest.fn(async () => undefined), recordSnapshotFailure: jest.fn(async () => undefined) }));
jest.mock('./nativeOfflineCoverage', () => ({
  readNativeOfflineCoverage: jest.fn(async () => null),
  recordNativeOfflineCoverageSuccess: jest.fn(async () => true),
  recordNativeOfflineCoverageFailure: jest.fn(async () => true),
}));

function message(sequence: number, conversationId = 'c1'): ChatMessage {
  return {
    id: `${conversationId}-m${sequence}`,
    conversation_id: conversationId,
    conversation_seq: sequence,
    sender_user_id: 7,
    body_text: `synthetic-${sequence}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + sequence * 1000).toISOString(),
  };
}
const messages = (first: number, last: number, conversationId = 'c1') => (
  Array.from({ length: last - first + 1 }, (_, index) => message(first + index, conversationId))
);
function snapshot(items: ChatMessage[]): NativeChatThreadSnapshot {
  return { conversation: null, title: 'Synthetic chat', messages: items, hasOlder: false,
    olderCursor: null, hasNewer: false, newerCursor: null, unreadBoundaryId: null,
    focusAnchorId: null, pinnedMessageId: null };
}
function page(items: ChatMessage[]): Awaited<ReturnType<typeof getMessagesPage>> {
  return { items, has_older: true, has_newer: false,
    older_cursor_message_id: items[0]?.id || null, newer_cursor_message_id: null,
    viewer_last_read_message_id: null, cursor_invalid: false } as Awaited<ReturnType<typeof getMessagesPage>>;
}
function seed(items: ChatMessage[], userId = 7, conversationId = 'c1') {
  mockSnapshots.set(mockSnapshotKey('chat-thread-details', userId, conversationId), snapshot(items));
}
function stored(userId = 7, conversationId = 'c1') {
  const value = mockSnapshots.get(mockSnapshotKey('chat-thread-details', userId, conversationId));
  if (!value) throw new Error('Expected a persisted thread snapshot');
  return value;
}
function prepare() {
  return prepareNativeOfflineData({ userId: 7, isAdmin: false, chat: true,
    dashboard: false, feed: false, tasks: false, notifications: false, mail: false,
    docflow: false, addressBook: false, database: false, myFiles: false, companyStructure: false });
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  await waitForNativeChatThreadSnapshotWrites();
  bumpNativeChatThreadHistoryGeneration();
  mockSnapshots.clear();
  jest.clearAllMocks();
  jest.mocked(getConversationPage).mockResolvedValue({
    items: [{ id: 'c1', kind: 'direct', title: 'Synthetic chat' }], has_more: false, next_cursor: null,
  });
  jest.mocked(listChatFolders).mockResolvedValue({ items: [], conversation_ids_by_folder: {}, folder_unread_counts: {} });
  jest.mocked(getMessagesPage).mockReset();
  jest.mocked(getMessagesPage).mockResolvedValue(page(messages(421, 500)));
});

afterEach(async () => { await waitForNativeChatThreadSnapshotWrites(); });

it('keeps the newest 1500 messages, not the oldest, after overflow', () => {
  const actual = mergeNativeChatThreadHistory(messages(1, 1500), messages(1501, 1510), 7);
  expect(actual).toHaveLength(1500);
  expect(actual[0].conversation_seq).toBe(1510);
  expect(actual[1499].conversation_seq).toBe(11);
});

it('continues advancing the retained window on repeated arrivals', () => {
  let actual = messages(1, 1500);
  for (let sequence = 1501; sequence <= 1525; sequence += 1) {
    actual = mergeNativeChatThreadHistory(actual, [message(sequence)], 7);
  }
  expect(actual).toHaveLength(1500);
  expect(actual[0].conversation_seq).toBe(1525);
  expect(actual[1499].conversation_seq).toBe(26);
});

it('prepares an overlapping 80-message page without replacing 500 cached messages', async () => {
  seed(messages(1, 500));
  await prepare();
  expect(stored().messages).toHaveLength(500);
  expect(stored().messages.some((item) => item.conversation_seq === 1)).toBe(true);
});

it('adds a new preparation page to the previously visited pages', async () => {
  seed(messages(1, 500));
  jest.mocked(getMessagesPage).mockResolvedValue(page(messages(501, 580)));
  await prepare();
  expect(stored().messages).toHaveLength(580);
  expect(stored().messages[0].conversation_seq).toBe(580);
});

it('preserves older pages while applying a received deletion', async () => {
  seed(messages(1, 500));
  const incoming = messages(421, 500);
  incoming[0] = { ...incoming[0], is_deleted: true, body_text: '' };
  jest.mocked(getMessagesPage).mockResolvedValue(page(incoming));
  await prepare();
  expect(stored().messages).toHaveLength(500);
  expect(stored().messages.find((item) => item.conversation_seq === 421)?.is_deleted).toBe(true);
});

it('is idempotent across preparations and does not touch another user', async () => {
  seed(messages(1, 500));
  seed(messages(1, 9), 8);
  await prepare();
  await prepare();
  expect(stored().messages).toHaveLength(500);
  expect(new Set(stored().messages.map((item) => item.id)).size).toBe(500);
  expect(stored(8).messages).toHaveLength(9);
});

it('preserves the old history when the preparation request fails', async () => {
  seed(messages(1, 500));
  jest.mocked(getMessagesPage).mockRejectedValue(new Error('Synthetic network failure'));
  await prepare();
  expect(stored().messages).toHaveLength(500);
  expect(writeNativeEntitySnapshot).not.toHaveBeenCalled();
});

it('does not persist a preparation response received after logout invalidation', async () => {
  seed(messages(1, 500));
  const reached = deferred<void>();
  const response = deferred<Awaited<ReturnType<typeof getMessagesPage>>>();
  jest.mocked(getMessagesPage).mockImplementation(() => { reached.resolve(); return response.promise; });
  const operation = prepare();
  await reached.promise;
  bumpNativeChatThreadHistoryGeneration();
  response.resolve(page(messages(501, 580)));
  await operation;
  expect(writeNativeEntitySnapshot).not.toHaveBeenCalled();
  expect(stored().messages).toHaveLength(500);
});

it('keeps scheduled writes scoped to their own user and conversation', async () => {
  seed(messages(1, 10));
  seed(messages(1, 20, 'c2'), 7, 'c2');
  await scheduleNativeChatThreadSnapshotWrite(7, 'c1', snapshot(messages(11, 20)), { currentUserId: 7 });
  expect(stored().messages).toHaveLength(20);
  expect(stored(7, 'c2').messages).toHaveLength(20);
  expect(stored(7, 'c2').messages[0].conversation_id).toBe('c2');
});
