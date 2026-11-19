import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import {
  deleteEquipment,
  emailDbTransferAct,
  getEquipmentTransferJob,
  listConsumables,
  listEquipmentBranches,
  listEquipmentLocations,
  listEquipmentOwnerDepartments,
  recordEquipmentWork,
  sendEquipmentTransferActsEmail,
  submitEquipmentTransfer,
  transferEquipmentToDatabase,
  type ConsumableRecord,
  type EquipmentDbTransferAct,
  type EquipmentDbTransferResult,
  type EquipmentDirectoryOption,
  type EquipmentOwnerOption,
  type EquipmentRecord,
  type EquipmentWorkKind,
  type TransferAct,
  type TransferMode,
  type TransferRequest,
  type TransferResult,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import { downloadDbTransferAct, downloadGeneratedTransferAct } from '../../database/nativeDatabaseFiles';
import { equipmentWorkKindLabel, equipmentWorkKinds, validateNativeTransferEmployeeName } from '../../database/nativeDatabaseModel';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeEquipmentOptionPicker } from './NativeEquipmentOptionPicker';
import { NativeEquipmentOwnerPicker } from './NativeEquipmentOwnerPicker';

type OwnerPickerKind = 'employee' | 'issuer' | 'recipient';

type ActionKind = TransferMode | EquipmentWorkKind | 'delete' | 'db-transfer' | null;

type PendingTransferJob = {
  jobId: string;
  mode: TransferMode;
  databaseId?: string;
  invNos: string[];
  statusText: string;
};

const TRANSFER_JOB_MAX_ATTEMPTS = 240;
const TRANSFER_JOB_MAX_CONSECUTIVE_ERRORS = 3;

function transferJobPollDelay(attempt: number): number {
  return attempt < 4 ? 1_200 : 2_500;
}

function isPendingTransferJob(result: TransferResult): boolean {
  return Boolean(result.job_id) && ['queued', 'processing'].includes(result.job_status || '');
}

