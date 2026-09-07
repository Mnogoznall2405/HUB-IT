import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
let mockSequence = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `mail-file-${++mockSequence}` }));
import { clearMailComposeDrafts, createMailComposeDraftSession, type MailComposeLocalDraft } from './nativeMailComposeDrafts';

const scope = { userId: 7, mailboxId: 'box', sourceId: 'reply-target', mode: 'reply' };
const state: MailComposeLocalDraft = {
  draftId: '', to: 'synthetic@example.test', cc: '', bcc: '', subject: 'Тема', body: 'Текст',
  quoteHtml: '<p>Цитата</p>', replyToMessageId: 'reply-target', forwardMessageId: '', retainedAttachments: [], files: [],
};
beforeEach(async () => { await clearMailComposeDrafts(); });

it('restores all fields in a new session without crossing user or mailbox boundaries', async () => {
  await createMailComposeDraftSession(scope).write(state);
  expect(await createMailComposeDraftSession(scope).read()).toEqual(state);
  expect(await createMailComposeDraftSession({ ...scope, userId: 8 }).read()).toBeNull();
  expect(await createMailComposeDraftSession({ ...scope, mailboxId: 'other' }).read()).toBeNull();
});

it('preserves a private attachment copy after the temporary picker file is removed', async () => {
  const source = new File(Paths.cache, 'mail-fixture'); source.write('Вложение');
  const saved = await createMailComposeDraftSession(scope).write({ ...state, files: [{ uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain' }] });
  source.delete();
  const restored = await createMailComposeDraftSession(scope).read();
  expect(restored?.files[0].uri).toBe(saved.files[0].uri);
  expect(await new File(saved.files[0].uri).text()).toBe('Вложение');
});

it('captures queued revisions immediately and persists the last submitted revision', async () => {
  const session = createMailComposeDraftSession(scope);
  const mutable = { ...state, body: 'Первая' };
  const first = session.write(mutable); mutable.body = 'Вторая';
  const second = session.write(mutable); mutable.body = 'Не отправлена на сохранение';
  expect((await first).body).toBe('Первая'); await second;
  expect((await session.read())?.body).toBe('Вторая');
});

it('replaces a truncated cached attachment from the intact picker original', async () => {
  const source = new File(Paths.cache, 'mail-truncated-copy'); source.write('Attachment contents');
  const session = createMailComposeDraftSession(scope);
  const draft = { ...state, files: [{ uri: source.uri, name: 'file.txt', size: source.size, mimeType: 'text/plain' }] };
  const first = await session.write(draft);
  new File(first.files[0].uri).write('x');
  const second = await session.write(draft);
  expect(second.files[0].uri).not.toBe(first.files[0].uri);
  expect(await new File(second.files[0].uri).text()).toBe('Attachment contents');
});

it('rejects a truncated restored attachment before preparing a send and preserves the stored draft', async () => {
  const source = new File(Paths.cache, 'mail-restored-corruption'); source.write('Attachment contents');
  const session = createMailComposeDraftSession(scope);
  const saved = await session.write({ ...state, files: [{ uri: source.uri, name: 'file.txt', size: source.size, mimeType: 'text/plain' }] });
  source.delete();
  new File(saved.files[0].uri).write('x');
  await expect(session.prepareSend(saved, () => 'synthetic-attempt')).rejects.toThrow('Размер вложения изменился');
  expect(await createMailComposeDraftSession(scope).read()).toEqual(saved);
});

it('preserves the previous revision on quota or storage failure', async () => {
  const session = createMailComposeDraftSession(scope); await session.write(state);
  await expect(session.write({ ...state, body: 'я'.repeat(270000) })).rejects.toThrow();
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Synthetic storage error'));
  await expect(session.write({ ...state, body: 'Новая' })).rejects.toThrow();
  expect(await session.read()).toEqual(state);
});

it('does not replace malformed stored drafts and invalidates writers on cleanup', async () => {
  const session = createMailComposeDraftSession(scope);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('{ invalid');
  await expect(session.write(state)).rejects.toThrow('Не удалось прочитать');
  await clearMailComposeDrafts();
  await expect(session.write(state)).rejects.toThrow('Сессия черновика завершена');
  expect(await createMailComposeDraftSession(scope).read()).toBeNull();
});

it('allows edits and another clear after a failed discard, without reviving a closed session', async () => {
  const session = createMailComposeDraftSession(scope);
  await session.write(state);
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Synthetic failure'));
  await expect(session.clear()).rejects.toThrow('Synthetic failure');
  await session.write({ ...state, body: 'После ошибки' });
  expect((await session.read())?.body).toBe('После ошибки');
  await session.clear();
  expect(await createMailComposeDraftSession(scope).read()).toBeNull();
  await expect(session.write(state)).rejects.toThrow('Сессия черновика завершена');
});

it('preserves a newer editor revision when an old send clears its local draft', async () => {
  const old = createMailComposeDraftSession(scope);
  await old.write(state);
  const newer = createMailComposeDraftSession(scope);
  await newer.read();
  await newer.write({ ...state, body: 'Новое письмо' });
  await old.clear();
  expect((await createMailComposeDraftSession(scope).read())?.body).toBe('Новое письмо');
  await newer.clear();
  expect(await createMailComposeDraftSession(scope).read()).toBeNull();
});

it('restores the same send key after reopening and rejects an altered uncertain attempt', async () => {
  const first = createMailComposeDraftSession(scope);
  const prepared = await first.prepareSend(state, () => 'synthetic-send-key');
  expect(prepared.retry).toBe(false);
  const next = createMailComposeDraftSession(scope);
  const restored = await next.read();
  const retry = await next.prepareSend(restored!, () => 'must-not-be-used');
  expect(retry.sendAttempt?.key).toBe('synthetic-send-key');
  expect(retry.retry).toBe(true);
  await next.write({ ...state, body: 'Другая версия' });
  await expect(next.prepareSend({ ...state, body: 'Другая версия' }, () => 'new-key-unused')).rejects.toThrow('Предыдущая отправка');
});

it('hides a sent draft even if deleting it fails, and permits a new identical letter', async () => {
  const session = createMailComposeDraftSession(scope);
  await session.prepareSend(state, () => 'synthetic-sent-key');
  await session.completeSend('synthetic-sent-key');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Synthetic deletion failure'));
  await expect(session.clear()).rejects.toThrow();
  const next = createMailComposeDraftSession(scope);
  expect(await next.read()).toBeNull();
  const fresh = await next.prepareSend(state, () => 'new-identical-letter');
  expect(fresh.retry).toBe(false);
  expect(fresh.sendAttempt?.key).toBe('new-identical-letter');
});

it('preserves newer edits when an older send is acknowledged', async () => {
  const old = createMailComposeDraftSession(scope);
  await old.prepareSend(state, () => 'synthetic-old-key');
  const newer = createMailComposeDraftSession(scope);
  await newer.read(); await newer.write({ ...state, body: 'Следующее письмо' });
  await old.completeSend('synthetic-old-key'); await old.clear();
  expect((await newer.read())?.body).toBe('Следующее письмо');
  const fresh = await newer.prepareSend({ ...state, body: 'Следующее письмо' }, () => 'synthetic-new-key');
  expect(fresh.retry).toBe(false);
});

it('does not return a send key when durable preparation fails', async () => {
  const session = createMailComposeDraftSession(scope);
  await session.write(state);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Synthetic write failure'));
  await expect(session.prepareSend(state, () => 'synthetic-key-unused')).rejects.toThrow();
  expect(await session.read()).toEqual(state);
});

it('records a compact fingerprint without duplicating a large letter in the quota', async () => {
  const session = createMailComposeDraftSession(scope);
  const large = { ...state, body: 'Я'.repeat(150000) };
  const prepared = await session.prepareSend(large, () => 'synthetic-large-key');
  expect(prepared.sendAttempt?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await session.read())?.body).toBe(large.body);
});
