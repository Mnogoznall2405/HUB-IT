import type { MailFolderNode, MailFolderSummary } from '../api/mailApi';
import type { MailMailbox } from '../api/mailMailboxesApi';

const PENDING_TTL_MS = 15 * 60 * 1000;
const TOTAL_KEY = '__total__';

type PendingEntry = {
  /** Accumulated unread delta not yet confirmed by a server counter. */
  delta: number;
  /** Last server counter observed before the first stage; null when unseen. */
  baseline: number | null;
  /** First server counter observed while the baseline was unknown. */
  seen: number | null;
  stagedAt: number;
};

const pendingDeltas = new Map<string, PendingEntry>();
const lastServerUnread = new Map<string, number>();

function safeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function scopeKey(mailboxId: string | number | null | undefined, folder: string | null | undefined): string {
  if (folder == null) return TOTAL_KEY;
  return `${String(mailboxId || '').trim()}|${String(folder || '').trim()}`;
}

/** Records a locally applied unread delta so the next server counters can be
 *  corrected while Exchange still reports the pre-change value. Callers always
 *  stage the folder-scoped entry; the publish helper additionally stages the
 *  cross-mailbox total used by the navigation badge. */
export function stageNativeMailUnreadDelta(mailboxId: string | number | null | undefined, folder: string | null | undefined, delta: number): void {
  const value = Math.trunc(Number(delta));
  if (!Number.isFinite(value) || value === 0) return;
  const key = scopeKey(mailboxId, folder);
  const previous = pendingDeltas.get(key);
  const next: PendingEntry = {
    delta: (previous?.delta || 0) + value,
    baseline: previous?.baseline ?? lastServerUnread.get(key) ?? null,
    seen: previous?.seen ?? null,
    stagedAt: previous?.stagedAt ?? Date.now(),
  };
  if (next.delta === 0) pendingDeltas.delete(key);
  else pendingDeltas.set(key, next);
}

function stageNativeMailUnreadTotal(delta: number): void {
  stageNativeMailUnreadDelta('', null, delta);
}

/** Applies the pending local delta to a server unread counter until the server
 *  reports a value that already reflects it. Pass folder=null for the
 *  cross-mailbox total used by the navigation badge. */
export function applyPendingNativeMailUnread(mailboxId: string | number | null | undefined, folder: string | null | undefined, serverUnread: unknown): number {
  const key = scopeKey(mailboxId, folder);
  const server = safeCount(serverUnread);
  lastServerUnread.set(key, server);
  const entry = pendingDeltas.get(key);
  if (!entry || entry.delta === 0) return server;
  if (Date.now() - entry.stagedAt > PENDING_TTL_MS) {
    pendingDeltas.delete(key);
    return server;
  }
  if (entry.baseline !== null) {
    const expected = Math.max(0, entry.baseline + entry.delta);
    if (entry.delta < 0) {
      if (server <= expected) {
        pendingDeltas.delete(key);
        return server;
      }
      // Server may have applied only part of the staged delta: clamp to the
      // predicted counter. A counter above the pre-stage baseline means new
      // unread mail arrived, so the full delta still applies.
      return Math.max(0, server > entry.baseline ? server + entry.delta : expected);
    }
    if (server >= expected) {
      pendingDeltas.delete(key);
      return server;
    }
    return Math.max(0, server < entry.baseline ? server + entry.delta : expected);
  }
  if (entry.seen === null) {
    entry.seen = server;
    return Math.max(0, server + entry.delta);
  }
  if (server !== entry.seen) {
    pendingDeltas.delete(key);
    return server;
  }
  return Math.max(0, server + entry.delta);
}

/** Drops pending corrections: a folder-scoped entry when mailbox+folder are
 *  given, the total entry when folder=null, or everything when mailboxId is
 *  omitted entirely. */
export function clearPendingNativeMailUnread(mailboxId?: string | number | null, folder?: string | null): void {
  if (mailboxId == null) {
    pendingDeltas.clear();
    return;
  }
  if (folder == null) pendingDeltas.delete(TOTAL_KEY);
  else pendingDeltas.delete(scopeKey(mailboxId, folder));
}

/** Internal helper for the publish path: stage both the folder entry and the
 *  cross-mailbox total used by the navigation badge. */
export function stageNativeMailUnreadForPublish(mailboxId: string | number | null | undefined, folder: string | null | undefined, delta: number): void {
  stageNativeMailUnreadDelta(mailboxId, folder, delta);
  stageNativeMailUnreadTotal(delta);
}

/** Corrects every folder entry of a fresh summary snapshot by its pending delta. */
export function applyPendingUnreadToSummary(mailboxId: string, summary: MailFolderSummary): MailFolderSummary {
  const next: MailFolderSummary = {};
  Object.entries(summary || {}).forEach(([folderId, entry]) => {
    next[folderId] = {
      ...entry,
      unread: applyPendingNativeMailUnread(mailboxId, folderId, entry?.unread),
    };
  });
  return next;
}

/** Corrects folder-tree unread counters recursively by their pending deltas. */
export function applyPendingUnreadToFolderTree(mailboxId: string, nodes: MailFolderNode[]): MailFolderNode[] {
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const nodeKey = String(node.well_known_key || node.id || node.folder_id || node.key || '').trim();
    const children = Array.isArray(node.children)
      ? applyPendingUnreadToFolderTree(mailboxId, node.children)
      : node.children;
    return {
      ...node,
      ...(node.unread != null && nodeKey
        ? { unread: applyPendingNativeMailUnread(mailboxId, nodeKey, node.unread) }
        : {}),
      ...(children !== node.children ? { children } : {}),
    };
  });
}

/** Corrects the per-mailbox inbox unread counters by their pending deltas. */
export function applyPendingUnreadToMailboxes(mailboxes: MailMailbox[]): MailMailbox[] {
  return (Array.isArray(mailboxes) ? mailboxes : []).map((mailbox) => ({
    ...mailbox,
    unread_count: applyPendingNativeMailUnread(String(mailbox.id), 'inbox', mailbox.unread_count),
  }));
}
