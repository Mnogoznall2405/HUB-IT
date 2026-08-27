import * as SecureStore from 'expo-secure-store';
import { DEFAULT_CHAT_FOLDER_KEY, normalizeFolderKey } from './chatFolders';

const STORAGE_KEY = 'hubit_native_chat_active_folder_v1';

type StoredFolder = {
  userId: number;
  folderKey: string;
};

async function load(): Promise<StoredFolder[]> {
  try {
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    const items = value ? JSON.parse(value) : [];
    if (!Array.isArray(items)) return [];
    return items.flatMap((raw): StoredFolder[] => {
      const item = raw as Partial<StoredFolder>;
      const userId = Number(item.userId || 0);
      const folderKey = normalizeFolderKey(item.folderKey);
      return Number.isInteger(userId) && userId > 0 ? [{ userId, folderKey }] : [];
    });
  } catch {
    return [];
  }
}

export async function getActiveChatFolderKey(userId: number): Promise<string> {
  if (!Number.isInteger(userId) || userId <= 0) return DEFAULT_CHAT_FOLDER_KEY;
  const items = await load();
  return items.find((item) => item.userId === userId)?.folderKey || DEFAULT_CHAT_FOLDER_KEY;
}

export async function setActiveChatFolderKey(userId: number, folderKey: string): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const normalized = normalizeFolderKey(folderKey);
  const items = (await load()).filter((item) => item.userId !== userId);
  items.push({ userId, folderKey: normalized });
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(items));
}
