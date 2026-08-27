import apiClient from './client';
import type { DatabaseOption } from '../account/accountFormat';

export type CurrentDatabase = DatabaseOption & {
  access?: string;
  source?: string;
  locked: boolean;
};

export type EquipmentRecord = {
  id?: number | string | null;
  inv_no: string;
  serial_no: string;
  hw_serial_no: string;
  part_no: string;
  type_no?: number | null;
  type_name: string;
  model_no?: number | null;
  model_name: string;
  vendor_name: string;
  status_no?: number | null;
  status_name: string;
  empl_no?: number | null;
  employee_name: string;
  employee_dept: string;
  employee_email: string;
  branch_no?: number | string | null;
  branch_name: string;
  loc_no?: number | string | null;
  location_name: string;
  ip_address: string;
  mac_address: string;
  network_name: string;
  domain_name: string;
  date_create?: string | null;
  date_last_modify?: string | null;
  description: string;
  hub_db_id: string;
  hub_db_name: string;
  raw: Record<string, unknown>;
};

export type EquipmentPage = {
  equipment: EquipmentRecord[];
  total: number;
  page: number;
  pages: number;
};

export type EquipmentActItem = {
  item_id?: number | null;
  inv_no: string;
  serial_no: string;
  model_name: string;
};

export type EquipmentAct = {
  doc_no: number;
  doc_number: string;
  doc_date?: string | null;
  type_name: string;
  branch_name: string;
  location_name: string;
  employee_name: string;
  has_file: boolean;
  items: EquipmentActItem[];
  raw: Record<string, unknown>;
};

export type EquipmentActsResponse = {
  query?: string;
  inv_no?: string;
  item_id?: number | null;
  total: number;
  truncated?: boolean;
  current_act?: EquipmentAct | null;
  acts: EquipmentAct[];
};

export type EquipmentHistoryResponse = {
  inv_no: string;
  item_id?: number | null;
  total: number;
  history: Record<string, unknown>[];
};

export type ConsumableRecord = {
  id: number;
  inv_no: string;
  type_no?: number | null;
  type_name: string;
  model_no?: number | null;
  model_name: string;
  qty: number;
  branch_no?: number | string | null;
  branch_name: string;
  loc_no?: number | string | null;
  location_name: string;
  part_no: string;
  description: string;
  raw: Record<string, unknown>;
};

export type ConsumablesPage = {
  consumables: ConsumableRecord[];
  total: number;
  truncated: boolean;
};

export type EquipmentWorkKind = 'cartridge' | 'battery' | 'component' | 'cleaning';

export type EquipmentWorkHistory = {
  kind: EquipmentWorkKind;
  last_date: string | null;
  count: number;
  time_ago_str: string;
};

export type EquipmentWorkHistoriesResult = {
  histories: EquipmentWorkHistory[];
  unavailable: EquipmentWorkKind[];
  failed: EquipmentWorkKind[];
};

export type EquipmentDirectoryOption = { id: number | string; name: string };
export type EquipmentTypeOption = { type_no: number; type_name: string; ci_type: number | null };
export type EquipmentModelOption = { model_no: number; model_name: string; type_no: number | null };
export type EquipmentStatusOption = { status_no: number; status_name: string };
export type EquipmentOwnerOption = { owner_no: number; name: string; department: string; email: string };

export type EquipmentCreatePayload = {
  serial_no: string;
  employee_name: string;
  branch_no: number | string;
  loc_no: number | string;
  type_no: number;
  status_no: number;
  model_name?: string;
  model_no?: number;
  employee_no?: number;
  employee_dept?: string;
  hw_serial_no?: string;
  part_no?: string;
  description?: string;
  ip_address?: string;
};

export type ConsumableCreatePayload = {
  branch_no: number | string;
  loc_no: number | string;
  type_no: number;
  qty: number;
  model_name?: string;
  model_no?: number;
  status_no?: number;
  part_no?: string;
  description?: string;
};

