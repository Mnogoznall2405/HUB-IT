import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { type ComponentProps, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  archivePasswordVaultEntry,
  archivePasswordVaultGroup,
  createPasswordVaultEntry,
  createPasswordVaultGroup,
  listPasswordVaultEntries,
  listPasswordVaultGroups,
  revealPasswordVaultEntry,
  unlockPasswordVaultWithBiometrics,
  updatePasswordVaultEntry,
  updatePasswordVaultGroup,
  type PasswordVaultEntry,
  type PasswordVaultGroup,
} from '../../api/passwordsApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { unlockBiometricLogin } from '../../auth/biometricAuth';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { NativePasswordEntryCard } from '../../components/passwords/NativePasswordEntryCard';
import { generateVaultPasswordWithCrypto } from '../../passwords/vaultPasswordGenerator';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { NativeAppliedChip, NativeFilterButton } from '../../components/ui/NativeFilterControls';
import { NativeFilterSheet } from '../../components/ui/NativeFilterSheet';
import { AccountField, AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PASSWORD_SCREEN_CAPTURE_KEY = 'hubit-password-vault';
const REVEALED_PASSWORD_TTL_MS = 30_000;

type PasswordEntryDraft = {
  group: string;
  tags: string;
  login: string;
  description: string;
  password: string;
};

const EMPTY_DRAFT: PasswordEntryDraft = {
  group: '',
  tags: '',
  login: '',
  description: '',
  password: '',
};

function SheetActionButton({
  label,
  icon,
  onPress,
  tokens,
  disabled = false,
  primary = false,
  danger = false,
  testID,
}: {
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void;
  tokens: ReturnType<typeof useFluentTokens>;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const foreground = primary || danger ? '#fff' : tokens.textPrimary;
  const background = primary ? tokens.primary : danger ? tokens.error : tokens.actionBg;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.sheetAction,
        {
          backgroundColor: background,
          borderColor: primary || danger ? background : tokens.borderSoft,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={19} color={foreground} />
      <Text style={[styles.sheetActionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

function PasswordVisibilityCountdown({ until, color }: { until: number; color: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return <Text style={{ color, fontSize: 12, lineHeight: 18 }}>Скроется через {Math.max(0, Math.ceil((until - now) / 1000))} с</Text>;
}

export function NativePasswordsScreen() {
  const { biometricEnabled, hasPermission, offlineMode, user } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const navInset = useNativeBottomNavInset();
  const canRead = hasPermission('passwords.read');
  const canWrite = hasPermission('passwords.write');
  // Group administration mirrors the web gate: Passwords.jsx exposes it for
  // role === 'admin' only, even though the backend accepts passwords.write.
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [entries, setEntries] = useState<PasswordVaultEntry[]>([]);
  const [listMeta, setListMeta] = useState({ total: 0, truncated: false });
  const [groups, setGroups] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [tag, setTag] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<PasswordVaultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [captureReady, setCaptureReady] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [unlockedUntil, setUnlockedUntil] = useState('');
  const [revealedPassword, setRevealedPassword] = useState('');
  const [secretVisibleUntil, setSecretVisibleUntil] = useState(0);
  const [actionBusy, setActionBusy] = useState<'unlock' | 'show' | 'copy' | 'edit' | 'save' | 'archive' | ''>('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [editorMode, setEditorMode] = useState<'' | 'create' | 'edit'>('');
  const [editDraft, setEditDraft] = useState<PasswordEntryDraft>(EMPTY_DRAFT);
  const [showDraftPassword, setShowDraftPassword] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupsManagerOpen, setGroupsManagerOpen] = useState(false);
  const [adminGroups, setAdminGroups] = useState<PasswordVaultGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
  const [newGroupDraft, setNewGroupDraft] = useState('');
  const [editorGroupInputOpen, setEditorGroupInputOpen] = useState(false);
  const [groupActionError, setGroupActionError] = useState('');
  const [groupActionMessage, setGroupActionMessage] = useState('');
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const requestRef = useRef(0);
  const secretGeneration = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const hideSecretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEntrySecret = useCallback(() => {
    secretGeneration.current += 1;
    if (hideSecretTimerRef.current) clearTimeout(hideSecretTimerRef.current);
    hideSecretTimerRef.current = null;
    setRevealedPassword('');
    setActionError('');
    setActionMessage('');
    setEditorMode('');
    setEditDraft(EMPTY_DRAFT);
    setShowDraftPassword(false);
    setEditorGroupInputOpen(false);
    setActionBusy('');
  }, []);

  const clearVaultState = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setEntries([]);
    setGroups([]);
    setTags([]);
    setSelected(null);
    setUnlockedUntil('');
    clearEntrySecret();
    setGroupsManagerOpen(false);
    setAdminGroups([]);
    setGroupDrafts({});
    setNewGroupDraft('');
    setGroupsLoading(false);
    setGroupSaving(false);
    setGroupActionError('');
    setGroupActionMessage('');
    setLoading(false);
    setRefreshing(false);
  }, [clearEntrySecret]);

  useLayoutEffect(() => {
    clearVaultState();
  }, [user?.id, canRead, canWrite, offlineMode, biometricEnabled, clearVaultState]);

  const protectScreen = useCallback(async () => {
    setCaptureReady(false);
    setCaptureError('');
    clearVaultState();
    try {
      await ScreenCapture.preventScreenCaptureAsync(PASSWORD_SCREEN_CAPTURE_KEY);
      if (mountedRef.current && focusedRef.current) setCaptureReady(true);
    } catch {
      if (mountedRef.current && focusedRef.current) {
        setCaptureError('Не удалось включить защиту экрана. Хранилище заблокировано.');
      }
    }
  }, [clearVaultState]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!canRead || offlineMode || !captureReady || !focusedRef.current) {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = await listPasswordVaultEntries({ q: query, group, tag, includeArchived, signal: controller.signal });
      if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
      setEntries(result.items);
      setListMeta({ total: result.total, truncated: result.truncated });
      setGroups(result.groups);
      setTags(result.tags);
      setSelected((current) => current ? result.items.find((item) => item.id === current.id) || null : null);
      if (group && !result.groups.includes(group)) setGroup('');
      if (tag && !result.tags.includes(tag)) setTag('');
    } catch (cause) {
      if (requestId === requestRef.current && !controller.signal.aborted && mountedRef.current) {
        setError(formatApiError(cause, 'Не удалось загрузить хранилище паролей.'));
      }
    } finally {
      if (requestId === requestRef.current && mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canRead, captureReady, group, includeArchived, offlineMode, query, tag]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      abortRef.current?.abort();
      if (hideSecretTimerRef.current) clearTimeout(hideSecretTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryDraft.trim().slice(0, 200)), 250);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!unlockedUntil) return undefined;
    const remainingMs = Date.parse(unlockedUntil) - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      setUnlockedUntil('');
      return undefined;
    }
    const timer = setTimeout(() => setUnlockedUntil(''), Math.min(remainingMs + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [unlockedUntil]);

  useEffect(() => {
    if (!canRead || offlineMode) {
      clearVaultState();
      return;
    }
    if (captureReady) void load();
  }, [user?.id, canWrite, biometricEnabled, canRead, captureReady, clearVaultState, load, offlineMode]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void protectScreen();
    return () => {
      focusedRef.current = false;
      setCaptureReady(false);
      clearVaultState();
      void ScreenCapture.allowScreenCaptureAsync(PASSWORD_SCREEN_CAPTURE_KEY).catch(() => undefined);
    };
  }, [clearVaultState, protectScreen]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setCaptureReady(false);
        clearVaultState();
        return;
      }
      if (focusedRef.current) void protectScreen();
    });
    return () => subscription?.remove?.();
  }, [clearVaultState, protectScreen]);

  const openEntry = useCallback((entry: PasswordVaultEntry) => {
    clearEntrySecret();
    setSelected(entry);
  }, [clearEntrySecret]);

  const closeEntry = useCallback(() => {
    clearEntrySecret();
    setSelected(null);
  }, [clearEntrySecret]);

  const hasActiveUnlock = useCallback(() => {
    const expiresAt = Date.parse(unlockedUntil);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }, [unlockedUntil]);

  const confirmBiometricUnlock = useCallback(async () => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (offlineMode) throw new Error('Для доступа к паролю требуется подключение к HUB.');
    if (!biometricEnabled) {
      throw new Error('Включите вход по отпечатку в разделе «Настройки → Безопасность».');
    }
    if (hasActiveUnlock()) return unlockedUntil;
    const credential = await unlockBiometricLogin();
    if (!isCurrent()) throw new Error('Защищённая операция отменена.');
    if (credential.version !== 2 || !credential.renewalToken) {
      throw new Error('Переподключите вход по отпечатку в разделе «Настройки → Безопасность».');
    }
    if (Number(credential.user.id) !== Number(user?.id)) {
      throw new Error('Отпечаток настроен для другой учётной записи. Войдите заново.');
    }
    const result = await unlockPasswordVaultWithBiometrics(credential.renewalToken);
    if (!isCurrent()) throw new Error('Защищённая операция отменена.');
    if (!result.unlocked_until) throw new Error('Сервер не подтвердил разблокировку хранилища.');
    setUnlockedUntil(result.unlocked_until);
    return result.unlocked_until;
  }, [biometricEnabled, hasActiveUnlock, offlineMode, unlockedUntil, user?.id]);

  const unlockVault = useCallback(async () => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (actionBusy) return;
    setActionBusy('unlock');
    setActionError('');
    setActionMessage('');
    try {
      await confirmBiometricUnlock();
      if (!isCurrent()) return;
      setActionMessage('Хранилище разблокировано на 5 минут.');
    } catch (cause) {
      if (!isCurrent()) return;
      setUnlockedUntil('');
      setActionError(formatApiError(cause, 'Не удалось подтвердить отпечаток.'));
    } finally {
      if (isCurrent()) setActionBusy('');
    }
  }, [actionBusy, confirmBiometricUnlock]);

  const revealPassword = useCallback(async (purpose: 'show' | 'copy') => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (!selected || actionBusy) return;
    setActionBusy(purpose);
    setActionError('');
    setActionMessage('');
    try {
      await confirmBiometricUnlock();
      if (!isCurrent()) return;
      const result = await revealPasswordVaultEntry(selected.id, purpose);
      if (!isCurrent()) return;
      setUnlockedUntil(result.unlocked_until);
      if (purpose === 'copy') {
        await Clipboard.setStringAsync(result.password);
        if (!isCurrent()) return;
        setRevealedPassword('');
        setActionMessage('Пароль скопирован.');
      } else {
        setSecretVisibleUntil(Date.now() + REVEALED_PASSWORD_TTL_MS);
        setRevealedPassword(result.password);
        if (hideSecretTimerRef.current) clearTimeout(hideSecretTimerRef.current);
        hideSecretTimerRef.current = setTimeout(() => {
          hideSecretTimerRef.current = null;
          setRevealedPassword('');
        }, REVEALED_PASSWORD_TTL_MS);
      }
    } catch (cause) {
      if (!isCurrent()) return;
      setUnlockedUntil('');
      setRevealedPassword('');
      setActionError(formatApiError(cause, 'Не удалось получить пароль.'));
    } finally {
      if (isCurrent()) setActionBusy('');
    }
  }, [actionBusy, confirmBiometricUnlock, selected]);

  const beginEditing = useCallback(async () => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (!selected || !canWrite || actionBusy) return;
    setActionBusy('edit');
    setActionError('');
    setActionMessage('');
    try {
      await confirmBiometricUnlock();
      if (!isCurrent()) return;
      setEditDraft({
        group: selected.group,
        tags: selected.tags.map((item) => `#${item}`).join(', '),
        login: selected.login,
        description: selected.description,
        password: '',
      });
      setEditorMode('edit');
    } catch (cause) {
      if (!isCurrent()) return;
      setUnlockedUntil('');
      setActionError(formatApiError(cause, 'Не удалось подтвердить отпечаток.'));
    } finally {
      if (isCurrent()) setActionBusy('');
    }
  }, [actionBusy, canWrite, confirmBiometricUnlock, selected]);

  const openCreateEditor = useCallback(() => {
    if (!canWrite || actionBusy || offlineMode) return;
    clearEntrySecret();
    setSelected(null);
    setEditDraft(EMPTY_DRAFT);
    setEditorMode('create');
  }, [actionBusy, canWrite, clearEntrySecret, offlineMode]);

  const updateDraft = useCallback((field: keyof PasswordEntryDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const saveEntry = useCallback(async () => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (!editorMode || actionBusy) return;
    const creating = editorMode === 'create';
    if (!creating && !selected) return;
    const normalizedGroup = editDraft.group.trim();
    const normalizedLogin = editDraft.login.trim();
    const password = editDraft.password;
    if (!normalizedGroup || !normalizedLogin || (creating && !password)) {
      setActionError(creating ? 'Заполните группу, логин и пароль.' : 'Заполните группу и логин.');
      return;
    }
    setActionBusy('save');
    setActionError('');
    setActionMessage('');
    try {
      if (creating) {
        // Creation does not unlock the vault (same as web/backend): the new
        // secret is written without revealing existing ones.
        const created = await createPasswordVaultEntry({
          group: normalizedGroup,
          tags: editDraft.tags.split(',').map((item) => item.trim().replace(/^#+/, '')).filter(Boolean),
          login: normalizedLogin,
          description: editDraft.description.trim(),
          password,
        });
        if (!isCurrent()) return;
        closeEntry();
        setActionMessage('Запись создана.');
        void load();
        return;
      }
      await confirmBiometricUnlock();
      if (!isCurrent() || !selected) return;
      const updated = await updatePasswordVaultEntry(selected.id, {
        group: normalizedGroup,
        tags: editDraft.tags.split(',').map((item) => item.trim().replace(/^#+/, '')).filter(Boolean),
        login: normalizedLogin,
        description: editDraft.description.trim(),
        ...(password ? { password } : {}),
      });
      if (!isCurrent()) return;
      setEntries((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setSelected(updated);
      setEditDraft(EMPTY_DRAFT);
      setShowDraftPassword(false);
      setEditorMode('');
      // A saved change invalidates the revealed secret — hiding it now
      // prevents the screen from showing the previous password as current.
      if (hideSecretTimerRef.current) { clearTimeout(hideSecretTimerRef.current); hideSecretTimerRef.current = null; }
      setRevealedPassword('');
      setSecretVisibleUntil(0);
      setActionMessage(password ? 'Запись и пароль обновлены.' : 'Запись обновлена.');
    } catch (cause) {
      if (!isCurrent()) return;
      setUnlockedUntil('');
      setActionError(formatApiError(cause, 'Не удалось сохранить запись.'));
    } finally {
      if (isCurrent()) setActionBusy('');
    }
  }, [actionBusy, closeEntry, confirmBiometricUnlock, editDraft, editorMode, load, selected]);

  const archiveEntry = useCallback(async () => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (!selected || !canWrite || actionBusy || offlineMode) return;
    setActionBusy('archive');
    setActionError('');
    setActionMessage('');
    try {
      await archivePasswordVaultEntry(selected.id);
      if (!isCurrent()) return;
      // Mirroring the web archive flow: the entry disappears from the current
      // list (unless the archive filter is on) and the detail sheet closes.
      closeEntry();
      setActionMessage('Запись перенесена в архив.');
      void load();
    } catch (cause) {
      if (!isCurrent()) return;
      setActionError(formatApiError(cause, 'Не удалось архивировать запись.'));
    } finally {
      if (isCurrent()) setActionBusy('');
    }
  }, [actionBusy, canWrite, closeEntry, load, offlineMode, selected]);

  const confirmArchiveEntry = useCallback(() => {
    if (!selected || !canWrite || actionBusy || offlineMode) return;
    Alert.alert('Архивировать пароль', `Архивировать пароль для ${selected.login}?`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Архивировать', style: 'destructive', onPress: () => { void archiveEntry(); } },
    ]);
  }, [actionBusy, archiveEntry, canWrite, offlineMode, selected]);

  const generateDraftPassword = useCallback(async () => {
    const generation = secretGeneration.current;
    try {
      const password = await generateVaultPasswordWithCrypto();
      if (!mountedRef.current || generation !== secretGeneration.current) return;
      setEditDraft((current) => ({ ...current, password }));
      setShowDraftPassword(true);
      setActionError('');
    } catch (cause) {
      if (!mountedRef.current || generation !== secretGeneration.current) return;
      setActionError(formatApiError(cause, 'Не удалось сгенерировать пароль.'));
    }
  }, []);

  const copyDraftPassword = useCallback(async () => {
    const generation = secretGeneration.current;
    if (!editDraft.password) return;
    await Clipboard.setStringAsync(editDraft.password);
    if (!mountedRef.current || generation !== secretGeneration.current) return;
    setActionMessage('Сгенерированный пароль скопирован.');
  }, [editDraft.password]);

  const loadAdminGroups = useCallback(async () => {
    if (!isAdmin || offlineMode) return;
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    setGroupsLoading(true);
    setGroupActionError('');
    try {
      const items = await listPasswordVaultGroups({ includeInactive: true });
      if (!isCurrent()) return;
      setAdminGroups(items);
      setGroupDrafts(Object.fromEntries(items.map((item) => [item.id, item.name])));
    } catch (cause) {
      if (!isCurrent()) return;
      setGroupActionError(formatApiError(cause, 'Не удалось загрузить группы хранилища.'));
    } finally {
      if (isCurrent()) setGroupsLoading(false);
    }
  }, [isAdmin, offlineMode]);

  const openGroupsManager = useCallback(() => {
    if (!isAdmin || offlineMode) return;
    setGroupActionError('');
    setGroupActionMessage('');
    setGroupsManagerOpen(true);
    void loadAdminGroups();
  }, [isAdmin, loadAdminGroups, offlineMode]);

  const closeGroupsManager = useCallback(() => {
    setGroupsManagerOpen(false);
    setNewGroupDraft('');
    setGroupActionError('');
    setGroupActionMessage('');
  }, []);

  const createGroup = useCallback(async (
    nameSource: string,
    sortOrder: number,
    onError: (message: string) => void,
  ): Promise<PasswordVaultGroup | null> => {
    const name = nameSource.trim();
    if (!name || groupSaving || offlineMode) return null;
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    setGroupSaving(true);
    try {
      const created = await createPasswordVaultGroup({ name, sort_order: sortOrder });
      if (!isCurrent()) return null;
      setGroups((current) => current.includes(created.name) ? current : [...current, created.name]);
      return created;
    } catch (cause) {
      if (!isCurrent()) return null;
      onError(formatApiError(cause, 'Не удалось создать группу.'));
      return null;
    } finally {
      if (isCurrent()) setGroupSaving(false);
    }
  }, [groupSaving, offlineMode]);

  const createGroupFromManager = useCallback(async () => {
    const created = await createGroup(newGroupDraft, adminGroups.length, setGroupActionError);
    if (!created) return;
    setAdminGroups((current) => [...current, created]);
    setGroupDrafts((current) => ({ ...current, [created.id]: created.name }));
    setNewGroupDraft('');
    setGroupActionError('');
    setGroupActionMessage('Группа создана.');
    void load();
  }, [adminGroups.length, createGroup, load, newGroupDraft]);

  const createGroupFromEditor = useCallback(async () => {
    const created = await createGroup(newGroupDraft, groups.length, setActionError);
    if (!created) return;
    updateDraft('group', created.name);
    setNewGroupDraft('');
    setEditorGroupInputOpen(false);
    setActionMessage('Группа создана.');
  }, [createGroup, groups.length, newGroupDraft, updateDraft]);

  const renameGroup = useCallback(async (item: PasswordVaultGroup) => {
    const name = (groupDrafts[item.id] ?? '').trim();
    if (!name || name === item.name || groupSaving || offlineMode) return;
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    setGroupSaving(true);
    setGroupActionError('');
    setGroupActionMessage('');
    try {
      const updated = await updatePasswordVaultGroup(item.id, { name, sort_order: item.sort_order });
      if (!isCurrent()) return;
      setAdminGroups((current) => current.map((groupItem) => groupItem.id === updated.id ? updated : groupItem));
      setGroupDrafts((current) => ({ ...current, [updated.id]: updated.name }));
      setGroupActionMessage('Группа переименована.');
      void load();
    } catch (cause) {
      if (!isCurrent()) return;
      setGroupActionError(formatApiError(cause, 'Не удалось обновить группу.'));
    } finally {
      if (isCurrent()) setGroupSaving(false);
    }
  }, [groupDrafts, groupSaving, load, offlineMode]);

  const archiveGroup = useCallback(async (item: PasswordVaultGroup) => {
    const generation = secretGeneration.current;
    const isCurrent = () => mountedRef.current && generation === secretGeneration.current;
    if (groupSaving || offlineMode) return;
    setGroupSaving(true);
    setGroupActionError('');
    setGroupActionMessage('');
    try {
      const updated = await archivePasswordVaultGroup(item.id);
      if (!isCurrent()) return;
      setAdminGroups((current) => current.map((groupItem) => groupItem.id === updated.id ? updated : groupItem));
      setGroupActionMessage('Группа отправлена в архив.');
      void load();
    } catch (cause) {
      if (!isCurrent()) return;
      setGroupActionError(formatApiError(cause, 'Не удалось архивировать группу.'));
    } finally {
      if (isCurrent()) setGroupSaving(false);
    }
  }, [groupSaving, load, offlineMode]);

  const confirmArchiveGroup = useCallback((item: PasswordVaultGroup) => {
    if (groupSaving || offlineMode) return;
    Alert.alert('Архивировать группу', `Архивировать группу "${item.name}"?`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Архивировать', style: 'destructive', onPress: () => { void archiveGroup(item); } },
    ]);
  }, [archiveGroup, groupSaving, offlineMode]);

  const refreshEntries = useCallback(() => {
    void load({ refresh: true });
  }, [load]);

  const renderEntry = useCallback(({ item }: ListRenderItemInfo<PasswordVaultEntry>) => (
    <NativePasswordEntryCard entry={item} tokens={tokens} onPress={openEntry} />
  ), [openEntry, tokens]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Пароли" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право passwords.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  if (!captureReady) {
    return (
      <AccountScreenScaffold title="Пароли" tokens={tokens}>
        <AccountSectionCard
          tokens={tokens}
          title={captureError ? 'Хранилище заблокировано' : 'Защищаем экран'}
          description={captureError || 'Включаем защиту от скриншотов и записи экрана.'}
        >
          {captureError ? (
            <Pressable
              testID="native-passwords-security-retry"
              onPress={() => { void protectScreen(); }}
              accessibilityRole="button"
              style={[styles.primaryAction, { backgroundColor: tokens.primary }]}
            >
              <Text style={styles.primaryActionText}>Повторить защиту</Text>
            </Pressable>
          ) : <ActivityIndicator color={tokens.primary} />}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const vaultUnlocked = hasActiveUnlock();

  const header = (
    <View style={styles.headerContent}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: хранилище не кэшируется и требует сеть.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      {actionError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{actionError}</Text> : null}
      {actionMessage ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.success }]}>{actionMessage}</Text> : null}
      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
        <TextInput
          testID="native-passwords-search"
          value={queryDraft}
          onChangeText={setQueryDraft}
          editable={!offlineMode}
          placeholder="Логин, описание или тег"
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Поиск в хранилище паролей"
          returnKeyType="search"
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {queryDraft ? <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}><MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} /></Pressable> : null}
      </View>
      {(group || tag) ? (
        <View style={styles.appliedRow}>
          {group ? <NativeAppliedChip label={`Группа: ${group}`} tokens={tokens} onRemove={() => setGroup('')} /> : null}
          {tag ? <NativeAppliedChip label={`#${tag}`} tokens={tokens} onRemove={() => setTag('')} /> : null}
        </View>
      ) : null}
      <View style={styles.countRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>
          {listMeta.truncated || listMeta.total > entries.length
            ? `Записей: ${entries.length} из ${listMeta.total} — уточните поиск для остальных`
            : `Записей: ${entries.length}`}
        </Text>
        <NativeFilterButton
          testID="native-passwords-filters"
          count={[group, tag, includeArchived].filter(Boolean).length}
          tokens={tokens}
          onPress={() => setFiltersOpen(true)}
        />
      </View>
      {loading && entries.length === 0 ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Загружаем метаданные…</Text></View> : null}
      {!loading && error && entries.length === 0 ? <Pressable testID="native-passwords-retry" onPress={() => { void load(); }} disabled={offlineMode} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}><Text style={styles.primaryActionText}>Повторить</Text></Pressable> : null}
    </View>
  );

  return (
    <AccountScreenScaffold
      title="Пароли"
      tokens={tokens}
      rightAction={(
        <View style={styles.headerActions}>
          {canWrite ? (
            <Pressable
              testID="native-passwords-create"
              accessibilityRole="button"
              accessibilityLabel="Новая запись"
              accessibilityState={{ disabled: offlineMode }}
              disabled={offlineMode}
              onPress={openCreateEditor}
              style={[styles.iconButton, { opacity: offlineMode ? 0.4 : 1 }]}
            >
              <MaterialCommunityIcons name="plus" size={25} color={tokens.primary} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Защита паролей" onPress={() => Alert.alert('Защищено отпечатком', 'Пароль загружается после подтверждения личности. Он не сохраняется в офлайн-кэше и скрывается при сворачивании приложения.')} style={styles.iconButton}><MaterialCommunityIcons name="shield-lock-outline" size={23} color={tokens.primary} /></Pressable>
        </View>
      )}
      scroll={false}
      contentUnderNav
    >
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        testID="native-passwords-list"
        data={entries}
        keyExtractor={(entry) => entry.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={entries.length ? [styles.list, { paddingBottom: navInset }] : [styles.emptyList, { paddingBottom: navInset }]}
        ListHeaderComponent={header}
        ListEmptyComponent={!loading && !error ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{query || group || tag ? 'По фильтрам ничего не найдено.' : 'В хранилище пока нет записей.'}</Text> : null}
        renderItem={renderEntry}
        refreshing={refreshing}
        onRefresh={refreshEntries}
      />
      <NativeFilterSheet
        visible={filtersOpen}
        title="Фильтры паролей"
        tokens={tokens}
        onClose={() => setFiltersOpen(false)}
        onReset={() => { setGroup(''); setTag(''); setIncludeArchived(false); }}
        sections={[
          ...(groups.length ? [{
            kind: 'options' as const,
            key: 'group',
            title: 'Группа',
            selected: group,
            onSelect: setGroup,
            testIDPrefix: 'native-passwords-group',
            options: [{ value: '', label: 'Все группы' }, ...groups.map((item) => ({ value: item, label: item }))],
          }] : []),
          ...(tags.length ? [{
            kind: 'options' as const,
            key: 'tag',
            title: 'Тег',
            selected: tag,
            onSelect: setTag,
            testIDPrefix: 'native-passwords-tag',
            options: [{ value: '', label: 'Все теги' }, ...tags.map((item) => ({ value: item, label: `#${item}` }))],
          }] : []),
          {
            kind: 'toggles' as const,
            key: 'flags',
            title: 'Список',
            items: [
              { key: 'archived', label: 'Показывать архив', value: includeArchived, onToggle: () => setIncludeArchived((value) => !value), testID: 'native-passwords-archived' },
            ],
          },
          ...(isAdmin ? [{
            kind: 'custom' as const,
            key: 'groups-admin',
            title: 'Администрирование',
            children: (
              <Pressable
                testID="native-passwords-manage-groups"
                accessibilityRole="button"
                accessibilityLabel="Управление группами"
                disabled={offlineMode}
                onPress={() => { setFiltersOpen(false); openGroupsManager(); }}
                style={({ pressed }) => [
                  styles.manageGroupsRow,
                  { borderColor: tokens.borderSoft },
                  pressed && { opacity: 0.82 },
                  offlineMode && { opacity: 0.5 },
                ]}
              >
                <MaterialCommunityIcons name="folder-cog-outline" size={21} color={tokens.primary} />
                <Text style={[styles.manageGroupsText, { color: tokens.textPrimary }]}>Управление группами</Text>
                <View style={styles.flex} />
                <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
              </Pressable>
            ),
          }] : []),
        ]}
      />

      <Modal visible={Boolean(selected) || editorMode === 'create'} transparent animationType="slide" onRequestClose={closeEntry} statusBarTranslucent>
        <KeyboardAvoidingView style={styles.modalRoot} {...chatKeyboardAvoidingProps()}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть карточку" style={styles.scrim} onPress={closeEntry} />
          {selected || editorMode === 'create' ? (
            <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.flex}>
                  <Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>{editorMode === 'create' ? 'Новая запись' : selected?.login}</Text>
                  <Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>
                    {editorMode === 'create' ? 'Создание записи в хранилище' : editorMode === 'edit' ? 'Редактирование записи' : selected?.group || 'Без группы'}
                  </Text>
                </View>
                <Pressable onPress={closeEntry} accessibilityRole="button" accessibilityLabel="Закрыть" style={styles.iconButton}><MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} /></Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.sheetContent}
                showsVerticalScrollIndicator={false}
              >
                {actionError ? <Text accessibilityRole="alert" style={[styles.noticeBox, { color: tokens.error, backgroundColor: tokens.panelInset }]}>{actionError}</Text> : null}
                {actionMessage ? <Text accessibilityLiveRegion="polite" style={[styles.noticeBox, { color: tokens.success, backgroundColor: tokens.panelInset }]}>{actionMessage}</Text> : null}

                {editorMode ? (
                  <View style={styles.editor}>
                    <Text style={[styles.editorHint, { color: tokens.textSecondary }]}>
                      {editorMode === 'edit'
                        ? 'Новый пароль можно оставить пустым — тогда текущий пароль не изменится.'
                        : 'Группа, логин и пароль обязательны.'}
                    </Text>
                    <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>Группа</Text>
                    <View testID="native-passwords-edit-group" style={styles.groupChips}>
                      {(editDraft.group && !groups.includes(editDraft.group) ? [editDraft.group, ...groups] : groups).map((name) => {
                        const active = editDraft.group === name;
                        return (
                          <Pressable
                            key={name}
                            testID={`native-passwords-edit-group-${name}`}
                            onPress={() => updateDraft('group', name)}
                            disabled={Boolean(actionBusy)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`Группа ${name}`}
                            style={({ pressed }) => [
                              styles.groupChip,
                              {
                                backgroundColor: active ? tokens.selected : tokens.panelInset,
                                borderColor: active ? tokens.selectedBorder : tokens.border,
                              },
                              pressed && !actionBusy && { opacity: 0.8 },
                            ]}
                          >
                            <Text style={[styles.groupChipText, { color: active ? tokens.primary : tokens.textSecondary }]}>{name}</Text>
                          </Pressable>
                        );
                      })}
                      {isAdmin ? (
                        <Pressable
                          testID="native-passwords-add-group"
                          onPress={() => setEditorGroupInputOpen((value) => !value)}
                          disabled={Boolean(actionBusy)}
                          accessibilityRole="button"
                          accessibilityLabel="Добавить группу"
                          style={({ pressed }) => [
                            styles.groupChip,
                            { backgroundColor: 'transparent', borderColor: tokens.borderSoft },
                            pressed && { opacity: 0.8 },
                          ]}
                        >
                          <MaterialCommunityIcons name="plus" size={17} color={tokens.primary} />
                          <Text style={[styles.groupChipText, { color: tokens.primary }]}>Новая</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {!groups.length && !editDraft.group ? (
                      <Text style={[styles.editorHint, { color: tokens.warning }]}>
                        {isAdmin
                          ? 'Нет доступных групп. Добавьте группу, чтобы можно было создавать записи.'
                          : 'Нет доступных групп. Попросите администратора добавить группы.'}
                      </Text>
                    ) : null}
                    {editorGroupInputOpen ? (
                      <View style={styles.inlineGroupRow}>
                        <TextInput
                          testID="native-passwords-new-group-name"
                          value={newGroupDraft}
                          onChangeText={setNewGroupDraft}
                          editable={!groupSaving}
                          accessibilityLabel="Название новой группы"
                          placeholder="Название новой группы"
                          placeholderTextColor={tokens.textTertiary}
                          style={[styles.editorInput, styles.flex, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
                        />
                        <Pressable
                          testID="native-passwords-new-group-save"
                          onPress={() => { void createGroupFromEditor(); }}
                          disabled={groupSaving || offlineMode || !newGroupDraft.trim()}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: groupSaving || offlineMode || !newGroupDraft.trim() }}
                          style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: (groupSaving || offlineMode || !newGroupDraft.trim()) ? 0.5 : 1 }]}
                        >
                          {groupSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryActionText}>Добавить</Text>}
                        </Pressable>
                      </View>
                    ) : null}
                    <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>Логин</Text>
                    <TextInput
                      testID="native-passwords-edit-login"
                      value={editDraft.login}
                      onChangeText={(value) => updateDraft('login', value)}
                      accessibilityLabel="Логин записи"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.editorInput, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
                    />
                    <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>Теги через запятую</Text>
                    <TextInput
                      testID="native-passwords-edit-tags"
                      value={editDraft.tags}
                      onChangeText={(value) => updateDraft('tags', value)}
                      accessibilityLabel="Теги записи через запятую"
                      autoCapitalize="none"
                      style={[styles.editorInput, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
                    />
                    <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>Описание</Text>
                    <TextInput
                      testID="native-passwords-edit-description"
                      value={editDraft.description}
                      onChangeText={(value) => updateDraft('description', value)}
                      accessibilityLabel="Описание записи"
                      multiline
                      textAlignVertical="top"
                      style={[styles.editorInput, styles.editorTextarea, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
                    />
                    <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>{editorMode === 'edit' ? 'Новый пароль' : 'Пароль'}</Text>
                    <View style={[styles.secretInputRow, { backgroundColor: tokens.panelInset, borderColor: tokens.border }]}>
                      <TextInput
                        testID="native-passwords-edit-password"
                        value={editDraft.password}
                        onChangeText={(value) => updateDraft('password', value)}
                        accessibilityLabel={editorMode === 'edit' ? 'Новый пароль' : 'Пароль'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry={!showDraftPassword}
                        style={[styles.secretInput, { color: tokens.textPrimary }]}
                      />
                      {editDraft.password ? (
                        <Pressable
                          testID="native-passwords-copy-draft-password"
                          onPress={() => { void copyDraftPassword(); }}
                          accessibilityRole="button"
                          accessibilityLabel="Скопировать введённый пароль"
                          style={styles.iconButton}
                        >
                          <MaterialCommunityIcons name="content-copy" size={19} color={tokens.iconMuted} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        testID="native-passwords-generate-password"
                        onPress={() => { void generateDraftPassword(); }}
                        disabled={Boolean(actionBusy)}
                        accessibilityRole="button"
                        accessibilityLabel="Сгенерировать пароль"
                        accessibilityState={{ disabled: Boolean(actionBusy) }}
                        style={styles.iconButton}
                      >
                        <MaterialCommunityIcons name="dice-multiple-outline" size={21} color={tokens.iconMuted} />
                      </Pressable>
                      <Pressable
                        onPress={() => setShowDraftPassword((value) => !value)}
                        accessibilityRole="button"
                        accessibilityLabel={showDraftPassword ? 'Скрыть новый пароль' : 'Показать новый пароль'}
                        accessibilityState={{ selected: showDraftPassword }}
                        style={styles.iconButton}
                      >
                        <MaterialCommunityIcons name={showDraftPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={tokens.iconMuted} />
                      </Pressable>
                    </View>
                    <View style={styles.actionRow}>
                      <SheetActionButton
                        label="Отмена"
                        icon="close"
                        onPress={() => {
                          if (editorMode === 'create') {
                            closeEntry();
                          } else {
                            setEditorMode(''); setEditDraft(EMPTY_DRAFT); setShowDraftPassword(false); setEditorGroupInputOpen(false); setActionError('');
                          }
                        }}
                        tokens={tokens}
                        disabled={Boolean(actionBusy)}
                      />
                      <SheetActionButton
                        label={actionBusy === 'save' ? 'Сохраняем…' : 'Сохранить'}
                        icon="content-save-outline"
                        onPress={() => { void saveEntry(); }}
                        tokens={tokens}
                        disabled={Boolean(actionBusy) || groupSaving}
                        primary
                        testID="native-passwords-save"
                      />
                    </View>
                  </View>
                ) : selected ? (
                  <>
                    <View style={[styles.unlockBanner, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                      <MaterialCommunityIcons name={vaultUnlocked ? 'lock-open-check-outline' : 'fingerprint'} size={25} color={vaultUnlocked ? tokens.success : tokens.primary} />
                      <View style={styles.flex}>
                        <Text style={[styles.unlockTitle, { color: tokens.textPrimary }]}>{vaultUnlocked ? `Доступ до ${new Date(unlockedUntil).toLocaleTimeString('ru-RU')}` : 'Требуется отпечаток'}</Text>
                        <Text style={[styles.unlockDescription, { color: tokens.textSecondary }]}>{vaultUnlocked ? 'Можно показать, скопировать или изменить запись.' : 'Подтвердите личность перед доступом к секрету.'}</Text>
                      </View>
                      {!vaultUnlocked ? (
                        <Pressable
                          testID="native-passwords-unlock"
                          onPress={() => { void unlockVault(); }}
                          disabled={Boolean(actionBusy) || offlineMode}
                          accessibilityRole="button"
                          accessibilityLabel="Разблокировать хранилище отпечатком"
                          accessibilityState={{ disabled: Boolean(actionBusy) || offlineMode }}
                          style={({ pressed }) => [styles.unlockIconButton, { backgroundColor: tokens.primary, opacity: actionBusy || offlineMode ? 0.5 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
                        >
                          {actionBusy === 'unlock' ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="fingerprint" size={23} color="#fff" />}
                        </Pressable>
                      ) : null}
                    </View>

                    <AccountField tokens={tokens} label="Логин" value={selected.login} />
                    <View style={[styles.passwordField, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                      <Text style={[styles.passwordLabel, { color: tokens.textSecondary }]}>Пароль</Text>
                      <Text
                        testID="native-passwords-secret"
                        selectable={Boolean(revealedPassword)}
                        accessibilityLabel={revealedPassword ? 'Пароль показан' : 'Пароль скрыт'}
                        numberOfLines={revealedPassword ? undefined : 1}
                        style={[styles.passwordValue, { color: tokens.textPrimary }]}
                      >
                        {revealedPassword || '••••••••••••'}
                      </Text>
                      {revealedPassword ? <PasswordVisibilityCountdown until={secretVisibleUntil} color={tokens.textSecondary} /> : null}
                    </View>
                    <View style={styles.actionRow}>
                      <SheetActionButton
                        label={revealedPassword ? 'Скрыть' : actionBusy === 'show' ? 'Открываем…' : 'Показать'}
                        icon={revealedPassword ? 'eye-off-outline' : 'eye-outline'}
                        onPress={() => {
                          if (revealedPassword) {
                            if (hideSecretTimerRef.current) clearTimeout(hideSecretTimerRef.current);
                            hideSecretTimerRef.current = null;
                            setRevealedPassword('');
                          } else {
                            void revealPassword('show');
                          }
                        }}
                        tokens={tokens}
                        disabled={Boolean(actionBusy) || offlineMode}
                      />
                      <SheetActionButton
                        label={actionBusy === 'copy' ? 'Копируем…' : 'Копировать'}
                        icon="content-copy"
                        onPress={() => { void revealPassword('copy'); }}
                        tokens={tokens}
                        disabled={Boolean(actionBusy) || offlineMode}
                      />
                      {canWrite && !selected.is_archived ? (
                        <SheetActionButton
                          label={actionBusy === 'edit' ? 'Открываем…' : 'Редактировать'}
                          icon="pencil-outline"
                          onPress={() => { void beginEditing(); }}
                          tokens={tokens}
                          disabled={Boolean(actionBusy) || offlineMode}
                        />
                      ) : null}
                      {canWrite && !selected.is_archived ? (
                        <SheetActionButton
                          label={actionBusy === 'archive' ? 'Архивируем…' : 'В архив'}
                          icon="archive-arrow-down-outline"
                          onPress={confirmArchiveEntry}
                          tokens={tokens}
                          disabled={Boolean(actionBusy) || offlineMode}
                          danger
                          testID="native-passwords-archive"
                        />
                      ) : null}
                    </View>
                    {actionBusy && actionBusy !== 'unlock' ? (
                      <View accessibilityLiveRegion="polite" style={styles.busyRow}>
                        <ActivityIndicator size="small" color={tokens.primary} />
                        <Text style={[styles.busyText, { color: tokens.textSecondary }]}>Защищённая операция…</Text>
                      </View>
                    ) : null}
                    <AccountField tokens={tokens} label="Группа" value={selected.group} />
                    <AccountField tokens={tokens} label="Теги" value={selected.tags.map((item) => `#${item}`).join(', ')} />
                    <AccountField tokens={tokens} label="Описание" value={selected.description} />
                    <AccountField tokens={tokens} label="Обновлено" value={selected.updated_at} />
                    <AccountField tokens={tokens} label="Состояние" value={selected.is_archived ? 'Архив' : 'Активна'} />
                  </>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={groupsManagerOpen} transparent animationType="slide" onRequestClose={closeGroupsManager} statusBarTranslucent>
        <KeyboardAvoidingView style={styles.modalRoot} {...chatKeyboardAvoidingProps()}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть управление группами" style={styles.scrim} onPress={closeGroupsManager} />
          <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>Группы хранилища</Text>
                <Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>Централизованный список групп для записей</Text>
              </View>
              <Pressable onPress={closeGroupsManager} accessibilityRole="button" accessibilityLabel="Закрыть" style={styles.iconButton}><MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} /></Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              {groupActionError ? <Text accessibilityRole="alert" style={[styles.noticeBox, { color: tokens.error, backgroundColor: tokens.panelInset }]}>{groupActionError}</Text> : null}
              {groupActionMessage ? <Text accessibilityLiveRegion="polite" style={[styles.noticeBox, { color: tokens.success, backgroundColor: tokens.panelInset }]}>{groupActionMessage}</Text> : null}
              <View style={styles.inlineGroupRow}>
                <TextInput
                  testID="native-passwords-group-new-name"
                  value={newGroupDraft}
                  onChangeText={setNewGroupDraft}
                  editable={!groupSaving}
                  accessibilityLabel="Новая группа"
                  placeholder="Новая группа"
                  placeholderTextColor={tokens.textTertiary}
                  style={[styles.editorInput, styles.flex, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
                />
                <Pressable
                  testID="native-passwords-group-create"
                  onPress={() => { void createGroupFromManager(); }}
                  disabled={groupSaving || offlineMode || !newGroupDraft.trim()}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: groupSaving || offlineMode || !newGroupDraft.trim() }}
                  style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: (groupSaving || offlineMode || !newGroupDraft.trim()) ? 0.5 : 1 }]}
                >
                  <Text style={styles.primaryActionText}>Добавить</Text>
                </Pressable>
              </View>
              {groupsLoading ? <ActivityIndicator color={tokens.primary} /> : null}
              {!groupsLoading && !adminGroups.length ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Групп пока нет.</Text> : null}
              {adminGroups.map((item) => {
                const draft = groupDrafts[item.id] ?? item.name;
                const dirty = item.is_active && Boolean(draft.trim()) && draft.trim() !== item.name;
                return (
                  <View key={item.id} style={[styles.groupRow, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                    {item.is_active ? (
                      <TextInput
                        testID={`native-passwords-group-name-${item.id}`}
                        value={draft}
                        onChangeText={(value) => setGroupDrafts((current) => ({ ...current, [item.id]: value }))}
                        editable={!groupSaving}
                        accessibilityLabel={`Название группы ${item.name}`}
                        style={[styles.groupNameInput, { color: tokens.textPrimary, borderColor: tokens.border }]}
                      />
                    ) : (
                      <Text style={[styles.groupNameText, { color: tokens.textTertiary }]}>{item.name}</Text>
                    )}
                    <Text style={[styles.groupStatus, { color: item.is_active ? tokens.success : tokens.textTertiary }]}>{item.is_active ? 'Активна' : 'Архив'}</Text>
                    {item.is_active ? (
                      <View style={styles.groupRowActions}>
                        <Pressable
                          testID={`native-passwords-group-save-${item.id}`}
                          onPress={() => { void renameGroup(item); }}
                          disabled={groupSaving || !dirty}
                          accessibilityRole="button"
                          accessibilityLabel={`Сохранить группу ${item.name}`}
                          accessibilityState={{ disabled: groupSaving || !dirty }}
                          style={[styles.groupRowButton, { borderColor: tokens.border, opacity: (groupSaving || !dirty) ? 0.5 : 1 }]}
                        >
                          <Text style={[styles.groupRowButtonText, { color: tokens.primary }]}>Сохранить</Text>
                        </Pressable>
                        <Pressable
                          testID={`native-passwords-group-archive-${item.id}`}
                          onPress={() => confirmArchiveGroup(item)}
                          disabled={groupSaving}
                          accessibilityRole="button"
                          accessibilityLabel={`Архивировать группу ${item.name}`}
                          accessibilityState={{ disabled: groupSaving }}
                          style={[styles.groupRowButton, { borderColor: tokens.border, opacity: groupSaving ? 0.5 : 1 }]}
                        >
                          <Text style={[styles.groupRowButtonText, { color: tokens.error }]}>Архив</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerContent: { gap: 9, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  searchBox: { minHeight: 48, borderRadius: 13, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  appliedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  countRow: { flexWrap: 'wrap', minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  count: { fontSize: 12, fontWeight: '700' },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 9 },
  list: { gap: 9, paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  sheetHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  sheetSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  sheetContent: { gap: 12, paddingBottom: 22 },
  noticeBox: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  unlockBanner: { minHeight: 76, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  unlockTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  unlockDescription: { marginTop: 2, fontSize: 12, lineHeight: 18 },
  unlockIconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  passwordField: { minHeight: 70, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10, gap: 3 },
  passwordLabel: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
  passwordValue: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sheetAction: { flexBasis: 120, minWidth: 0, minHeight: 46, flexGrow: 1, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  sheetActionText: { flexShrink: 1, textAlign: 'center', fontSize: 12, lineHeight: 17, fontWeight: '800' },
  busyRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  busyText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  editor: { gap: 8 },
  editorHint: { fontSize: 12, lineHeight: 17 },
  inputLabel: { marginTop: 2, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  editorInput: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  editorTextarea: { minHeight: 88 },
  secretInputRow: { minHeight: 50, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center' },
  secretInput: { minHeight: 48, flex: 1, fontSize: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  groupChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groupChip: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  groupChipText: { fontSize: 13, fontWeight: '700' },
  inlineGroupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageGroupsRow: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  manageGroupsText: { fontSize: 14, fontWeight: '700' },
  groupRow: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  groupNameInput: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontSize: 14 },
  groupNameText: { fontSize: 15, fontWeight: '800' },
  groupStatus: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  groupRowActions: { flexDirection: 'row', gap: 8 },
  groupRowButton: { minHeight: 42, flex: 1, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  groupRowButtonText: { fontSize: 13, fontWeight: '800' },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
