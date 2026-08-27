type MailReadItem = {
  id: string;
  mailbox_id?: string | number | null;
  is_read?: boolean | null;
};

const pendingReadOverrides = new Set<string>();

function overrideKey(messageId: string, mailboxId?: string | number | null): string {
  return `${String(mailboxId || '').trim()}\u0000${String(messageId || '').trim()}`;
}

export function stagePendingMailReadOverride(messageId: string, mailboxId?: string | number | null): void {
  pendingReadOverrides.add(overrideKey(messageId, mailboxId));
}

export function clearPendingMailReadOverride(messageId: string, mailboxId?: string | number | null): void {
  pendingReadOverrides.delete(overrideKey(messageId, mailboxId));
}

export function applyPendingMailReadOverrides<T extends MailReadItem>(
  items: T[],
  fallbackMailboxId?: string | number | null,
): T[] {
  return items.map((item) => {
    const mailboxId = item.mailbox_id ?? fallbackMailboxId;
    return pendingReadOverrides.has(overrideKey(item.id, mailboxId)) && item.is_read === false
      ? { ...item, is_read: true }
      : item;
  });
}