export type TransferMode = 'owner' | 'location' | 'act-only';
export type TransferRequest = {
  operation_id: string;
  inv_nos: string[];
  new_employee?: string;
  new_employee_no?: number;
  new_employee_dept?: string;
  issuer_employee?: string;
  issuer_owner_no?: number;
  branch_no?: number | string;
  loc_no?: number | string;
  comment?: string;
};
export type TransferAct = {
  act_id: string;
  old_employee: string;
  new_employee?: string | null;
  equipment_count: number;
  file_name: string;
  file_type: 'pdf' | 'docx';
};
export type TransferResult = {
  success_count: number;
  failed_count: number;
  failed: Array<{ inv_no: string; error: string }>;
  retry_inv_nos: string[];
  acts: TransferAct[];
  job_id?: string;
  operation_id?: string;
  job_status?: 'queued' | 'processing' | 'done' | 'failed';
  job_status_text?: string;
  job_error?: string;
};
export type UploadedActFile = {
  uri: string;
  name: string;
  mimeType: 'application/pdf';
  size: number;
};
export type UploadedActResolvedItem = {
  item_id: number;
  inv_no: string;
  serial_no: string;
  model_name: string;
  employee_name: string;
  branch_name: string;
  location_name: string;
};
export type UploadedActDraft = {
  draft_id: string;
  file_name: string;
  from_employee: string;
  to_employee: string;
  doc_date: string | null;
  equipment_inv_nos: string[];
  resolved_items: UploadedActResolvedItem[];
  warnings: string[];
};
export type UploadedActCommitPayload = {
  draft_id: string;
  from_employee?: string;
  to_employee?: string;
  doc_date?: string;
  equipment_inv_nos: string[];
  source_task_id?: string;
  reminder_id?: string;
};
export type UploadedActCommitResult = {
  success: boolean;
  doc_no: number;
  doc_number: string;
  file_no: number;
  linked_item_ids: number[];
  linked_inv_nos: string[];
  message: string;
  reminder_status?: string;
  reminder_task_id?: string;
  reminder_id?: string;
  reminder_pending_groups: number;
  reminder_warning?: string;
};
export type RecentEquipmentCard = {
  inv_no: string;
  db_id: string;
  last_action: string;
  last_action_label: string;
  last_activity_at: string | null;
  activity_count: number;
  snapshot: EquipmentRecord | null;
};
export type RecentEquipmentAct = {
  doc_no: number;
  doc_number: string;
  db_id: string;
  last_action: string;
  last_action_label: string;
  last_activity_at: string | null;
  activity_count: number;
  snapshot: EquipmentAct | null;
};
export type EquipmentWorkPayload = {
  kind: EquipmentWorkKind;
  equipment: EquipmentRecord;
  databaseId?: string;
  consumable?: ConsumableRecord | null;
  componentType?: string;
  componentName?: string;
  componentModel?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readFirst(row: Record<string, unknown>, keys: string[], fallback: unknown = ''): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function databaseHeaders(databaseId?: string): { headers: { 'X-Database-ID': string } } | undefined {
  const normalized = asText(databaseId);
  return normalized ? { headers: { 'X-Database-ID': normalized } } : undefined;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(asText(value).toLowerCase());
}

export function normalizeEquipmentRecord(value: unknown): EquipmentRecord | null {
  const row = asRecord(value);
  const invNo = asText(readFirst(row, ['inv_no', 'INV_NO']));
  if (!invNo) return null;
  return {
    id: readFirst(row, ['id', 'ID'], null) as number | string | null,
    inv_no: invNo,
    serial_no: asText(readFirst(row, ['serial_no', 'SERIAL_NO'])),
    hw_serial_no: asText(readFirst(row, ['hw_serial_no', 'HW_SERIAL_NO'])),
    part_no: asText(readFirst(row, ['part_no', 'PART_NO'])),
    type_no: asNumber(readFirst(row, ['type_no', 'TYPE_NO'], null)),
    type_name: asText(readFirst(row, ['type_name', 'TYPE_NAME'])),
    model_no: asNumber(readFirst(row, ['model_no', 'MODEL_NO'], null)),
    model_name: asText(readFirst(row, ['model_name', 'MODEL_NAME'])),
    vendor_name: asText(readFirst(row, ['vendor_name', 'VENDOR_NAME'])),
    status_no: asNumber(readFirst(row, ['status_no', 'STATUS_NO'], null)),
    status_name: asText(readFirst(row, ['status_name', 'STATUS_NAME'])),
    empl_no: asNumber(readFirst(row, ['empl_no', 'EMPL_NO', 'owner_no', 'OWNER_NO'], null)),
    employee_name: asText(readFirst(row, ['employee_name', 'EMPLOYEE_NAME', 'owner_name', 'OWNER_NAME'])),
    employee_dept: asText(readFirst(row, ['employee_dept', 'EMPLOYEE_DEPT', 'owner_dept', 'OWNER_DEPT'])),
    employee_email: asText(readFirst(row, ['employee_email', 'EMPLOYEE_EMAIL', 'owner_email', 'OWNER_EMAIL'])),
    branch_no: readFirst(row, ['branch_no', 'BRANCH_NO'], null) as number | string | null,
    branch_name: asText(readFirst(row, ['branch_name', 'BRANCH_NAME'])),
    loc_no: readFirst(row, ['loc_no', 'LOC_NO'], null) as number | string | null,
    location_name: asText(readFirst(row, ['location_name', 'LOCATION_NAME', 'location', 'LOCATION'])),
    ip_address: asText(readFirst(row, ['ip_address', 'IP_ADDRESS'])),
    mac_address: asText(readFirst(row, ['mac_address', 'MAC_ADDRESS'])),
    network_name: asText(readFirst(row, ['network_name', 'NETWORK_NAME'])),
    domain_name: asText(readFirst(row, ['domain_name', 'DOMAIN_NAME'])),
    date_create: asText(readFirst(row, ['date_create', 'DATE_CREATE'])) || null,
    date_last_modify: asText(readFirst(row, ['date_last_modify', 'DATE_LAST_MODIFY'])) || null,
    description: asText(readFirst(row, ['description', 'DESCRIPTION'])),
    hub_db_id: asText(readFirst(row, ['hub_db_id', 'HUB_DB_ID'])),
    hub_db_name: asText(readFirst(row, ['hub_db_name', 'HUB_DB_NAME'])),
    raw: row,
  };
}

function normalizeEquipmentList(value: unknown): EquipmentRecord[] {
  return (Array.isArray(value) ? value : [])
    .map(normalizeEquipmentRecord)
    .filter((item): item is EquipmentRecord => Boolean(item));
}

function normalizeEquipmentPage(value: unknown): EquipmentPage {
  const row = asRecord(value);
  const equipment = normalizeEquipmentList(row.equipment);
  return {
    equipment,
    total: Math.max(0, Number(row.total ?? equipment.length) || 0),
    page: Math.max(1, Number(row.page ?? 1) || 1),
    pages: Math.max(0, Number(row.pages ?? (equipment.length ? 1 : 0)) || 0),
  };
}

function normalizeAct(value: unknown): EquipmentAct | null {
  const row = asRecord(value);
  const docNo = asNumber(readFirst(row, ['doc_no', 'DOC_NO']));
  if (docNo === null) return null;
  const rawItems = readFirst(row, ['items', 'ITEMS'], []);
  const items = (Array.isArray(rawItems) ? rawItems : []).map((item) => {
    const itemRow = asRecord(item);
    return {
      item_id: asNumber(readFirst(itemRow, ['item_id', 'ITEM_ID'], null)),
      inv_no: asText(readFirst(itemRow, ['inv_no', 'INV_NO'])),
      serial_no: asText(readFirst(itemRow, ['serial_no', 'SERIAL_NO'])),
      model_name: asText(readFirst(itemRow, ['model_name', 'MODEL_NAME'])),
    };
  });
  return {
    doc_no: docNo,
    doc_number: asText(readFirst(row, ['doc_number', 'DOC_NUMBER'])),
    doc_date: asText(readFirst(row, ['doc_date', 'DOC_DATE'])) || null,
    type_name: asText(readFirst(row, ['type_name', 'TYPE_NAME'])),
    branch_name: asText(readFirst(row, ['branch_name', 'BRANCH_NAME'])),
    location_name: asText(readFirst(row, ['location_name', 'LOCATION_NAME'])),
    employee_name: asText(readFirst(row, ['employee_name', 'EMPLOYEE_NAME'])),
    has_file: asBoolean(readFirst(row, ['has_file', 'HAS_FILE'], false)),
    items,
    raw: row,
  };
}

function normalizeActsResponse(value: unknown): EquipmentActsResponse {
  const row = asRecord(value);
  const acts = (Array.isArray(row.acts) ? row.acts : [])
    .map(normalizeAct)
    .filter((item): item is EquipmentAct => Boolean(item));
  return {
    query: asText(row.query) || undefined,
    inv_no: asText(row.inv_no) || undefined,
    item_id: asNumber(row.item_id),
    total: Math.max(0, Number(row.total ?? acts.length) || 0),
    truncated: asBoolean(row.truncated),
    current_act: normalizeAct(row.current_act),
    acts,
  };
}

export function normalizeConsumableRecord(value: unknown): ConsumableRecord | null {
  const row = asRecord(value);
  const id = asNumber(readFirst(row, ['id', 'ID'], null));
  if (id === null) return null;
  return {
    id,
    inv_no: asText(readFirst(row, ['inv_no', 'INV_NO'])),
    type_no: asNumber(readFirst(row, ['type_no', 'TYPE_NO'], null)),
    type_name: asText(readFirst(row, ['type_name', 'TYPE_NAME'])),
    model_no: asNumber(readFirst(row, ['model_no', 'MODEL_NO'], null)),
    model_name: asText(readFirst(row, ['model_name', 'MODEL_NAME'])),
    qty: Math.max(0, asNumber(readFirst(row, ['qty', 'QTY'], 0)) ?? 0),
    branch_no: readFirst(row, ['branch_no', 'BRANCH_NO'], null) as number | string | null,
    branch_name: asText(readFirst(row, ['branch_name', 'BRANCH_NAME'])),
    loc_no: readFirst(row, ['loc_no', 'LOC_NO'], null) as number | string | null,
    location_name: asText(readFirst(row, ['location_name', 'LOCATION_NAME', 'location', 'LOCATION'])),
    part_no: asText(readFirst(row, ['part_no', 'PART_NO'])),
    description: asText(readFirst(row, ['description', 'DESCRIPTION'])),
    raw: row,
  };
}

function normalizeWorkHistory(kind: EquipmentWorkKind, value: unknown): EquipmentWorkHistory {
  const row = asRecord(value);
  return {
    kind,
    last_date: asText(row.last_date) || null,
    count: Math.max(0, asNumber(row.count) ?? 0),
    time_ago_str: asText(row.time_ago_str),
  };
}

function asDatabases(data: unknown): DatabaseOption[] {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as { id?: unknown; name?: unknown };
        const id = String(row.id || '').trim();
        if (!id) return null;
        return { id, name: String(row.name || id) };
      })
      .filter((item): item is DatabaseOption => Boolean(item));
  }
  return [];
}

