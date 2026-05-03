import { normalizeText, readFirst, readQty, toIdOrNull, toNumberOrNull } from './databaseRecordModel';

const UNKNOWN_BRANCH = '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d';
const UNKNOWN_LOCATION = '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e';

const readNetworkName = (data) =>
  String(
    readFirst(
      data,
      [
        'NETBIOS_NAME',
        'netbios_name',
        'NETWORK_NAME',
        'network_name',
        'NET_NAME',
        'net_name',
        'HOST_NAME',
        'host_name',
        'HOSTNAME',
        'hostname',
        'DNS_NAME',
        'dns_name',
        'DOMAIN_NAME',
        'domain_name',
      ],
      ''
    ) || ''
  );

export const toItemId = (item) => String(readFirst(item, ['ID', 'id'], '')).trim();

export const toOwnerOption = (owner) => ({
  owner_no: toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no),
  owner_display_name: String(owner?.OWNER_DISPLAY_NAME || owner?.owner_display_name || '').trim(),
  owner_dept: String(owner?.OWNER_DEPT || owner?.owner_dept || '').trim(),
});

export const createAddEquipmentInitialForm = () => ({
  employee_name: '',
  employee_no: null,
  employee_dept: '',
  branch_no: '',
  loc_no: '',
  type_no: '',
  model_name: '',
  model_no: null,
  status_no: '',
  serial_number: '',
  part_no: '',
  ip_address: '',
  description: '',
});

const toDefaultSelectValue = (value) => (value !== undefined && value !== null ? String(value) : '');

export const buildAddEquipmentDefaults = ({ selectedBranch, branchOptions = [], statusOptions = [] } = {}) => {
  const defaultBranch = selectedBranch
    ? branchOptions.find((option) => normalizeText(option.branch_name) === normalizeText(selectedBranch))
    : null;
  const defaultStatus = statusOptions.find((option) =>
    normalizeText(option.status_name).includes('эксплуата')
  ) || statusOptions[0];

  return {
    ...createAddEquipmentInitialForm(),
    branch_no: toDefaultSelectValue(defaultBranch?.branch_no),
    status_no: toDefaultSelectValue(defaultStatus?.status_no),
  };
};

export const buildAddEquipmentPayload = (form = {}) => {
  const serialNumber = String(form.serial_number || '').trim();
  const employeeName = String(form.employee_name || '').trim();
  const modelName = String(form.model_name || '').trim();
  const typeNo = toNumberOrNull(form.type_no);
  const statusNo = toNumberOrNull(form.status_no);
  const branchNo = toIdOrNull(form.branch_no);
  const locNo = toIdOrNull(form.loc_no);

  if (!serialNumber) {
    return { error: 'Укажите серийный номер.', payload: null };
  }
  if (!employeeName) {
    return { error: 'Выберите или введите сотрудника.', payload: null };
  }
  if (typeNo === null) {
    return { error: 'Выберите тип оборудования.', payload: null };
  }
  if (!modelName) {
    return { error: 'Укажите модель оборудования.', payload: null };
  }
  if (statusNo === null) {
    return { error: 'Выберите статус оборудования.', payload: null };
  }
  if (!branchNo) {
    return { error: 'Выберите филиал.', payload: null };
  }
  if (!locNo) {
    return { error: 'Выберите местоположение.', payload: null };
  }

  return {
    error: '',
    payload: {
      serial_no: serialNumber,
      employee_name: employeeName,
      employee_no: form.employee_no || undefined,
      employee_dept: String(form.employee_dept || '').trim() || undefined,
      branch_no: branchNo,
      loc_no: locNo,
      type_no: typeNo,
      model_name: modelName,
      model_no: form.model_no || undefined,
      status_no: statusNo,
      part_no: String(form.part_no || '').trim() || undefined,
      description: String(form.description || '').trim() || undefined,
      ip_address: String(form.ip_address || '').trim() || undefined,
      hw_serial_no: undefined,
    },
  };
};

export const buildAddEquipmentSuccessMessage = (response) => {
  const invNo = String(response?.inv_no || '').trim();
  const extra = [
    response?.created_owner ? 'создан сотрудник' : '',
    response?.created_model ? 'создана модель' : '',
  ].filter(Boolean).join(', ');

  return invNo
    ? `Оборудование добавлено. Инвентарный номер: ${invNo}${extra ? ` (${extra})` : ''}.`
    : `Оборудование добавлено.${extra ? ` (${extra})` : ''}`;
};

