import { useCallback } from 'react';

import { createSelectedMessagePreviewShell } from './mailDetailModel';

export default function useMailListItemSelection({
  isMobile,
  viewMode,
  folder,
  selectedMessageIds,
  selectedIdRef,
  selectedMessageRef,
  activeMailboxId,
  mailAPI,
  getRecentMessageDetailSnapshot,
  getMailErrorDetail,
  openComposeFromDraftMessage,
  saveCurrentListScrollPosition,
  revalidateSelectedMailDetail,
  closeMobileNavigationIfNeeded,
  setSelectedItems,
  setDetailLoading,
  setSelectedConversation,
  setSelectedMessage,
  setSelectedId,
  setSelectedByMode,
  setMoveTarget,
  setError,
} = {}) {
  return useCallback(async (value, item) => {
    const nextId = String(value || '');
    if (isMobile && viewMode === 'messages' && selectedMessageIds.length > 0) {
      setSelectedItems((prev) => (
        prev.includes(nextId)
          ? prev.filter((selectedItem) => selectedItem !== nextId)
          : [...prev, nextId]
      ));
      return;
    }
    const isDraftFolderSelection = (
      viewMode === 'messages'
      && String(folder || '').toLowerCase() === 'drafts'
      && Boolean(nextId)
    );
    if (isDraftFolderSelection) {
      setDetailLoading(true);
      try {
        const recentDetail = getRecentMessageDetailSnapshot(nextId);
        const draftDetail = recentDetail || await mailAPI.getMessage(nextId, { mailboxId: activeMailboxId });
        if (draftDetail) {
          setSelectedConversation(null);
          setSelectedMessage(draftDetail);
          openComposeFromDraftMessage(draftDetail);
        }
      } catch (requestError) {
        setError(getMailErrorDetail(requestError, 'Не удалось открыть черновик.'));
      } finally {
        setDetailLoading(false);
      }
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      setSelectedByMode((prev) => ({ ...(prev || {}), [viewMode]: nextId }));
      setMoveTarget('');
      closeMobileNavigationIfNeeded();
      return;
    }
    if (viewMode === 'messages') {
      saveCurrentListScrollPosition({ selectedMessageIdAtOpen: nextId });
      const sameMessageAlreadyOpen = (
        String(selectedIdRef.current || '') === nextId
        && String(selectedMessageRef.current?.id || '') === nextId
        && selectedMessageRef.current?.__previewOnly !== true
      );
      if (!sameMessageAlreadyOpen) {
        const recentDetail = getRecentMessageDetailSnapshot(nextId);
        const previewShell = recentDetail || createSelectedMessagePreviewShell(item, folder);
        if (!recentDetail) setDetailLoading(true);
        if (previewShell) {
          setSelectedConversation(null);
          setSelectedMessage(previewShell);
        }
        if (String(selectedIdRef.current || '') === nextId) {
          void revalidateSelectedMailDetail({ force: true });
        }
      }
    }
    selectedIdRef.current = nextId;
    setSelectedId(nextId);
    setSelectedByMode((prev) => ({ ...(prev || {}), [viewMode]: nextId }));
    setMoveTarget('');
    closeMobileNavigationIfNeeded();
    // Keep the original Mail.jsx identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeMailboxId,
    closeMobileNavigationIfNeeded,
    folder,
    getMailErrorDetail,
    getRecentMessageDetailSnapshot,
    isMobile,
    openComposeFromDraftMessage,
    revalidateSelectedMailDetail,
    saveCurrentListScrollPosition,
    selectedMessageIds,
    viewMode,
  ]);
}