export async function listAvailableDatabases(): Promise<DatabaseOption[]> {
  const { data } = await apiClient.get('/database/list');
  return asDatabases(data);
}

export async function getCurrentDatabase(): Promise<CurrentDatabase> {
  const { data } = await apiClient.get('/database/current');
  const row = asRecord(data);
  const id = asText(row.id);
  return {
    id,
    name: asText(row.name) || id,
    access: asText(row.access) || undefined,
    source: asText(row.source) || undefined,
    locked: asBoolean(row.locked),
  };
}

export async function switchDatabase(databaseId: string): Promise<CurrentDatabase> {
  const normalized = asText(databaseId);
  if (!normalized) throw new Error('Не выбрана база данных');
  const { data } = await apiClient.post('/database/switch', { database_id: normalized });
  const database = asRecord(asRecord(data).database);
  const selectedId = asText(database.id);
  if (!selectedId) return getCurrentDatabase();
  return {
    id: selectedId,
    name: asText(database.name) || selectedId,
    access: asText(database.access) || undefined,
    source: 'user_selection',
    locked: false,
  };
}

export async function listEquipment(page = 1, limit = 50, databaseId?: string): Promise<EquipmentPage> {
  const { data } = await apiClient.get('/equipment/database', {
    params: { page, limit },
    ...databaseHeaders(databaseId),
  });
  return normalizeEquipmentPage(data);
}