export const buildDetailFormState = (data) => ({
  type_no: toNumberOrNull(readFirst(data, ['TYPE_NO', 'type_no'], null)),
  type_name: String(readFirst(data, ['TYPE_NAME', 'type_name'], '') || ''),
  model_no: toNumberOrNull(readFirst(data, ['MODEL_NO', 'model_no'], null)),
  model_name: String(readFirst(data, ['MODEL_NAME', 'model_name'], '') || ''),
  serial_no: String(readFirst(data, ['SERIAL_NO', 'serial_no'], '') || ''),
  hw_serial_no: String(readFirst(data, ['HW_SERIAL_NO', 'hw_serial_no'], '') || ''),
  part_no: String(readFirst(data, ['PART_NO', 'part_no'], '') || ''),
  description: String(readFirst(data, ['DESCRIPTION', 'description'], '') || ''),
  status_no: toNumberOrNull(readFirst(data, ['STATUS_NO', 'status_no'], null)),
  empl_no: toNumberOrNull(readFirst(data, ['EMPL_NO', 'empl_no'], null)),
  employee_name: String(readFirst(data, ['OWNER_DISPLAY_NAME', 'employee_name'], '') || ''),
  employee_dept: String(readFirst(data, ['OWNER_DEPT', 'employee_dept'], '') || ''),
  branch_no: toIdOrNull(readFirst(data, ['BRANCH_NO', 'branch_no'], null)),
  branch_name: String(readFirst(data, ['BRANCH_NAME', 'branch_name'], '') || ''),
  loc_no: toIdOrNull(readFirst(data, ['LOC_NO', 'loc_no'], null)),
  location_name: String(readFirst(data, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], '') || ''),
  ip_address: String(readFirst(data, ['IP_ADDRESS', 'ip_address'], '') || ''),
  mac_address: String(readFirst(data, ['MAC_ADDRESS', 'mac_address', 'MAC_ADDR', 'mac_addr', 'MAC', 'mac'], '') || ''),
  network_name: readNetworkName(data),
  domain_name: String(readFirst(data, ['DOMAIN_NAME', 'domain_name'], '') || ''),
});

export const formatDetailDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

export const buildDetailActSummary = (act) => {
  if (!act || typeof act !== 'object') return null;
  const pick = (keys, fallback = '-') => {
    const value = readFirst(act, keys, '');
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  };
  const addInfo = readFirst(act, ['add_info', 'ADD_INFO', 'addinfo', 'ADDINFO'], '');
  return {
    docNo: pick(['doc_no', 'DOC_NO']),
    docNumber: pick(['doc_number', 'DOC_NUMBER']),
    docDate: pick(['doc_date', 'DOC_DATE']),
    typeName: pick(['type_name', 'TYPE_NAME', 'type_no', 'TYPE_NO']),
    branchName: pick(['branch_name', 'BRANCH_NAME']),
    locationName: pick(['location_name', 'LOCATION_NAME']),
    employeeName: pick(['employee_name', 'EMPLOYEE_NAME']),
    itemId: pick(['item_id', 'ITEM_ID']),
    createDate: pick(['create_date', 'CREATE_DATE']),
    createUser: pick(['create_user_name', 'CREATE_USER_NAME']),
    changeDate: pick(['ch_date', 'CH_DATE']),
    changeUser: pick(['ch_user', 'CH_USER']),
    addInfo: String(addInfo || '').trim(),
  };
};

export const formatDetailHistoryValue = (row, keys) => {
  const value = readFirst(row, keys, '');
  const text = String(value ?? '').trim();
  return text || '-';
};

export const formatDetailHistoryTransition = (row, oldKeys, newKeys) => {
  const oldValue = formatDetailHistoryValue(row, oldKeys);
  const newValue = formatDetailHistoryValue(row, newKeys);
  return `${oldValue} -> ${newValue}`;
};

