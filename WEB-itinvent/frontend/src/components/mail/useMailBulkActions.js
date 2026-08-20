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
    if (action === 'delete' && permanent && !confirmPermanentDelete({ count: selectedMessageIds.length })) {
      return;
    }
    setBulkActionLoading(true);
    try {
      const result = await mailAPI?.bulkMessageAction?.({
        mailbox_id: activeMailboxId || undefined,
        message_ids: selectedMessageIds,
        action,
        target_folder: targetFolder || undefined,
        permanent,
      });
      if (selectedMessage?.id && selectedMessageIds.includes(String(selectedMessage.id))) {
        clearSelection?.({ mode: viewMode });
      }
      await afterListMutation();
      if (action === 'delete' && !permanent) {
        const restoreIds = extractBulkTrashRestoreIds(result);
        onRecoverableDelete?.({
          messageIds: restoreIds,
          restoreFolder: folder,
          count: restoreIds.length || selectedMessageIds.length,
        });
      } else if (action === 'move') {
        onRecoverableMove?.({
          messageIds: selectedMessageIds,
          restoreFolder: folder,
          folderLabel: getFolderLabel?.(targetFolder) || targetFolder,
          count: selectedMessageIds.length,
        });
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

    try {
      if (ids.length === 1) {
        await mailAPI?.moveMessage?.(ids[0], withActiveMailboxPayload?.({ target_folder: targetFolder }));
      } else {
        await mailAPI?.bulkMessageAction?.({
          mailbox_id: activeMailboxId || undefined,
          message_ids: ids,
          action: 'move',
          target_folder: targetFolder,
        });
      }
      if (selectedMessage?.id && ids.includes(String(selectedMessage.id))) {
        clearSelection?.({ mode: viewMode });
      }
      await afterListMutation();
      onRecoverableMove?.({
        messageIds: ids,
        restoreFolder: folder,
        folderLabel: getFolderLabel?.(targetFolder) || targetFolder,
        count: ids.length,
      });
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
