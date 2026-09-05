import type { ChatConversationPage } from '../api/types';
import {
  readNativeCollectionSnapshot,
  readNativeSnapshot,
  writeNativeCollectionSnapshot,
} from '../cache/nativeSnapshotCache';

export const NATIVE_CHAT_INBOX_SNAPSHOT_KEY = 'default';

function isConversationPage(value: unknown): value is ChatConversationPage {
  const page = value as Partial<ChatConversationPage> | null;
  return Boolean(page && Array.isArray(page.items) && typeof page.has_more === 'boolean');
}

export async function readNativeChatInboxSnapshot(userId: number) {
  const current = await readNativeCollectionSnapshot<ChatConversationPage>(
    'chat-inbox',
    userId,
    NATIVE_CHAT_INBOX_SNAPSHOT_KEY,
  );
  if (current) return current;

  // Compatibility with releases that stored Chat as one plain snapshot.
  const legacy = await readNativeSnapshot<ChatConversationPage>('chat-inbox', userId);
  return legacy && isConversationPage(legacy.data) ? legacy : null;
}

export async function writeNativeChatInboxSnapshot(
  userId: number,
  page: ChatConversationPage,
): Promise<boolean> {
  if (!isConversationPage(page)) return false;
  const existing = await readNativeChatInboxSnapshot(userId);
  // A first online page must not replace a previously complete offline catalog.
  if (page.has_more && existing?.data.has_more === false) return true;
  return writeNativeCollectionSnapshot(
    'chat-inbox',
    userId,
    NATIVE_CHAT_INBOX_SNAPSHOT_KEY,
    page,
  );
}
