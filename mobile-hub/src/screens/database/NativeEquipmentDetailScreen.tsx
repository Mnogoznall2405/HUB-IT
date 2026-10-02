import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  getCurrentDatabase,
  getEquipment,
  getEquipmentActs,
  getEquipmentHistory,
  getEquipmentWorkHistories,
  listEquipmentBranches,
  listEquipmentLocations,
  listEquipmentModels,
  listEquipmentStatuses,
  listEquipmentTypes,
  searchEquipmentOwners,
  switchDatabase,
  touchRecentEquipmentCard,
  updateEquipment,
  type EquipmentAct,
  type EquipmentDirectoryOption,
  type EquipmentModelOption,
  type EquipmentOwnerOption,
  type EquipmentRecord,
  type EquipmentStatusOption,
  type EquipmentTypeOption,
  type EquipmentUpdatePayload,
  type EquipmentWorkHistory,
  type EquipmentWorkKind,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeEntitySnapshot,
  readNativeSnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { readNativeEquipmentCatalogSnapshot } from '../../cache/nativeEquipmentCatalogSnapshot';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { openExternalUrl } from '../../addressBook/messengerLinks';
import { NativeActionSheetDivider, NativeActionSheetItem, NativeEquipmentActionBar } from '../../components/database/NativeEquipmentActionBar';
import { NativeCopyableField, copyIconHitSlop, copyNativeFieldValue } from '../../components/database/NativeCopyableField';
import { NativeEquipmentActCard } from '../../components/database/NativeEquipmentActCard';
import { NativeEquipmentActions, type NativeEquipmentActionsHandle } from '../../components/database/NativeEquipmentActions';
import { NativeEquipmentOptionPicker, type NativeEquipmentPickerOption } from '../../components/database/NativeEquipmentOptionPicker';
import { NativeEquipmentDescriptionField, NativeEquipmentSection } from '../../components/database/NativeEquipmentSection';
import { NativeEquipmentWorkHistoryCard } from '../../components/database/NativeEquipmentWorkHistoryCard';
import { NativeToastHost } from '../../components/nativeToast';
import { NativeEmployeeCompareSheet } from '../../components/warehouse1c/NativeEmployeeCompareSheet';
import { downloadEquipmentAct } from '../../database/nativeDatabaseFiles';
import {
  equipmentIcon,
  equipmentLocation,
  equipmentOwner,
  equipmentShareText,
  equipmentStatusTone,
  equipmentTitle,
  equipmentWorkKindLabel,
  equipmentWorkKinds,
  formatDatabaseDate,
  historyDate,
  historyDescription,
  historyTitle,
  validateEquipmentDraft,
  type EquipmentDetailTab,
  type EquipmentStatusTone,
} from '../../database/nativeDatabaseModel';
import { nativeEquipmentDestination } from '../../database/nativeDatabaseFeature';
import {
  nativeEquipmentSnapshotKey,
  type NativeDatabaseBootstrapSnapshot,
  type NativeEquipmentDetailSnapshot,
} from '../../database/nativeDatabaseSnapshot';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountField,
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function asDetailTab(value: string): EquipmentDetailTab {
  return value === 'works' || value === 'acts' || value === 'history' ? value : 'general';
}

function statusToneColor(tone: EquipmentStatusTone, tokens: ReturnType<typeof useFluentTokens>): string {
  if (tone === 'success') return tokens.success;
  if (tone === 'info') return tokens.primary;
  if (tone === 'warning') return tokens.warning;
  if (tone === 'danger') return tokens.error;
  return tokens.textSecondary;
}

export function NativeEquipmentDetailScreen() {
  const params = useLocalSearchParams<{ invNo?: string | string[]; databaseId?: string | string[] }>();
  const { user, hasPermission } = useAuth();
  return <EquipmentDetailContent key={JSON.stringify([user?.id, first(params.invNo), first(params.databaseId), hasPermission('database.read')])} />;
}

