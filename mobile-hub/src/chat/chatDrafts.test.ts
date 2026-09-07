import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => 'synthetic-draft-file' }));
import {
  clearAllNativeChatDrafts,
  clearNativeChatDraft,
  getNativeChatDraft,
  getNativeChatDraftState,
  setNativeChatDraft,
} from './chatDrafts';

it.each([
  { text: { synthetic: 'private text' } }, { userId: '7' }, { conversationId: ['chat-a'] },
  { updatedAt: 'broken' }, { updatedAt: null },
])('preserves malformed draft fields instead of coercing or silently dropping them: %j', async (damage) => {
  await clearAllNativeChatDrafts();
  const key = 'hubit_native_chat_drafts_v1';
  const raw = JSON.stringify([{ userId: 7, conversationId: 'chat-a', text: 'Исходный текст', updatedAt: Date.now(), ...damage }]);
  await SecureStore.setItemAsync(key, raw);
  await expect(setNativeChatDraft(7, 'chat-b', 'Другой черновик')).rejects.toThrow('Не удалось прочитать черновики');
  expect(await SecureStore.getItemAsync(key)).toBe(raw);
  await clearAllNativeChatDrafts();
});

it.each([
  { mode: { type: 'edit' } },
  { mode: { type: 'reply', message: { id: 'm', conversation_id: 'other' } } },
  { files: 'invalid' },
  { files: [null] },
  { beforeEditText: { private: 'synthetic' } },
])('rejects damaged draft context without overwriting stored data: %j', async (context) => {
  await clearAllNativeChatDrafts();
  const key = 'hubit_native_chat_drafts_v1';
  const raw = JSON.stringify([{ userId: 7, conversationId: 'chat-a', text: 'Сохранённый текст', updatedAt: Date.now(), context }]);
  await SecureStore.setItemAsync(key, raw);
  await expect(getNativeChatDraftState(7, 'chat-a')).rejects.toThrow('Не удалось прочитать черновики');
  await expect(setNativeChatDraft(7, 'chat-b', 'Новый')).rejects.toThrow();
  expect(await SecureStore.getItemAsync(key)).toBe(raw);
  await clearAllNativeChatDrafts();
});

it('keeps drafts isolated by user and conversation and never sends them', async () => {
  await setNativeChatDraft(7, 'chat-a', 'Первый черновик');
  await setNativeChatDraft(7, 'chat-b', 'Второй черновик');
  await setNativeChatDraft(8, 'chat-a', 'Другой пользователь');

  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Первый черновик');
  expect(await getNativeChatDraft(7, 'chat-b')).toBe('Второй черновик');
  expect(await getNativeChatDraft(8, 'chat-a')).toBe('Другой пользователь');
});

it('rejects an invalid new context before replacing a valid draft', async () => {
  await clearAllNativeChatDrafts();
  await setNativeChatDraft(7, 'chat-a', 'Исходный текст');
  await expect(setNativeChatDraft(7, 'chat-a', 'Новый текст', {
    mode: { type: 'reply', message: { id: 'm', conversation_id: 'chat-b', sender_user_id: 7 } },
  })).rejects.toThrow('повреждён контекст');
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Исходный текст');
});

it('does not expose the malformed JSON content in a storage error', async () => {
  const key = 'hubit_native_chat_drafts_v1';
  const raw = '{"synthetic-private-draft": broken';
  await SecureStore.setItemAsync(key, raw);
  await expect(getNativeChatDraft(7, 'chat-a')).rejects.toThrow(/^Не удалось прочитать черновики$/);
  expect(await SecureStore.getItemAsync(key)).toBe(raw);
  await clearAllNativeChatDrafts();
});

it('clears a sent draft and all drafts on logout', async () => {
  await setNativeChatDraft(7, 'chat-a', 'Черновик');
  await clearNativeChatDraft(7, 'chat-a');
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('');

  await setNativeChatDraft(7, 'chat-a', 'Новый черновик');
  await clearAllNativeChatDrafts();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('hubit_native_chat_drafts_v1');
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('');
});

