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
  // A first online page must not replace a previously complete offline catalog,
  // but fresh items from that page still need to be merged in (OFF-08).
  if (page.has_more && existing?.data.has_more === false) {
    const byId = new Map<string, ChatConversationPage['items'][number]>();
    [...(existing.data.items || []), ...(page.items || [])].forEach((item) => {
      const id = String(item?.id || '').trim();
      if (id) byId.set(id, item);
    });
    return writeNativeCollectionSnapshot(
      'chat-inbox',
      userId,
      NATIVE_CHAT_INBOX_SNAPSHOT_KEY,
      {
        ...existing.data,
        items: [...byId.values()],
        has_more: false,
        next_cursor: null,
      },
    );
  }
  return writeNativeCollectionSnapshot(
    'chat-inbox',
    userId,
    NATIVE_CHAT_INBOX_SNAPSHOT_KEY,
    page,
  );
}
