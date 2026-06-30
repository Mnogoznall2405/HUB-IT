import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { authAPI, settingsAPI } from '../../../api/client';
import { passwordsAPI } from '../../../api/passwords';
import { databaseAPI } from '../../../api/database';
import {
  PERSONAL_SETTINGS_SECTIONS,
  getAvailableAdminSections,
  resolveLegacySettingsTarget,
} from '../../../components/account/accountNavigationConfig';
import {
  getVisibleNavigationItems,
  resolveMobileNavigationItems,
} from '../../../components/layout/navigationConfig';
import {
  buildDefaultTrustedDeviceLabel,
  extractWebAuthnErrorMessage,
  normalizeWebAuthnErrorName,
  registerTrustedDevice,
  resolveTrustedDeviceRegistrationMode,
} from '../../../lib/trustedDeviceEnrollment';
import { isPasskeyRegistrationAvailable } from '../../../lib/passkeyWebAuthn';
import { createNavigateToastAction } from '../../../components/feedback/toastActions';
import {
  normalizeMobileBottomNavItems,
  usePreferences,
} from '../../../contexts/PreferencesContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { useAuth } from '../../../contexts/AuthContext';
import {
  DESKTOP_SCROLL_QUERY,
  SETTINGS_VERY_WIDE_QUERY,
} from '../accountConstants';
import {
  mergeTaskDelegatesIntoUsers,
  normalizePermissions,
  normalizeTaskDelegateLinks,
} from '../accountUserModel';
import { normalizeAppSettingsState } from '../admin/appSettingsModel';

