import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
let mockFileSequence = 0;
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `synthetic-outbox-file-${++mockFileSequence}` }));
import * as api from '../api/chatApi';
import type { ChatMessage } from '../api/types';
import { clearNativeChatOutbox, createNativeChatOutbox, getNativeChatOutboxRuntimeState,
  getNativeChatQueueState, readNativeChatOutbox, subscribeNativeChatOutbox } from './nativeChatOutbox';
import { resetNativeChatOutboxRowsCache } from './nativeChatStorageQueue';
import { getChatSendTimingSummary, markChatSend, resetChatSendTiming } from '../diagnostics/chatSendTiming';

jest.mock('../api/chatApi', () => ({ sendTextMessage: jest.fn() }));
const send = jest.mocked(api.sendTextMessage);
const message: ChatMessage = { id: 'pending:one', client_message_id: 'one', conversation_id: 'chat-a', sender_user_id: 7, body_text: 'Привет', reply_preview: { id: 'reply-1', sender_name: 'Коллега' } };
beforeEach(async () => { await clearNativeChatOutbox(); send.mockReset(); });

it.each([
  { body_text: { synthetic: 'private text' } },
  { reply_preview: { id: 123, sender_name: 'Коллега' } },
  { reply_preview: 'broken reply' },
])('drops a row with damaged message fields and repairs the queue: %j', async (damage) => {
  const key = 'hubit_native_chat_outbox_v1';
  await SecureStore.setItemAsync(key, JSON.stringify([{ userId: 7, message: { ...message, ...damage } }]));
  resetNativeChatOutboxRowsCache();
  const queue = createNativeChatOutbox(7, 'chat-a');
  // One unreadable row must not dead-lock the queue: it is dropped, the blob
  // is rewritten without it, and subsequent sends work again.
  await expect(queue.read()).resolves.toEqual([]);
  expect(await SecureStore.getItemAsync(key)).toBeNull();
  send.mockResolvedValueOnce({ ...message, id: 'server-one' });
  await expect(queue.send(message, send)).resolves.toMatchObject({ id: 'server-one' });
});

it('quarantines an unreadable blob and unblocks subsequent sends', async () => {
  const key = 'hubit_native_chat_outbox_v1';
  await SecureStore.setItemAsync(key, '{"synthetic-private-message": broken');
  resetNativeChatOutboxRowsCache();
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.read()).resolves.toEqual([]);
  // The payload is moved aside for support instead of being destroyed.
  const quarantine = jest.mocked(SecureStore.setItemAsync).mock.calls
    .find(([storedKey]) => storedKey.startsWith(`${key}_corrupt_`));
  expect(quarantine?.[1]).toBe('{"synthetic-private-message": broken');
  expect(await SecureStore.getItemAsync(key)).toBeNull();
  send.mockResolvedValueOnce({ ...message, id: 'server-one' });
  await expect(queue.send(message, send)).resolves.toMatchObject({ id: 'server-one' });
  expect(await queue.read()).toEqual([]);
});

it('keeps valid rows when a sibling row in the blob is damaged', async () => {
  const key = 'hubit_native_chat_outbox_v1';
  const second = { ...message, id: 'pending:two', client_message_id: 'two', conversation_id: 'chat-b' };
  await SecureStore.setItemAsync(key, JSON.stringify([
    { userId: 7, message },
    { userId: 7, message: { id: 'pending:broken' } },
    { userId: 7, message: second },
  ]));
  resetNativeChatOutboxRowsCache();
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.read()).resolves.toEqual([expect.objectContaining({ client_message_id: 'one' })]);
  const stored = JSON.parse(await SecureStore.getItemAsync(key) || '[]') as Array<{ message: ChatMessage }>;
  expect(stored.map((row) => row.message.client_message_id)).toEqual(['one', 'two']);
});

it('drops rows left by another account on the first read under the new user', async () => {
  const key = 'hubit_native_chat_outbox_v1';
  await SecureStore.setItemAsync(key, JSON.stringify([
    { userId: 7, message },
    { userId: 8, message: { ...message, id: 'pending:b1', client_message_id: 'b1', conversation_id: 'chat-b', sender_user_id: 8 } },
  ]));
  resetNativeChatOutboxRowsCache();
  await expect(createNativeChatOutbox(8, 'chat-b').read()).resolves.toHaveLength(1);
  const stored = JSON.parse(await SecureStore.getItemAsync(key) || '[]') as Array<{ userId: number }>;
  expect(stored).toEqual([expect.objectContaining({ userId: 8 })]);
  // The new user's own queue keeps working afterwards.
  send.mockResolvedValueOnce({ ...message, id: 'server-b1', sender_user_id: 8, client_message_id: 'b2' });
  await expect(createNativeChatOutbox(8, 'chat-b').send(
    { ...message, id: 'pending:b2', client_message_id: 'b2', conversation_id: 'chat-b', sender_user_id: 8 },
    send,
  )).resolves.toMatchObject({ id: 'server-b1' });
});

