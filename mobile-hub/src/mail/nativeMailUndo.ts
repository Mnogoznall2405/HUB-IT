import type { MailMessagePreview } from '../api/mailApi';

export type NativeMailUndo = {
  scope: string;
} & (
  | { kind: 'read'; messageId: string; mailboxId: string; previousRead: boolean; item: MailMessagePreview; index: number; label: string }
  | { kind: 'archive'; messageId: string; mailboxId: string; targetFolder: string; label: string }
  | { kind: 'delete'; messageId: string; mailboxId: string; targetFolder: string; label: string }
  | {
      kind: 'bulk';
      mailboxId: string;
      action: 'read' | 'unread' | 'move' | 'delete';
      /** Server ids the bulk action was applied to (pre-move ids). */
      messageIds: string[];
      /** Ids to use when reversing a move/delete (server assigns new ids on move). */
      undoIds: string[];
      /** Folder the selected items lived in before the action. */
      sourceFolder: string;
      /** Unread delta that was applied to counters; undo applies the inverse. */
      unreadDelta: number;
      label: string;
    }
);

export function hasUnconfirmedMailResult(cause: unknown): boolean {
  const status = (cause as { response?: { status?: number } } | null)?.response?.status;
  return !status || status === 408 || status >= 500;
}
