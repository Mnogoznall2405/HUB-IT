import * as SecureStore from 'expo-secure-store';
import { clearMailQuickReplyDrafts, createMailQuickReplyDraftSession } from './mailQuickReplyDrafts';

const scope = { userId: 1, mailboxId: 'box', kind: 'message' as const, entityId: 'message' };
const values = new Map<string, string>();
beforeEach(async () => {
  jest.mocked(SecureStore.getItemAsync).mockReset();
  jest.mocked(SecureStore.setItemAsync).mockReset();
  jest.mocked(SecureStore.deleteItemAsync).mockReset();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { values.delete(key); });
  await clearMailQuickReplyDrafts();
});
afterEach(() => { jest.restoreAllMocks(); });

it('restores a pending attempt with the same key and rejects changed recipients or content', async () => {
  const payload = { to: ['synthetic@example.invalid'], body: 'Ответ на кириллице' };
  const first = await createMailQuickReplyDraftSession(scope).prepareSend('Ответ', payload, () => 'synthetic-key-001');
  expect(first.retry).toBeFalsy();
  const restored = createMailQuickReplyDraftSession(scope);
  expect(await restored.readPendingKey()).toBeTruthy();
  expect(await restored.read()).toBe('Ответ');
  expect(await restored.prepareSend('Ответ', payload, () => 'must-not-use')).toEqual({ key: first.key, retry: true });
  await expect(restored.prepareSend('Ответ', { ...payload, to: ['other@example.invalid'] }, () => 'new-key')).rejects.toThrow('Состав ответа изменился');
  await expect(restored.write('Изменённый ответ')).rejects.toThrow('Сначала проверьте');
  await expect(restored.clearIfText('Ответ')).rejects.toThrow('Сначала проверьте');
});

it('does not acknowledge preparation when secure storage fails', async () => {
  const session = createMailQuickReplyDraftSession(scope);
  await session.write('Сохранённый ответ');
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Synthetic failure'));
  await expect(session.prepareSend('Сохранённый ответ', { body: 'body' }, () => 'synthetic-key')).rejects.toThrow();
  expect(await session.readPendingKey()).toBeFalsy();
  expect(await session.read()).toBe('Сохранённый ответ');
});

it('persists sent status without depending on deletion and does not revive its text', async () => {
  const session = createMailQuickReplyDraftSession(scope);
  const attempt = await session.prepareSend('Отправлено', { body: 'text' }, () => 'synthetic-key');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Synthetic delete failure'));
  await session.completeSend(attempt.key);
  expect([...values.values()].join('')).not.toContain('Отправлено');
  const restored = createMailQuickReplyDraftSession(scope);
  expect(await restored.read()).toBe('');
  expect(await restored.readPendingKey()).toBeFalsy();
  await restored.write('Новый ответ');
  expect(await restored.read()).toBe('Новый ответ');
});

it('rejects a stale retry confirmation after the user resolves the attempt', async () => {
  const session = createMailQuickReplyDraftSession(scope);
  const attempt = await session.prepareSend('Ответ', { body: 'text' }, () => 'synthetic-key');
  await session.resolvePending(false, attempt.key);
  expect(await session.read()).toBe('Ответ');
  await expect(session.prepareSend('Ответ', { body: 'text' }, () => 'new-key-001', attempt.key)).rejects.toThrow('уже завершена');
  const next = await session.prepareSend('Ответ', { body: 'text' }, () => 'new-key-001');
  await session.completeSend(attempt.key);
  expect(await session.readPendingKey()).toBeTruthy();
  await session.completeSend(next.key);
  expect(await session.readPendingKey()).toBeFalsy();
});

it('serializes parallel preparations and stores large text without duplicating the payload', async () => {
  const text = 'я'.repeat(150_000);
  const session = createMailQuickReplyDraftSession(scope);
  const attempts = await Promise.all([
    session.prepareSend(text, { body: text }, () => 'synthetic-key-001'),
    session.prepareSend(text, { body: text }, () => 'synthetic-key-002'),
  ]);
  expect(attempts).toEqual([{ key: 'synthetic-key-001', retry: false }, { key: 'synthetic-key-001', retry: true }]);
  expect(await session.read()).toBe(text);
  await session.resolvePending(true, 'synthetic-key-001');
  expect(await session.read()).toBe('');
});

it('restores Cyrillic text in a new session and isolates users, mailboxes and entity kinds', async () => {
  await createMailQuickReplyDraftSession(scope).write('Кириллица\nНовая строка');
  expect(await createMailQuickReplyDraftSession(scope).read()).toBe('Кириллица\nНовая строка');
  for (const other of [{ ...scope, userId: 2 }, { ...scope, mailboxId: 'other' }, { ...scope, kind: 'conversation' as const }]) {
    expect(await createMailQuickReplyDraftSession(other).read()).toBe('');
  }
});

it('serializes independent writes and removes only the cleared draft', async () => {
  const first = createMailQuickReplyDraftSession(scope);
  const second = createMailQuickReplyDraftSession({ ...scope, entityId: 'second' });
  await Promise.all([first.write('Первый'), second.write('Второй')]);
  await first.write('');
  expect(await second.read()).toBe('Второй');
  expect(await first.read()).toBe('');
});

it('does not erase newer source edits after an older transfer is saved', async () => {
  const session = createMailQuickReplyDraftSession(scope);
  await session.write('Передано');
  await session.write('Новая правка');
  await session.clearIfText('Передано');
  expect(await session.read()).toBe('Новая правка');
  await session.clearIfText('Новая правка');
  expect(await session.read()).toBe('');
});

it('does not replace good data when reading fails or a new write exceeds the budget', async () => {
  const session = createMailQuickReplyDraftSession(scope);
  await session.write('Сохранено');
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Synthetic storage failure'));
  await expect(session.write('Новая версия')).rejects.toThrow();
  await expect(session.write('я'.repeat(262_144))).rejects.toThrow('Недостаточно места');
  expect(await session.read()).toBe('Сохранено');
});

it('invalidates old writers before clearing, so a late callback cannot restore a logged-out draft', async () => {
  const session = createMailQuickReplyDraftSession(scope);
  await session.write('Прежний пользователь');
  const pending = session.write('Поздняя запись');
  const clear = clearMailQuickReplyDrafts();
  await expect(pending).rejects.toThrow('Сессия черновика завершена');
  await clear;
  await expect(session.write('Ещё позже')).rejects.toThrow();
  expect(await createMailQuickReplyDraftSession(scope).read()).toBe('');
});
