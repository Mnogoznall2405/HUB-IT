import * as SecureStore from 'expo-secure-store';
import {
  DEFAULT_CHAT_WORKSPACE,
  normalizeChatWorkspaceKey,
  type ChatWorkspaceKey,
} from './chatAiWorkspace';

const STORAGE_KEY = 'hubit_native_chat_active_workspace_v1';

type StoredWorkspace = {
  userId: number;
  workspace: ChatWorkspaceKey;
};

async function load(): Promise<StoredWorkspace[]> {
  try {
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    const items = value ? JSON.parse(value) : [];
    if (!Array.isArray(items)) return [];
    return items.flatMap((raw): StoredWorkspace[] => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Partial<StoredWorkspace>;
      const userId = Number(item.userId || 0);
      return Number.isInteger(userId) && userId > 0
        ? [{ userId, workspace: normalizeChatWorkspaceKey(item.workspace) }]
        : [];
    });
  } catch {
    return [];
  }
}

export async function getChatActiveWorkspace(userId: number): Promise<ChatWorkspaceKey> {
  if (!Number.isInteger(userId) || userId <= 0) return DEFAULT_CHAT_WORKSPACE;
  const items = await load();
  return items.find((item) => item.userId === userId)?.workspace || DEFAULT_CHAT_WORKSPACE;
}

export async function setChatActiveWorkspace(
  userId: number,
  workspace: ChatWorkspaceKey,
): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const normalized = normalizeChatWorkspaceKey(workspace);
  const items = (await load()).filter((item) => item.userId !== userId);
  items.push({ userId, workspace: normalized });
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(items));
}
