import * as SecureStore from 'expo-secure-store';
import {
  clearAllNativeChatDrafts,
  clearNativeChatDraft,
  getNativeChatDraft,
  setNativeChatDraft,
} from './chatDrafts';

it('keeps drafts isolated by user and conversation and never sends them', async () => {
  await setNativeChatDraft(7, 'chat-a', 'Первый черновик');
  await setNativeChatDraft(7, 'chat-b', 'Второй черновик');
  await setNativeChatDraft(8, 'chat-a', 'Другой пользователь');

  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Первый черновик');
  expect(await getNativeChatDraft(7, 'chat-b')).toBe('Второй черновик');
  expect(await getNativeChatDraft(8, 'chat-a')).toBe('Другой пользователь');
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

it('limits one draft to the native composer maximum', async () => {
  await setNativeChatDraft(7, 'chat-a', 'x'.repeat(12_000));
  expect((await getNativeChatDraft(7, 'chat-a')).length).toBe(10_000);
});
