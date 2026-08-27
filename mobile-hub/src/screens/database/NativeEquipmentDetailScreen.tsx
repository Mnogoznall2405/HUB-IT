import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { NativeEquipmentActCard } from '../../components/database/NativeEquipmentActCard';
import { NativeEquipmentActions } from '../../components/database/NativeEquipmentActions';
import { NativeEquipmentWorkHistoryCard } from '../../components/database/NativeEquipmentWorkHistoryCard';
import { downloadEquipmentAct } from '../../database/nativeDatabaseFiles';
import {
  equipmentLocation,
  equipmentOwner,
  equipmentTitle,
  equipmentWorkKindLabel,
  equipmentWorkKinds,
  formatDatabaseDate,
  historyDate,
  historyDescription,
  historyTitle,
  type EquipmentDetailTab,
} from '../../database/nativeDatabaseModel';
import { nativeEquipmentDestination } from '../../database/nativeDatabaseFeature';
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

export function NativeEquipmentDetailScreen() {
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
  const canWrite = hasPermission('database.write');
  const canDeleteEquipment = String(user?.role || '').trim().toLowerCase() === 'admin';
  const [tab, setTab] = useState<EquipmentDetailTab>(asDetailTab(first(params.tab)));
  const [databaseId, setDatabaseId] = useState(requestedDatabaseId);
  const [equipment, setEquipment] = useState<EquipmentRecord | null>(null);
  const [acts, setActs] = useState<EquipmentAct[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [workHistory, setWorkHistory] = useState<EquipmentWorkHistory[]>([]);
  const [unavailableWorkKinds, setUnavailableWorkKinds] = useState<EquipmentWorkKind[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<EquipmentDetailTab>>(new Set());
  const [busyAct, setBusyAct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [tabError, setTabError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editDraft, setEditDraft] = useState<EquipmentUpdatePayload>({});
  const [editOptionsBusy, setEditOptionsBusy] = useState(false);
  const [editBranches, setEditBranches] = useState<EquipmentDirectoryOption[]>([]);
  const [editLocations, setEditLocations] = useState<EquipmentDirectoryOption[]>([]);
  const [editTypes, setEditTypes] = useState<EquipmentTypeOption[]>([]);
  const [editModels, setEditModels] = useState<EquipmentModelOption[]>([]);
  const [editStatuses, setEditStatuses] = useState<EquipmentStatusOption[]>([]);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerOptions, setOwnerOptions] = useState<EquipmentOwnerOption[]>([]);

  const ensureDatabase = useCallback(async (): Promise<string> => {
    const current = await getCurrentDatabase();
    if (!requestedDatabaseId || current.id === requestedDatabaseId) return current.id;
    if (current.locked) throw new Error(`Для пользователя закреплена база ${current.name}`);
    const switched = await switchDatabase(requestedDatabaseId);
    return switched.id;
  }, [requestedDatabaseId]);

  const loadEquipment = useCallback(async (refresh = false) => {
    if (!allowed || !invNo) {
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const activeDatabaseId = await ensureDatabase();
      const result = await getEquipment(invNo, activeDatabaseId);
      setDatabaseId(activeDatabaseId);
      setEquipment(result);
      void touchRecentEquipmentCard(invNo, result, 'view', activeDatabaseId).catch(() => undefined);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть карточку оборудования.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [allowed, ensureDatabase, invNo]);

  useEffect(() => { void loadEquipment(); }, [loadEquipment]);

  const loadTab = useCallback(async (target: EquipmentDetailTab, force = false) => {
    if (!invNo || target === 'general' || (target === 'works' && !equipment) || (!force && loadedTabs.has(target))) return;
    setTabLoading(true);
    setTabError('');
    try {
      if (target === 'acts') {
        const result = await getEquipmentActs(invNo, databaseId);
        setActs(result.acts);
      } else if (target === 'history') {
        const result = await getEquipmentHistory(invNo, databaseId);
        setHistory(result.history);
      } else if (equipment) {
        const result = await getEquipmentWorkHistories(equipment, equipmentWorkKinds(equipment));
        setWorkHistory(result.histories);
        setUnavailableWorkKinds(result.unavailable);
        if (result.failed.length) {
          setTabError(`Часть истории не загрузилась: ${result.failed.map(equipmentWorkKindLabel).join(', ')}.`);
        }
      }
      setLoadedTabs((current) => new Set(current).add(target));
    } catch (cause) {
      setTabError(formatApiError(cause, target === 'acts' ? 'Не удалось загрузить акты.' : target === 'works' ? 'Не удалось загрузить историю обслуживания.' : 'Не удалось загрузить историю.'));
    } finally {
      setTabLoading(false);
    }
  }, [databaseId, equipment, invNo, loadedTabs]);

  useEffect(() => { void loadTab(tab); }, [loadTab, tab]);

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

  const openEditor = useCallback(() => {
    if (!equipment || !canWrite || offlineMode) return;
    setEditDraft({
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
    });
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
    void listEquipmentLocations(editDraft.branch_no, databaseId)
      .then((items) => { if (active) setEditLocations(items); })
      .catch(() => { if (active) setEditLocations([]); });
    return () => { active = false; };
  }, [databaseId, editDraft.branch_no, editOpen]);

  useEffect(() => {
    if (!editOpen || !editDraft.type_no) {
      setEditModels([]);
      return;
    }
    let active = true;
    void listEquipmentModels(editDraft.type_no, 1, databaseId)
      .then((items) => { if (active) setEditModels(items); })
      .catch(() => { if (active) setEditModels([]); });
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

  const saveEditor = useCallback(async () => {
    if (!equipment || editBusy || offlineMode) return;
    setEditBusy(true);
    setError('');
    try {
      const updated = await updateEquipment(equipment.inv_no, editDraft, databaseId);
      setEquipment(updated);
      setEditOpen(false);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить карточку оборудования.'));
    } finally {
      setEditBusy(false);
    }
  }, [databaseId, editBusy, editDraft, equipment, offlineMode]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Карточка оборудования" tokens={tokens} onBack={goBack}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право database.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title={equipment ? equipmentTitle(equipment) : 'Карточка оборудования'}
      tokens={tokens}
      onBack={goBack}
      refreshing={refreshing}
      onRefresh={() => { void refresh(); }}
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
            <View style={[styles.heroIcon, { backgroundColor: tokens.accentSoft }]}><MaterialCommunityIcons name="desktop-tower-monitor" size={28} color={tokens.primary} /></View>
            <View style={styles.heroBody}>
              <Text style={[styles.heroTitle, { color: tokens.textPrimary }]}>{equipmentTitle(equipment)}</Text>
              <Text style={[styles.invNo, { color: tokens.primary }]}>Инв. № {equipment.inv_no}</Text>
              <Text style={[styles.heroMeta, { color: tokens.textSecondary }]}>{equipment.status_name || 'Статус не указан'}</Text>
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
              <AccountSectionCard tokens={tokens} title="Основные данные">
                <AccountField tokens={tokens} label="Тип" value={equipment.type_name} />
                <AccountField tokens={tokens} label="Модель" value={equipment.model_name} />
                <AccountField tokens={tokens} label="Производитель" value={equipment.vendor_name} />
                <AccountField tokens={tokens} label="Статус" value={equipment.status_name} />
                <AccountField tokens={tokens} label="Серийный номер" value={equipment.serial_no} />
                <AccountField tokens={tokens} label="Аппаратный S/N" value={equipment.hw_serial_no} />
                <AccountField tokens={tokens} label="Part number" value={equipment.part_no} />
              </AccountSectionCard>
              <AccountSectionCard tokens={tokens} title="Сотрудник и размещение">
                <AccountField tokens={tokens} label="Сотрудник" value={equipmentOwner(equipment)} />
                <AccountField tokens={tokens} label="Размещение" value={equipmentLocation(equipment)} />
                <AccountField tokens={tokens} label="E-mail" value={equipment.employee_email} />
              </AccountSectionCard>
              {(equipment.ip_address || equipment.mac_address || equipment.network_name || equipment.domain_name) ? (
                <AccountSectionCard tokens={tokens} title="Сеть">
                  <AccountField tokens={tokens} label="IP-адрес" value={equipment.ip_address} />
                  <AccountField tokens={tokens} label="MAC-адрес" value={equipment.mac_address} />
                  <AccountField tokens={tokens} label="Сеть" value={equipment.network_name} />
                  <AccountField tokens={tokens} label="Домен" value={equipment.domain_name} />
                </AccountSectionCard>
              ) : null}
              <AccountSectionCard tokens={tokens} title="Дополнительно">
                <AccountField tokens={tokens} label="Описание" value={equipment.description} />
                <AccountField tokens={tokens} label="Создано" value={formatDatabaseDate(equipment.date_create)} />
                <AccountField tokens={tokens} label="Изменено" value={formatDatabaseDate(equipment.date_last_modify)} />
              </AccountSectionCard>
              {canWrite ? (
                <Pressable
                  testID="native-equipment-edit"
                  disabled={offlineMode}
                  onPress={openEditor}
                  accessibilityRole="button"
                  accessibilityLabel="Редактировать карточку оборудования"
                  accessibilityState={{ disabled: offlineMode }}
                  style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={20} color="#fff" />
                  <Text style={styles.primaryActionText}>Редактировать карточку</Text>
                </Pressable>
              ) : null}
              <NativeEquipmentActions
                equipment={equipment}
                databaseId={databaseId}
                canWrite={canWrite}
                canDeleteEquipment={canDeleteEquipment}
                offline={offlineMode}
                surface="general"
                tokens={tokens}
                onChanged={() => loadEquipment(true)}
                onDeleted={goBack}
              />
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
        </>
      ) : null}
      <Modal
        visible={editOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { if (!editBusy) setEditOpen(false); }}
        accessibilityViewIsModal
      >
        <View style={[styles.editor, { backgroundColor: tokens.pageBg }]}> 
          <View style={[styles.editorHeader, { borderBottomColor: tokens.borderSoft }]}> 
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть редактирование" disabled={editBusy} onPress={() => setEditOpen(false)} style={styles.editorHeaderAction}>
              <Text style={[styles.editorHeaderButton, { color: tokens.textSecondary }]}>Отмена</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.editorTitle, { color: tokens.textPrimary }]}>Редактирование</Text>
            <Pressable testID="native-equipment-edit-save" accessibilityRole="button" accessibilityLabel="Сохранить карточку" accessibilityState={{ disabled: editBusy }} disabled={editBusy} onPress={() => { void saveEditor(); }} style={styles.editorHeaderAction}>
              {editBusy ? <ActivityIndicator size="small" color={tokens.primary} /> : <Text style={[styles.editorHeaderButton, { color: tokens.primary }]}>Сохранить</Text>}
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
            <Text style={[styles.editorHint, { color: tokens.textSecondary }]}>Инв. № {equipment?.inv_no}. Все справочные значения проверяются сервером текущей базы.</Text>
            {editOptionsBusy ? <ActivityIndicator style={styles.editorOptionsLoading} color={tokens.primary} /> : null}
            <EditorOptionStrip
              label="Статус"
              items={editStatuses.map((item) => ({ id: item.status_no, name: item.status_name }))}
              selected={editDraft.status_no ?? null}
              onSelect={(id) => setEditDraft((current) => ({ ...current, status_no: Number(id) }))}
              tokens={tokens}
            />
            <EditorOptionStrip
              label="Тип"
              items={editTypes.map((item) => ({ id: item.type_no, name: item.type_name }))}
              selected={editDraft.type_no ?? null}
              onSelect={(id) => setEditDraft((current) => ({ ...current, type_no: Number(id), model_no: null }))}
              tokens={tokens}
            />
            <EditorOptionStrip
              label="Модель"
              items={editModels.map((item) => ({ id: item.model_no, name: item.model_name }))}
              selected={editDraft.model_no ?? null}
              onSelect={(id) => setEditDraft((current) => ({ ...current, model_no: Number(id) }))}
              tokens={tokens}
            />
            <EditorOptionStrip
              label="Филиал"
              items={editBranches}
              selected={editDraft.branch_no ?? null}
              onSelect={(id) => setEditDraft((current) => ({ ...current, branch_no: id, loc_no: null }))}
              tokens={tokens}
            />
            <EditorOptionStrip
              label="Размещение"
              items={editLocations}
              selected={editDraft.loc_no ?? null}
              onSelect={(id) => setEditDraft((current) => ({ ...current, loc_no: id }))}
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
                  autoCapitalize={key === 'ip_address' || key === 'mac_address' ? 'none' : 'sentences'}
                  style={[styles.editorInput, key === 'description' && styles.editorTextarea, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </AccountScreenScaffold>
  );
}

function EditorOptionStrip({ label, items, selected, onSelect, tokens }: {
  label: string;
  items: Array<{ id: number | string; name: string }>;
  selected: number | string | null;
  onSelect: (id: number | string) => void;
  tokens: ReturnType<typeof useFluentTokens>;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.editorField}>
      <Text style={[styles.editorLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editorChoices}>
        {items.map((item) => {
          const active = String(item.id) === String(selected ?? '');
          return (
            <Pressable
              key={`${label}:${item.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => onSelect(item.id)}
              style={[styles.editorChoice, { backgroundColor: active ? tokens.primary : tokens.panelSolid, borderColor: active ? tokens.primary : tokens.border }]}
            >
              <Text style={[styles.editorChoiceText, { color: active ? '#fff' : tokens.textPrimary }]}>{item.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
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
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  workNotice: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  retry: { minHeight: 44, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 5 },
  heroIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1, gap: 3 },
  heroTitle: { fontSize: 21, lineHeight: 26, fontWeight: '900' },
  invNo: { fontSize: 13, fontWeight: '900' },
  heroMeta: { fontSize: 12 },
  tabs: { minHeight: 46, borderRadius: 12, padding: 3, flexDirection: 'row' },
  tab: { flex: 1, minHeight: 40, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 12, fontWeight: '800' },
  tabLoading: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
  webAction: { minHeight: 74, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  webActionBody: { flex: 1 },
  webActionTitle: { fontSize: 14, fontWeight: '800' },
  webActionText: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  primaryAction: { minHeight: 50, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '900' },
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
