import { markMailMessageRead } from '../api/mailApi';
import { publishNativeMailUnreadDelta } from './nativeMailUnreadEvents';

// Пометить письмо прочитанным и опубликовать дельту счётчика непрочитанных; единая точка для вызовов вне списка почты.
export async function markNativeMailRead(messageId: string, mailboxId: string): Promise<void> {
  await markMailMessageRead(messageId, mailboxId);
  publishNativeMailUnreadDelta(-1, { mailboxId, folder: 'inbox' });
}
