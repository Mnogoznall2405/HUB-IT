import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
let mockFileSequence = 0;
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `synthetic-outbox-file-${++mockFileSequence}` }));
import * as api from '../api/chatApi';
import type { ChatMessage } from '../api/types';
import { clearNativeChatOutbox, createNativeChatOutbox, subscribeNativeChatOutbox } from './nativeChatOutbox';

jest.mock('../api/chatApi', () => ({ sendTextMessage: jest.fn() }));
const send = jest.mocked(api.sendTextMessage);
const message: ChatMessage = { id: 'pending:one', client_message_id: 'one', conversation_id: 'chat-a', sender_user_id: 7, body_text: 'Привет', reply_preview: { id: 'reply-1', sender_name: 'Коллега' } };
beforeEach(async () => { await clearNativeChatOutbox(); send.mockReset(); });

it.each([
  { body_text: { synthetic: 'private text' } },
  { reply_preview: { id: 123, sender_name: 'Коллега' } },
  { reply_preview: 'broken reply' },
])('blocks damaged message fields before sending or overwriting the queue: %j', async (damage) => {
  const key = 'hubit_native_chat_outbox_v1';
  const raw = JSON.stringify([{ userId: 7, message: { ...message, ...damage } }]);
  await SecureStore.setItemAsync(key, raw);
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.read()).rejects.toThrow('Не удалось прочитать очередь');
  await expect(queue.send(message, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  expect(await SecureStore.getItemAsync(key)).toBe(raw);
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

it.each([{ files: 'invalid', body: '' }, { files: [null], body: '' }, { files: [], body: {} }])('rejects damaged uploads without sending or changing storage: %j', async (upload) => {
  const key = 'hubit_native_chat_outbox_v1';
  const raw = JSON.stringify([{ userId: 7, message, upload }]);
  await SecureStore.setItemAsync(key, raw);
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.readUploads()).rejects.toThrow('Не удалось прочитать очередь');
  await expect(queue.send(message, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  expect(await SecureStore.getItemAsync(key)).toBe(raw);
});

it.each([{ replyToMessageId: { id: 'm' } }, { replyPreview: { id: 123 } }, { durationSeconds: '5' }, { mediaKind: 'unknown' }])('preserves queued files with invalid upload metadata: %j', async (damage) => {
  const key = 'hubit_native_chat_outbox_v1';
  const raw = JSON.stringify([{ userId: 7, message, upload: { body: 'Подпись', files: [
    { uri: 'file:///synthetic.pdf', name: 'Файл.pdf', mimeType: 'application/pdf', size: 10 },
  ], ...damage } }]);
  await SecureStore.setItemAsync(key, raw);
  const queue = createNativeChatOutbox(7, 'chat-a');
  await expect(queue.readUploads()).rejects.toThrow('Не удалось прочитать очередь');
  await expect(queue.discard('one')).rejects.toThrow();
  expect(await SecureStore.getItemAsync(key)).toBe(raw);
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