it('atomically replaces a rejected text reply with an unquoted message and prevents stale retry', async () => {
  send.mockRejectedValueOnce(new Error('Quoted message not found'));
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.send(message, send)).rejects.toThrow();
  const { message: replacement } = await queue.detachReply('one', 'unquoted');
  expect(await createNativeChatOutbox(7, 'chat-a').read()).toEqual([expect.objectContaining({
    client_message_id: 'unquoted', reply_preview: null, body_text: 'Привет', local_status: 'failed',
  })]);
  await expect(queue.send(message, send)).rejects.toThrow('убрано');
  send.mockResolvedValueOnce({ ...replacement, id: 'server-unquoted' });
  await queue.send(replacement, send);
  expect(send).toHaveBeenLastCalledWith('chat-a', 'Привет', { clientMessageId: 'unquoted', replyToMessageId: undefined });
});

it('preserves the old reply when replacement storage fails and allows a safe retry', async () => {
  send.mockRejectedValueOnce(new Error('Rejected'));
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.send(message, send)).rejects.toThrow();
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(queue.detachReply('one', 'unquoted')).rejects.toThrow('Storage unavailable');
  expect(await queue.read()).toEqual([expect.objectContaining({ client_message_id: 'one', reply_preview: message.reply_preview, body_text: 'Привет' })]);
  await expect(queue.detachReply('one', 'unquoted')).resolves.toMatchObject({ message: { client_message_id: 'unquoted' } });
});

it('does not replace a reply when access changes while storage is being read', async () => {
  send.mockRejectedValueOnce(new Error('Rejected'));
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.send(message, send)).rejects.toThrow();
  const raw = await SecureStore.getItemAsync('hubit_native_chat_outbox_v1');
  resetNativeChatOutboxRowsCache();
  let finish!: (value: string | null) => void;
  let allowed = true;
  jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const replacement = queue.detachReply('one', 'unquoted', () => allowed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  allowed = false;
  finish(raw);
  await expect(replacement).rejects.toThrow('Доступ к диалогу изменился');
  expect(await SecureStore.getItemAsync('hubit_native_chat_outbox_v1')).toBe(raw);
});

it.each([{ files: 'invalid', body: '' }, { files: [null], body: '' }, { files: [], body: {} }])('drops rows with damaged uploads and repairs the queue: %j', async (upload) => {
  const key = 'hubit_native_chat_outbox_v1';
  await SecureStore.setItemAsync(key, JSON.stringify([{ userId: 7, message, upload }]));
  resetNativeChatOutboxRowsCache();
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.readUploads()).resolves.toEqual([]);
  expect(await SecureStore.getItemAsync(key)).toBeNull();
  send.mockResolvedValueOnce({ ...message, id: 'server-one' });
  await expect(queue.send(message, send)).resolves.toMatchObject({ id: 'server-one' });
});

it.each([{ replyToMessageId: { id: 'm' } }, { replyPreview: { id: 123 } }, { durationSeconds: '5' }, { mediaKind: 'unknown' }])('drops rows with invalid upload metadata and keeps the queue usable: %j', async (damage) => {
  const key = 'hubit_native_chat_outbox_v1';
  await SecureStore.setItemAsync(key, JSON.stringify([{ userId: 7, message, upload: { body: 'Подпись', files: [
    { uri: 'file:///synthetic.pdf', name: 'Файл.pdf', mimeType: 'application/pdf', size: 10 },
  ], ...damage } }]));
  resetNativeChatOutboxRowsCache();
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.readUploads()).resolves.toEqual([]);
  expect(await SecureStore.getItemAsync(key)).toBeNull();
  await expect(queue.read()).resolves.toEqual([]);
});

it('rejects a message owned by another user before transport', async () => {
  await expect(createNativeChatOutbox(7, 'chat-a').send({ ...message, sender_user_id: 8 }, send)).rejects.toThrow('Некорректное исходящее сообщение');
  expect(send).not.toHaveBeenCalled();
});