export type EquipmentUpdatePayload = Partial<Pick<
  EquipmentRecord,
  'serial_no' | 'hw_serial_no' | 'part_no' | 'ip_address' | 'mac_address' | 'network_name' | 'description'
>> & {
  status_no?: number | null;
  empl_no?: number | null;
  branch_no?: number | string | null;
  loc_no?: number | string | null;
  type_no?: number | null;
  model_no?: number | null;
};

export async function updateEquipment(
  invNo: string,
  payload: EquipmentUpdatePayload,
  databaseId?: string,
): Promise<EquipmentRecord> {
  const normalized = asText(invNo);
  if (!normalized) throw new Error('Не указан инвентарный номер');
  const body = Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.trim() : value,
  ]));
  if (!Object.keys(body).length) throw new Error('Нет изменений для сохранения');
  const { data } = await apiClient.patch(
    `/equipment/${encodeURIComponent(normalized)}`,
    body,
    databaseHeaders(databaseId),
  );
  const result = normalizeEquipmentRecord(data);
  if (!result) throw new Error('Сервер вернул некорректную карточку оборудования');
  return result;
}

export async function updateConsumableQuantity(
  item: Pick<ConsumableRecord, 'id' | 'inv_no'>,
  qty: number,
  databaseId?: string,
): Promise<{ qty_old?: number; qty_new?: number; message?: string }> {
  if (!Number.isInteger(qty) || qty < 0) throw new Error('Количество должно быть целым неотрицательным числом');
  const { data } = await apiClient.patch('/equipment/consumables/qty', {
    item_id: item.id,
    inv_no: item.inv_no || undefined,
    qty,
  }, databaseHeaders(databaseId));
  return asRecord(data) as { qty_old?: number; qty_new?: number; message?: string };
}

export async function searchEquipment(query: string, page = 1, limit = 50, databaseId?: string): Promise<EquipmentPage> {
  const q = asText(query);
  if (!q) return { equipment: [], total: 0, page: 1, pages: 0 };
  const { data } = await apiClient.get('/equipment/search/universal', {
    params: { q, page, limit },
    ...databaseHeaders(databaseId),
  });
  return normalizeEquipmentPage(data);
}

export async function searchEquipmentBySerial(query: string): Promise<EquipmentRecord[]> {
  const q = asText(query);
  if (!q) return [];
  const { data } = await apiClient.get('/equipment/search/serial', { params: { q } });
  return normalizeEquipmentList(asRecord(data).equipment);
}

export async function getEquipment(invNo: string, databaseId?: string): Promise<EquipmentRecord> {
  const normalized = asText(invNo);
  if (!normalized) throw new Error('Не указан инвентарный номер');
  const { data } = await apiClient.get(
    `/equipment/${encodeURIComponent(normalized)}`,
    databaseHeaders(databaseId),
  );
  const result = normalizeEquipmentRecord(data);
  if (!result) throw new Error('Сервер вернул некорректную карточку оборудования');
  return result;
}

export async function getEquipmentActs(invNo: string, databaseId?: string): Promise<EquipmentActsResponse> {
  const normalized = asText(invNo);
  if (!normalized) throw new Error('Не указан инвентарный номер');
  const { data } = await apiClient.get(
    `/equipment/${encodeURIComponent(normalized)}/acts`,
    databaseHeaders(databaseId),
  );
  return normalizeActsResponse(data);
}

export async function getEquipmentHistory(invNo: string, databaseId?: string): Promise<EquipmentHistoryResponse> {
  const normalized = asText(invNo);
  if (!normalized) throw new Error('Не указан инвентарный номер');
  const { data } = await apiClient.get(
    `/equipment/${encodeURIComponent(normalized)}/history`,
    databaseHeaders(databaseId),
  );
  const row = asRecord(data);
  const history = (Array.isArray(row.history) ? row.history : []).map(asRecord);
  return {
    inv_no: asText(row.inv_no) || normalized,
    item_id: asNumber(row.item_id),
    total: Math.max(0, Number(row.total ?? history.length) || 0),
    history,
  };
}

export async function searchEquipmentActs(
  query = '',
  limit = 50,
  databaseId?: string,
): Promise<EquipmentActsResponse> {
  const { data } = await apiClient.get('/equipment/acts/search', {
    params: { q: asText(query), limit },
    ...databaseHeaders(databaseId),
  });
  return normalizeActsResponse(data);
}

export async function listConsumables({
  modelName,
  branchNo,
  locationNo,
  onlyPositiveQty = true,
  limit = 300,
  databaseId,
}: {
  modelName?: string;
  branchNo?: number | string | null;
  locationNo?: number | string | null;
  onlyPositiveQty?: boolean;
  limit?: number;
  databaseId?: string;
} = {}): Promise<ConsumablesPage> {
  const normalizedLimit = Math.min(1000, Math.max(1, Math.trunc(limit) || 300));
  const params: Record<string, unknown> = {
    only_positive_qty: onlyPositiveQty,
    limit: normalizedLimit,
  };
  if (asText(modelName)) params.model_name = asText(modelName);
  if (branchNo !== undefined && branchNo !== null && asText(branchNo)) params.branch_no = branchNo;
  if (locationNo !== undefined && locationNo !== null && asText(locationNo)) params.loc_no = locationNo;
  const { data } = await apiClient.get('/equipment/consumables/lookup', {
    params,
    ...databaseHeaders(databaseId),
  });
  const consumables = (Array.isArray(data) ? data : [])
    .map(normalizeConsumableRecord)
    .filter((item): item is ConsumableRecord => Boolean(item));
  return {
    consumables,
    total: consumables.length,
    truncated: consumables.length >= normalizedLimit,
  };
}