export function useAccountSectionData(area = 'settings') {
  const isDesktopViewport = useMediaQuery(DESKTOP_SCROLL_QUERY);
  const isVeryWide = useMediaQuery(SETTINGS_VERY_WIDE_QUERY);
  const location = useLocation();
  const navigate = useNavigate();
  const { section = '' } = useParams();
  const pageRef = useRef(null);

  const { user, hasPermission, refreshSession, logout } = useAuth();
  const { preferences, savePreferences } = usePreferences();
  const {
    notifySuccess: pushNotifySuccess,
    notifyInfo: pushNotifyInfo,
    notifyApiError: pushNotifyApiError,
  } = useNotification();
  const settingsToastAction = useMemo(() => createNavigateToastAction('/settings', 'Открыть настройки'), []);
  const notifySuccess = useCallback((message, options = {}) => (
    pushNotifySuccess(message, { source: 'settings', action: settingsToastAction, ...options })
  ), [pushNotifySuccess, settingsToastAction]);
  const notifyInfo = useCallback((message, options = {}) => (
    pushNotifyInfo(message, { source: 'settings', action: settingsToastAction, ...options })
  ), [pushNotifyInfo, settingsToastAction]);
  const notifyApiError = useCallback((error, fallbackMessage, options = {}) => (
    pushNotifyApiError(error, fallbackMessage, { source: 'settings', action: settingsToastAction, ...options })
  ), [pushNotifyApiError, settingsToastAction]);

  const isAdmin = String(user?.role || '').trim() === 'admin';
  const canManageUsers = isAdmin || hasPermission('settings.users.manage');
  const canManageSessions = isAdmin || hasPermission('settings.sessions.manage');
  const canManageAiBots = isAdmin || hasPermission('settings.ai.manage');
  const canManageDepartments = isAdmin || hasPermission('departments.manage');
  const canAccessMail = hasPermission('mail.access');
  const adminSections = useMemo(
    () => getAvailableAdminSections({ user, hasPermission }),
    [hasPermission, user],
  );
  const requestedSection = String(section || '').trim();
  const personalSectionKeys = useMemo(
    () => new Set(PERSONAL_SETTINGS_SECTIONS.map((item) => item.key)),
    [],
  );
  const adminSectionKeys = useMemo(
    () => new Set(adminSections.map((item) => item.key)),
    [adminSections],
  );
  const activeSection = area === 'profile'
    ? 'profile'
    : area === 'admin'
      ? (
        adminSectionKeys.has(requestedSection)
          ? requestedSection
          : (isDesktopViewport ? adminSections[0]?.key || '' : '')
      )
      : (
        personalSectionKeys.has(requestedSection)
          ? requestedSection
          : (isDesktopViewport ? 'appearance' : '')
      );
  const tab = activeSection === 'system' ? 'env' : activeSection;
  const [blockingError, setBlockingError] = useState('');
  const [themeMode, setThemeMode] = useState(preferences.theme_mode || 'light');
  const [fontFamily, setFontFamily] = useState(preferences.font_family || 'Aptos');
  const [fontScale, setFontScale] = useState(Number(preferences.font_scale || 1));
  const [mobileBottomNavItems, setMobileBottomNavItems] = useState(
    () => normalizeMobileBottomNavItems(preferences.mobile_bottom_nav_items),
  );
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [databases, setDatabases] = useState([]);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [databasesLoaded, setDatabasesLoaded] = useState(false);
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [cleanupResult, setCleanupResult] = useState({ deactivated: 0, deleted: 0 });
  const [cleaningSessions, setCleaningSessions] = useState(false);
  const [purgingSessions, setPurgingSessions] = useState(false);
  const [envState, setEnvState] = useState({ items: [], deployment_targets: [], apply_plan: [], recent_changes: [], updated: 0 });
  const [envLoading, setEnvLoading] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [aiBotsState, setAiBotsState] = useState([]);
  const [aiBotsLoading, setAiBotsLoading] = useState(false);
  const [savingAiBotId, setSavingAiBotId] = useState('');
  const [aiBotRunsById, setAiBotRunsById] = useState({});
  const [appSettingsState, setAppSettingsState] = useState(() => normalizeAppSettingsState(null));
  const [appSettingsLoading, setAppSettingsLoading] = useState(false);
  const [savingAppSettings, setSavingAppSettings] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [resettingTwoFactor, setResettingTwoFactor] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState([]);
  const [backupCodes, setBackupCodes] = useState([]);
  const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
  const [linkTrustedDeviceOpen, setLinkTrustedDeviceOpen] = useState(false);
  const [linkTrustedDeviceLabel, setLinkTrustedDeviceLabel] = useState('');
  const [linkTrustedDeviceError, setLinkTrustedDeviceError] = useState('');
  const [linkingTrustedDevice, setLinkingTrustedDevice] = useState(false);
  const [passkeyLinkAvailable, setPasskeyLinkAvailable] = useState(false);
  const [passwordGroups, setPasswordGroups] = useState([]);
  const [passwordGroupsLoading, setPasswordGroupsLoading] = useState(false);
  const [passwordGroupsSaving, setPasswordGroupsSaving] = useState(false);
  const linkTrustedDeviceModeRef = useRef({ platformOnly: false });

  useEffect(() => {
    setThemeMode(preferences.theme_mode || 'light');
    setFontFamily(preferences.font_family || 'Aptos');
    setFontScale(Number(preferences.font_scale || 1));
    setMobileBottomNavItems(normalizeMobileBottomNavItems(preferences.mobile_bottom_nav_items));
  }, [preferences]);

  const availableNavigationItems = useMemo(
    () => getVisibleNavigationItems({ user, hasPermission }),
    [hasPermission, user],
  );
  const resolvedMobileNavigationItems = useMemo(
    () => resolveMobileNavigationItems({
      selectedPaths: mobileBottomNavItems,
      user,
      hasPermission,
    }),
    [hasPermission, mobileBottomNavItems, user],
  );

  useEffect(() => {
    if (area !== 'settings') return;
    const legacyTarget = resolveLegacySettingsTarget(location.search, location.hash);
    if (legacyTarget) navigate(legacyTarget, { replace: true });
  }, [area, location.hash, location.search, navigate]);

  const dbOptions = useMemo(
    () => databases.map((db) => ({ id: String(db.id), name: db.name })),
    [databases],
  );

  const loadDatabases = useCallback(async () => {
    setDatabasesLoading(true);
    try {
      const data = await databaseAPI.getAvailableDatabases();
      setDatabases(Array.isArray(data) ? data : []);
      setDatabasesLoaded(true);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setDatabasesLoaded(false);
      setBlockingError('Не удалось загрузить список баз данных.');
    } finally {
      setDatabasesLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    setUsersLoading(true);
    try {
      const data = await authAPI.getUsers();
      const baseUsers = (Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        use_custom_permissions: Boolean(item?.use_custom_permissions),
        custom_permissions: normalizePermissions(item?.custom_permissions),
      }));
      let usersWithDelegates = mergeTaskDelegatesIntoUsers(baseUsers, { items: [] });
      if (baseUsers.length > 0) {
        try {
          const delegatesPayload = await authAPI.getTaskDelegatesBulk(baseUsers.map((item) => item.id));
          usersWithDelegates = mergeTaskDelegatesIntoUsers(baseUsers, delegatesPayload);
        } catch (delegateError) {
          console.error(delegateError);
        }
      }
      setUsers(usersWithDelegates);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить пользователей.');
    } finally {
      setUsersLoading(false);
    }
  }, [canManageUsers]);

  const loadSessions = useCallback(async () => {
    if (!canManageSessions) return;
    setSessionsLoading(true);
    try {
      const data = await authAPI.getSessions();
      setSessions(Array.isArray(data) ? data : []);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить сессии.');
    } finally {
      setSessionsLoading(false);
    }
  }, [canManageSessions]);

  const loadEnv = useCallback(async () => {
    if (!isAdmin) return;
    setEnvLoading(true);
    try {
      const data = await settingsAPI.getEnvSettings();
      setEnvState({
        items: Array.isArray(data?.items) ? data.items : [],
        deployment_targets: Array.isArray(data?.deployment_targets) ? data.deployment_targets : [],
        apply_plan: Array.isArray(data?.apply_plan) ? data.apply_plan : [],
        recent_changes: Array.isArray(data?.recent_changes) ? data.recent_changes : [],
        updated: Number(data?.updated || 0),
      });
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить переменные окружения.');
    } finally {
      setEnvLoading(false);
    }
  }, [isAdmin]);

  const loadAppSettings = useCallback(async () => {
    if (!isAdmin) return;
    setAppSettingsLoading(true);
    try {
      const data = await settingsAPI.getAppSettings();
      setAppSettingsState(normalizeAppSettingsState(data));
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить web-настройки reminder-задач.');
    } finally {
      setAppSettingsLoading(false);
    }
  }, [isAdmin]);

  const loadPasswordGroups = useCallback(async () => {
    if (!isAdmin) return;
    setPasswordGroupsLoading(true);
    try {
      const data = await passwordsAPI.getGroups({ include_inactive: true });
      setPasswordGroups(Array.isArray(data?.items) ? data.items : []);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить группы хранилища паролей.');
    } finally {
      setPasswordGroupsLoading(false);
    }
  }, [isAdmin]);

  const loadAiBotsAdmin = useCallback(async () => {
    if (!canManageAiBots) return;
    setAiBotsLoading(true);
    try {
      const data = await settingsAPI.getAiBots();
      const items = Array.isArray(data) ? data : [];
      setAiBotsState(items);
      const runsEntries = await Promise.all(
        items.map(async (item) => {
          try {
            const runsResponse = await settingsAPI.getAiBotRuns(item.id);
            return [item.id, Array.isArray(runsResponse?.items) ? runsResponse.items : []];
          } catch {
            return [item.id, []];
          }
        }),
      );
      setAiBotRunsById(Object.fromEntries(runsEntries));
      setBlockingError('');
      return items;
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить настройки AI-ботов.');
      return [];
    } finally {
      setAiBotsLoading(false);
    }
  }, [canManageAiBots]);

  const loadSecurity = useCallback(async () => {
    if (!user?.id) return;
    setSecurityLoading(true);
    try {
      const devices = await authAPI.getTrustedDevices();
      setTrustedDevices(Array.isArray(devices) ? devices : []);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить данные по безопасности входа.');
    } finally {
      setSecurityLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const needsDatabases = tab === 'profile' || (tab === 'users' && canManageUsers) || (tab === 'ai-bots' && canManageAiBots);
    if (user && needsDatabases && !databasesLoaded && !databasesLoading) {
      loadDatabases();
    }
  }, [canManageAiBots, canManageUsers, databasesLoaded, databasesLoading, loadDatabases, tab, user]);

  useEffect(() => {
    setBlockingError('');
    if (tab === 'security') {
      loadSecurity();
    }
    if (tab === 'users' && canManageUsers) {
      loadUsers();
      if (canManageSessions) loadSessions();
    }
    if (tab === 'sessions' && canManageSessions) {
      loadSessions();
    }
    if (tab === 'env' && isAdmin) {
      loadEnv();
      loadAppSettings();
      loadPasswordGroups();
    }
    if (tab === 'ai-bots' && canManageAiBots) {
      loadAiBotsAdmin();
    }
  }, [tab, canManageUsers, canManageSessions, canManageAiBots, isAdmin, loadUsers, loadSessions, loadEnv, loadAppSettings, loadAiBotsAdmin, loadSecurity, loadPasswordGroups]);

  const handleSavePreferences = useCallback(async () => {
    setSavingPreferences(true);
    setBlockingError('');
    try {
      await savePreferences({
        theme_mode: themeMode,
        font_family: fontFamily,
        font_scale: Number(fontScale),
        mobile_bottom_nav_items: mobileBottomNavItems,
      });
      notifySuccess('Настройки внешнего вида сохранены.', { source: 'settings', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить настройки внешнего вида.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingPreferences(false);
    }
  }, [fontFamily, fontScale, mobileBottomNavItems, notifyApiError, notifySuccess, savePreferences, themeMode]);

  const handleRegenerateBackupCodes = useCallback(async () => {
    try {
      const response = await authAPI.regenerateBackupCodes();
      setBackupCodes(Array.isArray(response?.backup_codes) ? response.backup_codes : []);
      setBackupCodesDialogOpen(true);
      notifySuccess('Новые backup-коды сгенерированы. Сохраните их в безопасном месте.', { dedupeMode: 'none' });
      await loadSecurity();
    } catch (error) {
      notifyApiError(error, 'Не удалось сгенерировать backup-коды.', { dedupeMode: 'none' });
    }
  }, [loadSecurity, notifyApiError, notifySuccess]);

  const handleRevokeTrustedDevice = useCallback(async (deviceId) => {
    try {
      await authAPI.revokeTrustedDevice(deviceId);
      await refreshSession({ suppressAuthRequired: true });
      notifySuccess('Доверенное устройство отозвано.', { dedupeMode: 'none' });
      await loadSecurity();
    } catch (error) {
      notifyApiError(error, 'Не удалось отозвать доверенное устройство.', { dedupeMode: 'none' });
    }
  }, [loadSecurity, notifyApiError, notifySuccess, refreshSession]);

  const handleReloadSecurity = useCallback(async () => {
    try {
      await refreshSession({ suppressAuthRequired: true });
    } catch (error) {
      console.error(error);
    }
    await loadSecurity();
  }, [loadSecurity, refreshSession]);

  useEffect(() => {
    let cancelled = false;
    const evaluatePasskeyLink = async () => {
      if (user?.network_zone !== 'external') {
        if (!cancelled) {
          setPasskeyLinkAvailable(false);
        }
        return;
      }
      const available = await isPasskeyRegistrationAvailable();
      if (!cancelled) {
        setPasskeyLinkAvailable(Boolean(available));
      }
    };
    evaluatePasskeyLink();
    return () => {
      cancelled = true;
    };
  }, [user?.network_zone]);

  const handleOpenLinkTrustedDevice = useCallback(async () => {
    setLinkTrustedDeviceError('');
    setLinkTrustedDeviceLabel(buildDefaultTrustedDeviceLabel());
    const registrationMode = await resolveTrustedDeviceRegistrationMode();
    if (registrationMode.mode === 'unsupported') {
      setLinkTrustedDeviceError(registrationMode.hint);
      setLinkTrustedDeviceOpen(true);
      linkTrustedDeviceModeRef.current = { platformOnly: false };
      return;
    }
    linkTrustedDeviceModeRef.current = { platformOnly: registrationMode.platformOnly };
    setLinkTrustedDeviceOpen(true);
  }, []);

  const handleCloseLinkTrustedDevice = useCallback(() => {
    if (linkingTrustedDevice) {
      return;
    }
    setLinkTrustedDeviceOpen(false);
    setLinkTrustedDeviceError('');
  }, [linkingTrustedDevice]);

  const handleConfirmLinkTrustedDevice = useCallback(async () => {
    setLinkingTrustedDevice(true);
    setLinkTrustedDeviceError('');
    try {
      await registerTrustedDevice({
        authAPI,
        label: linkTrustedDeviceLabel,
        platformOnly: linkTrustedDeviceModeRef.current.platformOnly,
      });
      setLinkTrustedDeviceOpen(false);
      notifySuccess('Это устройство привязано. Теперь можно входить через passkey снаружи.', { dedupeMode: 'none' });
      await refreshSession({ suppressAuthRequired: true });
      await loadSecurity();
    } catch (error) {
      if (normalizeWebAuthnErrorName(error) === 'InvalidStateError') {
        setLinkTrustedDeviceOpen(false);
        notifySuccess('Passkey на этом устройстве уже сохранён.', { dedupeMode: 'none' });
        await loadSecurity();
        return;
      }
      setLinkTrustedDeviceError(
        extractWebAuthnErrorMessage(error, 'Не удалось привязать это устройство.'),
      );
    } finally {
      setLinkingTrustedDevice(false);
    }
  }, [linkTrustedDeviceLabel, loadSecurity, notifySuccess, refreshSession]);

  const handleResetTwoFactor = useCallback(async () => {
    if (!user?.id) return;
    const confirmed = window.confirm(
      'Сбросить 2FA и удалить все доверенные устройства для этой учётной записи? После этого нужно будет войти заново и настроить код повторно.'
    );
    if (!confirmed) return;
    setResettingTwoFactor(true);
    try {
      await authAPI.resetOwnTwoFactor();
      notifySuccess('2FA и доверенные устройства сброшены. Войдите заново и настройте код повторно.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      await logout();
      window.location.assign('/login');
    } catch (error) {
      notifyApiError(error, 'Не удалось сбросить 2FA для текущей учётной записи.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setResettingTwoFactor(false);
    }
  }, [logout, notifyApiError, notifySuccess, user?.id]);

  const handleCreateUser = useCallback(async (draft) => {
    setSavingUser(true);
    try {
      const payload = {
        username: draft.username,
        password: draft.auth_source === 'ldap' ? null : (String(draft.password || '').trim() || null),
        full_name: draft.full_name || null,
        department: draft.department || null,
        job_title: draft.job_title || null,
        email: draft.email || null,
        mailbox_email: draft.mailbox_email || null,
        mailbox_login: draft.mailbox_login || null,
        role: draft.role || 'viewer',
        auth_source: draft.auth_source || 'local',
        telegram_id: draft.telegram_id ? Number(draft.telegram_id) : null,
        assigned_database: draft.assigned_database || null,
        is_active: Boolean(draft.is_active),
        use_custom_permissions: Boolean(draft.use_custom_permissions),
        custom_permissions: normalizePermissions(draft.custom_permissions),
      };
      if (payload.auth_source !== 'ldap' && String(payload.password || '').length < 6) {
        notifyInfo('Для локального пользователя нужен пароль не короче 6 символов.', {
          source: 'settings',
          dedupeMode: 'none',
        });
        return { ok: false };
      }
      const created = await authAPI.createUser(payload);
      if (Array.isArray(draft.task_delegate_links) && draft.task_delegate_links.length > 0) {
        await authAPI.updateTaskDelegates(
          created.id,
          normalizeTaskDelegateLinks(draft.task_delegate_links).map((item) => ({
            delegate_user_id: Number(item.delegate_user_id),
            role_type: item.role_type === 'deputy' ? 'deputy' : 'assistant',
            is_active: item.is_active !== false,
          })),
        );
      }
      await loadUsers();
      notifySuccess(`Пользователь ${created.username} создан.`, { source: 'settings', dedupeMode: 'none' });
      return { ok: true, user: created };
    } catch (error) {
      notifyApiError(error, 'Не удалось создать пользователя.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return { ok: false };
    } finally {
      setSavingUser(false);
    }
  }, [loadUsers, notifyApiError, notifySuccess]);

  const handleUpdateUser = useCallback(async (draft) => {
    setSavingUser(true);
    try {
      const userId = Number(draft.id);
      if (!Number.isFinite(userId) || userId <= 0) {
        notifyInfo('Неизвестный пользователь для сохранения.', { source: 'settings', dedupeMode: 'none' });
        return { ok: false };
      }

      const payload = {
        full_name: draft.full_name || null,
        department: draft.department || null,
        job_title: draft.job_title || null,
        email: draft.email || null,
        mailbox_email: draft.mailbox_email || null,
        mailbox_login: draft.mailbox_login || null,
        role: draft.role || 'viewer',
        auth_source: draft.auth_source || 'local',
        telegram_id: draft.telegram_id ? Number(draft.telegram_id) : null,
        assigned_database: draft.assigned_database || null,
        is_active: Boolean(draft.is_active),
        use_custom_permissions: Boolean(draft.use_custom_permissions),
        custom_permissions: normalizePermissions(draft.custom_permissions),
      };
      const updated = await authAPI.updateUser(userId, payload);
      await authAPI.updateTaskDelegates(
        userId,
        normalizeTaskDelegateLinks(draft.task_delegate_links).map((item) => ({
          delegate_user_id: Number(item.delegate_user_id),
          role_type: item.role_type === 'deputy' ? 'deputy' : 'assistant',
          is_active: item.is_active !== false,
        })),
      );
      await loadUsers();
      if (canManageSessions) await loadSessions();
      if (Number(userId) === Number(user?.id)) {
        await refreshSession();
      }
      notifySuccess(`Пользователь ${updated.username} обновлён.`, { source: 'settings', dedupeMode: 'none' });
      return { ok: true, user: updated };
    } catch (error) {
      if (error?.response?.status === 404) {
        await loadUsers();
        if (canManageSessions) await loadSessions();
        notifyInfo('Пользователь больше не найден. Список обновлён.', {
          source: 'settings',
          dedupeMode: 'none',
        });
        return { ok: false, reason: 'not_found' };
      }
      notifyApiError(error, 'Не удалось обновить пользователя.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return { ok: false };
    } finally {
      setSavingUser(false);
    }
  }, [canManageSessions, loadSessions, loadUsers, notifyApiError, notifyInfo, notifySuccess, refreshSession, user?.id]);

  const handleDeleteUser = useCallback(async (target) => {
    try {
      await authAPI.deleteUser(target.id);
      await loadUsers();
      if (canManageSessions) await loadSessions();
      notifySuccess(`Пользователь ${target.username} удалён.`, { source: 'settings', dedupeMode: 'none' });
      return { ok: true };
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить пользователя.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return { ok: false };
    }
  }, [canManageSessions, loadSessions, loadUsers, notifyApiError, notifySuccess]);

  const handleTerminateSession = useCallback(async (sessionId) => {
    try {
      await authAPI.terminateSession(sessionId);
      await loadSessions();
      if (canManageUsers) await loadUsers();
      notifySuccess('Сессия завершена.', { source: 'settings', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось завершить сессию.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    }
  }, [canManageUsers, loadSessions, loadUsers, notifyApiError, notifySuccess]);

  const handleCleanupSessions = useCallback(async () => {
    setCleaningSessions(true);
    try {
      const result = await authAPI.cleanupSessions();
      setCleanupResult({
        deactivated: Number(result?.deactivated || 0),
        deleted: Number(result?.deleted || 0),
      });
      await loadSessions();
      notifySuccess(`Cleanup выполнен. Деактивировано: ${result?.deactivated || 0}, удалено: ${result?.deleted || 0}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось выполнить cleanup сессий.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setCleaningSessions(false);
    }
  }, [loadSessions, notifyApiError, notifySuccess]);

  const handlePurgeInactiveSessions = useCallback(async () => {
    setPurgingSessions(true);
    try {
      const result = await authAPI.purgeInactiveSessions();
      setCleanupResult({
        deactivated: Number(result?.deactivated || 0),
        deleted: Number(result?.deleted || 0),
      });
      await loadSessions();
      if (canManageUsers) await loadUsers();
      notifySuccess(`Неактивные сессии удалены. Удалено: ${result?.deleted || 0}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить неактивные сессии.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setPurgingSessions(false);
    }
  }, [canManageUsers, loadSessions, loadUsers, notifyApiError, notifySuccess]);

  const handleSaveEnv = useCallback(async (draftValues) => {
    const sourceItems = Array.isArray(envState?.items) ? envState.items : [];
    const changedItems = sourceItems
      .filter((item) => (draftValues[item.key] ?? '') !== (item.value ?? ''))
      .reduce((acc, item) => {
        acc[item.key] = draftValues[item.key] ?? '';
        return acc;
      }, {});

    if (Object.keys(changedItems).length === 0) {
      notifyInfo('Изменений в .env нет.', { source: 'settings', dedupeMode: 'none' });
      return;
    }

    setSavingEnv(true);
    try {
      const result = await settingsAPI.updateEnvSettings(changedItems);
      setEnvState({
        items: Array.isArray(result?.items) ? result.items : [],
        deployment_targets: Array.isArray(result?.deployment_targets) ? result.deployment_targets : [],
        apply_plan: Array.isArray(result?.apply_plan) ? result.apply_plan : [],
        recent_changes: Array.isArray(result?.recent_changes) ? result.recent_changes : [],
        updated: Number(result?.updated || 0),
      });
      notifySuccess(`Переменные окружения сохранены. Изменено: ${result?.updated || 0}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить переменные окружения.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingEnv(false);
    }
  }, [envState?.items, notifyApiError, notifyInfo, notifySuccess]);

  const handleSaveAppSettings = useCallback(async (patch) => {
    setSavingAppSettings(true);
    try {
      const result = await settingsAPI.updateAppSettings(patch);
      setAppSettingsState(normalizeAppSettingsState(result));
      notifySuccess('Контролёр по умолчанию для reminder-задач сохранён.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить контролёра по умолчанию для reminder-задач.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingAppSettings(false);
    }
  }, [notifyApiError, notifySuccess]);

  const handleCreatePasswordGroup = useCallback(async (payload) => {
    setPasswordGroupsSaving(true);
    try {
      await passwordsAPI.createGroup(payload);
      await loadPasswordGroups();
      notifySuccess('Группа паролей создана.', { dedupeMode: 'none' });
      return true;
    } catch (error) {
      notifyApiError(error, 'Не удалось создать группу паролей.', { dedupeMode: 'none' });
      return false;
    } finally {
      setPasswordGroupsSaving(false);
    }
  }, [loadPasswordGroups, notifyApiError, notifySuccess]);

  const handleUpdatePasswordGroup = useCallback(async (groupId, payload, options = {}) => {
    const autosave = Boolean(options?.autosave);
    setPasswordGroups((current) => current.map((item) => (
      item.id === groupId
        ? {
          ...item,
          ...(payload?.name !== undefined ? { name: String(payload.name || '') } : {}),
          ...(payload?.sort_order !== undefined ? { sort_order: Number(payload.sort_order || 0) } : {}),
        }
        : item
    )));
    if (autosave) return true;
    setPasswordGroupsSaving(true);
    try {
      await passwordsAPI.updateGroup(groupId, payload);
      await loadPasswordGroups();
      notifySuccess('Группа паролей обновлена.', { dedupeMode: 'none' });
      return true;
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить группу паролей.', { dedupeMode: 'none' });
      await loadPasswordGroups();
      return false;
    } finally {
      setPasswordGroupsSaving(false);
    }
  }, [loadPasswordGroups, notifyApiError, notifySuccess]);

  const handleArchivePasswordGroup = useCallback(async (group) => {
    if (!window.confirm(`Архивировать группу "${group?.name || ''}"?`)) return;
    setPasswordGroupsSaving(true);
    try {
      await passwordsAPI.archiveGroup(group.id);
      await loadPasswordGroups();
      notifySuccess('Группа паролей отправлена в архив.', { dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось архивировать группу паролей.', { dedupeMode: 'none' });
    } finally {
      setPasswordGroupsSaving(false);
    }
  }, [loadPasswordGroups, notifyApiError, notifySuccess]);

  const handleCreateAiBot = useCallback(async (draft) => {
    setSavingAiBotId('new');
    try {
      const created = await settingsAPI.createAiBot({
        ...draft,
        slug: String(draft?.slug || '').trim().toLowerCase(),
        title: String(draft?.title || '').trim(),
        description: String(draft?.description || '').trim(),
        system_prompt: String(draft?.system_prompt || '').trim(),
        model: String(draft?.model || '').trim(),
        temperature: Number(draft?.temperature ?? 0.2),
        max_tokens: Number(draft?.max_tokens ?? 2000),
        allowed_kb_scope: Array.isArray(draft?.allowed_kb_scope) ? draft.allowed_kb_scope : [],
        enabled_tools: Array.isArray(draft?.enabled_tools) ? draft.enabled_tools : [],
        tool_settings: {
          multi_db_mode: String(draft?.multi_db_mode || 'single').trim() || 'single',
          allowed_databases: Array.isArray(draft?.allowed_databases) ? draft.allowed_databases : [],
          max_tool_rounds: Number(draft?.max_tool_rounds ?? 6),
          max_tool_calls_per_round: Number(draft?.max_tool_calls_per_round ?? 3),
        },
      });
      await loadAiBotsAdmin();
      notifySuccess(`AI-бот ${created?.title || created?.slug || 'bot'} создан.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать AI-бота.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingAiBotId('');
    }
  }, [loadAiBotsAdmin, notifyApiError, notifySuccess]);

  const handleUpdateAiBot = useCallback(async (botId, draft) => {
    const normalizedBotId = String(botId || '').trim();
    if (!normalizedBotId) return;
    setSavingAiBotId(normalizedBotId);
    try {
      const updated = await settingsAPI.updateAiBot(normalizedBotId, {
        ...draft,
        title: String(draft?.title || '').trim(),
        description: String(draft?.description || '').trim(),
        system_prompt: String(draft?.system_prompt || '').trim(),
        model: String(draft?.model || '').trim(),
        temperature: Number(draft?.temperature ?? 0.2),
        max_tokens: Number(draft?.max_tokens ?? 2000),
        allowed_kb_scope: Array.isArray(draft?.allowed_kb_scope) ? draft.allowed_kb_scope : [],
        enabled_tools: Array.isArray(draft?.enabled_tools) ? draft.enabled_tools : [],
        tool_settings: {
          multi_db_mode: String(draft?.multi_db_mode || 'single').trim() || 'single',
          allowed_databases: Array.isArray(draft?.allowed_databases) ? draft.allowed_databases : [],
          max_tool_rounds: Number(draft?.max_tool_rounds ?? 6),
          max_tool_calls_per_round: Number(draft?.max_tool_calls_per_round ?? 3),
        },
      });
      await loadAiBotsAdmin();
      notifySuccess(`AI-бот ${updated?.title || updated?.slug || 'bot'} обновлён.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить AI-бота.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingAiBotId('');
    }
  }, [loadAiBotsAdmin, notifyApiError, notifySuccess]);

  return {
    area,
    pageRef,
    user,
    isAdmin,
    canManageUsers,
    canManageSessions,
    canManageAiBots,
    canManageDepartments,
    canAccessMail,
    adminSections,
    activeSection,
    blockingError,
    setBlockingError,
    themeMode,
    setThemeMode,
    fontFamily,
    setFontFamily,
    fontScale,
    setFontScale,
    mobileBottomNavItems,
    setMobileBottomNavItems,
    savingPreferences,
    availableNavigationItems,
    resolvedMobileNavigationItems,
    handleSavePreferences,
    dbOptions,
    users,
    sessions,
    usersLoading,
    sessionsLoading,
    savingUser,
    cleanupResult,
    cleaningSessions,
    purgingSessions,
    envState,
    envLoading,
    savingEnv,
    aiBotsState,
    aiBotsLoading,
    savingAiBotId,
    aiBotRunsById,
    appSettingsState,
    appSettingsLoading,
    savingAppSettings,
    securityLoading,
    resettingTwoFactor,
    trustedDevices,
    backupCodes,
    backupCodesDialogOpen,
    setBackupCodesDialogOpen,
    linkTrustedDeviceOpen,
    linkTrustedDeviceLabel,
    linkTrustedDeviceError,
    linkingTrustedDevice,
    passkeyLinkAvailable,
    setLinkTrustedDeviceLabel,
    passwordGroups,
    passwordGroupsLoading,
    passwordGroupsSaving,
    loadAiBotsAdmin,
    loadEnv,
    loadPasswordGroups,
    handleCreateUser,
    handleUpdateUser,
    handleDeleteUser,
    handleTerminateSession,
    handleCleanupSessions,
    handlePurgeInactiveSessions,
    handleSaveEnv,
    handleSaveAppSettings,
    handleCreatePasswordGroup,
    handleUpdatePasswordGroup,
    handleArchivePasswordGroup,
    handleCreateAiBot,
    handleUpdateAiBot,
    handleRegenerateBackupCodes,
    handleRevokeTrustedDevice,
    handleReloadSecurity,
    handleOpenLinkTrustedDevice,
    handleCloseLinkTrustedDevice,
    handleConfirmLinkTrustedDevice,
    handleResetTwoFactor,
    isVeryWide,
  };
}
