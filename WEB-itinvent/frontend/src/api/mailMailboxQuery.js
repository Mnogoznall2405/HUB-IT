export function normalizeMailboxId(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function withMailboxQuery(params = {}, mailboxId) {
  const normalizedMailboxId = normalizeMailboxId(mailboxId ?? params?.mailbox_id ?? params?.mailboxId);
  const nextParams = { ...(params || {}) };
  delete nextParams.mailboxId;
  if (normalizedMailboxId) {
    nextParams.mailbox_id = normalizedMailboxId;
  } else {
    delete nextParams.mailbox_id;
  }
  return nextParams;
}
