import { useCallback, useEffect, useRef } from 'react';

const normalizeMailboxId = (value) => String(value || '').trim();
const getMailboxEntryId = (value) => normalizeMailboxId(value?.id || value?.mailbox_id);
const normalizeUnreadCountState = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fresh' || normalized === 'stale') return normalized;
  return 'deferred';
};

// The endpoint reports snapshot state ('ok' | 'stale' | 'error' | 'unknown').
// Only 'ok' is a real measurement; 'error'/'stale' keep a usable value but must
// be refetched, and 'unknown' means the count was never measured — stamping it
// 'fresh' would pin a fabricated 0 for the whole session (MAIL-28).
const unreadCountStateFromResponse = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'stale') return { state: 'stale', trusted: true };
  if (normalized === 'error') return { state: 'stale', trusted: false };
  if (normalized === 'unknown') return { state: 'deferred', trusted: false };
  // 'ok' and missing state (the pre-state response shape) are trusted counts.
  return { state: 'fresh', trusted: true };
};

export default function useMailMailboxUnreadCounts({
  mailAPI,
  mailboxes,
  activeMailboxId,
  setMailboxes,
} = {}) {
  const mailboxesRef = useRef(mailboxes);
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    mailboxesRef.current = mailboxes;
  }, [mailboxes]);

  const refreshMailboxUnreadCounts = useCallback(async ({ mailboxIds = null, force = false } = {}) => {
    if (!mailAPI || typeof mailAPI.getUnreadCount !== 'function' || typeof setMailboxes !== 'function') {
      return;
    }

    const requestedIds = Array.isArray(mailboxIds)
      ? mailboxIds.map((value) => normalizeMailboxId(value)).filter(Boolean)
      : null;
    const requestedIdSet = requestedIds ? new Set(requestedIds) : null;
    const currentMailboxes = Array.isArray(mailboxesRef.current) ? mailboxesRef.current : [];
    const normalizedActiveMailboxId = normalizeMailboxId(activeMailboxId);

    const targets = currentMailboxes
      .filter((entry) => {
        const mailboxId = getMailboxEntryId(entry);
        if (!mailboxId || entry?.is_active === false) return false;
        if (mailboxId === normalizedActiveMailboxId) return false;
        if (requestedIdSet && !requestedIdSet.has(mailboxId)) return false;
        if (inFlightRef.current.has(mailboxId)) return false;
        if (force) return true;
        return normalizeUnreadCountState(entry?.unread_count_state) !== 'fresh';
      })
      .map((entry) => getMailboxEntryId(entry))
      .filter(Boolean);

    if (targets.length === 0) return;

    const results = await Promise.allSettled(targets.map(async (mailboxId) => {
      inFlightRef.current.add(mailboxId);
      try {
        const response = await mailAPI.getUnreadCount({ mailboxId });
        return {
          mailboxId,
          unreadCount: Number(response?.unread_count || 0),
          ...unreadCountStateFromResponse(response?.state),
        };
      } finally {
        inFlightRef.current.delete(mailboxId);
      }
    }));

    const nextCounts = new Map();
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      nextCounts.set(result.value.mailboxId, result.value);
    });
    if (nextCounts.size === 0) return;

    setMailboxes((prev) => (Array.isArray(prev) ? prev.map((entry) => {
      const mailboxId = getMailboxEntryId(entry);
      const measured = mailboxId ? nextCounts.get(mailboxId) : null;
      if (!measured) return entry;
      if (!measured.trusted) {
        return { ...entry, unread_count_state: measured.state };
      }
      return {
        ...entry,
        unread_count: Number(measured.unreadCount || 0),
        unread_count_state: measured.state,
      };
    }) : prev));
  }, [activeMailboxId, mailAPI, setMailboxes]);

  const handleOpenMailboxList = useCallback(() => {
    void refreshMailboxUnreadCounts();
  }, [refreshMailboxUnreadCounts]);

  return {
    refreshMailboxUnreadCounts,
    handleOpenMailboxList,
  };
}
