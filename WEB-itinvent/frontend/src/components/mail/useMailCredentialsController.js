import { useCallback, useState } from 'react';

const PRIMARY_CREDENTIALS_MODE = 'primary_credentials';
const PRIMARY_SESSION_MODE = 'primary_session';

const hasMailboxIdentity = (config) => Boolean(
  config
  && (
    config?.mailbox_email
    || config?.effective_mailbox_login
    || config?.mailbox_login
  )
);

const authMode = (config) => String(config?.auth_mode || '').trim().toLowerCase();

export default function useMailCredentialsController({
  mailAPI,
  activeMailboxId = '',
  mailboxInfo = null,
  setMailboxInfo,
  setMailboxes,
  setSelectedMailboxId,
  mergeMailboxEntries,
  getMailboxEntryId,
  getMailErrorCode,
  getMailErrorDetail,
  refreshConfig,
  refreshBootstrap,
  invalidateMailClientCache,
  onError,
  onMessage,
} = {}) {
  const [mailCredentialsOpen, setMailCredentialsOpen] = useState(false);
  const [mailCredentialsSaving, setMailCredentialsSaving] = useState(false);
  const [mailCredentialsError, setMailCredentialsError] = useState('');
  const [mailCredentialsReason, setMailCredentialsReason] = useState('missing');
  const [mailCredentialsLogin, setMailCredentialsLogin] = useState('');
  const [mailCredentialsPassword, setMailCredentialsPassword] = useState('');
  const [mailCredentialsEmail, setMailCredentialsEmail] = useState('');

  const closeMailCredentialsDialog = useCallback(() => {
    setMailCredentialsOpen(false);
    setMailCredentialsError('');
    setMailCredentialsPassword('');
  }, []);

  const openMailCredentialsDialog = useCallback((config, { reason = 'missing', errorText = '' } = {}) => {
    const nextLogin = String(
      config?.mailbox_login
      || config?.effective_mailbox_login
      || mailboxInfo?.mailbox_login
      || mailboxInfo?.effective_mailbox_login
      || ''
    ).trim();
    const nextEmail = String(config?.mailbox_email || mailboxInfo?.mailbox_email || '').trim();
    setMailCredentialsReason(reason);
    setMailCredentialsError(String(errorText || '').trim());
    setMailCredentialsLogin(nextLogin);
    setMailCredentialsPassword('');
    setMailCredentialsEmail(nextEmail);
    setMailCredentialsOpen(true);
  }, [mailboxInfo?.effective_mailbox_login, mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login]);

  const handleMailCredentialsRequired = useCallback(async (requestError, fallbackMessage = '') => {
    const errorCode = getMailErrorCode?.(requestError);
    if (errorCode === 'MAIL_RELOGIN_REQUIRED') {
      const refreshedConfig = await refreshConfig?.();
      const nextConfig = refreshedConfig || mailboxInfo;
      const canSaveSharedCredentials = Boolean(
        nextConfig
        && authMode(nextConfig) === PRIMARY_SESSION_MODE
        && hasMailboxIdentity(nextConfig)
      );
      if (canSaveSharedCredentials) {
        openMailCredentialsDialog(nextConfig, {
          reason: 'shared',
          errorText: 'Сохраните пароль корпоративной почты, чтобы этот ящик работал на всех ваших устройствах.',
        });
        onError?.('Сохраните корпоративный пароль, чтобы почта снова открывалась без повторного входа.');
        return true;
      }
      closeMailCredentialsDialog();
      onError?.('Для доступа к почте войдите в систему заново.');
      return true;
    }
    if (errorCode !== 'MAIL_PASSWORD_REQUIRED' && errorCode !== 'MAIL_AUTH_INVALID') {
      return false;
    }
    const refreshedConfig = await refreshConfig?.();
    const nextConfig = refreshedConfig || mailboxInfo;
    if (authMode(nextConfig) === PRIMARY_CREDENTIALS_MODE) {
      closeMailCredentialsDialog();
      onError?.(
        errorCode === 'MAIL_AUTH_INVALID'
          ? 'Пароль основной AD-учетной записи устарел или неверен. Выйдите и снова войдите через AD.'
          : 'Для общего ящика нужно заново войти через AD, чтобы обновить пароль основной учетной записи.'
      );
      return true;
    }
    const canSaveOnPage = hasMailboxIdentity(nextConfig);
    if (canSaveOnPage) {
      openMailCredentialsDialog(nextConfig, {
        reason: errorCode === 'MAIL_AUTH_INVALID' ? 'expired' : 'missing',
        errorText: errorCode === 'MAIL_AUTH_INVALID'
          ? 'Пароль от корпоративного компьютера изменился. Введите новый пароль — полный повторный вход в HUB не нужен.'
          : '',
      });
      onError?.(errorCode === 'MAIL_AUTH_INVALID'
        ? 'Пароль изменился. Обновите его здесь, на странице Почта.'
        : String(fallbackMessage || '').trim());
      return true;
    }
    openMailCredentialsDialog(nextConfig, {
      reason: errorCode === 'MAIL_AUTH_INVALID' ? 'expired' : 'missing',
      errorText: errorCode === 'MAIL_AUTH_INVALID'
        ? 'Неверный или устаревший пароль. Введите актуальный пароль от корпоративного компьютера (Windows).'
        : '',
    });
    onError?.(errorCode === 'MAIL_AUTH_INVALID'
      ? 'Неверный или устаревший пароль. Введите актуальный пароль от корпоративного компьютера (Windows).'
      : String(fallbackMessage || '').trim());
    return true;
  }, [
    closeMailCredentialsDialog,
    getMailErrorCode,
    mailboxInfo,
    onError,
    openMailCredentialsDialog,
    refreshConfig,
  ]);

  const handleSaveMailCredentials = useCallback(async () => {
    const login = String(mailCredentialsLogin || '').trim();
    const password = String(mailCredentialsPassword || '').trim();
    const mailboxEmail = String(mailCredentialsEmail || '').trim();
    if (!password) {
      setMailCredentialsError('Введите пароль от корпоративного компьютера.');
      return;
    }
    setMailCredentialsSaving(true);
    setMailCredentialsError('');
    try {
      const data = await mailAPI?.saveMyCredentials?.({
        mailbox_id: getMailboxEntryId?.(mailboxInfo) || activeMailboxId || undefined,
        mailbox_login: login || undefined,
        mailbox_password: password,
        mailbox_email: mailboxEmail || undefined,
      });
      setMailboxInfo?.(data || null);
      setMailboxes?.((prev) => mergeMailboxEntries?.(prev, data || null) || prev);
      const resolvedMailboxId = getMailboxEntryId?.(data);
      if (resolvedMailboxId) {
        setSelectedMailboxId?.(resolvedMailboxId);
      }
      closeMailCredentialsDialog();
      onError?.('');
      onMessage?.('Корпоративный пароль сохранён в профиле. Этот ящик доступен на всех ваших устройствах.');
      invalidateMailClientCache?.();
      await refreshBootstrap?.({ force: true, live: true });
    } catch (requestError) {
      setMailCredentialsError(
        getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось сохранить корпоративный пароль.')
          : 'Не удалось сохранить корпоративный пароль.'
      );
    } finally {
      setMailCredentialsSaving(false);
    }
  }, [
    activeMailboxId,
    closeMailCredentialsDialog,
    getMailErrorDetail,
    getMailboxEntryId,
    invalidateMailClientCache,
    mailAPI,
    mailCredentialsEmail,
    mailCredentialsLogin,
    mailCredentialsPassword,
    mailboxInfo,
    mergeMailboxEntries,
    onError,
    onMessage,
    refreshBootstrap,
    setMailboxInfo,
    setMailboxes,
    setSelectedMailboxId,
  ]);

  return {
    mailCredentialsOpen,
    mailCredentialsSaving,
    mailCredentialsError,
    mailCredentialsReason,
    mailCredentialsLogin,
    mailCredentialsPassword,
    mailCredentialsEmail,
    setMailCredentialsOpen,
    setMailCredentialsError,
    setMailCredentialsReason,
    setMailCredentialsLogin,
    setMailCredentialsPassword,
    setMailCredentialsEmail,
    openMailCredentialsDialog,
    closeMailCredentialsDialog,
    handleMailCredentialsRequired,
    handleSaveMailCredentials,
  };
}
