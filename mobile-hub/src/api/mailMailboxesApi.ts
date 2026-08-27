import apiClient from './client';

export type MailMailbox = {
  id: string;
  label?: string | null;
  mailbox_email?: string | null;
  mailbox_login?: string | null;
  effective_mailbox_login?: string | null;
  auth_mode?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
  unread_count?: number | null;
};

export type MailboxWritePayload = {
  label?: string;
  mailbox_email: string;
  mailbox_login?: string;
  mailbox_password?: string;
  auth_mode: string;
  is_primary?: boolean;
  is_active?: boolean;
};

function asItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

export async function listMailboxes(includeUnread = true): Promise<MailMailbox[]> {
  const { data } = await apiClient.get('/mail/mailboxes', {
    params: { include_unread: includeUnread },
  });
  return asItems<MailMailbox>(data);
}

export async function createMailbox(payload: MailboxWritePayload): Promise<MailMailbox> {
  const { data } = await apiClient.post<MailMailbox>('/mail/mailboxes', payload);
  return data;
}

export async function updateMailbox(mailboxId: string, payload: Partial<MailboxWritePayload>): Promise<MailMailbox> {
  const { data } = await apiClient.patch<MailMailbox>(
    `/mail/mailboxes/${encodeURIComponent(mailboxId)}`,
    payload,
  );
  return data;
}

export async function deleteMailbox(mailboxId: string): Promise<void> {
  await apiClient.delete(`/mail/mailboxes/${encodeURIComponent(mailboxId)}`);
}