function isPermanentTransferJobError(cause: unknown): boolean {
  const status = Number((cause as { response?: { status?: unknown } } | null)?.response?.status);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type NativeEquipmentActionKind = Exclude<ActionKind, null>;

export type NativeEquipmentTransferContext = {
  invNos: string[];
  databaseId?: string;
};

export type NativeEquipmentActionsHandle = {
  open: (kind: NativeEquipmentActionKind) => void;
};

function operationId(): string {
  return Crypto.randomUUID?.()
    || `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Как в веб-экзекьюторе: общий seed попытки + позиционный суффикс, ≤ 64 символов
// (backend принимает operation_id по шаблону [A-Za-z0-9.:-]+).
function buildWorkOperationId(
  seed: string,
  kind: string,
  invNo: string,
  consumableId?: number | null,
  componentType?: string,
): string {
  return [seed, kind, invNo, consumableId ?? '', String(componentType || '').trim()]
    .filter(Boolean)
    .join('-')
    .slice(0, 64);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function directoryLabel(items: EquipmentDirectoryOption[], selected: number | string | null, fallback = ''): string {
  const found = items.find((item) => String(item.id) === String(selected ?? ''));
  return found?.name || (selected === null || selected === undefined ? '' : fallback);
}

function PickerField({
  label,
  value,
  hint,
  disabled,
  onPress,
  tokens,
  testID,
}: {
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
  tokens: FluentTokens;
  testID?: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.pickerField, { backgroundColor: tokens.panelSolid, borderColor: tokens.border, opacity: disabled ? 0.5 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.pickerFieldText, { color: value ? tokens.textPrimary : tokens.textTertiary }]}>
          {value || hint || 'Выбрать из списка'}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={tokens.iconMuted} />
      </Pressable>
    </View>
  );
}

export const NativeEquipmentActions = forwardRef<NativeEquipmentActionsHandle, {
  equipment: EquipmentRecord;
  targets?: EquipmentRecord[];
  databaseId?: string;
  databases?: { id: string; name: string }[];
  canWrite: boolean;
  canDeleteEquipment: boolean;
  /** Право database.delete_equipment_history — отдельное, как в вебе. */
  canDeleteEquipmentHistory?: boolean;
  /** Показать действия обслуживания (картридж/батарея/компонент/чистка) в общем списке. */
  allowWorkActions?: boolean;
  offline: boolean;
  surface: 'general' | 'works';
  tokens: FluentTokens;
  onChanged: (kind: NativeEquipmentActionKind, result?: TransferResult, context?: NativeEquipmentTransferContext) => Promise<void> | void;
  onClosed?: (result: TransferResult | null) => void;
  onDeleted: (invNos: string[]) => void;
  testIDPrefix?: string;
  triggers?: 'grid' | 'none';
}>(function NativeEquipmentActions({
  equipment,
  targets,
  databaseId,
  databases,
  canWrite,
  canDeleteEquipment,
  canDeleteEquipmentHistory = false,
  allowWorkActions = false,
  offline,
  surface,
  tokens,
  onChanged,
  onClosed,
  onDeleted,
  testIDPrefix = 'native-equipment',
  triggers = 'grid',
}, ref) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const [action, setAction] = useState<ActionKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [branches, setBranches] = useState<EquipmentDirectoryOption[]>([]);
  const [locations, setLocations] = useState<EquipmentDirectoryOption[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [branchNo, setBranchNo] = useState<number | string | null>(equipment.branch_no ?? null);
  const [locationNo, setLocationNo] = useState<number | string | null>(equipment.loc_no ?? null);
  const [employee, setEmployee] = useState('');
  const [employeePick, setEmployeePick] = useState<EquipmentOwnerOption | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const [departmentStatus, setDepartmentStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [department, setDepartment] = useState('');
  const [issuer, setIssuer] = useState(equipment.employee_name || '');
  const [issuerPick, setIssuerPick] = useState<EquipmentOwnerOption | null>(null);
  const [pickerKind, setPickerKind] = useState<'branch' | 'location' | 'department' | OwnerPickerKind | 'db-target' | 'db-branch' | 'db-location' | 'db-owner' | null>(null);
  const [comment, setComment] = useState('');
  const [consumables, setConsumables] = useState<ConsumableRecord[]>([]);
  const [selectedConsumable, setSelectedConsumable] = useState<ConsumableRecord | null>(null);
  const [componentType, setComponentType] = useState('component');
  const [result, setResult] = useState<TransferResult | null>(null);
  const [fileBusy, setFileBusy] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMode, setEmailMode] = useState<'old' | 'new' | 'manual' | 'employee'>('old');
  const [manualEmail, setManualEmail] = useState('');
  const [recipientPick, setRecipientPick] = useState<EquipmentOwnerOption | null>(null);
  const [dbTargetId, setDbTargetId] = useState('');
  const [dbOwner, setDbOwner] = useState<EquipmentOwnerOption | null>(null);
  const [dbOwnerName, setDbOwnerName] = useState('');
  const [dbBranchNo, setDbBranchNo] = useState<number | string | null>(null);
  const [dbLocNo, setDbLocNo] = useState<number | string | null>(null);
  const [dbBranches, setDbBranches] = useState<EquipmentDirectoryOption[]>([]);
  const [dbLocations, setDbLocations] = useState<EquipmentDirectoryOption[]>([]);
  const [dbBranchesLoading, setDbBranchesLoading] = useState(false);
  const [dbLocationsLoading, setDbLocationsLoading] = useState(false);
  const [dbResult, setDbResult] = useState<EquipmentDbTransferResult | null>(null);
  const [dbEmail, setDbEmail] = useState('');
  const [dbEmailBusy, setDbEmailBusy] = useState(false);
  // Инв. номера, которые сервер отказался удалять без with_history (409) —
  // предлагаются к повтору только с правом database.delete_equipment_history.
  const [deleteRetryInvNos, setDeleteRetryInvNos] = useState<string[]>([]);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const lastResultRef = useRef<TransferResult | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const pollSeqRef = useRef(0);
  const databaseScopeRef = useRef(databaseId);
  const [pendingJob, setPendingJob] = useState<PendingTransferJob | null>(null);
  const pendingJobRef = useRef<PendingTransferJob | null>(null);
  // Цели операции — записи, а не только инв. номера: у каждой карточки
  // свой серийник/филиал/размещение, уходящие в payload работы.
  const actionItems = useMemo(() => {
    const seen = new Set<string>();
    return (targets?.length ? targets : [equipment]).filter((item) => {
      const invNo = String(item?.inv_no || '').trim();
      if (!invNo || seen.has(invNo)) return false;
      seen.add(invNo);
      return true;
    });
  }, [equipment, targets]);
  const targetInvNos = useMemo(() => actionItems.map((item) => item.inv_no.trim()), [actionItems]);
  const multiple = targetInvNos.length > 1;
  const workKinds = useMemo(() => equipmentWorkKinds(equipment), [equipment]);
  // Как в вебе: действие обслуживания в множественном выборе доступно,
  // только если его поддерживает КАЖДАЯ выбранная карточка.
  const bulkWorkKinds = useMemo(() => {
    const sets = actionItems.map((item) => equipmentWorkKinds(item));
    return (sets[0] || []).filter((kind) => sets.every((kinds) => kinds.includes(kind)));
  }, [actionItems]);
  const targetDatabases = useMemo(
    () => (databases || []).filter((db) => db.id !== databaseId),
    [databaseId, databases],
  );
  const transferAction = action === 'owner' || action === 'location' || action === 'act-only';
  const workAction = action === 'cartridge' || action === 'battery' || action === 'component' || action === 'cleaning';
  const dbTransferActive = action === 'db-transfer' && !dbResult;

  useEffect(() => {
    databaseScopeRef.current = databaseId;
  }, [databaseId]);

  const usesLocationFields = (action === 'owner' || action === 'location') && !result && !pendingJob;

  useEffect(() => {
    if (!usesLocationFields || offline) return;
    let active = true;
    setBranchesLoading(true);
    void listEquipmentBranches(databaseId)
      .then((next) => { if (active) setBranches(next); })
      .catch((cause) => {
        if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники размещения.'));
      })
      .finally(() => { if (active) setBranchesLoading(false); });
    return () => { active = false; };
  }, [databaseId, usesLocationFields, offline]);

  // The card can refresh under an open or closed form (own transfer result or
  // a detail reload): keep the transfer target in sync so the payload never
  // sends the pre-transfer branch/location.
  useEffect(() => {
    setBranchNo(equipment.branch_no ?? null);
    setLocationNo(equipment.loc_no ?? null);
  }, [equipment.branch_no, equipment.loc_no]);

  useEffect(() => {
    if (!usesLocationFields || offline) return;
    let active = true;
    if (branchNo === null || branchNo === undefined || String(branchNo) === '') {
      setLocations([]);
      return;
    }
    setLocations([]);
    setLocationsLoading(true);
    void listEquipmentLocations(branchNo, databaseId)
      .then((next) => { if (active) setLocations(next); })
      .catch((cause) => {
        if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники размещения.'));
      })
      .finally(() => { if (active) setLocationsLoading(false); });
    return () => { active = false; };
  }, [branchNo, databaseId, usesLocationFields, offline]);

  useEffect(() => {
    if (action !== 'cartridge' && action !== 'component') return;
    let active = true;
    setError('');
    void listConsumables({
      branchNo: equipment.branch_no,
      locationNo: equipment.loc_no,
      onlyPositiveQty: true,
      limit: 100,
      databaseId,
    }).then((resultValue) => {
      if (active) setConsumables(resultValue.consumables);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить доступные расходники.'));
    });
    return () => { active = false; };
  }, [action, databaseId, equipment.branch_no, equipment.loc_no]);

  // Справочники переноса в другую базу читаются из ЦЕЛЕВОЙ базы (X-Database-ID),
  // как в веб-диалоге «В другую базу». Филиал опционален: null = «как в источнике».
  useEffect(() => {
    if (!dbTransferActive || offline || !dbTargetId) { setDbBranches([]); return; }
    let active = true;
    setDbBranchesLoading(true);
    void listEquipmentBranches(dbTargetId)
      .then((next) => { if (active) setDbBranches(next); })
      .catch((cause) => {
        if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники целевой базы.'));
      })
      .finally(() => { if (active) setDbBranchesLoading(false); });
    return () => { active = false; };
  }, [dbTargetId, dbTransferActive, offline]);

  useEffect(() => {
    if (!dbTransferActive || offline || !dbTargetId) { setDbLocations([]); return; }
    let active = true;
    setDbLocations([]);
    setDbLocationsLoading(true);
    void listEquipmentLocations(dbBranchNo, dbTargetId)
      .then((next) => { if (active) setDbLocations(next); })
      .catch((cause) => {
        if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники целевой базы.'));
      })
      .finally(() => { if (active) setDbLocationsLoading(false); });
    return () => { active = false; };
  }, [dbBranchNo, dbTargetId, dbTransferActive, offline]);

  const manualOwner = action === 'owner' && !employeePick && Boolean(employee.trim());

  useEffect(() => {
    if (!manualOwner || result) return;
    let active = true;
    setDepartmentStatus('loading');
    void listEquipmentOwnerDepartments(databaseId)
      .then((items) => {
        if (!active) return;
        setDepartments(items);
        setDepartmentStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setDepartments([]);
        setDepartmentStatus('error');
      });
    return () => { active = false; };
  }, [databaseId, manualOwner, employee, result]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollSeqRef.current += 1;
    };
  }, []);

  const setPending = useCallback((job: PendingTransferJob | null) => {
    pendingJobRef.current = job;
    setPendingJob(job);
  }, []);

  const openAction = useCallback((kind: ActionKind) => {
    const pending = pendingJobRef.current;
    if (pending) {
      setError('');
      setNotice(pending.statusText || 'Операция выполняется…');
      setAction(pending.mode);
      return;
    }
    if (kind === 'db-transfer') {
      if (!targetDatabases.length) return;
      setDbTargetId((current) => targetDatabases.some((db) => db.id === current)
        ? current
        : targetDatabases[0].id);
    }
    setAction(kind);
  }, [targetDatabases]);

  const close = useCallback(() => {
    if (busy && !pendingJobRef.current) return;
    if (pendingJobRef.current) {
      pollSeqRef.current += 1;
      inFlightRef.current = false;
      setBusy(false);
    }
    const lastResult = lastResultRef.current;
    setAction(null);
    setError('');
    setNotice('');
    setResult(null);
    lastResultRef.current = null;
    setSelectedConsumable(null);
    setRecipientPick(null);
    setPickerKind(null);
    setEmailMode('old');
    setManualEmail('');
    setBranchNo(equipment.branch_no ?? null);
    setLocationNo(equipment.loc_no ?? null);
    setComment('');
    setDbTargetId('');
    setDbOwner(null);
    setDbOwnerName('');
    setDbBranchNo(null);
    setDbLocNo(null);
    setDbBranches([]);
    setDbLocations([]);
    setDbResult(null);
    setDbEmail('');
    setDbEmailBusy(false);
    setDeleteRetryInvNos([]);
    if (!pendingJobRef.current) {
      setEmployee('');
      setEmployeePick(null);
      setDepartment('');
      setDepartments([]);
      setDepartmentStatus('idle');
      setIssuer(equipment.employee_name || '');
      setIssuerPick(null);
    }
    onClosed?.(lastResult);
  }, [busy, equipment.branch_no, equipment.employee_name, equipment.loc_no, onClosed]);

  const finishTransferJob = useCallback(async (job: PendingTransferJob, next: TransferResult, seq: number) => {
    if (!mountedRef.current || pollSeqRef.current !== seq) return;
    if (next.job_status === 'failed') {
      const statusText = next.job_error || 'Операция завершилась ошибкой';
      setPending({ ...job, statusText });
      setNotice('');
      setError(statusText);
      return;
    }
    setResult(next);
    lastResultRef.current = next;
    setNotice('');
    setPending(null);
    attemptRef.current = null;
    try {
      await onChanged(job.mode, next, { invNos: [...job.invNos], databaseId: job.databaseId });
    } catch {
      if (mountedRef.current && pollSeqRef.current === seq) {
        setNotice('Операция завершена, но не удалось обновить данные.');
      }
    }
  }, [onChanged, setPending]);

  const pollTransferJob = useCallback(async (job: PendingTransferJob, seq: number) => {
    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < TRANSFER_JOB_MAX_ATTEMPTS; attempt += 1) {
      await wait(transferJobPollDelay(attempt));
      if (!mountedRef.current || pollSeqRef.current !== seq) return;
      let next: TransferResult;
      try {
        next = await getEquipmentTransferJob(job.jobId, job.databaseId);
      } catch (cause) {
        if (!mountedRef.current || pollSeqRef.current !== seq) return;
        if (isPermanentTransferJobError(cause)) {
          setNotice('');
          setError(formatApiError(cause, 'Не удалось проверить статус операции.'));
          return;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= TRANSFER_JOB_MAX_CONSECUTIVE_ERRORS) {
          setNotice('');
          setError('Не удалось обновить статус операции. Задание продолжает выполняться — проверьте статус позже.');
          return;
        }
        continue;
      }
      if (!mountedRef.current || pollSeqRef.current !== seq) return;
      consecutiveErrors = 0;
      const status = next.job_status || '';
      if (status === 'queued' || status === 'processing') {
        const statusText = next.job_status_text || 'Формируются документы…';
        setNotice(statusText);
        setPending({ ...job, statusText });
        continue;
      }
      if (status === 'done' || status === 'failed') {
        await finishTransferJob(job, next, seq);
        return;
      }
      setNotice('');
      setError(`Неожиданный статус задания (${status || 'нет статуса'}). Задание сохранено — проверьте статус позже.`);
      return;
    }
    if (!mountedRef.current || pollSeqRef.current !== seq) return;
    setNotice('');
    setError('Операция выполняется дольше обычного. Задание сохранено — проверьте статус позже.');
  }, [finishTransferJob, setPending]);

  const refreshTransferJob = useCallback(async () => {
    const job = pendingJobRef.current;
    if (!job || inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    setNotice(job.statusText || 'Проверяем статус операции…');
    const seq = ++pollSeqRef.current;
    try {
      await pollTransferJob(job, seq);
    } finally {
      if (pollSeqRef.current === seq) {
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  }, [pollTransferJob]);

  const runTransfer = useCallback(async (invNosOverride?: string[]) => {
    if (!transferAction || busy || offline || inFlightRef.current || pendingJobRef.current) return;
    const invNos = invNosOverride?.length ? invNosOverride : targetInvNos;
    if (!invNos.length) {
      setError('Не выбрано оборудование для операции.');
      return;
    }
    if (action === 'owner') {
      if (!employeePick && !validateNativeTransferEmployeeName(employee)) {
        setError(employee.trim().length < 2 ? 'Укажите нового сотрудника.' : 'Некорректное ФИО нового сотрудника.');
        return;
      }
      if (!employeePick) {
        if (departmentStatus === 'loading') {
          setError('Список отделов ещё загружается — подождите и повторите.');
          return;
        }
        if (departmentStatus === 'error' || !departments.length) {
          setError('Не удалось загрузить список отделов. Выберите сотрудника из справочника или переоткройте операцию.');
          return;
        }
        if (!departments.some((name) => name === department.trim())) {
          setError('Выберите отдел нового сотрудника из списка.');
          return;
        }
      }
    }
    if ((action === 'owner' || action === 'location') && (
      branchNo === null || branchNo === undefined || String(branchNo) === ''
        || locationNo === null || locationNo === undefined || String(locationNo) === ''
    )) {
      setError('Выберите филиал и размещение.');
      return;
    }
    if (action === 'act-only' && !issuer.trim()) {
      setError('Укажите сотрудника, который передал оборудование.');
      return;
    }
    const base: Omit<TransferRequest, 'operation_id'> = {
      inv_nos: invNos,
      comment: comment.trim() || undefined,
      ...(action === 'owner' ? {
        new_employee: employeePick ? employeePick.name : employee.trim(),
        ...(employeePick ? {
          new_employee_no: employeePick.owner_no,
          new_employee_dept: employeePick.department || undefined,
        } : {
          new_employee_dept: department.trim() || undefined,
        }),
        branch_no: branchNo ?? undefined,
        loc_no: locationNo ?? undefined,
      } : {}),
      ...(action === 'location' ? {
        branch_no: branchNo ?? undefined,
        loc_no: locationNo ?? undefined,
      } : {}),
      ...(action === 'act-only' ? {
        issuer_employee: issuer.trim(),
        ...(issuerPick ? { issuer_owner_no: issuerPick.owner_no } : {}),
      } : {}),
    };
    const signature = JSON.stringify({ action, ...base });
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: operationId() };
    const payload: TransferRequest = { ...base, operation_id: attemptRef.current.key };
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    setNotice('Операция поставлена в очередь…');
    const seq = ++pollSeqRef.current;
    try {
      const submitted = await submitEquipmentTransfer(action, payload, databaseId);
      if (!mountedRef.current || pollSeqRef.current !== seq) return;
      if (isPendingTransferJob(submitted)) {
        const job: PendingTransferJob = {
          jobId: submitted.job_id as string,
          mode: action as TransferMode,
          databaseId,
          invNos,
          statusText: submitted.job_status_text || 'Формируются документы…',
        };
        setPending(job);
        setNotice(job.statusText);
        await pollTransferJob(job, seq);
        return;
      }
      if (submitted.job_id && submitted.job_status !== 'done') {
        const statusText = submitted.job_status === 'failed'
          ? submitted.job_error || 'Операция завершилась ошибкой'
          : `Неожиданный статус задания (${submitted.job_status || 'нет статуса'}). Задание сохранено — проверьте статус позже.`;
        setPending({
          jobId: submitted.job_id,
          mode: action as TransferMode,
          databaseId,
          invNos,
          statusText,
        });
        setNotice('');
        setError(statusText);
        return;
      }
      if (submitted.job_status === 'failed') throw new Error(submitted.job_error || 'Операция завершилась ошибкой');
      setResult(submitted);
      lastResultRef.current = submitted;
      setNotice('');
      attemptRef.current = null;
      if (!mountedRef.current || pollSeqRef.current !== seq) return;
      try {
        await onChanged(action, submitted, { invNos: [...invNos], databaseId });
      } catch {
        if (mountedRef.current && pollSeqRef.current === seq) {
          setNotice('Операция завершена, но не удалось обновить данные.');
        }
      }
    } catch (cause) {
      if (mountedRef.current && pollSeqRef.current === seq) {
        setNotice('');
        setError(formatApiError(cause, 'Не удалось выполнить операцию.'));
      }
    } finally {
      if (pollSeqRef.current === seq) {
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  }, [action, branchNo, busy, comment, databaseId, department, departmentStatus, departments.length, employee, employeePick, issuer, issuerPick, locationNo, offline, onChanged, pollTransferJob, setPending, targetInvNos, transferAction]);

  const runWork = useCallback(async () => {
    if (!workAction || busy || offline) return;
    const items = actionItems;
    if (!items.length) {
      setError('Не выбрано оборудование для операции.');
      return;
    }
    setBusy(true);
    setError('');
    const scopeDb = databaseId || '';
    const seq = ++pollSeqRef.current;
    try {
      // Тот же подход, что у transfer attemptRef: идентичный повтор отправки
      // переиспользует operation_id — сервер возобновляет durable-операцию.
      // Для каждой карточки свой operation_id (seed попытки + inv_no), как в вебе.
      const signature = JSON.stringify({
        kind: action,
        invNos: items.map((item) => item.inv_no),
        consumableId: selectedConsumable?.id ?? null,
        componentType,
      });
      if (attemptRef.current?.signature !== signature) {
        attemptRef.current = { signature, key: operationId() };
      }
      const seed = attemptRef.current.key;
      const failed: { inv_no: string; error: string }[] = [];
      let succeeded = 0;
      // Как в вебе: позиции записываются по одной, у каждой свой payload.
      for (const item of items) {
        if (!mountedRef.current || pollSeqRef.current !== seq || databaseScopeRef.current !== scopeDb) return;
        const invNo = String(item.inv_no || '').trim();
        try {
          await recordEquipmentWork({
            kind: action,
            equipment: item,
            databaseId,
            consumable: selectedConsumable,
            componentType,
            componentName: componentType,
            componentModel: selectedConsumable?.model_name,
            operationId: buildWorkOperationId(seed, action, invNo, selectedConsumable?.id ?? null, componentType),
          });
          succeeded += 1;
        } catch (cause) {
          failed.push({ inv_no: invNo || '—', error: formatApiError(cause, 'Ошибка записи работы') });
        }
      }
      if (!mountedRef.current || pollSeqRef.current !== seq || databaseScopeRef.current !== scopeDb) return;
      lastResultRef.current = {
        success_count: succeeded,
        failed_count: failed.length,
        failed,
        retry_inv_nos: failed.map((entry) => entry.inv_no),
        acts: [],
      };
      if (failed.length) {
        // Частичный результат — не успех: attemptRef сохраняет operation_id,
        // повтор этой же попытки доиграет незаписанные позиции без дублей.
        setError(`Записано: ${succeeded} из ${items.length}. ${failed.slice(0, 3).map((entry) => `${entry.inv_no}: ${entry.error}`).join('; ')}${failed.length > 3 ? `; ещё ${failed.length - 3}` : ''}`);
        if (succeeded > 0) {
          try { await onChanged(action); } catch { /* обновление не критично */ }
        }
        return;
      }
      // Успех завершает попытку: следующее сознательное действие получит
      // новый operation_id, а не переиграет уже записанный результат.
      attemptRef.current = null;
      setNotice(items.length > 1
        ? `${equipmentWorkKindLabel(action)} записана: ${succeeded} из ${items.length}.`
        : `${equipmentWorkKindLabel(action)} записана.`);
      try {
        await onChanged(action);
      } catch {
        setNotice('Операция завершена, но не удалось обновить данные.');
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось записать обслуживание.'));
    } finally {
      setBusy(false);
    }
  }, [action, actionItems, busy, componentType, databaseId, offline, onChanged, selectedConsumable, workAction]);

  const confirmDelete = useCallback(async (withHistory = false, onlyInvNos?: Set<string>) => {
    if (action !== 'delete' || busy || offline || !canDeleteEquipment) return;
    const items = onlyInvNos
      ? actionItems.filter((item) => onlyInvNos.has(String(item.inv_no || '').trim()))
      : actionItems;
    if (!items.length) {
      setError('Не выбрано оборудование для операции.');
      return;
    }
    setBusy(true);
    setError('');
    setDeleteRetryInvNos([]);
    const scopeDb = databaseId || '';
    const seq = ++pollSeqRef.current;
    const deleted: string[] = [];
    const failed: { inv_no: string; error: string }[] = [];
    const historyBlocked: string[] = [];
    // Как одиночное удаление в вебе: один DELETE на каждую карточку,
    // частичные ошибки собираются и показываются списком.
    for (const item of items) {
      if (!mountedRef.current || pollSeqRef.current !== seq || databaseScopeRef.current !== scopeDb) return;
      const invNo = String(item.inv_no || '').trim();
      try {
        if (withHistory) await deleteEquipment(invNo, databaseId, { withHistory: true });
        else await deleteEquipment(invNo, databaseId);
        deleted.push(invNo);
      } catch (cause) {
        const status = Number((cause as { response?: { status?: unknown } })?.response?.status);
        if (!withHistory && status === 409) historyBlocked.push(invNo);
        failed.push({ inv_no: invNo, error: formatApiError(cause, 'Не удалось удалить.') });
      }
    }
    if (!mountedRef.current || pollSeqRef.current !== seq || databaseScopeRef.current !== scopeDb) return;
    const summary: TransferResult = {
      success_count: deleted.length,
      failed_count: failed.length,
      failed,
      retry_inv_nos: failed.map((entry) => entry.inv_no),
      acts: [],
    };
    lastResultRef.current = summary;
    try {
      if (deleted.length) {
        if (targets?.length) {
          // Множественное удаление: экран сам снимет удалённые карточки
          // со списка при закрытии диалога (recordTransferChange → flush).
          try { await onChanged('delete', summary, { invNos: [...deleted], databaseId }); } catch { /* список обновит следующее чтение */ }
        }
        try { onDeleted(deleted); } catch { /* навигация/уведомление не критичны */ }
      }
      if (failed.length) {
        // Как в веб-диалоге удаления: 409 (связанные акты/история) предлагает
        // повтор с with_history — только при database.delete_equipment_history.
        if (historyBlocked.length && canDeleteEquipmentHistory) {
          setDeleteRetryInvNos(historyBlocked);
        }
        setError(`Удалено: ${deleted.length} из ${items.length}. ${failed.slice(0, 3).map((entry) => `${entry.inv_no}: ${entry.error}`).join('; ')}${failed.length > 3 ? `; ещё ${failed.length - 3}` : ''}`);
        return;
      }
      close();
    } finally {
      if (pollSeqRef.current === seq) setBusy(false);
    }
  }, [action, actionItems, busy, canDeleteEquipment, canDeleteEquipmentHistory, close, databaseId, offline, onChanged, onDeleted, targets?.length]);

  const runDbTransfer = useCallback(async () => {
    if (action !== 'db-transfer' || busy || offline || inFlightRef.current || pendingJobRef.current) return;
    const targetDb = dbTargetId.trim();
    if (!targetDb) {
      setError('Выберите целевую базу.');
      return;
    }
    if (!dbOwner && !validateNativeTransferEmployeeName(dbOwnerName)) {
      setError(dbOwnerName.trim().length < 2 ? 'Укажите сотрудника в целевой базе.' : 'Некорректное ФИО сотрудника.');
      return;
    }
    const invNos = targetInvNos;
    if (!invNos.length) {
      setError('Не выбрано оборудование для операции.');
      return;
    }
    const base = {
      inv_nos: invNos,
      target_db: targetDb,
      target_owner_no: dbOwner?.owner_no ?? null,
      new_owner_name: dbOwner ? null : dbOwnerName.trim(),
      new_owner_dept: dbOwner?.department || null,
      target_branch_no: dbBranchNo === null || dbBranchNo === undefined || String(dbBranchNo) === '' || Number.isNaN(Number(dbBranchNo)) ? null : Number(dbBranchNo),
      target_loc_no: dbLocNo === null || dbLocNo === undefined || String(dbLocNo) === '' || Number.isNaN(Number(dbLocNo)) ? null : Number(dbLocNo),
      task_assignee_user_ids: null,
      task_due_at: null,
      comment: comment.trim() || null,
    };
    const signature = JSON.stringify({ action, ...base });
    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = { signature, key: operationId() };
    }
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    setNotice('Перенос выполняется…');
    const seq = ++pollSeqRef.current;
    const scopeDb = databaseId || '';
    try {
      const report = await transferEquipmentToDatabase(
        { ...base, operation_id: attemptRef.current.key },
        databaseId,
      );
      if (!mountedRef.current || pollSeqRef.current !== seq || databaseScopeRef.current !== scopeDb) return;
      setDbResult(report);
      const failedItems = report.items.filter((item) => item.status !== 'ok');
      const summary: TransferResult = {
        success_count: report.summary.ok,
        failed_count: report.summary.failed || failedItems.length,
        failed: failedItems.map((item) => ({ inv_no: item.inv_no_old || item.inv_no, error: item.message || 'Ошибка переноса' })),
        retry_inv_nos: failedItems.map((item) => item.inv_no_old || item.inv_no),
        acts: [],
      };
      lastResultRef.current = summary;
      setNotice('');
      // Успех завершает попытку: повторный submit с тем же operation_id
      // вернул бы сохранённый результат (replayed), новый id нужен заново.
      attemptRef.current = null;
      try {
        await onChanged('db-transfer', summary, { invNos: [...invNos], databaseId });
      } catch {
        if (mountedRef.current && pollSeqRef.current === seq) {
          setNotice('Операция завершена, но не удалось обновить данные.');
        }
      }
    } catch (cause) {
      if (mountedRef.current && pollSeqRef.current === seq && databaseScopeRef.current === scopeDb) {
        setNotice('');
        setError(formatApiError(cause, 'Не удалось выполнить перенос в другую базу.'));
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [action, busy, comment, databaseId, dbBranchNo, dbLocNo, dbOwner, dbOwnerName, dbTargetId, offline, onChanged, targetInvNos]);

  const openAct = useCallback(async (act: TransferAct) => {
    if (fileBusy) return;
    setFileBusy(act.act_id);
    setError('');
    try {
      const file = await downloadGeneratedTransferAct(act.act_id, {
        fileName: act.file_name,
        fileType: act.file_type,
        databaseId,
      });
      await openNativeFile(file, act.file_type === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть сформированный акт.'));
    } finally {
      setFileBusy('');
    }
  }, [databaseId, fileBusy]);

  const sendActs = useCallback(async () => {
    if (!result?.acts.length || emailBusy) return;
    if (emailMode === 'manual' && !/^\S+@\S+\.\S+$/.test(manualEmail.trim())) {
      setError('Укажите корректный e-mail получателя.');
      return;
    }
    if (emailMode === 'employee' && !recipientPick) return;
    setEmailBusy(true);
    setError('');
    try {
      const sent = await sendEquipmentTransferActsEmail({
        act_ids: result.acts.map((act) => act.act_id),
        mode: emailMode,
        manual_email: emailMode === 'manual' ? manualEmail.trim() : undefined,
        owner_no: emailMode === 'employee' ? recipientPick?.owner_no : undefined,
      }, databaseId);
      setNotice(sent.failed_count
        ? `Отправлено: ${sent.success_count}, ошибок: ${sent.failed_count}.`
        : `Акты отправлены: ${sent.success_count}.`);
      if (sent.errors.length) setError(sent.errors.join('\n'));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить акты по почте.'));
    } finally {
      setEmailBusy(false);
    }
  }, [databaseId, emailBusy, emailMode, manualEmail, recipientPick, result?.acts]);

  const openDbTransferAct = useCallback(async (act: EquipmentDbTransferAct) => {
    if (fileBusy || act.file_no === null) return;
    setFileBusy(act.act_id || String(act.file_no));
    setError('');
    try {
      const file = await downloadDbTransferAct(act.db_id, act.file_no, {
        fileName: act.file_name,
        sourceDatabaseId: databaseId,
      });
      await openNativeFile(file, 'application/pdf');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть акт оприходования.'));
    } finally {
      setFileBusy('');
    }
  }, [databaseId, fileBusy]);

  const sendDbTransferActs = useCallback(async () => {
    const acts = (dbResult?.acts || []).filter((act) => act.file_no !== null);
    if (!acts.length || dbEmailBusy) return;
    const email = dbEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Укажите корректный e-mail получателя.');
      return;
    }
    setDbEmailBusy(true);
    setError('');
    try {
      // Как в вебе: отдельная отправка по каждому сформированному акту.
      for (const act of acts) {
        await emailDbTransferAct(act.db_id, act.file_no as number, email, databaseId);
      }
      setNotice(acts.length > 1 ? `Акты отправлены на ${email}.` : `Акт отправлен на ${email}.`);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить акт по почте.'));
    } finally {
      setDbEmailBusy(false);
    }
  }, [databaseId, dbEmail, dbEmailBusy, dbResult?.acts]);

  useImperativeHandle(ref, () => ({
    open: (kind) => { openAction(kind); },
  }), [openAction]);

  if (!canWrite && !canDeleteEquipment) return null;

  return (
    <>
      {triggers === 'none' ? null : surface === 'general' ? (
        <View style={styles.actionGrid}>
          {canWrite ? (
            <>
              <ActionButton testID={`${testIDPrefix}-transfer-owner`} icon="account-arrow-right-outline" label="Передать сотруднику" onPress={() => openAction('owner')} disabled={offline} tokens={tokens} />
              <ActionButton testID={`${testIDPrefix}-transfer-location`} icon="map-marker-right-outline" label="Сменить размещение" onPress={() => openAction('location')} disabled={offline} tokens={tokens} />
              <ActionButton testID={`${testIDPrefix}-transfer-act-only`} icon="file-document-edit-outline" label="Сформировать акт" onPress={() => openAction('act-only')} disabled={offline} tokens={tokens} />
              {allowWorkActions ? bulkWorkKinds.map((kind) => (
                <ActionButton
                  key={kind}
                  testID={`${testIDPrefix}-record-work-${kind}`}
                  icon={kind === 'cleaning' ? 'broom' : kind === 'battery' ? 'battery-sync-outline' : kind === 'cartridge' ? 'printer-pos-wrench-outline' : 'tools'}
                  label={equipmentWorkKindLabel(kind)}
                  onPress={() => openAction(kind)}
                  disabled={offline}
                  tokens={tokens}
                />
              )) : null}
              {targetDatabases.length ? (
                <ActionButton testID={`${testIDPrefix}-db-transfer`} icon="database-sync-outline" label="В другую базу" onPress={() => openAction('db-transfer')} disabled={offline} tokens={tokens} />
              ) : null}
            </>
          ) : null}
          {canDeleteEquipment ? (
            <ActionButton testID={`${testIDPrefix}-delete`} icon="delete-outline" label={multiple ? 'Удалить карточки' : 'Удалить карточку'} onPress={() => openAction('delete')} disabled={offline} tokens={tokens} destructive />
          ) : null}
        </View>
      ) : (
        <View style={styles.actionGrid}>
          {canWrite ? workKinds.map((kind) => (
            <ActionButton
              key={kind}
              testID={`native-equipment-record-work-${kind}`}
              icon={kind === 'cleaning' ? 'broom' : kind === 'battery' ? 'battery-sync-outline' : kind === 'cartridge' ? 'printer-pos-wrench-outline' : 'tools'}
              label={equipmentWorkKindLabel(kind)}
              onPress={() => openAction(kind)}
              disabled={offline}
              tokens={tokens}
            />
          )) : null}
        </View>
      )}

      <Modal visible={Boolean(action)} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} accessibilityViewIsModal>
        <View style={[styles.modal, { backgroundColor: tokens.pageBg, paddingTop: insets?.top || 0 }]}>
          <View style={[styles.modalHeader, { borderBottomColor: tokens.borderSoft }]}> 
            <Pressable disabled={busy && !pendingJob} accessibilityRole="button" accessibilityLabel="Закрыть операцию" onPress={close} style={styles.headerAction}>
              <Text style={[styles.headerText, { color: tokens.textSecondary }]}>{result ? 'Закрыть' : 'Отмена'}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.modalTitle, { color: tokens.textPrimary }]}>{actionTitle(action)}</Text>
            <View style={styles.headerAction} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <Text style={[styles.context, { color: tokens.textSecondary }]}>{pendingJob
              ? (pendingJob.invNos.length > 1
                ? `Выбрано карточек: ${pendingJob.invNos.length}`
                : pendingJob.invNos[0] === equipment.inv_no
                  ? `Инв. № ${equipment.inv_no} · ${equipment.model_name || equipment.type_name}`
                  : `Инв. № ${pendingJob.invNos[0]}`)
              : multiple
                ? `Выбрано карточек: ${targetInvNos.length}`
                : `Инв. № ${equipment.inv_no} · ${equipment.model_name || equipment.type_name}`}</Text>
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.textSecondary }]}>{notice}</Text> : null}

            {action === 'owner' && !result ? (
              <PickerField
                testID="native-transfer-employee"
                label="Новый сотрудник"
                value={employeePick?.name || employee}
                hint="Начните вводить ФИО"
                disabled={busy || Boolean(pendingJob)}
                onPress={() => setPickerKind('employee')}
                tokens={tokens}
              />
            ) : null}
            {action === 'owner' && !result && manualOwner ? (
              <PickerField
                testID="native-transfer-pick-department"
                label="Отдел нового сотрудника"
                value={department}
                hint={departmentStatus === 'loading' ? 'Загрузка отделов…' : 'Выбрать из списка'}
                disabled={busy || Boolean(pendingJob) || departmentStatus === 'loading'}
                onPress={() => setPickerKind('department')}
                tokens={tokens}
              />
            ) : null}
            {action === 'act-only' && !result ? (
              <PickerField
                testID="native-transfer-issuer"
                label="Передал оборудование"
                value={issuerPick?.name || issuer}
                hint="Начните вводить ФИО"
                disabled={busy || Boolean(pendingJob)}
                onPress={() => setPickerKind('issuer')}
                tokens={tokens}
              />
            ) : null}
            {!result && (action === 'owner' || action === 'location') ? (
              <>
                <PickerField
                  testID="native-transfer-pick-branch"
                  label="Филиал"
                  value={directoryLabel(branches, branchNo, equipment.branch_name)}
                  hint={branchesLoading ? 'Загрузка филиалов…' : undefined}
                  disabled={busy || Boolean(pendingJob) || branchesLoading}
                  onPress={() => setPickerKind('branch')}
                  tokens={tokens}
                />
                <PickerField
                  testID="native-transfer-pick-location"
                  label="Размещение"
                  value={directoryLabel(locations, locationNo, equipment.location_name)}
                  hint={locationsLoading ? 'Загрузка размещений…' : branchNo === null || branchNo === undefined ? 'Сначала выберите филиал' : undefined}
                  disabled={busy || Boolean(pendingJob) || branchNo === null || branchNo === undefined || locationsLoading}
                  onPress={() => setPickerKind('location')}
                  tokens={tokens}
                />
              </>
            ) : null}
            {transferAction && !result ? <Field label="Комментарий (необязательно)" value={comment} onChange={setComment} tokens={tokens} multiline editable={!busy && !pendingJob} /> : null}

            {action === 'db-transfer' && !dbResult ? (
              <>
                <Text style={[styles.context, { color: tokens.textSecondary }]}>
                  {`Перенос удаляет карточки из текущей базы и создаёт их в выбранной. Филиал и размещение можно оставить «как в источнике».`}
                </Text>
                <PickerField
                  testID="native-dbtransfer-target"
                  label="Целевая база"
                  value={targetDatabases.find((db) => db.id === dbTargetId)?.name || dbTargetId}
                  hint="Выберите базу"
                  disabled={busy || Boolean(pendingJob) || targetDatabases.length < 2}
                  onPress={() => setPickerKind('db-target')}
                  tokens={tokens}
                />
                <PickerField
                  testID="native-dbtransfer-owner"
                  label="Сотрудник в целевой базе"
                  value={dbOwner?.name || dbOwnerName}
                  hint="Выберите из списка или укажите ФИО"
                  disabled={busy || Boolean(pendingJob)}
                  onPress={() => setPickerKind('db-owner')}
                  tokens={tokens}
                />
                <PickerField
                  testID="native-dbtransfer-branch"
                  label="Филиал в целевой базе"
                  value={dbBranchNo === null || dbBranchNo === undefined || String(dbBranchNo) === ''
                    ? 'Как в источнике'
                    : directoryLabel(dbBranches, dbBranchNo)}
                  hint={dbBranchesLoading ? 'Загрузка филиалов…' : undefined}
                  disabled={busy || Boolean(pendingJob) || dbBranchesLoading}
                  onPress={() => setPickerKind('db-branch')}
                  tokens={tokens}
                />
                <PickerField
                  testID="native-dbtransfer-location"
                  label="Размещение в целевой базе"
                  value={dbLocNo === null || dbLocNo === undefined || String(dbLocNo) === ''
                    ? 'Как в источнике'
                    : directoryLabel(dbLocations, dbLocNo)}
                  hint={dbLocationsLoading ? 'Загрузка размещений…' : undefined}
                  disabled={busy || Boolean(pendingJob) || dbLocationsLoading}
                  onPress={() => setPickerKind('db-location')}
                  tokens={tokens}
                />
                <Field label="Комментарий (необязательно)" value={comment} onChange={setComment} tokens={tokens} multiline editable={!busy && !pendingJob} />
              </>
            ) : null}

            {(action === 'cartridge' || action === 'component') ? (
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Расходник со склада</Text>
                {consumables.length ? consumables.map((item) => {
                  const selected = item.id === selectedConsumable?.id;
                  return (
                    <Pressable
                      key={item.id}
                      testID={`native-work-consumable-${item.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setSelectedConsumable(item)}
                      style={[styles.consumable, { backgroundColor: selected ? tokens.selected : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                    >
                      <Text style={[styles.consumableTitle, { color: tokens.textPrimary }]}>{item.model_name || item.type_name}</Text>
                      <Text style={[styles.consumableMeta, { color: tokens.textSecondary }]}>{item.qty} шт. · {item.location_name || 'без размещения'}</Text>
                    </Pressable>
                  );
                }) : <Text style={[styles.empty, { color: tokens.textSecondary }]}>Подходящие расходники с положительным остатком не найдены.</Text>}
              </View>
            ) : null}
            {action === 'component' ? <Field label="Тип компонента" value={componentType} onChange={setComponentType} tokens={tokens} testID="native-work-component-type" /> : null}

            {result ? (
              <View style={styles.resultActs}>
                <Text accessibilityLiveRegion="polite" style={[styles.resultSummary, { color: result.failed_count ? tokens.warning : tokens.success }]}>
                  {action === 'act-only'
                    ? `Подготовлено позиций: ${result.success_count}, ошибок: ${result.failed_count}`
                    : `Перемещено: ${result.success_count}, ошибок: ${result.failed_count}`}
                </Text>
                {result.failed.length ? (
                  <View style={styles.resultFailed}>
                    {result.failed.slice(0, 5).map((item, index) => (
                      <Text key={`${item.inv_no}-${index}`} style={[styles.error, { color: tokens.error }]}>{item.inv_no}: {item.error}</Text>
                    ))}
                    {result.retry_inv_nos.length ? (
                      <Pressable
                        testID="native-transfer-retry-failed"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        onPress={() => { void runTransfer(result.retry_inv_nos); }}
                        style={[styles.secondary, { borderColor: tokens.primary }]}
                      >
                        {busy ? <ActivityIndicator color={tokens.primary} /> : <Text style={[styles.secondaryText, { color: tokens.primary }]}>Повторить только неуспешные ({result.retry_inv_nos.length})</Text>}
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {result.acts.length ? (
                  <View>
                    <Text style={[styles.label, { color: tokens.textSecondary }]}>Сформированные акты</Text>
                    {result.acts.map((act) => (
                      <View key={act.act_id} style={[styles.actCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
                        <View style={styles.actCardBody}>
                          <Text style={[styles.actCardTitle, { color: tokens.textPrimary }]}>
                            {action === 'act-only' && act.new_employee
                              ? `${act.old_employee} → ${act.new_employee} (${act.equipment_count})`
                              : `${act.old_employee} (${act.equipment_count})`}
                          </Text>
                          <Text numberOfLines={1} style={[styles.actCardMeta, { color: tokens.textSecondary }]}>{act.file_name}</Text>
                        </View>
                        <Pressable
                          testID={`native-transfer-act-${act.act_id}`}
                          disabled={Boolean(fileBusy)}
                          accessibilityRole="button"
                          accessibilityLabel={`Открыть ${act.file_name}`}
                          onPress={() => { void openAct(act); }}
                          style={[styles.actOpen, { borderColor: tokens.primary }]}
                        >
                          {fileBusy === act.act_id ? <ActivityIndicator color={tokens.primary} /> : <Text style={[styles.actOpenText, { color: tokens.primary }]}>Открыть</Text>}
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {action !== 'location' ? (
                  <View style={styles.emailBlock}>
                    <Text style={[styles.label, { color: tokens.textSecondary }]}>Отправка акта по email</Text>
                    <View style={styles.emailModes}>
                      {(['old', 'new', 'employee', 'manual'] as const).map((value) => {
                        const selected = emailMode === value;
                        const label = value === 'old'
                          ? (action === 'act-only' ? 'Выдавшему' : 'Старому сотруднику')
                          : value === 'new'
                            ? (action === 'act-only' ? 'Получателю' : 'Новому сотруднику')
                            : value === 'employee' ? 'Выбрать сотрудника' : 'Ввести email вручную';
                        return (
                          <Pressable
                            key={value}
                            testID={`native-transfer-email-mode-${value}`}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            onPress={() => setEmailMode(value)}
                            style={[styles.emailMode, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                          >
                            <Text style={[styles.emailModeText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {emailMode === 'employee' ? (
                      <PickerField
                        testID="native-transfer-email-recipient"
                        label="Сотрудник-получатель"
                        value={recipientPick ? `${recipientPick.name}${recipientPick.email ? ` · ${recipientPick.email}` : ''}` : ''}
                        hint="Начните вводить ФИО"
                        disabled={emailBusy}
                        onPress={() => setPickerKind('recipient')}
                        tokens={tokens}
                      />
                    ) : null}
                    {emailMode === 'manual' ? <Field label="E-mail получателя" value={manualEmail} onChange={setManualEmail} tokens={tokens} testID="native-transfer-email" /> : null}
                    <Pressable
                      testID="native-transfer-email-send"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: emailBusy || !result.acts.length || (emailMode === 'employee' && !recipientPick) }}
                      disabled={emailBusy || !result.acts.length || (emailMode === 'employee' && !recipientPick)}
                      onPress={() => { void sendActs(); }}
                      style={[styles.secondary, { borderColor: tokens.primary }]}
                    >
                      {emailBusy ? <ActivityIndicator color={tokens.primary} /> : <Text style={[styles.secondaryText, { color: tokens.primary }]}>Отправить акт</Text>}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            {action === 'db-transfer' && dbResult ? (
              <View style={styles.resultActs}>
                <Text accessibilityLiveRegion="polite" style={[styles.resultSummary, { color: dbResult.summary.failed ? tokens.warning : tokens.success }]}>
                  {`Перенос завершён: ${dbResult.summary.ok} из ${dbResult.summary.total}.`}
                  {dbResult.act_doc_no ? ` Акт оприходования № ${dbResult.act_doc_no} в базе ${dbResult.target_db}.` : ''}
                </Text>
                {dbResult.replayed ? (
                  <Text style={[styles.notice, { color: tokens.textSecondary }]}>Показан сохранённый результат предыдущего запроса (повтор по operation_id).</Text>
                ) : null}
                {dbResult.items.map((item) => (
                  <View key={item.inv_no_old || item.inv_no} style={styles.resultItemRow}>
                    <Text style={[styles.resultItemText, { color: tokens.textPrimary }]}>
                      {`инв. ${item.inv_no_old || item.inv_no}${item.inv_no_new ? ` → ${item.inv_no_new}` : ''}`}
                    </Text>
                    <Text style={[styles.resultItemStatus, { color: item.status === 'ok' ? tokens.success : item.status === 'partial' ? tokens.warning : tokens.error }]}>
                      {item.status === 'ok' ? 'перенесено' : item.status === 'partial' ? 'частично' : `ошибка: ${item.message || 'не перенесено'}`}
                    </Text>
                  </View>
                ))}
                {dbResult.created_refs.length ? (
                  <View style={styles.resultFailed}>
                    <Text style={[styles.label, { color: tokens.textSecondary }]}>Создано в целевой базе</Text>
                    {dbResult.created_refs.map((line, index) => (
                      <Text key={`${line}-${index}`} style={[styles.resultItemStatus, { color: tokens.textSecondary }]}>{line}</Text>
                    ))}
                  </View>
                ) : null}
                {dbResult.acts.length ? (
                  <View>
                    <Text style={[styles.label, { color: tokens.textSecondary }]}>Сформированные акты</Text>
                    {dbResult.acts.map((act) => (
                      <View key={act.act_id || String(act.file_no)} style={[styles.actCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
                        <View style={styles.actCardBody}>
                          <Text style={[styles.actCardTitle, { color: tokens.textPrimary }]}>{`Акт оприходования № ${act.doc_no ?? dbResult.act_doc_no}`}</Text>
                          <Text numberOfLines={1} style={[styles.actCardMeta, { color: tokens.textSecondary }]}>{act.file_name}</Text>
                        </View>
                        <Pressable
                          testID={`native-dbtransfer-act-${act.file_no}`}
                          disabled={Boolean(fileBusy) || act.file_no === null}
                          accessibilityRole="button"
                          accessibilityLabel={`Открыть ${act.file_name}`}
                          onPress={() => { void openDbTransferAct(act); }}
                          style={[styles.actOpen, { borderColor: tokens.primary }]}
                        >
                          {fileBusy === act.act_id ? <ActivityIndicator color={tokens.primary} /> : <Text style={[styles.actOpenText, { color: tokens.primary }]}>Открыть</Text>}
                        </Pressable>
                      </View>
                    ))}
                    <View style={styles.emailBlock}>
                      <Text style={[styles.label, { color: tokens.textSecondary }]}>Отправка акта по email</Text>
                      <Field label="E-mail получателя" value={dbEmail} onChange={setDbEmail} tokens={tokens} testID="native-dbtransfer-email" editable={!dbEmailBusy} />
                      <Pressable
                        testID="native-dbtransfer-email-send"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: dbEmailBusy || !dbResult.acts.some((act) => act.file_no !== null) }}
                        disabled={dbEmailBusy || !dbResult.acts.some((act) => act.file_no !== null)}
                        onPress={() => { void sendDbTransferActs(); }}
                        style={[styles.secondary, { borderColor: tokens.primary }]}
                      >
                        {dbEmailBusy ? <ActivityIndicator color={tokens.primary} /> : <Text style={[styles.secondaryText, { color: tokens.primary }]}>Отправить акт</Text>}
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {dbResult.task_id ? <Text style={[styles.resultItemStatus, { color: tokens.textSecondary }]}>{`Задача на приёмку создана: #${dbResult.task_id.slice(0, 8)}`}</Text> : null}
                {dbResult.task_error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warning }]}>{dbResult.task_error}</Text> : null}
                {dbResult.act_error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warning }]}>{dbResult.act_error}</Text> : null}
                {dbResult.acts_error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warning }]}>{dbResult.acts_error}</Text> : null}
              </View>
            ) : null}

            {action === 'delete' ? (
              <View style={[styles.dangerBox, { backgroundColor: tokens.panelInset }]}> 
                <Text style={[styles.dangerTitle, { color: tokens.error }]}>{multiple ? `Удалить выбранные карточки (${targetInvNos.length}) без возможности восстановления?` : 'Удалить карточку без возможности восстановления?'}</Text>
                <Text style={[styles.dangerText, { color: tokens.textSecondary }]}>Сервер отменит удаление, если с оборудованием связаны акты или история.</Text>
                {deleteRetryInvNos.length ? (
                  <Pressable
                    testID={`${testIDPrefix}-delete-with-history`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy || offline }}
                    disabled={busy || offline}
                    onPress={() => { void confirmDelete(true, new Set(deleteRetryInvNos)); }}
                    style={[styles.secondary, { borderColor: tokens.error }]}
                  >
                    <Text style={[styles.secondaryText, { color: tokens.error }]}>{`Удалить с историей (${deleteRetryInvNos.length})`}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {!result && !dbResult ? (
              <Pressable
                testID={`${testIDPrefix}-action-confirm`}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || offline }}
                disabled={busy || offline}
                onPress={() => { if (pendingJob) void refreshTransferJob(); else if (transferAction) void runTransfer(); else if (workAction) void runWork(); else if (action === 'db-transfer') void runDbTransfer(); else void confirmDelete(); }}
                style={[styles.primary, { backgroundColor: action === 'delete' ? tokens.error : tokens.primary, opacity: busy || offline ? 0.55 : 1 }]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{pendingJob ? 'Проверить статус' : action === 'delete' ? 'Удалить' : action === 'db-transfer' ? 'Перенести' : 'Выполнить'}</Text>}
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={close} style={[styles.primary, { backgroundColor: tokens.primary }]}>
                <Text style={styles.primaryText}>Готово</Text>
              </Pressable>
            )}
          </ScrollView>
          <NativeEquipmentOptionPicker
            visible={pickerKind === 'branch' || pickerKind === 'location' || pickerKind === 'department'
              || pickerKind === 'db-target' || pickerKind === 'db-branch' || pickerKind === 'db-location'}
            title={
              pickerKind === 'branch' ? 'Филиал'
                : pickerKind === 'department' ? 'Отдел нового сотрудника'
                  : pickerKind === 'db-target' ? 'Целевая база'
                    : pickerKind === 'db-branch' ? 'Филиал в целевой базе'
                      : pickerKind === 'db-location' ? 'Размещение в целевой базе'
                        : 'Размещение'
            }
            options={
              pickerKind === 'branch' ? branches
                : pickerKind === 'department' ? departments.map((name) => ({ id: name, name }))
                  : pickerKind === 'db-target' ? targetDatabases.map((db) => ({ id: db.id, name: db.name || db.id }))
                    : pickerKind === 'db-branch' ? [{ id: '', name: 'Как в источнике' }, ...dbBranches]
                      : pickerKind === 'db-location' ? [{ id: '', name: 'Как в источнике' }, ...dbLocations]
                        : locations
            }
            selectedId={
              pickerKind === 'branch' ? branchNo
                : pickerKind === 'department' ? department
                  : pickerKind === 'db-target' ? dbTargetId
                    : pickerKind === 'db-branch' ? dbBranchNo ?? ''
                      : pickerKind === 'db-location' ? dbLocNo ?? ''
                        : locationNo
            }
            loading={
              pickerKind === 'department'
                ? departmentStatus === 'loading'
                : pickerKind === 'branch' ? branchesLoading
                  : pickerKind === 'db-branch' ? dbBranchesLoading
                    : pickerKind === 'db-location' ? dbLocationsLoading
                      : locationsLoading
            }
            tokens={tokens}
            testIDPrefix={
              pickerKind === 'branch' ? 'native-transfer-branch'
                : pickerKind === 'department' ? 'native-transfer-department'
                  : pickerKind === 'db-target' ? 'native-dbtransfer-target'
                    : pickerKind === 'db-branch' ? 'native-dbtransfer-branch'
                      : pickerKind === 'db-location' ? 'native-dbtransfer-location'
                        : 'native-transfer-location'
            }
            onSelect={(id) => {
              if (pickerKind === 'branch') { setBranchNo(id); setLocationNo(null); }
              else if (pickerKind === 'department') setDepartment(String(id));
              else if (pickerKind === 'db-target') { setDbTargetId(String(id)); setDbOwner(null); setDbOwnerName(''); setDbBranchNo(null); setDbLocNo(null); }
              else if (pickerKind === 'db-branch') { setDbBranchNo(String(id) === '' ? null : id); setDbLocNo(null); }
              else if (pickerKind === 'db-location') setDbLocNo(String(id) === '' ? null : id);
              else setLocationNo(id);
              setPickerKind(null);
            }}
            onClose={() => setPickerKind(null)}
          />
          <NativeEquipmentOwnerPicker
            visible={pickerKind === 'employee' || pickerKind === 'issuer' || pickerKind === 'recipient' || pickerKind === 'db-owner'}
            title={pickerKind === 'issuer' ? 'Передал оборудование' : pickerKind === 'recipient' ? 'Сотрудник-получатель' : pickerKind === 'db-owner' ? 'Сотрудник в целевой базе' : 'Новый сотрудник'}
            databaseId={pickerKind === 'db-owner' ? dbTargetId : databaseId}
            selectedOwnerNo={pickerKind === 'issuer' ? issuerPick?.owner_no ?? null : pickerKind === 'recipient' ? recipientPick?.owner_no ?? null : pickerKind === 'db-owner' ? dbOwner?.owner_no ?? null : employeePick?.owner_no ?? null}
            allowManual={pickerKind !== 'recipient'}
            initialQuery={pickerKind === 'issuer' ? issuer : pickerKind === 'employee' ? employee : pickerKind === 'db-owner' ? dbOwnerName : ''}
            tokens={tokens}
            onSelect={(owner) => {
              if (pickerKind === 'issuer') { setIssuerPick(owner); setIssuer(owner.name); }
              else if (pickerKind === 'recipient') setRecipientPick(owner);
              else if (pickerKind === 'db-owner') { setDbOwner(owner); setDbOwnerName(owner.name); }
              else { setEmployeePick(owner); setEmployee(owner.name); setDepartment(''); }
              setPickerKind(null);
            }}
            onManual={(name) => {
              if (pickerKind === 'issuer') { setIssuer(name); setIssuerPick(null); }
              else if (pickerKind === 'db-owner') { setDbOwnerName(name); setDbOwner(null); }
              else { setEmployee(name); setEmployeePick(null); setDepartment(''); }
              setPickerKind(null);
            }}
            onClose={() => setPickerKind(null)}
          />
        </View>
      </Modal>
    </>
  );
});

function ActionButton({ testID, icon, label, onPress, disabled, tokens, destructive = false }: {
  testID: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled: boolean;
  tokens: FluentTokens;
  destructive?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, {
        backgroundColor: destructive ? tokens.panelInset : tokens.panelSolid,
        borderColor: destructive ? tokens.error : tokens.border,
        opacity: disabled ? 0.5 : pressed ? 0.76 : 1,
      }]}
    >
      <MaterialCommunityIcons name={icon} size={21} color={destructive ? tokens.error : tokens.primary} />
      <Text style={[styles.actionLabel, { color: destructive ? tokens.error : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, tokens, testID, multiline = false, editable = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens: FluentTokens;
  testID?: string;
  multiline?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        editable={editable}
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={tokens.textTertiary}
        style={[styles.input, multiline && styles.textarea, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
      />
    </View>
  );
}

function actionTitle(action: ActionKind): string {
  if (action === 'owner') return 'Передача сотруднику';
  if (action === 'location') return 'Смена размещения';
  if (action === 'act-only') return 'Акт без перемещения';
  if (action === 'db-transfer') return 'Перенос в другую базу';
  if (action === 'delete') return 'Удаление оборудования';
  return action ? equipmentWorkKindLabel(action) : 'Операция';
}

const styles = StyleSheet.create({
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 10 },
  actionButton: { minHeight: 52, minWidth: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionLabel: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  modal: { flex: 1 },
  modalHeader: { minHeight: 58, borderBottomWidth: 1, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 82, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headerText: { fontSize: 13, fontWeight: '800' },
  modalTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900' },
  modalContent: { padding: 16, paddingBottom: 40 },
  context: { marginBottom: 14, fontSize: 12, lineHeight: 17 },
  fieldGroup: { marginBottom: 14 },
  label: { marginBottom: 6, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { minHeight: 92, textAlignVertical: 'top' },
  pickerField: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerFieldText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  error: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  notice: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  consumable: { minHeight: 62, borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 7 },
  consumableTitle: { fontSize: 13, fontWeight: '800' },
  consumableMeta: { marginTop: 3, fontSize: 11 },
  empty: { fontSize: 12, lineHeight: 17 },
  resultActs: { marginTop: 4, marginBottom: 14 },
  resultSummary: { marginBottom: 10, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  resultFailed: { marginBottom: 12 },
  resultItemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  resultItemText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  resultItemStatus: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  actCard: { borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  actCardBody: { flex: 1, minWidth: 0 },
  actCardTitle: { fontSize: 13, fontWeight: '800' },
  actCardMeta: { marginTop: 3, fontSize: 11 },
  actOpen: { minHeight: 38, minWidth: 84, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  actOpenText: { fontSize: 12, fontWeight: '800' },
  emailBlock: { marginTop: 8 },
  emailModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  emailMode: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 11, justifyContent: 'center' },
  emailModeText: { fontSize: 11, fontWeight: '800' },
  fileButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', gap: 9, alignItems: 'center', marginBottom: 7 },
  fileName: { flex: 1, fontSize: 12, fontWeight: '800' },
  dangerBox: { borderRadius: 14, padding: 14, marginBottom: 14 },
  dangerTitle: { fontSize: 14, lineHeight: 19, fontWeight: '900' },
  dangerText: { marginTop: 5, fontSize: 12, lineHeight: 17 },
  primary: { minHeight: 50, borderRadius: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondary: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '900' },
});
