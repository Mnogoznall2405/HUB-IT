import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import type { ChatMessage } from '../api/types';
import * as api from '../api/chatApi';
import {
  clearAllNativeChatDrafts,
  clearNativeChatDraft,
  getNativeChatDraft,
  getNativeChatDraftState,
  setNativeChatDraft,
} from './chatDrafts';
import { clearNativeChatOutbox, createNativeChatOutbox } from './nativeChatOutbox';
import { deleteUnreferencedChatFiles } from './nativeChatDraftFiles';
import {
  CHAT_DRAFT_STORAGE_KEY,
  CHAT_OUTBOX_STORAGE_KEY,
  enqueueNativeChatStorage,
} from './nativeChatStorageQueue';

jest.mock('../api/chatApi', () => ({ sendTextMessage: jest.fn() }));

const send = jest.mocked(api.sendTextMessage);
const message: ChatMessage = {
  id: 'pending:one', client_message_id: 'one', conversation_id: 'chat-a',
  sender_user_id: 7, body_text: 'Привет',
};

const setItem = jest.mocked(SecureStore.setItemAsync);
const originalSetItem = setItem.getMockImplementation()!;

/** Occupy the serialized queue so later enqueues stay pending until released. */
function holdQueue() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocker = enqueueNativeChatStorage(() => gate);
  return { blocker, release };
}

function recordWrites() {
  const writes: string[] = [];
  setItem.mockImplementation(async (key: string, value: string) => {
    writes.push(key);
    return originalSetItem(key, value);
  });
  return writes;
}

beforeEach(async () => {
  await clearNativeChatOutbox();
  await clearAllNativeChatDrafts();
  send.mockReset();
});
afterEach(() => {
  setItem.mockImplementation(originalSetItem);
});

it('starts the outbox write of a send without waiting for a queued draft write', async () => {
  const { blocker, release } = holdQueue();
  const writes = recordWrites();
  const draft = setNativeChatDraft(7, 'chat-a', 'Черновик, который ещё пишется');
  const queue = createNativeChatOutbox(7, 'chat-a');
  const sending = queue.send(message, send, undefined, { deliver: false });
  release();
  await Promise.all([blocker, draft, sending]);
  expect(writes).toEqual([CHAT_OUTBOX_STORAGE_KEY, CHAT_DRAFT_STORAGE_KEY]);
  expect(send).not.toHaveBeenCalled();
  expect(await queue.read()).toHaveLength(1);
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Черновик, который ещё пишется');
});

it('lets an in-flight draft write finish, then overtakes the next queued draft', async () => {
  const order: string[] = [];
  let releaseDraft!: () => void;
  const gate = new Promise<void>((resolve) => { releaseDraft = resolve; });
  setItem.mockImplementation(async (key: string, value: string) => {
    order.push(key);
    if (key === CHAT_DRAFT_STORAGE_KEY) await gate;
    return originalSetItem(key, value);
  });
  // The first draft owns the queue and is slow inside SecureStore; it cannot be preempted.
  const first = setNativeChatDraft(7, 'chat-a', 'Первая версия');
  // A newer draft revision and an outbox commit both land while it still writes.
  const second = setNativeChatDraft(7, 'chat-a', 'Вторая версия');
  const sending = createNativeChatOutbox(7, 'chat-a').send(message, send, undefined, { deliver: false });
  releaseDraft();
  await Promise.all([first, second, sending]);
  expect(order).toEqual([CHAT_DRAFT_STORAGE_KEY, CHAT_OUTBOX_STORAGE_KEY, CHAT_DRAFT_STORAGE_KEY]);
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Вторая версия');
});

it('coalesces queued writes of the same draft so only the latest version is stored', async () => {
  const { blocker, release } = holdQueue();
  const draftWrites: string[] = [];
  setItem.mockImplementation(async (key: string, value: string) => {
    if (key === CHAT_DRAFT_STORAGE_KEY) draftWrites.push(value);
    return originalSetItem(key, value);
  });
  const first = setNativeChatDraft(7, 'chat-a', 'Первая версия');
  const second = setNativeChatDraft(7, 'chat-a', 'Последняя версия');
  const other = setNativeChatDraft(7, 'chat-b', 'Другой диалог');
  release();
  await Promise.all([blocker, first, second, other]);
  expect(draftWrites).toHaveLength(2);
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Последняя версия');
  expect(await getNativeChatDraft(7, 'chat-b')).toBe('Другой диалог');
});

it('keeps the attachments of a queued draft when a file check overtakes its commit', async () => {
  const directory = new Directory(Paths.document, 'hubit-chat-draft-files', '7');
  directory.create({ intermediates: true, idempotent: true });
  const durable = new File(directory, 'queued-attachment');
  durable.write('Вложение ожидающего черновика');
  const picked = {
    uri: durable.uri, name: 'Файл.txt', mimeType: 'text/plain', size: durable.size, source: 'document' as const,
  };

  const { blocker, release } = holdQueue();
  let draftCommitted = true;
  const draft = setNativeChatDraft(7, 'chat-a', 'Подпись', { files: [picked] });
  const deletion = enqueueNativeChatStorage(async () => {
    // This check shares the storage ordering with the draft commit: at this
    // point the queued draft is not durable yet, so its references must be
    // protected the same way an already-written draft would be.
    draftCommitted = Boolean((await SecureStore.getItemAsync(CHAT_DRAFT_STORAGE_KEY))?.includes('queued-attachment'));
    await deleteUnreferencedChatFiles([durable.uri]);
  });
  release();
  await Promise.all([blocker, draft, deletion]);
  expect(draftCommitted).toBe(false);
  expect(new File(durable.uri).exists).toBe(true);
  expect((await getNativeChatDraftState(7, 'chat-a'))?.context?.files?.[0]?.uri).toBe(durable.uri);

  await clearNativeChatDraft(7, 'chat-a');
  await enqueueNativeChatStorage(() => deleteUnreferencedChatFiles([durable.uri]));
  expect(new File(durable.uri).exists).toBe(false);
});
