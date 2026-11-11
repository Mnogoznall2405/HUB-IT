import { useEffect } from 'react';

import { normalizeMailboxId, writeStoredSelectedMailboxId } from './mailMailboxModel';
import { normalizeMailFolder } from './mailViewStateModel';

export default function useMailDeepLinkSelection({
  locationSearch,
  activeMailboxId,
  folder,
  viewMode,
  lastAppliedMailboxViewStateRef,
  deepLinkKeyRef,
  selectedIdRef,
  setSelectedMailboxId,
  setFolder,
  setViewMode,
  setSelectedItems,
  setSelectedByMode,
  setSelectedId,
  persistSelectedMailboxId = writeStoredSelectedMailboxId,
} = {}) {
  useEffect(() => {
    const searchParams = new URLSearchParams(locationSearch || '');
    const nextMailboxId = normalizeMailboxId(searchParams.get('mailbox_id'));
    const rawNextFolder = String(searchParams.get('folder') || '').trim();
    const nextFolder = rawNextFolder ? normalizeMailFolder(rawNextFolder) : '';
    const nextMessageId = String(searchParams.get('message') || '').trim();
    if (nextMailboxId && nextMailboxId !== activeMailboxId) {
      lastAppliedMailboxViewStateRef.current = '';
      setSelectedMailboxId(nextMailboxId);
      persistSelectedMailboxId(nextMailboxId);
      return;
    }
    if (!nextMessageId) {
      deepLinkKeyRef.current = '';
      return;
    }
    const resolvedFolder = nextFolder || 'inbox';
    const nextKey = `${resolvedFolder}:${nextMessageId}`;
    if (deepLinkKeyRef.current === nextKey) return;
    deepLinkKeyRef.current = nextKey;
    if (folder !== resolvedFolder) {
      setFolder(resolvedFolder);
    }
    if (viewMode !== 'messages') {
      setViewMode('messages');
    }
    setSelectedItems([]);
    setSelectedByMode((prev) => ({ ...(prev || {}), messages: nextMessageId }));
    selectedIdRef.current = nextMessageId;
    setSelectedId(nextMessageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMailboxId, folder, locationSearch, viewMode]);
}