async function getEquipmentWorkHistory(
  kind: EquipmentWorkKind,
  equipment: EquipmentRecord,
): Promise<EquipmentWorkHistory> {
  const serialNumber = asText(equipment.serial_no);
  const hardwareSerialNumber = asText(equipment.hw_serial_no);
  const commonParams: Record<string, unknown> = { serial_number: serialNumber };
  if (hardwareSerialNumber) commonParams.hw_serial_number = hardwareSerialNumber;

  if (kind === 'cartridge') {
    const params = { ...commonParams, inv_no: equipment.inv_no };
    const { data } = await apiClient.get('/json/works/cartridge/history', { params });
    return normalizeWorkHistory(kind, data);
  }
  const { data } = await apiClient.get(`/json/works/${kind}/history`, { params: commonParams });
  return normalizeWorkHistory(kind, data);
}

export async function getEquipmentWorkHistories(
  equipment: EquipmentRecord,
  kinds: EquipmentWorkKind[],
): Promise<EquipmentWorkHistoriesResult> {
  const hasSerial = Boolean(asText(equipment.serial_no) || asText(equipment.hw_serial_no));
  const unavailable = kinds.filter((kind) => kind !== 'cartridge' && !hasSerial);
  const loadable = kinds.filter((kind) => !unavailable.includes(kind));
  const settled = await Promise.allSettled(
    loadable.map(async (kind) => ({ kind, history: await getEquipmentWorkHistory(kind, equipment) })),
  );
  const histories: EquipmentWorkHistory[] = [];
  const failed: EquipmentWorkKind[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') histories.push(result.value.history);
    else failed.push(loadable[index]);
  });
  return { histories, unavailable, failed };
}

export async function touchRecentEquipmentCard(
  invNo: string,
  snapshot?: EquipmentRecord | null,
  actionType = 'view',
  databaseId?: string,
): Promise<void> {
  const normalized = asText(invNo);
  if (!normalized) return;
  await apiClient.post('/equipment/recent-cards/touch', {
    inv_no: normalized,
    action_type: actionType,
    snapshot: snapshot?.raw || undefined,
  }, databaseHeaders(databaseId));
}

function normalizeDirectoryOptions(value: unknown, idKeys: string[], nameKeys: string[]): EquipmentDirectoryOption[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const row = asRecord(entry);
    const id = readFirst(row, idKeys, null);
    const name = asText(readFirst(row, nameKeys));
    return id === null || id === undefined || !name ? [] : [{ id: id as number | string, name }];
  });
}

export async function listEquipmentBranches(databaseId?: string): Promise<EquipmentDirectoryOption[]> {
  const { data } = await apiClient.get('/equipment/branches', databaseHeaders(databaseId));
  return normalizeDirectoryOptions(data, ['id', 'BRANCH_NO', 'branch_no'], ['name', 'BRANCH_NAME', 'branch_name']);
}

export async function listEquipmentLocations(
  branchNo?: number | string | null,
  databaseId?: string,
): Promise<EquipmentDirectoryOption[]> {
  const { data } = await apiClient.get('/equipment/locations', {
    params: branchNo === null || branchNo === undefined || asText(branchNo) === '' ? {} : { branch_no: branchNo },
    ...databaseHeaders(databaseId),
  });
  return normalizeDirectoryOptions(data, ['loc_no', 'LOC_NO', 'id'], ['loc_name', 'LOC_NAME', 'name']);
}

export async function listEquipmentTypes(ciType = 1, databaseId?: string): Promise<EquipmentTypeOption[]> {
  const { data } = await apiClient.get('/equipment/types', {
    params: { ci_type: ciType },
    ...databaseHeaders(databaseId),
  });
  return (Array.isArray(data) ? data : []).flatMap((entry) => {
    const row = asRecord(entry);
    const typeNo = asNumber(readFirst(row, ['type_no', 'TYPE_NO']));
    const typeName = asText(readFirst(row, ['type_name', 'TYPE_NAME']));
    if (typeNo === null || !typeName) return [];
    return [{ type_no: typeNo, type_name: typeName, ci_type: asNumber(readFirst(row, ['ci_type', 'CI_TYPE'])) }];
  });
}

export async function listEquipmentStatuses(databaseId?: string): Promise<EquipmentStatusOption[]> {
  const { data } = await apiClient.get('/equipment/statuses', databaseHeaders(databaseId));
  return (Array.isArray(data) ? data : []).flatMap((entry) => {
    const row = asRecord(entry);
    const statusNo = asNumber(readFirst(row, ['status_no', 'STATUS_NO']));
    const statusName = asText(readFirst(row, ['status_name', 'STATUS_NAME']));
    return statusNo === null || !statusName ? [] : [{ status_no: statusNo, status_name: statusName }];
  });
}