it('rejects oversized text without truncating or replacing the saved draft', async () => {
  await clearAllNativeChatDrafts();
  await setNativeChatDraft(7, 'chat-a', 'Сохранённый текст');
  await expect(setNativeChatDraft(7, 'chat-a', 'я'.repeat(10_001))).rejects.toThrow();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Сохранённый текст');
});

it('rejects a new conversation over capacity without silently evicting another draft', async () => {
  await clearAllNativeChatDrafts();
  for (let index = 0; index < 20; index += 1) {
    await setNativeChatDraft(7, `chat-${index}`, `Черновик ${index}`);
  }
  await expect(setNativeChatDraft(7, 'overflow', 'Новый')).rejects.toThrow();
  for (let index = 0; index < 20; index += 1) {
    expect(await getNativeChatDraft(7, `chat-${index}`)).toBe(`Черновик ${index}`);
  }
  await clearNativeChatDraft(7, 'chat-0');
  await setNativeChatDraft(7, 'overflow', 'Повтор');
  expect(await getNativeChatDraft(7, 'overflow')).toBe('Повтор');
});

it('rejects the total text quota without losing another conversation', async () => {
  await clearAllNativeChatDrafts();
  for (let index = 0; index < 6; index += 1) {
    await setNativeChatDraft(7, `large-${index}`, 'ю'.repeat(10_000));
  }
  await setNativeChatDraft(7, 'last', 'я'.repeat(4_000));
  await expect(setNativeChatDraft(7, 'last', 'я'.repeat(4_001))).rejects.toThrow();
  expect(await getNativeChatDraft(7, 'last')).toBe('я'.repeat(4_000));
  for (let index = 0; index < 6; index += 1) {
    expect(await getNativeChatDraft(7, `large-${index}`)).toBe('ю'.repeat(10_000));
  }
});

it('preserves concurrent changes in different conversations and a queued clear', async () => {
  await clearAllNativeChatDrafts();
  await Promise.all([
    setNativeChatDraft(7, 'chat-a', 'Первый'),
    setNativeChatDraft(7, 'chat-b', 'Второй'),
    setNativeChatDraft(7, 'chat-a', 'Последняя версия'),
    clearNativeChatDraft(7, 'chat-b'),
    setNativeChatDraft(8, 'chat-a', 'Другой пользователь'),
  ]);
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Последняя версия');
  expect(await getNativeChatDraft(7, 'chat-b')).toBe('');
  expect(await getNativeChatDraft(8, 'chat-a')).toBe('Другой пользователь');
});

it('does not overwrite existing drafts when secure storage cannot be read', async () => {
  await clearAllNativeChatDrafts();
  await setNativeChatDraft(7, 'chat-a', 'Сохранённый');
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(setNativeChatDraft(7, 'chat-b', 'Новый')).rejects.toThrow();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Сохранённый');
  await setNativeChatDraft(7, 'chat-b', 'Повтор');
  expect(await getNativeChatDraft(7, 'chat-b')).toBe('Повтор');
});

it('finishes pending saves before logout clears the drafts', async () => {
  const write = setNativeChatDraft(7, 'chat-a', 'Перед выходом');
  const clear = clearAllNativeChatDrafts();
  await Promise.all([write, clear]);
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('');
});

it('restores reply, edit context and attachment references without requiring body text', async () => {
  await clearAllNativeChatDrafts();
  const source = new File(Paths.cache, 'synthetic-photo.jpg');
  source.write('synthetic image bytes');
  const context = {
    mode: { type: 'edit' as const, message: { id: 'm1', conversation_id: 'chat-a', sender_user_id: 7, body_text: 'До изменения' } },
    beforeEditText: 'Мой обычный черновик',
    files: [{ uri: source.uri, name: 'Фото.jpg', mimeType: 'image/jpeg', size: source.size, source: 'gallery' as const }],
  };
  await setNativeChatDraft(7, 'chat-a', '', context);
  source.delete();
  const restored = await getNativeChatDraftState(7, 'chat-a');
  expect(restored).toMatchObject({ text: '', context: { mode: context.mode, beforeEditText: context.beforeEditText } });
  expect(await new File(restored!.context!.files![0].uri).text()).toBe('synthetic image bytes');
  await clearNativeChatDraft(7, 'chat-a');
  expect(await getNativeChatDraftState(7, 'chat-a')).toBeNull();
});
