import { useEffect } from 'react';

export function isMailShortcutTypingTarget(target) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.closest('.ql-editor')) return true;
  const tagName = String(element.tagName || '').toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || element.isContentEditable;
}

export default function useMailKeyboardShortcuts({
  searchInputRef,
  shortcutsOpen = false,
  setShortcutsOpen,
  openCompose,
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
  selectedMessageId = '',
  selectedMessageIds = [],
  selectAdjacentMessage,
  folder = 'inbox',
  runBulkAction,
  handleDeleteSelectedMessage,
  mobileNavigationOpen = false,
  setMobileNavigationOpen,
  composeOpen = false,
  composeCloseRequestRef,
  advancedSearchOpen = false,
  setAdvancedSearchOpen,
  mailPreferencesOpen = false,
  setMailPreferencesOpen,
  headersOpen = false,
  closeHeadersDialog,
} = {}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (isMailShortcutTypingTarget(event.target) && event.key !== 'Escape') return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen?.(true);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        searchInputRef?.current?.focus?.();
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        openCompose?.();
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        invalidateMailClientCache?.();
        refreshList?.({ force: true });
        refreshFolderSummary?.();
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && selectAdjacentMessage) {
        const inMessageList = Boolean(event.target?.closest?.('[data-mail-message-list]'));
        if (inMessageList) {
          event.preventDefault();
          selectAdjacentMessage(event.key === 'ArrowDown' ? 1 : -1);
        }
        return;
      }
      if (event.key === 'Delete' && selectedMessageId) {
        event.preventDefault();
        if (selectedMessageIds.length > 0) {
          runBulkAction?.({
            action: 'delete',
            permanent: folder === 'trash',
            successMessage: folder === 'trash' ? 'Выбранные письма удалены навсегда.' : 'Выбранные письма перемещены в удаленные.',
          });
        } else {
          void handleDeleteSelectedMessage?.(folder === 'trash');
        }
        return;
      }
      if (event.key === 'Escape') {
        if (mobileNavigationOpen) {
          event.preventDefault();
          setMobileNavigationOpen?.(false);
          return;
        }
        if (composeOpen) {
          event.preventDefault();
          composeCloseRequestRef?.current?.();
          return;
        }
        if (advancedSearchOpen) {
          event.preventDefault();
          setAdvancedSearchOpen?.(false);
          return;
        }
        if (mailPreferencesOpen) {
          event.preventDefault();
          setMailPreferencesOpen?.(false);
          return;
        }
        if (headersOpen) {
          event.preventDefault();
          closeHeadersDialog?.();
          return;
        }
        if (shortcutsOpen) {
          event.preventDefault();
          setShortcutsOpen?.(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    advancedSearchOpen,
    closeHeadersDialog,
    composeCloseRequestRef,
    composeOpen,
    folder,
    handleDeleteSelectedMessage,
    headersOpen,
    invalidateMailClientCache,
    mailPreferencesOpen,
    mobileNavigationOpen,
    openCompose,
    refreshFolderSummary,
    refreshList,
    runBulkAction,
    searchInputRef,
    selectedMessageId,
    selectedMessageIds,
    selectAdjacentMessage,
    setAdvancedSearchOpen,
    setMailPreferencesOpen,
    setMobileNavigationOpen,
    setShortcutsOpen,
    shortcutsOpen,
  ]);
}