export async function listEquipmentModels(
  typeNo: number,
  ciType = 1,
  databaseId?: string,
): Promise<EquipmentModelOption[]> {
  if (!Number.isInteger(typeNo) || typeNo <= 0) return [];
  const { data } = await apiClient.get('/equipment/models', {
    params: { type_no: typeNo, ci_type: ciType },
    ...databaseHeaders(databaseId),
  });
  const source = asRecord(data).models;
  return (Array.isArray(source) ? source : []).flatMap((entry) => {
    const row = asRecord(entry);
    const modelNo = asNumber(readFirst(row, ['model_no', 'MODEL_NO']));
    const modelName = asText(readFirst(row, ['model_name', 'MODEL_NAME']));
    return modelNo === null || !modelName ? [] : [{
      model_no: modelNo,
      model_name: modelName,
      type_no: asNumber(readFirst(row, ['type_no', 'TYPE_NO'])),
    }];
  });
}

export async function searchEquipmentOwners(
  query: string,
  limit = 20,
  databaseId?: string,
): Promise<EquipmentOwnerOption[]> {
  const q = asText(query);
  if (!q) return [];
  const { data } = await apiClient.get('/equipment/owners/search', {
    params: { q, limit },
    ...databaseHeaders(databaseId),
  });
  const source = asRecord(data).owners;
  return (Array.isArray(source) ? source : []).flatMap((entry) => {
    const row = asRecord(entry);
    const ownerNo = asNumber(readFirst(row, ['owner_no', 'OWNER_NO', 'id', 'ID']));
    const name = asText(readFirst(row, ['name', 'OWNER_NAME', 'owner_name']));
    return ownerNo === null || !name ? [] : [{
      owner_no: ownerNo,
      name,
      department: asText(readFirst(row, ['department', 'DEPT', 'OWNER_DEPT'])),
      email: asText(readFirst(row, ['email', 'EMAIL', 'OWNER_EMAIL'])),
    }];
  });
}

export async function createEquipment(
  payload: EquipmentCreatePayload,
  databaseId?: string,
): Promise<{ success: boolean; inv_no?: string; item_id?: number; message: string }> {
  const { data } = await apiClient.post('/equipment/create', payload, databaseHeaders(databaseId));
  const row = asRecord(data);
  return {
    success: asBoolean(row.success),
    inv_no: asText(row.inv_no) || undefined,
    item_id: asNumber(row.item_id) ?? undefined,
    message: asText(row.message),
  };
}

export async function deleteEquipment(invNo: string, databaseId?: string): Promise<void> {
  const normalized = asText(invNo);
  if (!normalized) throw new Error('Не указан инвентарный номер');
  await apiClient.delete(`/equipment/${encodeURIComponent(normalized)}`, databaseHeaders(databaseId));
}

export async function createConsumable(
  payload: ConsumableCreatePayload,
  databaseId?: string,
): Promise<{ success: boolean; inv_no?: string; item_id?: number; message: string }> {
  const { data } = await apiClient.post('/equipment/consumables/create', payload, databaseHeaders(databaseId));
  const row = asRecord(data);
  return {
    success: asBoolean(row.success),
    inv_no: asText(row.inv_no) || undefined,
    item_id: asNumber(row.item_id) ?? undefined,
    message: asText(row.message),
  };
}

export async function deleteConsumable(itemId: number, databaseId?: string): Promise<void> {
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error('Некорректный идентификатор расходника');
  await apiClient.delete(`/equipment/consumables/${itemId}`, databaseHeaders(databaseId));
}

function normalizeTransferResult(value: unknown): TransferResult {
  const row = asRecord(value);
  const failed = (Array.isArray(row.failed) ? row.failed : []).map((entry) => {
    const item = asRecord(entry);
    return { inv_no: asText(item.inv_no), error: asText(item.error) };
  });
  const acts = (Array.isArray(row.acts) ? row.acts : []).flatMap((entry) => {
    const item = asRecord(entry);
    const actId = asText(item.act_id);
    if (!actId) return [];
    return [{
      act_id: actId,
      old_employee: asText(item.old_employee),
      new_employee: asText(item.new_employee) || null,
      equipment_count: Math.max(0, asNumber(item.equipment_count) ?? 0),
      file_name: asText(item.file_name) || `act-${actId}`,
      file_type: asText(item.file_type) === 'docx' ? 'docx' as const : 'pdf' as const,
    }];
  });
  const jobStatus = asText(row.job_status);
  return {
    success_count: Math.max(0, asNumber(row.success_count) ?? 0),
    failed_count: Math.max(0, asNumber(row.failed_count) ?? failed.length),
    failed,
    retry_inv_nos: (Array.isArray(row.retry_inv_nos) ? row.retry_inv_nos : []).map(asText).filter(Boolean),
    acts,
    job_id: asText(row.job_id) || undefined,
    operation_id: asText(row.operation_id) || undefined,
    job_status: ['queued', 'processing', 'done', 'failed'].includes(jobStatus)
      ? jobStatus as TransferResult['job_status']
      : undefined,
    job_status_text: asText(row.job_status_text) || undefined,
    job_error: asText(row.job_error) || undefined,
  };
}