it('keeps durable attachments and caption through failed and successful removal of a reply', async () => {
  const source = new File(Paths.cache, 'quoted-file');
  source.write('Синтетические байты');
  const queue = createNativeChatOutbox(7, 'chat-a');
  const durable = await queue.prepareUpload(message, { body: 'Подпись', replyToMessageId: 'reply-1', replyPreview: message.reply_preview,
    files: [{ uri: source.uri, name: 'Файл.txt', mimeType: 'text/plain', size: source.size, source: 'document' }] });
  queue.finishUpload('one');
  source.delete();
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(queue.detachReply('one', 'unquoted')).rejects.toThrow();
  expect((await queue.readUploads())[0].upload).toEqual(durable);
  expect(new File(durable.files[0].uri).exists).toBe(true);
  const replacement = await queue.detachReply('one', 'unquoted');
  expect(replacement.upload).toEqual({ ...durable, replyToMessageId: undefined, replyPreview: null });
  expect((await createNativeChatOutbox(7, 'chat-a').readUploads())[0]).toMatchObject({ id: 'unquoted', upload: { body: 'Подпись', files: durable.files } });
  expect(new File(durable.files[0].uri).exists).toBe(true);
});

it('does not turn a queued file upload into a text send under the same key', async () => {
  const source = new File(Paths.cache, 'typed-upload');
  source.write('Синтетическое вложение');
  const queue = createNativeChatOutbox(7, 'chat-a');
  await queue.prepareUpload(message, { body: message.body_text || '', files: [{ uri: source.uri, name: 'Файл.txt', mimeType: 'text/plain', size: source.size, source: 'document' }] });
  queue.finishUpload('one');
  expect((await queue.readUploads())[0].upload.files[0].uri).toBeTruthy();
  await expect(queue.send(message, send)).rejects.toThrow('Тип повторной отправки изменился');
  expect(send).not.toHaveBeenCalled();
  expect(await queue.readUploads()).toHaveLength(1);
});

it('does not turn a successful storage commit into a send failure when an observer throws', async () => {
  const unsubscribe = subscribeNativeChatOutbox(() => { throw new Error('Observer failed'); });
  const observer = jest.fn();
  const unsubscribeHealthy = subscribeNativeChatOutbox(observer);
  try {
    send.mockResolvedValueOnce({ ...message, id: 'server-one' });
    const queue = createNativeChatOutbox(7, 'chat-a');
    await expect(queue.send(message, send)).resolves.toMatchObject({ id: 'server-one' });
    expect(await queue.read()).toEqual([]);
    expect(observer).toHaveBeenCalled();
  } finally { unsubscribe(); unsubscribeHealthy(); }
});

it('persists before transport and restores a failed send in a new session with the same id', async () => {
  send.mockRejectedValueOnce(new Error('Network timeout'));
  await expect(createNativeChatOutbox(7, 'chat-a').send(message, send)).rejects.toThrow();
  const restored = createNativeChatOutbox(7, 'chat-a');
  expect(await restored.read()).toEqual([{ ...message, local_status: 'failed' }]);
  expect(await createNativeChatOutbox(8, 'chat-a').read()).toEqual([]);
  send.mockImplementationOnce(async () => {
    expect(await restored.read()).toHaveLength(1);
    return { ...message, id: 'server-one' };
  });
  await restored.send(message, send);
  expect(send).toHaveBeenLastCalledWith('chat-a', 'Привет', { clientMessageId: 'one', replyToMessageId: 'reply-1' });
  expect(await restored.read()).toEqual([]);
});