export const normalizeDetailComparable = (formState) => ({
  type_no: toNumberOrNull(formState?.type_no),
  model_no: toNumberOrNull(formState?.model_no),
  serial_no: String(formState?.serial_no || '').trim(),
  hw_serial_no: String(formState?.hw_serial_no || '').trim(),
  part_no: String(formState?.part_no || '').trim(),
  ip_address: String(formState?.ip_address || '').trim(),
  mac_address: String(formState?.mac_address || '').trim(),
  network_name: String(formState?.network_name || '').trim(),
  description: String(formState?.description || '').trim(),
  status_no: toNumberOrNull(formState?.status_no),
  empl_no: toNumberOrNull(formState?.empl_no),
  branch_no: toIdOrNull(formState?.branch_no),
  loc_no: toIdOrNull(formState?.loc_no),
});

export const hasDetailFormChanges = (currentForm, initialForm) => {
  if (!currentForm || !initialForm) return false;
  const current = normalizeDetailComparable(currentForm);
  const initial = normalizeDetailComparable(initialForm);
  return Object.keys(current).some((key) => current[key] !== initial[key]);
};

export const buildDetailUpdatePayload = (currentForm, initialForm) => {
  if (
    !currentForm ||
    !initialForm ||
    typeof currentForm !== 'object' ||
    typeof initialForm !== 'object' ||
    Object.keys(currentForm).length === 0 ||
    Object.keys(initialForm).length === 0
  ) {
    return {};
  }

  const current = normalizeDetailComparable(currentForm);
  const initial = normalizeDetailComparable(initialForm);
  const payload = {};
  Object.keys(current).forEach((key) => {
    if (current[key] !== initial[key]) {
      payload[key] = current[key];
    }
  });
  return payload;
};

export const buildDetailQrFileName = (data) => {
  const invNo = String(readFirst(data, ['INV_NO', 'inv_no'], '') || '').trim();
  const safeInvNo = (invNo || 'equipment').replace(/[^0-9A-Za-z_-]+/g, '_');
  return `qr_${safeInvNo}.png`;
};

export const toGroupedItem = (data) => ({
  ID: readFirst(data, ['ID', 'id'], null),
  INV_NO: String(readFirst(data, ['INV_NO', 'inv_no'], '') || ''),
  SERIAL_NO: String(readFirst(data, ['SERIAL_NO', 'serial_no'], '') || ''),
  HW_SERIAL_NO: String(readFirst(data, ['HW_SERIAL_NO', 'hw_serial_no'], '') || ''),
  PART_NO: String(readFirst(data, ['PART_NO', 'part_no'], '') || ''),
  QTY: readQty(data, 1),
  IP_ADDRESS: String(readFirst(data, ['IP_ADDRESS', 'ip_address'], '') || ''),
  MAC_ADDRESS: String(readFirst(data, ['MAC_ADDRESS', 'mac_address', 'MAC_ADDR', 'mac_addr', 'MAC', 'mac'], '') || ''),
  NETWORK_NAME: readNetworkName(data),
  DOMAIN_NAME: String(readFirst(data, ['DOMAIN_NAME', 'domain_name'], '') || ''),
  TYPE_NAME: String(readFirst(data, ['TYPE_NAME', 'type_name'], '-') || '-'),
  MODEL_NAME: String(readFirst(data, ['MODEL_NAME', 'model_name'], '-') || '-'),
  VENDOR_NAME: String(readFirst(data, ['VENDOR_NAME', 'vendor_name', 'MANUFACTURER', 'manufacturer'], '-') || '-'),
  OWNER_DISPLAY_NAME: String(readFirst(data, ['OWNER_DISPLAY_NAME', 'employee_name'], '-') || '-'),
  OWNER_DEPT: String(readFirst(data, ['OWNER_DEPT', 'employee_dept'], '') || ''),
  BRANCH_NAME: String(readFirst(data, ['BRANCH_NAME', 'branch_name'], UNKNOWN_BRANCH) || UNKNOWN_BRANCH),
  LOCATION_NAME: String(
    readFirst(data, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], UNKNOWN_LOCATION) || UNKNOWN_LOCATION
  ),
  DESCRIPTION: String(readFirst(data, ['DESCRIPTION', 'description'], '') || ''),
  TYPE_NO: toNumberOrNull(readFirst(data, ['TYPE_NO', 'type_no'], null)),
  MODEL_NO: toNumberOrNull(readFirst(data, ['MODEL_NO', 'model_no'], null)),
  STATUS_NO: toNumberOrNull(readFirst(data, ['STATUS_NO', 'status_no'], null)),
  DESCR: String(readFirst(data, ['DESCR', 'status_name', 'status'], '') || ''),
});