function normalizeUploadedActDraft(value: unknown): UploadedActDraft {
  const row = asRecord(value);
  const draftId = asText(row.draft_id);
  if (!draftId) throw new Error('Сервер не вернул черновик распознанного акта');
  const resolvedItems = (Array.isArray(row.resolved_items) ? row.resolved_items : []).flatMap((entry) => {
    const item = asRecord(entry);
    const itemId = asNumber(item.item_id);
    if (itemId === null) return [];
    return [{
      item_id: itemId,
      inv_no: asText(item.inv_no),
      serial_no: asText(item.serial_no),
      model_name: asText(item.model_name),
      employee_name: asText(item.employee_name),
      branch_name: asText(item.branch_name),
      location_name: asText(item.location_name),
    }];
  });
  return {
    draft_id: draftId,
    file_name: asText(row.file_name),
    from_employee: asText(row.from_employee),
    to_employee: asText(row.to_employee),
    doc_date: asText(row.doc_date) || null,
    equipment_inv_nos: (Array.isArray(row.equipment_inv_nos) ? row.equipment_inv_nos : []).map(asText).filter(Boolean),
    resolved_items: resolvedItems,
    warnings: (Array.isArray(row.warnings) ? row.warnings : []).map(asText).filter(Boolean),
  };
}

function normalizeUploadedActCommitResult(value: unknown): UploadedActCommitResult {
  const row = asRecord(value);
  const docNo = asNumber(row.doc_no);
  const fileNo = asNumber(row.file_no);
  if (docNo === null || fileNo === null) throw new Error('Сервер не вернул реквизиты записанного акта');
  return {
    success: asBoolean(row.success),
    doc_no: docNo,
    doc_number: asText(row.doc_number),
    file_no: fileNo,
    linked_item_ids: (Array.isArray(row.linked_item_ids) ? row.linked_item_ids : []).flatMap((item) => {
      const valueNumber = asNumber(item);
      return valueNumber === null ? [] : [valueNumber];
    }),
    linked_inv_nos: (Array.isArray(row.linked_inv_nos) ? row.linked_inv_nos : []).map(asText).filter(Boolean),
    message: asText(row.message),
    reminder_status: asText(row.reminder_status) || undefined,
    reminder_task_id: asText(row.reminder_task_id) || undefined,
    reminder_id: asText(row.reminder_id) || undefined,
    reminder_pending_groups: Math.max(0, asNumber(row.reminder_pending_groups) ?? 0),
    reminder_warning: asText(row.reminder_warning) || undefined,
  };
}

export async function submitEquipmentTransfer(
  mode: TransferMode,
  payload: TransferRequest,
  databaseId?: string,
): Promise<TransferResult> {
  const endpoint = mode === 'location'
    ? '/equipment/transfer/location'
    : mode === 'act-only'
      ? '/equipment/transfer/act-only'
      : '/equipment/transfer';
  const { data } = await apiClient.post(endpoint, payload, databaseHeaders(databaseId));
  return normalizeTransferResult(data);
}

export async function getEquipmentTransferJob(jobId: string, databaseId?: string): Promise<TransferResult> {
  const normalized = asText(jobId);
  if (!normalized) throw new Error('Не указан идентификатор операции');
  const { data } = await apiClient.get(
    `/equipment/transfer/act-jobs/${encodeURIComponent(normalized)}`,
    databaseHeaders(databaseId),
  );
  return normalizeTransferResult(data);
}

export const UPLOADED_ACT_PARSE_TIMEOUT_MS = 180_000;

export async function parseUploadedEquipmentAct(
  file: UploadedActFile,
  options: { manualMode?: boolean; databaseId?: string } = {},
): Promise<UploadedActDraft> {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  const scoped = databaseHeaders(options.databaseId);
  const { data } = await apiClient.post('/equipment/acts/upload/parse', formData, {
    params: options.manualMode ? { manual_mode: true } : undefined,
    headers: {
      ...scoped?.headers,
      'Content-Type': 'multipart/form-data',
    },
    timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
  });
  return normalizeUploadedActDraft(data);
}

export async function getUploadedEquipmentActDraft(
  draftId: string,
  databaseId?: string,
): Promise<UploadedActDraft> {
  const normalized = asText(draftId);
  if (!normalized) throw new Error('Не указан идентификатор черновика акта');
  const { data } = await apiClient.get(
    `/equipment/acts/upload/draft/${encodeURIComponent(normalized)}`,
    databaseHeaders(databaseId),
  );
  return normalizeUploadedActDraft(data);
}

export async function commitUploadedEquipmentAct(
  payload: UploadedActCommitPayload,
  databaseId?: string,
): Promise<UploadedActCommitResult> {
  const draftId = asText(payload.draft_id);
  const invNos = payload.equipment_inv_nos.map(asText).filter(Boolean);
  if (!draftId) throw new Error('Не указан идентификатор черновика акта');
  if (!invNos.length) throw new Error('Укажите хотя бы один инвентарный номер');
  const { data } = await apiClient.post('/equipment/acts/upload/commit', {
    draft_id: draftId,
    from_employee: asText(payload.from_employee) || undefined,
    to_employee: asText(payload.to_employee) || undefined,
    doc_date: asText(payload.doc_date) || undefined,
    equipment_inv_nos: [...new Set(invNos)],
    source_task_id: asText(payload.source_task_id) || undefined,
    reminder_id: asText(payload.reminder_id) || undefined,
  }, databaseHeaders(databaseId));
  return normalizeUploadedActCommitResult(data);
}

