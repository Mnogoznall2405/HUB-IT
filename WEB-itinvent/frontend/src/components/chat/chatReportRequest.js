import { useEffect, useState } from 'react';

// The message menu lives far from the dialogs, so a request to report a message is kept in a tiny
// store: the menu action sets it, the report dialog (mounted with the chat dialogs) reads it.
let current = null;
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());

export function requestMessageReport(message) {
  const messageId = String(message?.id || '').trim();
  if (!messageId) return;
  current = {
    messageId,
    conversationId: String(message?.conversation_id || '').trim(),
    senderName: String(message?.sender?.full_name || message?.sender?.username || '').trim(),
    preview: String(message?.body || '').trim().slice(0, 200),
  };
  emit();
}

export function clearMessageReportRequest() {
  if (current === null) return;
  current = null;
  emit();
}

export function useMessageReportRequest() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const listener = () => setValue(current);
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}
