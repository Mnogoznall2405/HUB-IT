import { useEffect } from 'react';

const PRIMARY_MAILBOX_PASSWORD_ERROR = (
  'Для общего ящика нужно заново войти через AD, чтобы обновить пароль основной учетной записи.'
);

const clearMailSelection = ({
  selectedIdRef,
  setSelectedId,
  setSelectedMessage,
  setSelectedConversation,
  setSelectedItems,
  setSelectedByMode,
} = {}) => {
  selectedIdRef.current = '';
  setSelectedId('');
  setSelectedMessage(null);
  setSelectedConversation(null);
  setSelectedItems([]);
  setSelectedByMode({ messages: '', conversations: '' });
};

export default function useMailCredentialsDialogGate({
  mailboxInfo,
  mailRequiresRelogin,
  mailRequiresPassword,
  mailboxUsesPrimaryCredentials,
  canSaveMailForAllDevices,
  mailCredentialsOpen,
  mailCredentialsReason,
  mailCredentialsError,
  selectedIdRef,
  openMailCredentialsDialog,
  closeMailCredentialsDialog,
  setError,
  setSelectedId,
  setSelectedMessage,
  setSelectedConversation,
  setSelectedItems,
  setSelectedByMode,
} = {}) {
  useEffect(() => {
    if (!mailboxInfo) return;
    if (mailRequiresRelogin) {
      if (!canSaveMailForAllDevices) {
        closeMailCredentialsDialog();
      }
      return;
    }
    if (mailRequiresPassword) {
      if (mailboxUsesPrimaryCredentials) {
        closeMailCredentialsDialog();
        setError(PRIMARY_MAILBOX_PASSWORD_ERROR);
        clearMailSelection({
          selectedIdRef,
          setSelectedId,
          setSelectedMessage,
          setSelectedConversation,
          setSelectedItems,
          setSelectedByMode,
        });
        return;
      }
      openMailCredentialsDialog(mailboxInfo, {
        reason: mailCredentialsReason || 'missing',
        errorText: mailCredentialsError,
      });
      clearMailSelection({
        selectedIdRef,
        setSelectedId,
        setSelectedMessage,
        setSelectedConversation,
        setSelectedItems,
        setSelectedByMode,
      });
      return;
    }
    // Keep an AUTH_INVALID / expired-password dialog open so a brief "ready" config
    // (stale session password still present) cannot close it before the user saves.
    if (mailCredentialsReason === 'expired' && mailCredentialsOpen) {
      return;
    }
    closeMailCredentialsDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canSaveMailForAllDevices,
    closeMailCredentialsDialog,
    mailCredentialsError,
    mailCredentialsOpen,
    mailCredentialsReason,
    mailRequiresPassword,
    mailRequiresRelogin,
    mailboxUsesPrimaryCredentials,
    mailboxInfo,
    openMailCredentialsDialog,
  ]);
}
