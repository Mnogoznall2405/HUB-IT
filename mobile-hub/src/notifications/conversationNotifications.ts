import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Removes the drawer notifications of a conversation the user is looking at
 * (Telegram does the same on opening a chat). Best effort: never throws. */
export async function dismissConversationNotifications(conversationId: string): Promise<void> {
  const id = String(conversationId || '').trim();
  if (!id || Platform.OS !== 'android') return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(presented
      .filter((item) => {
        const data = item.request.content.data as Record<string, unknown> | undefined;
        return String(data?.conversation_id || data?.conversationId || '').trim() === id;
      })
      .map((item) => Notifications.dismissNotificationAsync(item.request.identifier).catch(() => undefined)));
  } catch {
    /* the shade is a convenience, not a requirement */
  }
}
