import { useCallback, useMemo, useRef, useState } from 'react';
import { confirmMailPermanentDelete } from './mailPermanentDeleteConfirm';
import { extractBulkTrashRestoreIds } from './mailTrashUndo';

export const normalizeSelectedMessageIds = (items = []) => (
  Array.from(new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item || ''))
    .filter(Boolean)))
);

export default function useMailBulkActions({
  mailAPI,
  activeMailboxId = '',
  folder = 'inbox',
  messageItems = [],
  selectedItems = [],
  setSelectedItems,
  setMoveTarget,
  selectedMessage = null,
  viewMode = 'messages',
  clearSelection,
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
  withActiveMailboxPayload,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
  onMessage,
  confirmPermanentDelete = confirmMailPermanentDelete,
  onRecoverableDelete,
  onRecoverableMove,
  getFolderLabel,
} = {}) {
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const dragMessageIdsRef = useRef([]);
  const selectedMessageIds = useMemo(
    () => normalizeSelectedMessageIds(selectedItems),
    [selectedItems]
  );

  const clearBulkSelection = useCallback(() => {
    setSelectedItems?.([]);
    setMoveTarget?.('');
    dragMessageIdsRef.current = [];
  }, [setMoveTarget, setSelectedItems]);

  const afterListMutation = useCallback(async ({ clearBulkSelection: shouldClearBulkSelection = true } = {}) => {
    if (shouldClearBulkSelection) {
      clearBulkSelection();
    } else {
      dragMessageIdsRef.current = [];
    }
    invalidateMailClientCache?.();
    await Promise.all([
      refreshList?.({ silent: true, force: true }),
      refreshFolderSummary?.({ force: true }),
    ]);
    window.dispatchEvent(new CustomEvent('mail-list-refreshed'));
  }, [clearBulkSelection, invalidateMailClientCache, refreshFolderSummary, refreshList]);

  const runBulkAction = useCallback(async ({
    action,
    targetFolder = '',
    permanent = false,
    successMessage = '',
  }) => {
    if (selectedMessageIds.length === 0) return;
    let deletePermanently = permanent;
    let deleteRestoreFolder = folder;
    if (action === 'delete') {
      const actualFolders = new Map(messageItems.map((item) => [String(item.id), item.folder]));
      const selectedFolders = selectedMessageIds.map((id) => actualFolders.get(id) || folder);
      const trashCount = selectedFolders.filter((key) => key === 'trash').length;
      if (trashCount > 0 && trashCount < selectedMessageIds.length) {
        onError?.('Выберите письма из «Удалённых» отдельно от писем в других папках.');
        return;
      }
      deletePermanently = trashCount === selectedMessageIds.length;
      deleteRestoreFolder = new Set(selectedFolders).size === 1 ? selectedFolders[0] : '';
      if (deletePermanently && !confirmPermanentDelete({ count: selectedMessageIds.length })) return;
    }
    setBulkActionLoading(true);
    try {
      const result = await mailAPI?.bulkMessageAction?.({
        mailbox_id: activeMailboxId || undefined,
        message_ids: selectedMessageIds,
        action,
        target_folder: targetFolder || undefined,
        permanent: deletePermanently,
      });
      if (selectedMessage?.id && selectedMessageIds.includes(String(selectedMessage.id))) {
        clearSelection?.({ mode: viewMode });
      }
      await afterListMutation();
      if (action === 'delete' && Number(result?.failed) > 0) {
        onError?.(`Не удалось удалить письма: ${result.failed}.`);
        if (deletePermanently || !Number(result.succeeded)) return;
      }
      if (action === 'delete' && !deletePermanently) {
        const restoreIds = extractBulkTrashRestoreIds(result);
        onRecoverableDelete?.({
          messageIds: restoreIds,
          restoreFolder: deleteRestoreFolder,
          count: restoreIds.length || selectedMessageIds.length,
        });
      } else if (action === 'move') {
        // Only messages the server actually moved get an undo entry; each entry
        // uses the new id and that message's own source folder.
        const actualFolders = new Map(messageItems.map((item) => [String(item.id), item.folder]));
        const moves = (Array.isArray(result?.results) ? result.results : [])
          .map((entry) => {
            const originalId = String(entry?.message_id || '');
            const movedId = String(entry?.result?.message_id || originalId);
            const sourceFolder = String(
              entry?.result?.source_folder || actualFolders.get(originalId) || folder
            );
            return movedId ? { id: movedId, restoreFolder: sourceFolder } : null;
          })
          .filter(Boolean);
        const failedCount = Number(result?.failed || 0);
        if (failedCount > 0) {
          onError?.(`Не удалось переместить письма: ${failedCount}.`);
        }
        if (moves.length > 0) {
          onRecoverableMove?.({
            moves,
            folderLabel: getFolderLabel?.(targetFolder) || targetFolder,
            count: moves.length,
          });
        }
      } else if (action === 'delete' && deletePermanently) {
        onMessage?.('Выбранные письма удалены навсегда.');
      } else if (successMessage) {
        onMessage?.(successMessage);
      }
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось выполнить массовое действие.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось выполнить массовое действие.')
          : (requestError?.response?.data?.detail || 'Не удалось выполнить массовое действие.');
        onError?.(detail);
      }
    } finally {
      setBulkActionLoading(false);
    }
  }, [
    activeMailboxId,
    afterListMutation,
    clearSelection,
    confirmPermanentDelete,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    mailAPI,
    messageItems,
    onError,
    onMessage,
    onRecoverableDelete,
    onRecoverableMove,
    getFolderLabel,
    selectedMessage,
    selectedMessageIds,
    viewMode,
  ]);

  const handleStartDragItems = useCallback((ids) => {
    dragMessageIdsRef.current = normalizeSelectedMessageIds(ids);
  }, []);

  const handleDropMessagesToFolder = useCallback(async (targetFolderId) => {
    const targetFolder = String(targetFolderId || '');
    const ids = dragMessageIdsRef.current.length > 0
      ? dragMessageIdsRef.current
      : (selectedMessageIds.length > 0
        ? selectedMessageIds
        : [String(selectedMessage?.id || '')].filter(Boolean));
    if (!targetFolder || ids.length === 0) return;
    if (targetFolder === folder) return;

    const actualFolders = new Map(messageItems.map((item) => [String(item.id), item.folder]));
    try {
      let moves = [];
      let failedCount = 0;
      if (ids.length === 1) {
        const moveResult = await mailAPI?.moveMessage?.(ids[0], withActiveMailboxPayload?.({ target_folder: targetFolder }));
        moves = [{
          id: String(moveResult?.message_id || ids[0]),
          restoreFolder: String(moveResult?.source_folder || actualFolders.get(ids[0]) || folder),
        }];
      } else {
        const result = await mailAPI?.bulkMessageAction?.({
          mailbox_id: activeMailboxId || undefined,
          message_ids: ids,
          action: 'move',
          target_folder: targetFolder,
        });
        failedCount = Number(result?.failed || 0);
        moves = (Array.isArray(result?.results) ? result.results : [])
          .map((entry) => {
            const originalId = String(entry?.message_id || '');
            const movedId = String(entry?.result?.message_id || originalId);
            const sourceFolder = String(
              entry?.result?.source_folder || actualFolders.get(originalId) || folder
            );
            return movedId ? { id: movedId, restoreFolder: sourceFolder } : null;
          })
          .filter(Boolean);
      }
      if (selectedMessage?.id && ids.includes(String(selectedMessage.id))) {
        clearSelection?.({ mode: viewMode });
      }
      await afterListMutation();
      if (failedCount > 0) {
        onError?.(`Не удалось переместить письма: ${failedCount}.`);
      }
      if (moves.length > 0) {
        onRecoverableMove?.({
          moves,
          folderLabel: getFolderLabel?.(targetFolder) || targetFolder,
          count: moves.length,
        });
      }
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось переместить письма.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось переместить письма.')
          : (requestError?.response?.data?.detail || 'Не удалось переместить письма.');
        onError?.(detail);
      }
    }
  }, [
    activeMailboxId,
    afterListMutation,
    clearSelection,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    mailAPI,
    messageItems,
    onError,
    onRecoverableMove,
    getFolderLabel,
    selectedMessage,
    selectedMessageIds,
    viewMode,
    withActiveMailboxPayload,
  ]);

  return {
    selectedMessageIds,
    bulkActionLoading,
    clearBulkSelection,
    afterListMutation,
    runBulkAction,
    handleStartDragItems,
    handleDropMessagesToFolder,
  };
}
