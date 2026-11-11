import * as SecureStore from 'expo-secure-store';
import {
  getChatActiveWorkspace,
  setChatActiveWorkspace,
} from './chatActiveWorkspace';

const STORAGE_KEY = 'hubit_native_chat_active_workspace_v1';

describe('chatActiveWorkspace', () => {
  it('defaults to chats and keeps the last workspace isolated per user', async () => {
    expect(await getChatActiveWorkspace(7)).toBe('chats');
    await setChatActiveWorkspace(7, 'ai');
    await setChatActiveWorkspace(8, 'chats');
    expect(await getChatActiveWorkspace(7)).toBe('ai');
    expect(await getChatActiveWorkspace(8)).toBe('chats');
  });

  it('overwrites only the record of the same user', async () => {
    await setChatActiveWorkspace(7, 'ai');
    await setChatActiveWorkspace(7, 'chats');
    expect(await getChatActiveWorkspace(7)).toBe('chats');
    const stored = JSON.parse((await SecureStore.getItemAsync(STORAGE_KEY)) || '[]');
    expect(stored).toEqual([{ userId: 7, workspace: 'chats' }]);
  });

  it('ignores anonymous users without writing storage', async () => {
    await setChatActiveWorkspace(0, 'ai');
    await setChatActiveWorkspace(-3, 'ai');
    expect(await getChatActiveWorkspace(0)).toBe('chats');
    expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
  });

  it('normalizes malformed entries and survives corrupted payloads', async () => {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify([
      { userId: 'x', workspace: 'ai' },
      { userId: 7, workspace: 'bogus' },
      { userId: 8, workspace: 'ai' },
      null,
    ]));
    expect(await getChatActiveWorkspace(7)).toBe('chats');
    expect(await getChatActiveWorkspace(8)).toBe('ai');
    await SecureStore.setItemAsync(STORAGE_KEY, '{oops');
    expect(await getChatActiveWorkspace(7)).toBe('chats');
  });
});