function EquipmentDetailContent() {
  const params = useLocalSearchParams<{
    invNo?: string | string[];
    databaseId?: string | string[];
    tab?: string | string[];
  }>();
  const invNo = first(params.invNo);
  const requestedDatabaseId = first(params.databaseId);
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('database.read');
  const requestRef = useRef(0);
  const tabRequests = useRef(new Map<EquipmentDetailTab, number>());
  const canWrite = hasPermission('database.write');
  const canViewWarehouse1C = hasPermission('warehouse_1c.read');
  const canDeleteEquipment = String(user?.role || '').trim().toLowerCase() === 'admin';
  const [tab, setTab] = useState<EquipmentDetailTab>(asDetailTab(first(params.tab)));
  const [databaseId, setDatabaseId] = useState(requestedDatabaseId);
  const [equipment, setEquipment] = useState<EquipmentRecord | null>(null);
  const equipmentRef = useRef<EquipmentRecord | null>(null);
  useEffect(() => { equipmentRef.current = equipment; }, [equipment]);
  const [acts, setActs] = useState<EquipmentAct[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [workHistory, setWorkHistory] = useState<EquipmentWorkHistory[]>([]);
  const [unavailableWorkKinds, setUnavailableWorkKinds] = useState<EquipmentWorkKind[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<EquipmentDetailTab>>(new Set());
  const [worksSummaryFailed, setWorksSummaryFailed] = useState(false);
  const [busyAct, setBusyAct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [tabError, setTabError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editDraft, setEditDraft] = useState<EquipmentUpdatePayload>({});
  const [initialDraft, setInitialDraft] = useState<EquipmentUpdatePayload | null>(null);
  const [pickerKind, setPickerKind] = useState<'status' | 'type' | 'model' | 'branch' | 'location' | null>(null);
  const [editModelsBusy, setEditModelsBusy] = useState(false);
  const [editLocationsBusy, setEditLocationsBusy] = useState(false);
  const [editOptionsBusy, setEditOptionsBusy] = useState(false);
  const [editBranches, setEditBranches] = useState<EquipmentDirectoryOption[]>([]);
  const [editLocations, setEditLocations] = useState<EquipmentDirectoryOption[]>([]);
  const [editTypes, setEditTypes] = useState<EquipmentTypeOption[]>([]);
  const [editModels, setEditModels] = useState<EquipmentModelOption[]>([]);
  const [editStatuses, setEditStatuses] = useState<EquipmentStatusOption[]>([]);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerOptions, setOwnerOptions] = useState<EquipmentOwnerOption[]>([]);
  const [employeeCompareOpen, setEmployeeCompareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const actionsRef = useRef<NativeEquipmentActionsHandle>(null);

  const applyCachedDetail = useCallback((snapshot: NativeEquipmentDetailSnapshot) => {
    setDatabaseId(snapshot.databaseId);
    equipmentRef.current = snapshot.equipment;
    setEquipment(snapshot.equipment);
    setActs(snapshot.acts || []);
    setHistory(snapshot.history || []);
    setWorkHistory(snapshot.workHistory || []);
    setUnavailableWorkKinds(snapshot.unavailableWorkKinds || []);
    setLoadedTabs(new Set(snapshot.loadedTabs || []));
  }, []);

  const ensureDatabase = useCallback(async (): Promise<string> => {
    const current = await getCurrentDatabase();
    if (!requestedDatabaseId || current.id === requestedDatabaseId) return current.id;
    if (current.locked) throw new Error(`Для пользователя закреплена база ${current.name}`);
    const switched = await switchDatabase(requestedDatabaseId);
    return switched.id;
  }, [requestedDatabaseId]);

  const loadEquipment = useCallback(async (refresh = false) => {
    const lease = ++requestRef.current;
    const current = () => requestRef.current === lease;
    if (!allowed || !invNo) {
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    const userId = Number(user?.id || 0);
    let cached: NativeEquipmentDetailSnapshot | null = null;
    let cachedDatabaseId = requestedDatabaseId;
    if (!cachedDatabaseId && userId) {
      const bootstrap = await readNativeSnapshot<NativeDatabaseBootstrapSnapshot>('database-bootstrap', userId);
      if (!current()) return;
      cachedDatabaseId = bootstrap?.data.currentDatabase.id || '';
    }
    if (userId && cachedDatabaseId) {
      const snapshot = await readNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
        'database-item-details',
        userId,
        nativeEquipmentSnapshotKey(cachedDatabaseId, invNo),
      );
      if (!current()) return;
      if (snapshot) {
        cached = snapshot.data;
        applyCachedDetail(snapshot.data);
        setLoading(false);
      }
      if (!cached) {
        const catalog = await readNativeEquipmentCatalogSnapshot(userId, cachedDatabaseId);
        if (!current()) return;
        const normalizedInvNo = invNo.trim().toLocaleUpperCase('ru-RU');
        const catalogItem = catalog?.data.equipment.find(
          (item) => item.inv_no.trim().toLocaleUpperCase('ru-RU') === normalizedInvNo,
        );
        if (catalogItem) {
          cached = {
            databaseId: cachedDatabaseId,
            equipment: catalogItem,
            acts: [],
            history: [],
            workHistory: [],
            unavailableWorkKinds: [],
            loadedTabs: [],
          };
          applyCachedDetail(cached);
          setLoading(false);
        }
      }
    }
    if (offlineMode) {
      if (!cached) setError('Нет подключения, и эта карточка ещё не сохранена на устройстве.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const activeDatabaseId = await ensureDatabase();
      if (!current()) return;
      const result = await getEquipment(invNo, activeDatabaseId);
      if (!current()) return;
      setDatabaseId(activeDatabaseId);
      equipmentRef.current = result;
      setEquipment(result);
      void touchRecentEquipmentCard(invNo, result, 'view', activeDatabaseId).catch(() => undefined);
      if (userId) {
        await writeNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
          'database-item-details',
          userId,
          nativeEquipmentSnapshotKey(activeDatabaseId, invNo),
          {
            databaseId: activeDatabaseId,
            equipment: result,
            acts: cached?.acts || [],
            history: cached?.history || [],
            workHistory: cached?.workHistory || [],
            unavailableWorkKinds: cached?.unavailableWorkKinds || [],
            loadedTabs: cached?.loadedTabs || [],
          },
        ).catch(() => undefined);
      }
    } catch (cause) {
      if (!current()) return;
      if (cached) setError('Показана сохранённая карточка. Обновить данные не удалось.');
      else setError(formatApiError(cause, 'Не удалось открыть карточку оборудования.'));
    } finally {
      if (current()) { setLoading(false); setRefreshing(false); }
    }
  }, [allowed, applyCachedDetail, ensureDatabase, invNo, offlineMode, requestedDatabaseId, user?.id]);

  useEffect(() => {
    void loadEquipment();
    return () => { requestRef.current += 1; tabRequests.current.clear(); };
  }, [loadEquipment]);

  const loadTab = useCallback(async (target: EquipmentDetailTab, force = false, silent = false) => {
    if (!invNo || target === 'general' || (target === 'works' && !equipment) || (!force && loadedTabs.has(target))) return;
    const lease = requestRef.current;
    const tabLease = (tabRequests.current.get(target) || 0) + 1;
    tabRequests.current.set(target, tabLease);
    const current = () => lease === requestRef.current && tabRequests.current.get(target) === tabLease;
    if (!silent) {
      setTabLoading(true);
      setTabError('');
    }
    const userId = Number(user?.id || 0);
    const snapshotKey = nativeEquipmentSnapshotKey(databaseId || requestedDatabaseId, invNo);
    let cached: NativeEquipmentDetailSnapshot | null = null;
    if (userId && snapshotKey !== ':') {
      const snapshot = await readNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
        'database-item-details',
        userId,
        snapshotKey,
      );
      if (!current()) return;
      if (snapshot) {
        cached = snapshot.data;
        if (snapshot.data.loadedTabs.includes(target as 'works' | 'acts' | 'history')) {
          applyCachedDetail(snapshot.data);
          if (!silent) setTabLoading(false);
          if (offlineMode || (silent && !force)) return;
        }
      }
    }
    if (offlineMode) {
      if (!silent) {
        setTabError('Эта вкладка ещё не сохранена. Откройте её один раз при наличии интернета.');
        setTabLoading(false);
      } else if (target === 'works') {
        setWorksSummaryFailed(true);
      }
      return;
    }
    try {
      let nextActs = cached?.acts || acts;
      let nextHistory = cached?.history || history;
      let nextWorkHistory = cached?.workHistory || workHistory;
      let nextUnavailable = cached?.unavailableWorkKinds || unavailableWorkKinds;
      if (target === 'acts') {
        const result = await getEquipmentActs(invNo, databaseId);
        if (!current()) return;
        setActs(result.acts);
        nextActs = result.acts;
      } else if (target === 'history') {
        const result = await getEquipmentHistory(invNo, databaseId);
        if (!current()) return;
        setHistory(result.history);
        nextHistory = result.history;
      } else if (equipment) {
        const result = await getEquipmentWorkHistories(equipment, equipmentWorkKinds(equipment));
        if (!current()) return;
        setWorkHistory(result.histories);
        setUnavailableWorkKinds(result.unavailable);
        nextWorkHistory = result.histories;
        nextUnavailable = result.unavailable;
        if (result.failed.length && !silent) {
          setTabError(`Часть истории не загрузилась: ${result.failed.map(equipmentWorkKindLabel).join(', ')}.`);
        }
      }
      setLoadedTabs((current) => new Set(current).add(target));
      if (target === 'works') setWorksSummaryFailed(false);
      if (userId && equipment) {
        const latest = (await readNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
          'database-item-details',
          userId,
          snapshotKey,
        ))?.data;
        if (!current()) return;
        void writeNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
          'database-item-details',
          userId,
          snapshotKey,
          {
            databaseId,
            equipment: equipmentRef.current ?? latest?.equipment ?? equipment,
            acts: target === 'acts' ? nextActs : (latest?.acts ?? nextActs),
            history: target === 'history' ? nextHistory : (latest?.history ?? nextHistory),
            workHistory: target === 'works' ? nextWorkHistory : (latest?.workHistory ?? nextWorkHistory),
            unavailableWorkKinds: target === 'works' ? nextUnavailable : (latest?.unavailableWorkKinds ?? nextUnavailable),
            loadedTabs: [...new Set([
              ...(latest?.loadedTabs || cached?.loadedTabs || [...loadedTabs].filter(
                (value): value is 'works' | 'acts' | 'history' => value !== 'general',
              )),
              target as 'works' | 'acts' | 'history',
            ])],
          },
        );
      }
    } catch (cause) {
      if (!current()) return;
      if (!silent) setTabError(formatApiError(cause, target === 'acts' ? 'Не удалось загрузить акты.' : target === 'works' ? 'Не удалось загрузить историю обслуживания.' : 'Не удалось загрузить историю.'));
      else if (target === 'works') setWorksSummaryFailed(true);
    } finally {
      if (current() && !silent) setTabLoading(false);
    }
  }, [acts, applyCachedDetail, databaseId, equipment, history, invNo, loadedTabs, offlineMode, requestedDatabaseId, unavailableWorkKinds, user?.id, workHistory]);

  useEffect(() => { void loadTab(tab); }, [loadTab, tab]);

  // Silent background prefetch for the "Обслуживание" summary on the card tab.
  useEffect(() => {
    if (tab === 'works' || !equipment || !equipmentWorkKinds(equipment).length) return;
    void loadTab('works', false, true);
  }, [equipment, loadTab, tab]);

  const refresh = useCallback(async () => {
    await loadEquipment(true);
    if (tab !== 'general') await loadTab(tab, true);
  }, [loadEquipment, loadTab, tab]);

  const openActFile = useCallback(async (act: EquipmentAct) => {
    if (busyAct !== null) return;
    setBusyAct(act.doc_no);
    setTabError('');
    try {
      const firstItem = act.items[0];
      const file = await downloadEquipmentAct(act.doc_no, {
        itemId: firstItem?.item_id,
        invNo: firstItem?.inv_no || invNo,
        fileName: `act-${act.doc_number || act.doc_no}.pdf`,
        databaseId,
      });
      await openNativeFile(file, 'application/pdf');
    } catch (cause) {
      setTabError(formatApiError(cause, 'Не удалось открыть файл акта.'));
    } finally {
      setBusyAct(null);
    }
  }, [busyAct, databaseId, invNo]);

  const goBack = useCallback(() => goBackOrReplace('/(shell)/database'), []);

  const copyAllCard = useCallback(() => {
    if (!equipment) return;
    setMenuOpen(false);
    void copyNativeFieldValue(equipmentShareText(equipment), 'Карточка скопирована');
  }, [equipment]);

  const copyModelTitle = useCallback(() => {
    if (!equipment) return;
    void copyNativeFieldValue(String(equipment.model_name || '').trim() || equipmentTitle(equipment), 'Модель скопирована');
  }, [equipment]);

  const shareCard = useCallback(() => {
    if (!equipment) return;
    setMenuOpen(false);
    void Share.share({ message: equipmentShareText(equipment), title: equipmentTitle(equipment) }).catch(() => undefined);
  }, [equipment]);

  const requestDelete = useCallback(() => {
    setMenuOpen(false);
    actionsRef.current?.open('delete');
  }, []);

  const openEditor = useCallback(() => {
    if (!equipment || !canWrite || offlineMode) return;
    const draft: EquipmentUpdatePayload = {
      serial_no: equipment.serial_no,
      hw_serial_no: equipment.hw_serial_no,
      part_no: equipment.part_no,
      ip_address: equipment.ip_address,
      mac_address: equipment.mac_address,
      network_name: equipment.network_name,
      description: equipment.description,
      status_no: equipment.status_no ?? null,
      empl_no: equipment.empl_no ?? null,
      branch_no: equipment.branch_no ?? null,
      loc_no: equipment.loc_no ?? null,
      type_no: equipment.type_no ?? null,
      model_no: equipment.model_no ?? null,
    };
    setEditDraft(draft);
    setInitialDraft(draft);
    setOwnerQuery(equipment.employee_name || '');
    setOwnerOptions(equipment.empl_no ? [{
      owner_no: equipment.empl_no,
      name: equipment.employee_name,
      department: equipment.employee_dept,
      email: equipment.employee_email,
    }] : []);
    setEditOpen(true);
  }, [canWrite, equipment, offlineMode]);

  useEffect(() => {
    if (!editOpen) return;
    let active = true;
    setEditOptionsBusy(true);
    void Promise.all([
      listEquipmentBranches(databaseId),
      listEquipmentTypes(1, databaseId),
      listEquipmentStatuses(databaseId),
    ]).then(([branches, types, statuses]) => {
      if (!active) return;
      setEditBranches(branches);
      setEditTypes(types);
      setEditStatuses(statuses);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники редактирования.'));
    }).finally(() => { if (active) setEditOptionsBusy(false); });
    return () => { active = false; };
  }, [databaseId, editOpen]);

  useEffect(() => {
    if (!editOpen || editDraft.branch_no === null || editDraft.branch_no === undefined) return;
    let active = true;
    setEditLocationsBusy(true);
    void listEquipmentLocations(editDraft.branch_no, databaseId)
      .then((items) => { if (active) setEditLocations(items); })
      .catch(() => { if (active) setEditLocations([]); })
      .finally(() => { if (active) setEditLocationsBusy(false); });
    return () => { active = false; };
  }, [databaseId, editDraft.branch_no, editOpen]);

  useEffect(() => {
    if (!editOpen || !editDraft.type_no) {
      setEditModels([]);
      return;
    }
    let active = true;
    setEditModelsBusy(true);
    void listEquipmentModels(editDraft.type_no, 1, databaseId)
      .then((items) => { if (active) setEditModels(items); })
      .catch(() => { if (active) setEditModels([]); })
      .finally(() => { if (active) setEditModelsBusy(false); });
    return () => { active = false; };
  }, [databaseId, editDraft.type_no, editOpen]);

  useEffect(() => {
    if (!editOpen || ownerQuery.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchEquipmentOwners(ownerQuery, 20, databaseId)
        .then((items) => { if (active) setOwnerOptions(items); })
        .catch(() => { if (active) setOwnerOptions([]); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [databaseId, editOpen, ownerQuery]);

  const editDirty = useMemo(() => {
    if (!initialDraft) return false;
    const keys = new Set([...Object.keys(editDraft), ...Object.keys(initialDraft)] as Array<keyof EquipmentUpdatePayload>);
    for (const key of keys) {
      const next = editDraft[key] == null ? '' : String(editDraft[key] as string | number);
      const base = initialDraft[key] == null ? '' : String(initialDraft[key] as string | number);
      if (next !== base) return true;
    }
    return false;
  }, [editDraft, initialDraft]);
  const editErrors = useMemo(() => {
    const errors = validateEquipmentDraft(editDraft);
    if (initialDraft) {
      (['ip_address', 'mac_address'] as const).forEach((key) => {
        const next = editDraft[key] == null ? '' : String(editDraft[key] as string | number);
        const base = initialDraft[key] == null ? '' : String(initialDraft[key] as string | number);
        if (next === base) delete errors[key];
      });
    }
    return errors;
  }, [editDraft, initialDraft]);

  const requestCloseEditor = useCallback(() => {
    if (editBusy) return;
    if (!editDirty) {
      setEditOpen(false);
      return;
    }
    Alert.alert('Отменить изменения?', 'Несохранённые правки будут потеряны.', [
      { text: 'Остаться', style: 'cancel' },
      { text: 'Отменить', style: 'destructive', onPress: () => setEditOpen(false) },
    ]);
  }, [editBusy, editDirty]);

  const saveEditor = useCallback(async () => {
    if (!equipment || editBusy || offlineMode || !editDirty) return;
    if (editErrors.ip_address || editErrors.mac_address) return;
    setEditBusy(true);
    setError('');
    try {
      const updated = await updateEquipment(equipment.inv_no, editDraft, databaseId);
      equipmentRef.current = updated;
      setEquipment(updated);
      setEditOpen(false);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить карточку оборудования.'));
    } finally {
      setEditBusy(false);
    }
  }, [databaseId, editBusy, editDirty, editDraft, editErrors, equipment, offlineMode]);

  const pickerConfig = useMemo((): {
    title: string;
    options: NativeEquipmentPickerOption[];
    selected: number | string | null;
    loading: boolean;
    onSelect: (id: number | string) => void;
  } => {
    switch (pickerKind) {
      case 'status':
        return {
          title: 'Статус',
          options: editStatuses.map((item) => ({ id: item.status_no, name: item.status_name })),
          selected: editDraft.status_no ?? null,
          loading: editOptionsBusy,
          onSelect: (id) => setEditDraft((current) => ({ ...current, status_no: Number(id) })),
        };
      case 'type':
        return {
          title: 'Тип',
          options: editTypes.map((item) => ({ id: item.type_no, name: item.type_name })),
          selected: editDraft.type_no ?? null,
          loading: editOptionsBusy,
          onSelect: (id) => setEditDraft((current) => ({ ...current, type_no: Number(id), model_no: null })),
        };
      case 'model':
        return {
          title: 'Модель',
          options: editModels.map((item) => ({ id: item.model_no, name: item.model_name })),
          selected: editDraft.model_no ?? null,
          loading: editModelsBusy,
          onSelect: (id) => setEditDraft((current) => ({ ...current, model_no: Number(id) })),
        };
      case 'branch':
        return {
          title: 'Филиал',
          options: editBranches,
          selected: editDraft.branch_no ?? null,
          loading: editOptionsBusy,
          onSelect: (id) => setEditDraft((current) => ({ ...current, branch_no: id, loc_no: null })),
        };
      case 'location':
        return {
          title: 'Размещение',
          options: editLocations,
          selected: editDraft.loc_no ?? null,
          loading: editLocationsBusy,
          onSelect: (id) => setEditDraft((current) => ({ ...current, loc_no: id })),
        };
      default:
        return { title: '', options: [], selected: null, loading: false, onSelect: () => undefined };
    }
  }, [editBranches, editDraft.branch_no, editDraft.loc_no, editDraft.model_no, editDraft.status_no, editDraft.type_no, editLocations, editLocationsBusy, editModels, editModelsBusy, editOptionsBusy, editStatuses, editTypes, pickerKind]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Карточка оборудования" tokens={tokens} onBack={goBack}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право database.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <>
    <AccountScreenScaffold
      title={equipment ? equipmentTitle(equipment) : 'Карточка оборудования'}
      tokens={tokens}
      onBack={goBack}
      refreshing={refreshing}
      onRefresh={() => { void refresh(); }}
      rightAction={equipment ? (
        <Pressable
          testID="native-equipment-menu"
          accessibilityRole="button"
          accessibilityLabel="Меню карточки оборудования"
          onPress={() => setMenuOpen(true)}
          style={styles.headerAction}
        >
          <MaterialCommunityIcons name="dots-vertical" size={22} color={tokens.textPrimary} />
        </Pressable>
      ) : undefined}
      footer={equipment && canWrite ? (
        <NativeEquipmentActionBar
          tokens={tokens}
          offline={offlineMode}
          workKinds={equipmentWorkKinds(equipment)}
          onEdit={openEditor}
          onOpenAction={(kind) => actionsRef.current?.open(kind)}
        />
      ) : undefined}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: доступны только уже загруженные данные.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {loading && !equipment ? <AccountLoading tokens={tokens} /> : null}
      {!loading && !equipment ? (
        <AccountSectionCard tokens={tokens} title="Карточка недоступна" description="Проверьте инвентарный номер или обновите страницу.">
          <Pressable onPress={() => { void loadEquipment(); }} accessibilityRole="button" style={[styles.retry, { borderColor: tokens.border }]}>
            <Text style={{ color: tokens.primary, fontWeight: '800' }}>Повторить</Text>
          </Pressable>
        </AccountSectionCard>
      ) : null}

      {equipment ? (
        <>
          <View style={styles.hero}>
            <View style={[styles.heroIcon, { backgroundColor: tokens.accentSoft }]}><MaterialCommunityIcons name={equipmentIcon(equipment)} size={30} color={tokens.primary} /></View>
            <View style={styles.heroBody}>
              <Pressable
                testID="native-equipment-title"
                onLongPress={copyModelTitle}
                accessibilityLabel={equipmentTitle(equipment)}
                accessibilityHint="Долгое нажатие — скопировать модель"
                style={styles.heroTitleRow}
              >
                <Text style={[styles.heroTitle, { color: tokens.textPrimary }]}>{equipmentTitle(equipment)}</Text>
                <Pressable
                  testID="native-equipment-copy-title"
                  accessibilityRole="button"
                  accessibilityLabel={`Скопировать модель: ${String(equipment.model_name || '').trim() || equipmentTitle(equipment)}`}
                  onPress={copyModelTitle}
                  onLongPress={copyModelTitle}
                  hitSlop={copyIconHitSlop}
                  style={styles.heroCopyButton}
                >
                  <MaterialCommunityIcons name="content-copy" size={18} color={tokens.iconMuted} />
                </Pressable>
              </Pressable>
              <Text style={[styles.heroMeta, { color: tokens.textSecondary }]}>{[equipment.vendor_name, equipment.type_name].filter(Boolean).join(' · ') || 'Производитель и тип не указаны'}</Text>
              <View style={styles.pillRow}>
                <Pressable
                  testID="native-equipment-copy-inv"
                  accessibilityRole="button"
                  accessibilityLabel={`Инвентарный номер ${equipment.inv_no}. Нажмите, чтобы скопировать`}
                  onPress={() => { void copyNativeFieldValue(equipment.inv_no, 'Инвентарный номер скопирован'); }}
                  style={({ pressed }) => [styles.invPill, { backgroundColor: tokens.accentSoft, opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[styles.invNo, { color: tokens.primary }]}>Инв. № {equipment.inv_no}</Text>
                  <MaterialCommunityIcons name="content-copy" size={14} color={tokens.primary} />
                </Pressable>
                <View
                  accessible
                  accessibilityLabel={`Статус: ${equipment.status_name || 'не указан'}`}
                  style={[styles.pill, { backgroundColor: tokens.panelInset }]}
                >
                  <View style={[styles.statusDot, { backgroundColor: statusToneColor(equipmentStatusTone(equipment.status_name), tokens) }]} />
                  <Text numberOfLines={1} style={[styles.pillText, { color: tokens.textSecondary }]}>{equipment.status_name || 'Статус не указан'}</Text>
                </View>
                {equipment.serial_no ? (
                  <Pressable
                    testID="native-equipment-copy-serial"
                    accessibilityRole="button"
                    accessibilityLabel={`Серийный номер ${equipment.serial_no}. Нажмите, чтобы скопировать`}
                    onPress={() => { void copyNativeFieldValue(equipment.serial_no, 'Серийный номер скопирован'); }}
                    style={({ pressed }) => [styles.invPill, { backgroundColor: tokens.accentSoft, opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Text numberOfLines={1} style={[styles.invNo, { color: tokens.primary }]}>S/N {equipment.serial_no}</Text>
                    <MaterialCommunityIcons name="content-copy" size={14} color={tokens.primary} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          <View style={[styles.tabs, { backgroundColor: tokens.panelInset }]} accessibilityRole="tablist">
            {(['general', 'works', 'acts', 'history'] as const).map((value) => {
              const selected = tab === value;
              const label = value === 'general'
                ? 'Карточка'
                : value === 'works'
                  ? 'Работы'
                  : value === 'acts'
                    ? `Акты${loadedTabs.has('acts') ? ` ${acts.length}` : ''}`
                    : `История${loadedTabs.has('history') ? ` ${history.length}` : ''}`;
              return (
                <Pressable
                  key={value}
                  testID={`native-equipment-tab-${value}`}
                  onPress={() => setTab(value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  style={[styles.tab, { backgroundColor: selected ? tokens.panelSolid : 'transparent' }]}
                >
                  <Text numberOfLines={1} style={[styles.tabText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'general' ? (
            <>
              <NativeEquipmentSection tokens={tokens} title="Устройство" sectionKey="device" alwaysShow items={[
                { key: 'model', empty: !String(equipment.model_name || '').trim(), node: <NativeCopyableField tokens={tokens} label="Модель" value={equipment.model_name} copyLabel="Модель" copiedMessage="Модель скопирована" testID="native-equipment-field-model" /> },
                { key: 'type', empty: !String(equipment.type_name || '').trim(), node: <NativeCopyableField tokens={tokens} label="Тип" value={equipment.type_name} copyLabel="Тип" testID="native-equipment-field-type" /> },
                { key: 'vendor', empty: !String(equipment.vendor_name || '').trim(), node: <NativeCopyableField tokens={tokens} label="Производитель" value={equipment.vendor_name} copyLabel="Производитель" testID="native-equipment-field-vendor" /> },
                { key: 'serial', empty: !String(equipment.serial_no || '').trim(), node: <NativeCopyableField tokens={tokens} label="Серийный номер" value={equipment.serial_no} copyLabel="Серийный номер" testID="native-equipment-field-serial" /> },
                { key: 'hw-serial', empty: !String(equipment.hw_serial_no || '').trim(), node: <NativeCopyableField tokens={tokens} label="Аппаратный S/N" value={equipment.hw_serial_no} copyLabel="Аппаратный S/N" testID="native-equipment-field-hw-serial" /> },
                { key: 'part', empty: !String(equipment.part_no || '').trim(), node: <NativeCopyableField tokens={tokens} label="Part number" value={equipment.part_no} copyLabel="Part number" testID="native-equipment-field-part" /> },
              ]} />
              <NativeEquipmentSection tokens={tokens} title="Сотрудник и размещение" sectionKey="employee" items={[
                {
                  key: 'employee',
                  empty: !String(equipment.employee_name || '').trim(),
                  node: canViewWarehouse1C && equipment.employee_name ? (
                    <Pressable
                      testID="native-equipment-employee-compare"
                      accessibilityRole="button"
                      accessibilityLabel={`Сотрудник: ${equipmentOwner(equipment)}. Открыть склад сотрудника в Хабе и 1С`}
                      accessibilityHint="Долгое нажатие — скопировать ФИО сотрудника"
                      accessibilityState={{ disabled: offlineMode }}
                      onPress={() => { if (!offlineMode) setEmployeeCompareOpen(true); }}
                      onLongPress={() => { void copyNativeFieldValue(equipment.employee_name, 'Сотрудник скопирован'); }}
                      style={({ pressed }) => [styles.employeeCompareRow, { borderBottomColor: tokens.borderSoft }, { opacity: offlineMode ? 0.5 : pressed ? 0.75 : 1 }]}
                    >
                      <View style={styles.employeeCompareText}>
                        <Text style={[styles.employeeCompareLabel, { color: tokens.textSecondary }]}>Сотрудник</Text>
                        <View style={styles.employeeCompareValueRow}>
                          <Text style={[styles.employeeCompareValue, { color: tokens.textPrimary }]}>{equipmentOwner(equipment)}</Text>
                          <Pressable
                            testID="native-equipment-employee-copy"
                            accessibilityRole="button"
                            accessibilityLabel="Скопировать: Сотрудник"
                            onPress={() => { void copyNativeFieldValue(equipment.employee_name, 'Сотрудник скопирован'); }}
                            onLongPress={() => { void copyNativeFieldValue(equipment.employee_name, 'Сотрудник скопирован'); }}
                            hitSlop={copyIconHitSlop}
                            style={styles.inlineCopyButton}
                          >
                            <MaterialCommunityIcons name="content-copy" size={18} color={tokens.iconMuted} />
                          </Pressable>
                        </View>
                        <Text style={[styles.employeeCompareHint, { color: tokens.primary }]}>Склад в Хабе и в 1С</Text>
                      </View>
                      <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
                    </Pressable>
                  ) : (
                    <NativeCopyableField tokens={tokens} label="Сотрудник" value={equipmentOwner(equipment)} copyLabel="Сотрудник" copyValue={equipment.employee_name} testID="native-equipment-field-employee" />
                  ),
                },
                { key: 'dept', empty: !String(equipment.employee_dept || '').trim(), node: <NativeCopyableField tokens={tokens} label="Отдел" value={equipment.employee_dept} copyLabel="Отдел" testID="native-equipment-field-dept" /> },
                {
                  key: 'email',
                  empty: !String(equipment.employee_email || '').trim(),
                  node: (
                    <NativeCopyableField
                      tokens={tokens}
                      label="E-mail"
                      value={equipment.employee_email}
                      copyLabel="E-mail"
                      testID="native-equipment-field-email"
                      trailing={(
                        <Pressable
                          testID="native-equipment-field-email-mailto"
                          accessibilityRole="button"
                          accessibilityLabel={`Написать письмо: ${equipment.employee_email}`}
                          onPress={() => { void openExternalUrl(`mailto:${String(equipment.employee_email || '').trim()}`); }}
                          hitSlop={copyIconHitSlop}
                          style={styles.inlineCopyButton}
                        >
                          <MaterialCommunityIcons name="email-outline" size={18} color={tokens.iconMuted} />
                        </Pressable>
                      )}
                    />
                  ),
                },
                { key: 'location', empty: !String(equipment.branch_name || '').trim() && !String(equipment.location_name || '').trim(), node: <NativeCopyableField tokens={tokens} label="Размещение" value={equipmentLocation(equipment)} copyLabel="Размещение" copiedMessage="Размещение скопировано" copyValue={[equipment.branch_name, equipment.location_name].filter(Boolean).join(' · ')} testID="native-equipment-field-location" /> },
              ]} />
              {equipmentWorkKinds(equipment).length && !worksSummaryFailed ? (
                <AccountSectionCard tokens={tokens} title="Обслуживание">
                  {loadedTabs.has('works')
                    ? equipmentWorkKinds(equipment).map((kind) => {
                        const entry = workHistory.find((item) => item.kind === kind);
                        const value = entry?.last_date
                          ? `${formatDatabaseDate(entry.last_date)}${entry.time_ago_str ? ` · ${entry.time_ago_str}` : ''}`
                          : 'нет записей';
                        return (
                          <View key={kind} style={styles.maintenanceRow}>
                            <Text style={[styles.maintenanceKind, { color: tokens.textSecondary }]}>{equipmentWorkKindLabel(kind)}</Text>
                            <Text style={[styles.maintenanceValue, { color: tokens.textPrimary }]}>{value}</Text>
                          </View>
                        );
                      })
                    : <Text style={[styles.maintenanceValue, { color: tokens.textSecondary }]}>Загрузка…</Text>}
                  <Pressable
                    testID="native-equipment-all-works"
                    accessibilityRole="button"
                    accessibilityLabel="Все работы"
                    onPress={() => setTab('works')}
                    style={({ pressed }) => [styles.maintenanceLink, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.maintenanceLinkText, { color: tokens.primary }]}>Все работы →</Text>
                  </Pressable>
                </AccountSectionCard>
              ) : null}
              <NativeEquipmentSection tokens={tokens} title="Сеть" sectionKey="network" items={[
                { key: 'network', empty: !String(equipment.network_name || '').trim(), node: <NativeCopyableField tokens={tokens} label="Сетевое имя" value={equipment.network_name} copyLabel="Сетевое имя" copiedMessage="Сетевое имя скопировано" testID="native-equipment-field-network" /> },
                { key: 'ip', empty: !String(equipment.ip_address || '').trim(), node: <NativeCopyableField tokens={tokens} label="IP-адрес" value={equipment.ip_address} copyLabel="IP-адрес" testID="native-equipment-field-ip" /> },
                { key: 'mac', empty: !String(equipment.mac_address || '').trim(), node: <NativeCopyableField tokens={tokens} label="MAC-адрес" value={equipment.mac_address} copyLabel="MAC-адрес" testID="native-equipment-field-mac" /> },
                { key: 'domain', empty: !String(equipment.domain_name || '').trim(), node: <NativeCopyableField tokens={tokens} label="Домен" value={equipment.domain_name} copyLabel="Домен" testID="native-equipment-field-domain" /> },
              ]} />
              <NativeEquipmentSection tokens={tokens} title="Описание" sectionKey="description" items={[
                { key: 'description', empty: !String(equipment.description || '').trim(), node: <NativeEquipmentDescriptionField tokens={tokens} value={equipment.description} testID="native-equipment-field-description" /> },
              ]} />
              <NativeEquipmentSection tokens={tokens} title="Служебное" sectionKey="service" items={[
                { key: 'created', empty: !String(equipment.date_create || '').trim(), node: <AccountField tokens={tokens} label="Создано" value={formatDatabaseDate(equipment.date_create)} /> },
                { key: 'modified', empty: !String(equipment.date_last_modify || '').trim(), node: <AccountField tokens={tokens} label="Изменено" value={formatDatabaseDate(equipment.date_last_modify)} /> },
                { key: 'changed_by', empty: !String(equipment.changed_by || '').trim(), node: <AccountField tokens={tokens} label="Изменил" value={equipment.changed_by || '—'} /> },
              ]} />
            </>
          ) : null}

          {tab !== 'general' ? (
            <View>
              {tabError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{tabError}</Text> : null}
              {tabLoading ? <View style={styles.tabLoading}><ActivityIndicator color={tokens.primary} /></View> : null}
              {!tabLoading && tab === 'acts' ? (
                acts.length ? acts.map((act) => (
                  <NativeEquipmentActCard
                    key={act.doc_no}
                    act={act}
                    tokens={tokens}
                    fileBusy={busyAct === act.doc_no}
                    onOpenEquipment={(targetInvNo) => router.push(nativeEquipmentDestination(targetInvNo, 'general', databaseId) as never)}
                    onOpenFile={act.has_file ? () => { void openActFile(act); } : undefined}
                  />
                )) : <EmptyTab tokens={tokens} label="Для оборудования нет связанных актов." onRetry={() => { void loadTab('acts', true); }} />
              ) : null}
              {!tabLoading && tab === 'works' ? (
                <View>
                  {unavailableWorkKinds.length ? (
                    <Text accessibilityLiveRegion="polite" style={[styles.workNotice, { color: tokens.textSecondary }]}>
                      Не указан серийный номер — недоступно: {unavailableWorkKinds.map(equipmentWorkKindLabel).join(', ')}.
                    </Text>
                  ) : null}
                  {workHistory.length ? workHistory.map((entry) => (
                    <NativeEquipmentWorkHistoryCard key={entry.kind} history={entry} tokens={tokens} />
                  )) : (
                    <AccountSectionCard
                      tokens={tokens}
                      title="История обслуживания пуста"
                      description={equipmentWorkKinds(equipment).length ? 'Для оборудования пока нет доступных записей.' : 'Для этого типа оборудования сервисные сценарии не определены.'}
                    >
                      <Pressable onPress={() => { void loadTab('works', true); }} accessibilityRole="button" style={[styles.retry, { borderColor: tokens.border }]}>
                        <Text style={{ color: tokens.primary, fontWeight: '800' }}>Обновить</Text>
                      </Pressable>
                    </AccountSectionCard>
                  )}
                  <NativeEquipmentActions
                    equipment={equipment}
                    databaseId={databaseId}
                    canWrite={canWrite}
                    canDeleteEquipment={false}
                    offline={offlineMode}
                    surface="works"
                    tokens={tokens}
                    onChanged={() => loadTab('works', true)}
                    onDeleted={goBack}
                  />
                </View>
              ) : null}
              {!tabLoading && tab === 'history' ? (
                history.length ? history.map((row, index) => (
                  <View key={`${historyDate(row)}:${index}`} style={[styles.historyCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                    <View style={styles.historyTitleRow}>
                      <MaterialCommunityIcons name="history" size={20} color={tokens.primary} />
                      <Text style={[styles.historyTitle, { color: tokens.textPrimary }]}>{historyTitle(row)}</Text>
                    </View>
                    <Text style={[styles.historyDescription, { color: tokens.textSecondary }]}>{historyDescription(row)}</Text>
                    <Text style={[styles.historyDate, { color: tokens.textTertiary }]}>{historyDate(row)}</Text>
                  </View>
                )) : <EmptyTab tokens={tokens} label="История перемещений пуста." onRetry={() => { void loadTab('history', true); }} />
              ) : null}
            </View>
          ) : null}
          <NativeEquipmentActions
            ref={actionsRef}
            equipment={equipment}
            databaseId={databaseId}
            canWrite={canWrite}
            canDeleteEquipment={canDeleteEquipment}
            offline={offlineMode}
            surface="general"
            triggers="none"
            tokens={tokens}
            onChanged={async (kind) => {
              await loadEquipment(true);
              if (equipmentWorkKinds(equipment).includes(kind as EquipmentWorkKind)) {
                await loadTab('works', true, tab !== 'works');
              }
            }}
            onDeleted={goBack}
          />
        </>
      ) : null}
      <Modal
        visible={editOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={requestCloseEditor}
        accessibilityViewIsModal
      >
        <KeyboardAvoidingView style={[styles.editor, { backgroundColor: tokens.pageBg }]} {...chatKeyboardAvoidingProps()}>
          <View style={[styles.editorHeader, { borderBottomColor: tokens.borderSoft }]}> 
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть редактирование" disabled={editBusy} onPress={requestCloseEditor} style={styles.editorHeaderAction}>
              <Text style={[styles.editorHeaderButton, { color: tokens.textSecondary }]}>Отмена</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.editorTitle, { color: tokens.textPrimary }]}>Редактирование</Text>
            <Pressable testID="native-equipment-edit-save" accessibilityRole="button" accessibilityLabel="Сохранить карточку" accessibilityState={{ disabled: editBusy || !editDirty }} disabled={editBusy || !editDirty} onPress={() => { void saveEditor(); }} style={styles.editorHeaderAction}>
              {editBusy ? <ActivityIndicator size="small" color={tokens.primary} /> : <Text style={[styles.editorHeaderButton, { color: editDirty ? tokens.primary : tokens.textTertiary }]}>Сохранить</Text>}
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
            <Text style={[styles.editorHint, { color: tokens.textSecondary }]}>Инв. № {equipment?.inv_no}. Все справочные значения проверяются сервером текущей базы.</Text>
            {editOptionsBusy ? <ActivityIndicator style={styles.editorOptionsLoading} color={tokens.primary} /> : null}
            <EditorPickerRow
              testID="native-equipment-edit-pick-status"
              label="Статус"
              value={pickerValueLabel(editStatuses.map((item) => ({ id: item.status_no, name: item.status_name })), editDraft.status_no, equipment?.status_name)}
              disabled={editBusy}
              onPress={() => setPickerKind('status')}
              tokens={tokens}
            />
            <EditorPickerRow
              testID="native-equipment-edit-pick-type"
              label="Тип"
              value={pickerValueLabel(editTypes.map((item) => ({ id: item.type_no, name: item.type_name })), editDraft.type_no, equipment?.type_name)}
              disabled={editBusy}
              onPress={() => setPickerKind('type')}
              tokens={tokens}
            />
            <EditorPickerRow
              testID="native-equipment-edit-pick-model"
              label="Модель"
              value={pickerValueLabel(editModels.map((item) => ({ id: item.model_no, name: item.model_name })), editDraft.model_no, equipment?.model_name)}
              hint={editDraft.type_no ? undefined : 'Сначала выберите тип'}
              disabled={editBusy || !editDraft.type_no}
              onPress={() => setPickerKind('model')}
              tokens={tokens}
            />
            <EditorPickerRow
              testID="native-equipment-edit-pick-branch"
              label="Филиал"
              value={pickerValueLabel(editBranches, editDraft.branch_no, equipment?.branch_name)}
              disabled={editBusy}
              onPress={() => setPickerKind('branch')}
              tokens={tokens}
            />
            <EditorPickerRow
              testID="native-equipment-edit-pick-location"
              label="Размещение"
              value={pickerValueLabel(editLocations, editDraft.loc_no, equipment?.location_name)}
              hint={editDraft.branch_no ? undefined : 'Сначала выберите филиал'}
              disabled={editBusy || !editDraft.branch_no}
              onPress={() => setPickerKind('location')}
              tokens={tokens}
            />
            <View style={styles.editorField}>
              <Text style={[styles.editorLabel, { color: tokens.textSecondary }]}>Сотрудник</Text>
              <TextInput
                testID="native-equipment-edit-owner-search"
                value={ownerQuery}
                onChangeText={setOwnerQuery}
                editable={!editBusy}
                accessibilityLabel="Поиск сотрудника"
                placeholder="ФИО сотрудника"
                placeholderTextColor={tokens.textTertiary}
                style={[styles.editorInput, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
              />
              {ownerOptions.map((owner) => {
                const selected = owner.owner_no === editDraft.empl_no;
                return (
                  <Pressable
                    key={owner.owner_no}
                    testID={`native-equipment-edit-owner-${owner.owner_no}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => { setEditDraft((current) => ({ ...current, empl_no: owner.owner_no })); setOwnerQuery(owner.name); }}
                    style={[styles.ownerOption, { backgroundColor: selected ? tokens.selected : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                  >
                    <Text style={[styles.ownerName, { color: tokens.textPrimary }]}>{owner.name}</Text>
                    {owner.department ? <Text style={[styles.ownerMeta, { color: tokens.textSecondary }]}>{owner.department}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {([
              ['serial_no', 'Серийный номер'],
              ['hw_serial_no', 'Аппаратный S/N'],
              ['part_no', 'Part number'],
              ['ip_address', 'IP-адрес'],
              ['mac_address', 'MAC-адрес'],
              ['network_name', 'Сеть'],
              ['description', 'Описание'],
            ] as Array<[keyof EquipmentUpdatePayload, string]>).map(([key, label]) => (
              <View key={key} style={styles.editorField}>
                <Text style={[styles.editorLabel, { color: tokens.textSecondary }]}>{label}</Text>
                <TextInput
                  testID={`native-equipment-edit-${key}`}
                  value={String(editDraft[key] || '')}
                  onChangeText={(value) => setEditDraft((current) => ({ ...current, [key]: value }))}
                  editable={!editBusy}
                  multiline={key === 'description'}
                  accessibilityLabel={label}
                  placeholder={label}
                  placeholderTextColor={tokens.textTertiary}
                  autoCapitalize={key === 'mac_address' ? 'characters' : key === 'ip_address' ? 'none' : 'sentences'}
                  autoCorrect={key === 'ip_address' || key === 'mac_address' ? false : undefined}
                  keyboardType={key === 'ip_address' ? 'numbers-and-punctuation' : 'default'}
                  style={[styles.editorInput, key === 'description' && styles.editorTextarea, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: editErrors[key as 'ip_address' | 'mac_address'] ? tokens.error : tokens.border }]}
                />
                {editErrors[key as 'ip_address' | 'mac_address'] ? (
                  <Text accessibilityRole="alert" style={[styles.editorFieldError, { color: tokens.error }]}>{editErrors[key as 'ip_address' | 'mac_address']}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <NativeEquipmentOptionPicker
            visible={pickerKind !== null}
            title={pickerConfig.title}
            options={pickerConfig.options}
            selectedId={pickerConfig.selected}
            loading={pickerConfig.loading}
            tokens={tokens}
            onSelect={(id) => { pickerConfig.onSelect(id); setPickerKind(null); }}
            onClose={() => setPickerKind(null)}
          />
        </KeyboardAvoidingView>
      </Modal>
      <NativeEmployeeCompareSheet
        visible={employeeCompareOpen}
        ownerNo={equipment?.empl_no ?? null}
        employeeName={equipment?.employee_name || ''}
        databaseId={databaseId}
        canViewWarehouse1C={canViewWarehouse1C}
        offline={offlineMode}
        tokens={tokens}
        onClose={() => setEmployeeCompareOpen(false)}
      />
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть меню карточки" style={styles.menuScrim} onPress={() => setMenuOpen(false)} />
          <View style={[styles.menuSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
            <ScrollView contentContainerStyle={styles.menuSheetContent}>
              <NativeActionSheetItem testID="native-equipment-copy-all" icon="content-copy" label="Скопировать всё" onPress={copyAllCard} tokens={tokens} />
              <NativeActionSheetItem testID="native-equipment-share" icon="share-variant-outline" label="Поделиться" onPress={shareCard} tokens={tokens} />
              {canDeleteEquipment ? <NativeActionSheetDivider tokens={tokens} /> : null}
              {canDeleteEquipment ? (
                <NativeActionSheetItem
                  testID="native-equipment-delete"
                  icon="delete-outline"
                  label="Удалить карточку"
                  danger
                  disabled={offlineMode}
                  onPress={requestDelete}
                  tokens={tokens}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AccountScreenScaffold>
    <NativeToastHost />
    </>
  );
}

function pickerValueLabel(items: Array<{ id: number | string; name: string }>, selected: number | string | null | undefined, fallback?: string): string {
  const found = items.find((item) => String(item.id) === String(selected ?? ''));
  if (found) return found.name;
  return selected == null ? '' : (fallback || '');
}

function EditorPickerRow({ label, value, hint, disabled, onPress, tokens, testID }: {
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
  tokens: ReturnType<typeof useFluentTokens>;
  testID: string;
}) {
  return (
    <View style={styles.editorField}>
      <Text style={[styles.editorLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'не выбрано'}`}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.editorPickerRow, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }, disabled && { opacity: 0.5 }]}
      >
        <Text style={[styles.editorPickerValue, { color: value ? tokens.textPrimary : tokens.textTertiary }]}>{value || 'Не выбрано'}</Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={tokens.iconMuted} />
      </Pressable>
      {hint ? <Text style={[styles.editorFieldHint, { color: tokens.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

function EmptyTab({ tokens, label, onRetry }: { tokens: ReturnType<typeof useFluentTokens>; label: string; onRetry: () => void }) {
  return (
    <AccountSectionCard tokens={tokens} title={label}>
      <Pressable onPress={onRetry} accessibilityRole="button" style={[styles.retry, { borderColor: tokens.border }]}>
        <Text style={{ color: tokens.primary, fontWeight: '800' }}>Обновить</Text>
      </Pressable>
    </AccountSectionCard>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  employeeCompareRow: { minHeight: 48, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  employeeCompareText: { flex: 1, minWidth: 0 },
  employeeCompareLabel: { fontSize: 12, fontWeight: '600' },
  employeeCompareValueRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8 },
  employeeCompareValue: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
  employeeCompareHint: { marginTop: 2, fontSize: 12, fontWeight: '700' },
  maintenanceRow: { paddingVertical: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  maintenanceKind: { flexShrink: 1, minWidth: 0, fontSize: 13, fontWeight: '600' },
  maintenanceValue: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  maintenanceLink: { minHeight: 44, justifyContent: 'center' },
  maintenanceLinkText: { fontSize: 13, fontWeight: '800' },
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  workNotice: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  retry: { minHeight: 44, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 5 },
  heroIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1, gap: 3 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { flexShrink: 1, fontSize: 21, lineHeight: 26, fontWeight: '900' },
  heroCopyButton: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  invNo: { fontSize: 13, fontWeight: '900' },
  invPill: { alignSelf: 'flex-start', minHeight: 34, borderRadius: 9, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  inlineCopyButton: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  heroMeta: { fontSize: 12 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  pill: { minHeight: 34, borderRadius: 9, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '800' },
  tabs: { minHeight: 46, borderRadius: 12, padding: 3, flexDirection: 'row' },
  tab: { flex: 1, minHeight: 40, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 12, fontWeight: '800' },
  tabLoading: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
  webAction: { minHeight: 74, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  webActionBody: { flex: 1 },
  webActionTitle: { fontSize: 14, fontWeight: '800' },
  webActionText: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  menuRoot: { flex: 1, justifyContent: 'flex-end' },
  menuScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  menuSheet: { maxHeight: '72%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingTop: 8 },
  menuSheetContent: { paddingHorizontal: 14, paddingBottom: 26 },
  editor: { flex: 1 },
  editorHeader: { minHeight: 58, borderBottomWidth: 1, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  editorHeaderAction: { width: 88, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  editorHeaderButton: { fontSize: 13, fontWeight: '800' },
  editorTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900' },
  editorContent: { padding: 16, paddingBottom: 40 },
  editorHint: { marginBottom: 14, fontSize: 12, lineHeight: 17 },
  editorOptionsLoading: { marginBottom: 12 },
  editorField: { marginBottom: 12 },
  editorLabel: { marginBottom: 5, fontSize: 12, fontWeight: '800' },
  editorPickerRow: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editorPickerValue: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
  editorFieldHint: { marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  editorFieldError: { marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  editorChoices: { gap: 8, paddingBottom: 2 },
  editorChoice: { minHeight: 44, maxWidth: 260, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, justifyContent: 'center' },
  editorChoiceText: { fontSize: 12, fontWeight: '800' },
  editorInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  editorTextarea: { minHeight: 104, textAlignVertical: 'top' },
  ownerOption: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8, marginTop: 7 },
  ownerName: { fontSize: 13, fontWeight: '800' },
  ownerMeta: { marginTop: 2, fontSize: 11 },
  historyCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8 },
  historyTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  historyTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  historyDescription: { marginTop: 7, fontSize: 12, lineHeight: 17 },
  historyDate: { marginTop: 6, fontSize: 11 },
});
