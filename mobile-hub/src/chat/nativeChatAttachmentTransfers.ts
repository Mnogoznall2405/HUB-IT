import { useSyncExternalStore } from 'react';
import type { ChatAttachmentTransfer } from '../components/chat/ChatDocumentAttachment';

// Per-attachment transfer state lives outside React state so high-frequency
// progress ticks rerender only the subscribed attachment row, never the list.
const transfers = new Map<string, ChatAttachmentTransfer>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => {
    try { listener(); } catch { /* Observer only. */ }
  });
}

export function subscribeChatAttachmentTransfers(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getChatAttachmentTransfer(id: string) { return transfers.get(id); }

function sameTransfer(a: ChatAttachmentTransfer | undefined, b: ChatAttachmentTransfer) {
  return !!a && a.action === b.action && a.status === b.status
    && a.progress === b.progress && a.cancellable === b.cancellable;
}

export function setChatAttachmentTransfer(id: string, transfer: ChatAttachmentTransfer) {
  if (sameTransfer(transfers.get(id), transfer)) return;
  transfers.set(id, transfer);
  emit();
}

export function clearChatAttachmentTransfer(id: string) {
  if (transfers.delete(id)) emit();
}

/** Mirror authoritative status transitions into the store and prune dropped ids. */
export function syncChatAttachmentTransfers(map: Record<string, ChatAttachmentTransfer>) {
  let changed = false;
  const seen = new Set(Object.keys(map));
  transfers.forEach((_, id) => {
    if (!seen.has(id)) { transfers.delete(id); changed = true; }
  });
  seen.forEach((id) => {
    const next = map[id];
    const prev = transfers.get(id);
    // A progress-only difference means the external store holds a fresher
    // upload/download tick than the coarser React state snapshot.
    const progressOnly = !!prev && !!next
      && prev.action === next.action && prev.status === next.status
      && prev.cancellable === next.cancellable && prev.progress !== next.progress;
    if (next && !sameTransfer(prev, next) && !progressOnly) {
      transfers.set(id, next);
      changed = true;
    }
  });
  if (changed) emit();
}

export function useChatAttachmentTransfer(id: string | null | undefined): ChatAttachmentTransfer | undefined {
  const key = id || '';
  return useSyncExternalStore(
    subscribeChatAttachmentTransfers,
    () => transfers.get(key),
    () => transfers.get(key),
  );
}