export async function sendEquipmentTransferActsEmail(
  payload: { act_ids: string[]; mode: 'old' | 'new' | 'manual' | 'employee'; manual_email?: string; owner_no?: number },
  databaseId?: string,
): Promise<{ success_count: number; failed_count: number; errors: string[] }> {
  const { data } = await apiClient.post('/equipment/transfer/email', payload, databaseHeaders(databaseId));
  const row = asRecord(data);
  return {
    success_count: Math.max(0, asNumber(row.success_count) ?? 0),
    failed_count: Math.max(0, asNumber(row.failed_count) ?? 0),
    errors: (Array.isArray(row.errors) ? row.errors : []).map(asText).filter(Boolean),
  };
}

export async function listRecentEquipmentCards(limit = 8, databaseId?: string): Promise<RecentEquipmentCard[]> {
  const { data } = await apiClient.get('/equipment/recent-cards', {
    params: { limit },
    ...databaseHeaders(databaseId),
  });
  const source = asRecord(data).items;
  return (Array.isArray(source) ? source : []).flatMap((entry) => {
    const row = asRecord(entry);
    const invNo = asText(row.inv_no);
    if (!invNo) return [];
    return [{
      inv_no: invNo,
      db_id: asText(row.db_id),
      last_action: asText(row.last_action),
      last_action_label: asText(row.last_action_label),
      last_activity_at: asText(row.last_activity_at) || null,
      activity_count: Math.max(0, asNumber(row.activity_count) ?? 0),
      snapshot: normalizeEquipmentRecord(row.snapshot),
    }];
  });
}

export async function listRecentEquipmentActs(limit = 8, databaseId?: string): Promise<RecentEquipmentAct[]> {
  const { data } = await apiClient.get('/equipment/acts/recent', {
    params: { limit },
    ...databaseHeaders(databaseId),
  });
  const source = asRecord(data).items;
  return (Array.isArray(source) ? source : []).flatMap((entry) => {
    const row = asRecord(entry);
    const docNo = asNumber(row.doc_no);
    if (docNo === null) return [];
    return [{
      doc_no: docNo,
      doc_number: asText(row.doc_number),
      db_id: asText(row.db_id),
      last_action: asText(row.last_action),
      last_action_label: asText(row.last_action_label),
      last_activity_at: asText(row.last_activity_at) || null,
      activity_count: Math.max(0, asNumber(row.activity_count) ?? 0),
      snapshot: normalizeAct(row.snapshot),
    }];
  });
}

export async function touchRecentEquipmentAct(
  act: EquipmentAct,
  actionType = 'view',
  databaseId?: string,
): Promise<void> {
  await apiClient.post('/equipment/acts/recent/touch', {
    doc_no: act.doc_no,
    doc_number: act.doc_number,
    action_type: actionType,
    snapshot: act.raw || undefined,
  }, databaseHeaders(databaseId));
}

export async function recordEquipmentWork({
  kind,
  equipment,
  databaseId,
  consumable,
  componentType,
  componentName,
  componentModel,
}: EquipmentWorkPayload): Promise<void> {
  const serialNumber = asText(equipment.serial_no);
  const common = {
    serial_number: serialNumber,
    employee: asText(equipment.employee_name) || 'Не указан',
    branch: asText(equipment.branch_name),
    location: asText(equipment.location_name),
    inv_no: equipment.inv_no,
    db_name: asText(databaseId),
    equipment_id: asNumber(equipment.id),
    current_description: equipment.description,
    hw_serial_no: equipment.hw_serial_no,
    model_name: equipment.model_name,
    manufacturer: equipment.vendor_name,
  };
  if (!common.branch || !common.location) throw new Error('В карточке не указаны филиал и размещение');
  if (kind !== 'cartridge' && !serialNumber) throw new Error('В карточке не указан серийный номер');
  if (kind === 'cleaning' || kind === 'battery') {
    await apiClient.post(`/json/works/${kind}`, common);
    return;
  }
  if (!consumable?.id) throw new Error('Выберите расходник');
  await apiClient.post('/equipment/consumables/consume', {
    item_id: consumable.id,
    inv_no: consumable.inv_no || undefined,
    qty: 1,
    reason: kind,
  }, databaseHeaders(databaseId));
  const additional_data = {
    consumable_item_id: consumable.id,
    consumable_inv_no: consumable.inv_no,
    consumable_model: consumable.model_name,
    consumable_branch: consumable.branch_name,
    consumable_location: consumable.location_name,
  };
  if (kind === 'cartridge') {
    await apiClient.post('/json/works/cartridge', {
      ...common,
      printer_model: equipment.model_name || 'Unknown',
      cartridge_color: 'black',
      component_type: 'cartridge',
      component_color: 'black',
      cartridge_model: consumable.model_name || undefined,
      detection_source: 'sql-consumables',
      additional_data,
    });
    return;
  }
  const normalizedComponentType = asText(componentType);
  const normalizedComponentModel = asText(componentModel) || consumable.model_name;
  if (!normalizedComponentType || !normalizedComponentModel) throw new Error('Укажите тип и модель компонента');
  const value = [equipment.type_name, equipment.model_name].join(' ').toLowerCase();
  await apiClient.post('/json/works/component', {
    ...common,
    component_type: normalizedComponentType,
    component_name: asText(componentName) || normalizedComponentType,
    component_model: normalizedComponentModel,
    equipment_kind: /(^|[^a-zа-я0-9])(pc|пк)([^a-zа-я0-9]|$)|системн/.test(value) ? 'pc' : 'printer',
    detection_source: 'sql-consumables',
    additional_data,
  });
}