it('does not send or overwrite the queue when storage cannot be read', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Unavailable'));
  resetNativeChatOutboxRowsCache();
  await expect(createNativeChatOutbox(7, 'chat-a').send(message, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it('deduplicates concurrent retries across screen sessions', async () => {
  let done!: (value: ChatMessage) => void;
  send.mockReturnValue(new Promise((resolve) => { done = resolve; }));
  const first = createNativeChatOutbox(7, 'chat-a').send(message, send);
  const second = createNativeChatOutbox(7, 'chat-a').send(message, send);
  expect(second).toBe(first);
  await new Promise((resolve) => setTimeout(resolve, 0));
  done({ ...message, id: 'server-one' });
  await first;
  expect(send).toHaveBeenCalledTimes(1);
});

it('keeps an acknowledged send successful when local cleanup fails', async () => {
  send.mockImplementationOnce(async () => {
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Storage failure'));
    return { ...message, id: 'server-one' };
  });
  await expect(createNativeChatOutbox(7, 'chat-a').send(message, send)).resolves.toMatchObject({ id: 'server-one' });
  expect(await createNativeChatOutbox(7, 'chat-a').read()).toHaveLength(1);
});

it('invalidates old sessions on logout and prevents a queued operation from sending', async () => {
  const old = createNativeChatOutbox(7, 'chat-a');
  await clearNativeChatOutbox();
  await expect(old.send(message, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it('restores an upload and its preview from a durable copy after cache removal', async () => {
  const source = new File(Paths.cache, 'upload.txt');
  source.write('Вложение');
  const file = { uri: source.uri, name: 'upload.txt', mimeType: 'text/plain', size: source.size, source: 'document' as const };
  const pending = { ...message, attachments: [{ id: 'attachment-1', file_name: file.name, local_uri: file.uri }] };
  await createNativeChatOutbox(7, 'chat-a').prepareUpload(pending, { files: [file], body: 'Подпись' });
  source.delete();
  const restored = createNativeChatOutbox(7, 'chat-a');
  const [{ upload, id }] = await restored.readUploads();
  expect(id).toBe('one');
  expect(await new File(upload.files[0].uri).text()).toBe('Вложение');
  expect((await restored.read())[0].attachments?.[0].local_uri).toBe(upload.files[0].uri);
  await restored.completeUpload(id);
  expect(await restored.readUploads()).toEqual([]);
});

it('never projects a visible failure while queue() is still preparing the entry', async () => {
  // The UI renders the failure badge only for local_status 'failed'
  // without a queue state. A delivery-less entry flashes that state between the
  // initial persist and the delivery-metadata commit unless busy hides it.
  const queue = createNativeChatOutbox(7, 'chat-a');
  const frames: Array<{ status?: string; queue?: string }> = [];
  const unsubscribe = subscribeNativeChatOutbox(() => {
    void queue.read().then((rows) => {
      rows.forEach((row) => frames.push({
        status: row.local_status,
        queue: getNativeChatQueueState(row) || undefined,
      }));
    }).catch(() => undefined);
  });
  try {
    await queue.queue(message);
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    unsubscribe();
  }
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter((frame) => frame.status === 'failed' && !frame.queue)).toEqual([]);
  expect(frames.at(-1)).toEqual({ status: 'failed', queue: 'queued' });
});

it('queues for later delivery without calling the network send', async () => {
  const queue = createNativeChatOutbox(7, 'chat-a');
  const saved = await queue.send(message, send, undefined, { deliver: false });
  expect(send).not.toHaveBeenCalled();
  expect(saved.local_status).toBe('failed');
  expect(await queue.read()).toEqual([expect.objectContaining({
    client_message_id: 'one',
    local_status: 'failed',
  })]);
  const restored = createNativeChatOutbox(7, 'chat-a');
  expect(await restored.read()).toHaveLength(1);
  send.mockResolvedValueOnce({ ...message, id: 'server-one', local_status: undefined });
  await expect(restored.send(message, send)).resolves.toMatchObject({ id: 'server-one' });
  expect(send).toHaveBeenCalledTimes(1);
});

it('reconciles a lost acknowledgement only with an own server message in the same conversation', async () => {
  send.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  const outbox = createNativeChatOutbox(7, 'chat-a');
  await expect(outbox.send(message, send)).rejects.toThrow();
  await outbox.acknowledge([{ ...message, sender_user_id: 8 }]);
  expect(await outbox.read()).toHaveLength(1);
  await outbox.acknowledge([{ ...message, id: 'server-one' }]);
  expect(await outbox.read()).toEqual([]);
});

it('discards a failed entry durably and rejects a late retry from another screen', async () => {
  send.mockRejectedValueOnce(new Error('Network'));
  const session = createNativeChatOutbox(7, 'chat-a');
  await expect(session.send(message, send)).rejects.toThrow();
  await session.discard('one');
  expect(await createNativeChatOutbox(7, 'chat-a').read()).toEqual([]);
  await expect(createNativeChatOutbox(7, 'chat-a').send(message, send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});

it('keeps an entry when discard storage fails and allows another discard attempt', async () => {
  send.mockRejectedValueOnce(new Error('Network'));
  const session = createNativeChatOutbox(7, 'chat-a');
  await expect(session.send(message, send)).rejects.toThrow();
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Storage'));
  await expect(session.discard('one')).rejects.toThrow();
  expect(await session.read()).toHaveLength(1);
  await session.discard('one');
  expect(await session.read()).toEqual([]);
});

it('rejects discard while transport is active', async () => {
  let done!: (value: ChatMessage) => void;
  send.mockReturnValue(new Promise((resolve) => { done = resolve; }));
  const session = createNativeChatOutbox(7, 'chat-a');
  const pending = session.send(message, send);
  await expect(session.discard('one')).rejects.toThrow('Дождитесь');
  await new Promise((resolve) => setTimeout(resolve, 0));
  done({ ...message, id: 'server-one' });
  await pending;
});

it('does not write queue metadata or allow transport until deferred File.copy settles', async () => {
  const source = new File(Paths.cache, 'deferred-outbox');
  source.write('Отложенная копия');
  const file = {
    uri: source.uri,
    name: 'upload.txt',
    mimeType: 'text/plain',
    size: source.size,
    source: 'document' as const,
  };
  let releaseCopy!: () => void;
  const gate = new Promise<void>((resolve) => { releaseCopy = resolve; });
  const originalCopy = File.prototype.copy;
  const copySpy = jest.spyOn(File.prototype, 'copy').mockImplementation(function (this: File, destination) {
    return gate.then(async () => {
      await originalCopy.call(this, destination);
    });
  });
  const setItem = jest.mocked(SecureStore.setItemAsync);
  const writesBeforeRelease = setItem.mock.calls.length;

  try {
    const queue = createNativeChatOutbox(7, 'chat-a');
    const pending = queue.prepareUpload(message, { files: [file], body: 'Подпись' });
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(setItem.mock.calls.length).toBe(writesBeforeRelease);
    expect(await SecureStore.getItemAsync('hubit_native_chat_outbox_v1')).toBeNull();

    releaseCopy();
    const durable = await pending;
    queue.finishUpload('one');
    expect(settled).toBe(true);
    expect(durable.files[0].uri).not.toBe(source.uri);
    expect(await new File(durable.files[0].uri).text()).toBe('Отложенная копия');
    expect(await SecureStore.getItemAsync('hubit_native_chat_outbox_v1')).toContain(durable.files[0].uri);
  } finally {
    copySpy.mockRestore();
  }
});

it('does not start network upload when durable copy fails asynchronously', async () => {
  const source = new File(Paths.cache, 'outbox-copy-fail');
  source.write('Исходник');
  const file = {
    uri: source.uri,
    name: 'upload.txt',
    mimeType: 'text/plain',
    size: source.size,
    source: 'document' as const,
  };
  const copySpy = jest.spyOn(File.prototype, 'copy').mockImplementation(() => (
    Promise.reject(new Error('synthetic copy failure'))
  ));
  try {
    const queue = createNativeChatOutbox(7, 'chat-a');
    await expect(queue.prepareUpload(message, { files: [file], body: 'Подпись' })).rejects.toThrow(
      'Не удалось сохранить вложение на устройстве',
    );
    expect(await SecureStore.getItemAsync('hubit_native_chat_outbox_v1')).toBeNull();
    expect(source.exists).toBe(true);
    expect(send).not.toHaveBeenCalled();
  } finally {
    copySpy.mockRestore();
  }
});

it('rejects a late prepareUpload after logout without resurrecting the previous session', async () => {
  const source = new File(Paths.cache, 'logout-during-copy');
  source.write('Сессия завершена');
  const file = {
    uri: source.uri,
    name: 'upload.txt',
    mimeType: 'text/plain',
    size: source.size,
    source: 'document' as const,
  };
  let releaseCopy!: () => void;
  const gate = new Promise<void>((resolve) => { releaseCopy = resolve; });
  const originalCopy = File.prototype.copy;
  const copySpy = jest.spyOn(File.prototype, 'copy').mockImplementation(function (this: File, destination) {
    return gate.then(async () => {
      await originalCopy.call(this, destination);
    });
  });

  try {
    const old = createNativeChatOutbox(7, 'chat-a');
    const pending = old.prepareUpload(message, { files: [file], body: 'Подпись' });
    await clearNativeChatOutbox();
    releaseCopy();
    await expect(pending).rejects.toThrow('Сеанс очереди сообщений завершён');
    expect(await SecureStore.getItemAsync('hubit_native_chat_outbox_v1')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  } finally {
    copySpy.mockRestore();
  }
});

it('records send-path marks and storage timings without message content', async () => {
  resetChatSendTiming();
  resetNativeChatOutboxRowsCache();
  const queue = createNativeChatOutbox(7, 'chat-a');
  markChatSend('one', 'tap_send');
  await queue.queue(message);
  await queue.deliverQueued('one', async (row) => ({ ...row.message, id: 'server-one', local_status: undefined }),
    () => true, async () => true);
  const summary = getChatSendTimingSummary();
  expect(summary.sends).toBe(1);
  expect(summary.intervals.tap_to_outbox_persisted.count).toBe(1);
  expect(summary.intervals.tap_to_http_start.count).toBe(1);
  expect(summary.intervals.tap_to_ack.count).toBe(1);
  expect(summary.intervals.tap_to_ui_confirmed.count).toBe(1);
  expect(summary.storageOps.read.count).toBeGreaterThan(0);
  expect(summary.storageOps.write.count).toBeGreaterThan(0);
  const encoded = JSON.stringify(summary);
  expect(encoded).not.toContain('Привет');
  expect(encoded).not.toContain('body_text');
  expect(encoded).not.toContain('one');
});

it('reuses the same queued client id on prepareUpload retry without creating a second row', async () => {
  const source = new File(Paths.cache, 'retry-same-id');
  source.write('Повтор');
  const file = {
    uri: source.uri,
    name: 'upload.txt',
    mimeType: 'text/plain',
    size: source.size,
    source: 'document' as const,
  };
  const queue = createNativeChatOutbox(7, 'chat-a');
  const first = await queue.prepareUpload(message, { files: [file], body: 'Подпись' });
  queue.finishUpload('one');
  const second = await queue.prepareUpload(message, { files: [file], body: 'Подпись' });
  queue.finishUpload('one');
  expect(second).toEqual(first);
  expect(await queue.readUploads()).toHaveLength(1);
  expect((await queue.readUploads())[0].id).toBe('one');
});

it('persists the resumable upload session id on the durable row mid-transport', async () => {
  const source = new File(Paths.cache, 'session-id-persist');
  source.write('Данные для сессии');
  const file = {
    uri: source.uri,
    name: 'upload.txt',
    mimeType: 'text/plain',
    size: source.size,
    source: 'document' as const,
  };
  const queue = createNativeChatOutbox(7, 'chat-a');
  await queue.queue(message, { files: [file], body: 'Подпись' });
  await queue.deliverQueued('one', async (row, _signal, helpers) => {
    await helpers.patchUpload({ sessionId: 'sess-9' });
    return { ...row.message, id: 'server-one', local_status: undefined };
  }, () => true, async () => false);
  const stored = (await queue.readUploads()).find((item) => item.id === 'one');
  expect(stored?.upload.sessionId).toBe('sess-9');
  const raw = JSON.parse((await SecureStore.getItemAsync('hubit_native_chat_outbox_v1')) || '[]');
  expect(raw[0]?.upload?.sessionId).toBe('sess-9');
});

it('stamps fresh queued delivery on the detached replacement so the runner keeps it deliverable', async () => {
  send.mockRejectedValueOnce(new Error('Quoted message not found'));
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.send(message, send)).rejects.toThrow();
  await queue.detachReply('one', 'unquoted');
  const [entry] = await readNativeChatOutbox(7);
  expect(entry.message.client_message_id).toBe('unquoted');
  expect(entry.delivery).toEqual({ version: 1, state: 'queued', attempts: 0, notBefore: 0 });
});

it('keeps the replacement queued metadata when the delivery stamp write fails', async () => {
  send.mockRejectedValueOnce(new Error('Quoted message not found'));
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.send(message, send)).rejects.toThrow();
  await queue.detachReply('one', 'unquoted');
  // A retryDelivery failure later must still leave the row deliverable: the
  // delivery field is never wiped by detachReply.
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Storage'));
  await expect(queue.retryDelivery('unquoted')).rejects.toThrow();
  const [entry] = await readNativeChatOutbox(7);
  expect(entry.delivery?.state).toBe('queued');
});

it('clears cancelled bookkeeping after discards, including a failed one', async () => {
  send.mockRejectedValue(new Error('Network'));
  const session = createNativeChatOutbox(7, 'chat-a');
  await expect(session.send(message, send)).rejects.toThrow();
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Storage'));
  await expect(session.discard('one')).rejects.toThrow();
  await session.discard('one');
  const second = { ...message, id: 'pending:two', client_message_id: 'two' };
  await expect(session.send(second, send)).rejects.toThrow();
  await session.discard('two');
  expect(getNativeChatOutboxRuntimeState().cancelled).toBe(0);
});
