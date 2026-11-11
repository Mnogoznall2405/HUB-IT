import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { passwordsAPI } from '../../api/passwords';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { getPasskeyAssertion } from '../../lib/passkeyWebAuthn';
import { extractWebAuthnErrorMessage } from '../../lib/trustedDeviceEnrollment';
import { useWebAuthnAvailability } from '../../lib/useWebAuthnAvailability';
import {
  PASSWORD_HIDE_MS,
  buildSecretWatermark,
  copyPasswordWithAutoClear,
  isUnlockedUntilActive,
  isVaultDecryptError,
  isVaultUnlockRequiredError,
  pickActiveUnlockedUntil,
  readStoredVaultUnlockUntil,
  retryPendingClipboardClear,
  writeStoredVaultUnlockUntil,
} from './passwordVaultUtils';

/**
 * Единственная реализация доступа к секретам хранилища: подтверждение 2FA/passkey,
 * раскрытие и копирование пароля с автоскрытием, очистка буфера обмена, затемнение при уходе
 * с вкладки. Её используют и страница «Пароли», и раздел паролей в карточке объекта ИТ.
 *
 * onActivity — что обновить после раскрытия пароля (журнал на странице, журнал в карточке).
 */
export default function usePasswordVaultAccess({ onActivity = null } = {}) {
  const { user, refreshSession } = useAuth();
  const { notifySuccess, notifyInfo, notifyWarning, notifyApiError } = useNotification();
  const { webAuthnReady } = useWebAuthnAvailability();
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const [unlockedUntil, setUnlockedUntil] = useState(() => readStoredVaultUnlockUntil(user?.id));
  const [revealBusyId, setRevealBusyId] = useState('');
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [revealExpiresAt, setRevealExpiresAt] = useState({});
  const [privacyCoverActive, setPrivacyCoverActive] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockMode, setUnlockMode] = useState('verify');
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockSetupCode, setUnlockSetupCode] = useState('');
  const [unlockSetupData, setUnlockSetupData] = useState(null);
  const [unlockSetupLoading, setUnlockSetupLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [pendingReveal, setPendingReveal] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const hideTimersRef = useRef({});
  // Bumped whenever secrets are hidden or the account changes; a reveal started under an
  // older epoch is discarded when its response arrives.
  const revealEpochRef = useRef(0);

  const passkeyUnlockAvailable = webAuthnReady && Number(user?.trusted_devices_count || 0) > 0;
  const isUnlocked = isUnlockedUntilActive(unlockedUntil);
  const unlockedRemainingMs = useMemo(() => {
    const parsed = new Date(unlockedUntil || '');
    if (Number.isNaN(parsed.getTime())) return 0;
    return Math.max(0, parsed.getTime() - nowTs);
  }, [nowTs, unlockedUntil]);

  const isUnlockExpiringSoon = isUnlocked && unlockedRemainingMs > 0 && unlockedRemainingMs <= 30_000;

  const syncUnlockedUntil = useCallback((...candidates) => {
    const resolved = pickActiveUnlockedUntil(
      readStoredVaultUnlockUntil(user?.id),
      ...candidates,
    );
    setUnlockedUntil(resolved);
    writeStoredVaultUnlockUntil(user?.id, resolved);
    return resolved;
  }, [user?.id]);

  useEffect(() => {
    syncUnlockedUntil(unlockedUntil);
  }, [user?.id, syncUnlockedUntil]);

  useEffect(() => {
    revealEpochRef.current += 1;
  }, [user?.id]);

  useEffect(() => () => {
    Object.values(hideTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  const hasRevealedSecrets = Object.keys(revealedPasswords).length > 0;

  useEffect(() => {
    if (!isUnlocked && !hasRevealedSecrets) return undefined;
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRevealedSecrets, isUnlocked]);

  const secretWatermark = buildSecretWatermark(user?.username, nowTs);

  const hidePassword = (entryId) => {
    window.clearTimeout(hideTimersRef.current[entryId]);
    delete hideTimersRef.current[entryId];
    setRevealedPasswords((prev) => {
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
    setRevealExpiresAt((prev) => {
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  };

  const scheduleHide = (entryId) => {
    window.clearTimeout(hideTimersRef.current[entryId]);
    hideTimersRef.current[entryId] = window.setTimeout(() => hidePassword(entryId), PASSWORD_HIDE_MS);
    setRevealExpiresAt((prev) => ({ ...prev, [entryId]: Date.now() + PASSWORD_HIDE_MS }));
  };

  const hideAllPasswords = useCallback(() => {
    // Any reveal still in flight belongs to a view the user has just hidden/left (blur, tab
    // hide, print): its late answer must not bring the plaintext back or reach the clipboard.
    revealEpochRef.current += 1;
    Object.values(hideTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    hideTimersRef.current = {};
    setRevealedPasswords({});
    setRevealExpiresAt({});
  }, []);

  useEffect(() => {
    const cover = () => {
      document.documentElement.classList.add('vault-privacy-blur');
      hideAllPasswords();
      setPrivacyCoverActive(true);
    };
    const uncover = () => {
      if (document.hidden || !document.hasFocus()) return;
      document.documentElement.classList.remove('vault-privacy-blur');
      setPrivacyCoverActive(false);
      retryPendingClipboardClear({
        onCleared: () => notifyInfo('Буфер обмена очищен.', { source: 'passwords', dedupeMode: 'none' }),
        onClearFailed: () => notifyWarning(
          'Буфер обмена не очищен — вернитесь на вкладку для очистки.',
          { source: 'passwords', dedupeMode: 'recent' },
        ),
      });
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cover();
      } else {
        uncover();
      }
    };
    const handlePrint = () => hideAllPasswords();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', cover);
    window.addEventListener('focus', uncover);
    window.addEventListener('beforeprint', handlePrint);
    window.addEventListener('afterprint', handlePrint);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', cover);
      window.removeEventListener('focus', uncover);
      window.removeEventListener('beforeprint', handlePrint);
      window.removeEventListener('afterprint', handlePrint);
      document.documentElement.classList.remove('vault-privacy-blur');
    };
  }, [hideAllPasswords, notifyInfo, notifyWarning]);

  const copyPassword = async (value) => {
    const copied = await copyPasswordWithAutoClear(value, {
      onCleared: () => notifyInfo('Буфер обмена очищен.', { source: 'passwords', dedupeMode: 'none' }),
      onClearFailed: () => notifyWarning(
        'Буфер обмена не очищен — вернитесь на вкладку для очистки.',
        { source: 'passwords', dedupeMode: 'none' },
      ),
    });
    if (!copied) {
      notifyWarning('Буфер обмена недоступен в этом браузере.', { source: 'passwords', dedupeMode: 'none' });
    }
    return copied;
  };

  const loadUnlockSetup = useCallback(async () => {
    setUnlockSetupLoading(true);
    try {
      const setup = await passwordsAPI.unlockSetup2fa();
      setUnlockSetupData(setup);
      return setup;
    } catch (error) {
      notifyApiError(error, 'Не удалось подготовить настройку 2FA.', { dedupeMode: 'none' });
      setUnlockDialogOpen(false);
      return null;
    } finally {
      setUnlockSetupLoading(false);
    }
  }, [notifyApiError]);

  const openUnlockDialog = useCallback(() => {
    setUnlockCode('');
    setUnlockSetupCode('');
    if (!user?.is_2fa_enabled) {
      setUnlockMode('setup');
      setUnlockSetupData(null);
      setUnlockDialogOpen(true);
      void loadUnlockSetup();
      return;
    }
    setUnlockMode('verify');
    setUnlockDialogOpen(true);
  }, [loadUnlockSetup, user?.is_2fa_enabled]);

  const revealEntry = async (entry, purpose, { allowUnlockPrompt = false } = {}) => {
    const epoch = revealEpochRef.current;
    setRevealBusyId(`${entry.id}:${purpose}`);
    try {
      const payload = await passwordsAPI.revealEntry(entry.id, { purpose });
      if (revealEpochRef.current !== epoch) {
        // Hidden/blurred/switched account while the request was in flight: drop the secret.
        return false;
      }
      syncUnlockedUntil(payload?.unlocked_until);
      if (purpose === 'copy') {
        const copied = await copyPassword(payload.password || '');
        if (copied) {
          notifySuccess('Пароль скопирован.', { source: 'passwords', dedupeMode: 'none', durationMs: 1800 });
        }
      } else {
        setRevealedPasswords((prev) => ({ ...prev, [entry.id]: payload.password || '' }));
        scheduleHide(entry.id);
      }
      await onActivityRef.current?.();
      return true;
    } catch (error) {
      if (allowUnlockPrompt && isVaultUnlockRequiredError(error)) {
        setPendingReveal({ entry, purpose });
        openUnlockDialog();
        return false;
      }
      notifyApiError(
        error,
        isVaultDecryptError(error)
          ? 'Пароль зашифрован старым ключом и не читается. Пересохраните запись или обратитесь к администратору.'
          : 'Не удалось раскрыть пароль.',
        { dedupeMode: 'none' },
      );
      return false;
    } finally {
      setRevealBusyId('');
    }
  };

  const requestReveal = (entry, purpose) => {
    revealEntry(entry, purpose, { allowUnlockPrompt: true });
  };

  const handleCopyLogin = async (entry) => {
    try {
      const copied = await copyPassword(entry.login);
      if (copied) {
        notifySuccess('Логин скопирован.', { source: 'passwords', dedupeMode: 'none', durationMs: 1800 });
      }
    } catch {
      notifyWarning('Не удалось скопировать логин.', { source: 'passwords', dedupeMode: 'none' });
    }
  };

  const completeUnlock = useCallback(async (unlockedUntilValue, { notifyMessage } = {}) => {
    const resolvedUnlock = syncUnlockedUntil(unlockedUntilValue);
    setUnlockDialogOpen(false);
    setUnlockCode('');
    setUnlockSetupCode('');
    setUnlockSetupData(null);
    setUnlockMode('verify');
    notifySuccess(
      notifyMessage || 'Доступ к раскрытию паролей открыт на 5 минут.',
      { source: 'passwords', dedupeMode: 'none' },
    );
    const nextReveal = pendingReveal;
    setPendingReveal(null);
    if (nextReveal?.entry) {
      await revealEntry(nextReveal.entry, nextReveal.purpose);
    }
    syncUnlockedUntil(resolvedUnlock);
    await onActivityRef.current?.();
  }, [notifySuccess, pendingReveal, revealEntry, syncUnlockedUntil]);

  const handleUnlock = async () => {
    const code = unlockCode.trim();
    if (!code) return;
    setUnlocking(true);
    try {
      const payload = /^\d+$/.test(code) ? { totp_code: code } : { backup_code: code };
      const result = await passwordsAPI.unlock(payload);
      await completeUnlock(result?.unlocked_until || null);
    } catch (error) {
      notifyApiError(error, 'Не удалось подтвердить 2FA.', { dedupeMode: 'none' });
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlockWithPasskey = async () => {
    setUnlocking(true);
    try {
      const optionsResult = await passwordsAPI.unlockWebAuthnOptions();
      const credential = await getPasskeyAssertion(optionsResult.public_key);
      const result = await passwordsAPI.unlockWebAuthnVerify({
        challenge_id: optionsResult.challenge_id,
        credential,
      });
      await completeUnlock(result?.unlocked_until || null);
    } catch (error) {
      notifyWarning(
        extractWebAuthnErrorMessage(error, 'Не удалось подтвердить passkey.'),
        { source: 'passwords', dedupeMode: 'none' },
      );
    } finally {
      setUnlocking(false);
    }
  };

  const handleVerify2faSetup = async () => {
    const code = unlockSetupCode.trim();
    if (code.length < 6 || !unlockSetupData?.setup_challenge_id) return;
    setUnlocking(true);
    try {
      const result = await passwordsAPI.unlockVerify2faSetup({
        setup_challenge_id: unlockSetupData.setup_challenge_id,
        totp_code: code,
      });
      await refreshSession();
      const backupCodes = Array.isArray(result?.backup_codes) ? result.backup_codes : [];
      const notifyMessage = backupCodes.length
        ? `2FA подключён. Сохраните backup-коды: ${backupCodes.join(', ')}`
        : '2FA подключён. Хранилище разблокировано.';
      await completeUnlock(result?.unlocked_until || null, { notifyMessage });
    } catch (error) {
      notifyApiError(error, 'Не удалось подтвердить настройку 2FA.', { dedupeMode: 'none' });
    } finally {
      setUnlocking(false);
    }
  };

  const closeUnlockDialog = () => {
    setUnlockDialogOpen(false);
    setUnlockSetupCode('');
    setUnlockSetupData(null);
    setUnlockMode('verify');
  };

  // Всё, что нужно <PasswordUnlockDialog>, кроме isMobile (его знает вызывающий).
  const unlockDialogProps = {
    open: unlockDialogOpen,
    mode: unlockMode,
    accountName: user?.username || '',
    unlockCode,
    setupCode: unlockSetupCode,
    setupData: unlockSetupData,
    setupLoading: unlockSetupLoading,
    unlocking,
    passkeyAvailable: passkeyUnlockAvailable && unlockMode === 'verify',
    onClose: closeUnlockDialog,
    onCodeChange: (event) => setUnlockCode(event.target.value),
    onSetupCodeChange: (event) => setUnlockSetupCode(event.target.value),
    onSubmit: handleUnlock,
    onSetupSubmit: handleVerify2faSetup,
    onReloadSetup: loadUnlockSetup,
    onPasskeyUnlock: handleUnlockWithPasskey,
  };

  return {
    user,
    isUnlocked,
    unlockedUntil,
    unlockedRemainingMs,
    isUnlockExpiringSoon,
    nowTs,
    revealBusyId,
    revealedPasswords,
    revealExpiresAt,
    privacyCoverActive,
    secretWatermark,
    syncUnlockedUntil,
    openUnlockDialog,
    requestReveal,
    hidePassword,
    copyPassword,
    handleCopyLogin,
    unlockDialogProps,
  };
}
