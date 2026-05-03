import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';

export const toTransferNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const toTransferIdOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
};

export const normalizeTransferText = (value) => String(value ?? '').trim().toLowerCase();

const readTransferFirst = (item, keys, fallback = null) => {
  if (!item) return fallback;
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key];
  }
  return fallback;
};

const getTransferBranchName = (item) =>
  String(readTransferFirst(item, ['BRANCH_NAME', 'branch_name'], '') || '').trim();

const getTransferLocationName = (item) =>
  String(
    readTransferFirst(item, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], '') || ''
  ).trim();

const getTransferBranchNo = (item) =>
  toTransferIdOrNull(readTransferFirst(item, ['BRANCH_NO', 'branch_no'], null));

const getTransferLocNo = (item) =>
  toTransferIdOrNull(readTransferFirst(item, ['LOC_NO', 'loc_no'], null));

export const buildTransferSourceDefaults = ({ items, branchOptions }) => {
  const sourceItems = Array.isArray(items) ? items : [];
  if (sourceItems.length === 0) {
    return {
      branch_no: null,
      loc_no: null,
      branch_name: '',
      location_name: '',
      mixed_branch: false,
      mixed_location: false,
    };
  }

  const branches = Array.isArray(branchOptions) ? branchOptions : [];
  const firstItem = sourceItems[0];
  const firstBranchName = getTransferBranchName(firstItem);
  const firstLocationName = getTransferLocationName(firstItem);
  const firstBranchNoRaw = getTransferBranchNo(firstItem);
  const firstLocNo = getTransferLocNo(firstItem);

  const matchedBranch = branches.find(
    (option) =>
      normalizeTransferText(option?.branch_name ?? option?.BRANCH_NAME) ===
      normalizeTransferText(firstBranchName)
  );
  const firstBranchNo =
    readTransferFirst(matchedBranch, ['branch_no', 'BRANCH_NO'], undefined) ??
    firstBranchNoRaw ??
    null;

  const mixedBranch = sourceItems.some(
    (item) => normalizeTransferText(getTransferBranchName(item)) !== normalizeTransferText(firstBranchName)
  );
  const mixedLocation = sourceItems.some(
    (item) =>
      normalizeTransferText(getTransferLocationName(item)) !== normalizeTransferText(firstLocationName)
  );

  return {
    branch_no: firstBranchNo,
    loc_no: firstLocNo,
    branch_name: firstBranchName,
    location_name: firstLocationName,
    mixed_branch: mixedBranch,
    mixed_location: mixedLocation,
  };
};

export const validateTransferEmployeeName = (name) => {
  if (!name || typeof name !== 'string') return false;
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 100) return false;

  const dangerousChars = ['<', '>', '"', "'", '&', ';', '|', '`', '\n', '\r'];
  if (dangerousChars.some((char) => normalized.includes(char))) return false;

  const upper = normalized.toUpperCase();
  const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'EXEC'];
  return !sqlKeywords.some((keyword) => upper.includes(keyword));
};

export const toTransferOwnerOption = (owner) => ({
  owner_no: toTransferNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no),
  owner_display_name: String(owner?.OWNER_DISPLAY_NAME || owner?.owner_display_name || '').trim(),
  owner_dept: String(owner?.OWNER_DEPT || owner?.owner_dept || '').trim(),
});

export const buildCreateTransferEmployeeOption = (input) => ({
  __create: true,
  OWNER_NO: null,
  OWNER_DISPLAY_NAME: String(input || '').trim(),
  OWNER_DEPT: '',
});

export const getSelectedTransferEmployeeOption = ({
  employeeNo,
  employeeName,
  employeeOptions,
}) => {
  if (!employeeNo) return null;
  const selectedNo = toTransferNumberOrNull(employeeNo);
  const matched = (employeeOptions || []).find(
    (owner) => toTransferNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no) === selectedNo
  );
  if (matched) return matched;
  return {
    OWNER_NO: employeeNo,
    OWNER_DISPLAY_NAME: employeeName || 'Не указан',
    OWNER_DEPT: '',
  };
};

export const buildTransferEmployeeInputState = ({
  operationMode,
  transferResult,
  employeeNo,
  employeeName,
  employeeInput,
  employeeOptions,
}) => {
  const options = Array.isArray(employeeOptions) ? employeeOptions : [];
  const inputTrimmed = String(employeeInput || '').trim();
  const normalizedInput = normalizeTransferText(inputTrimmed);
  const hasExactMatch = Boolean(normalizedInput) && options.some(
    (owner) => normalizeTransferText(toTransferOwnerOption(owner).owner_display_name) === normalizedInput
  );
  const canAdd =
    operationMode === TRANSFER_OPERATION_MOVE &&
    !transferResult &&
    !employeeNo &&
    inputTrimmed.length >= 2 &&
    !hasExactMatch &&
    normalizeTransferText(employeeName) !== normalizedInput;
  const autocompleteOptions =
    canAdd && options.length === 0
      ? [buildCreateTransferEmployeeOption(inputTrimmed)]
      : options;

  return {
    inputTrimmed,
    hasExactMatch,
    canAdd,
    autocompleteOptions,
    usesManualEmployee: !employeeNo && String(employeeName || '').trim().length >= 2,
  };
};

export const getTransferEmptyTargetError = (operationMode) =>
  operationMode === TRANSFER_OPERATION_ACT_ONLY
    ? 'Не выбрано оборудование для акта'
    : 'Не выбрано оборудование для перемещения';

export const buildTransferActOnlyPayload = ({
  targetInvNos,
  issuerName,
  issuerOwnerNo,
}) => {
  const invNos = Array.isArray(targetInvNos) ? targetInvNos : [];
  const trimmedIssuerName = String(issuerName || '').trim();
  if (invNos.length === 0) {
    return { error: getTransferEmptyTargetError(TRANSFER_OPERATION_ACT_ONLY), payload: null };
  }
  if (!trimmedIssuerName) {
    return { error: 'Укажите, кто выдал технику.', payload: null };
  }

  return {
    error: '',
    payload: {
      inv_nos: invNos,
      issuer_employee: trimmedIssuerName,
      issuer_owner_no: issuerOwnerNo || undefined,
    },
  };
};

export const buildTransferMovePayload = ({
  targetInvNos,
  employeeName,
  employeeNo,
  department,
  branchNo,
  locationNo,
}) => {
  const invNos = Array.isArray(targetInvNos) ? targetInvNos : [];
  const trimmedEmployeeName = String(employeeName || '').trim();
  const trimmedDepartment = String(department || '').trim();

  if (invNos.length === 0) {
    return { error: getTransferEmptyTargetError(TRANSFER_OPERATION_MOVE), payload: null };
  }
  if (!employeeNo && trimmedEmployeeName.length < 2) {
    return { error: 'Выберите сотрудника из списка или нажмите "Добавить сотрудника".', payload: null };
  }
  if (!employeeNo && !validateTransferEmployeeName(trimmedEmployeeName)) {
    return { error: 'Некорректное ФИО нового сотрудника.', payload: null };
  }
  if (!employeeNo && !trimmedDepartment) {
    return { error: 'Выберите отдел для нового сотрудника из списка.', payload: null };
  }
  if (!branchNo) {
    return { error: 'Выберите филиал назначения из списка.', payload: null };
  }
  if (!locationNo) {
    return { error: 'Выберите местоположение назначения из списка.', payload: null };
  }

  return {
    error: '',
    payload: {
      inv_nos: invNos,
      new_employee: trimmedEmployeeName,
      new_employee_no: employeeNo || undefined,
      new_employee_dept: !employeeNo ? trimmedDepartment || undefined : undefined,
      branch_no: branchNo,
      loc_no: locationNo,
    },
  };
};

export const buildTransferEmailPayload = ({
  acts,
  mode,
  manualEmail,
  recipient,
}) => {
  if (!Array.isArray(acts) || acts.length === 0) {
    return { error: '', payload: null };
  }

  const payload = {
    act_ids: acts.map((act) => act.act_id),
    mode,
  };

  if (mode === 'manual') {
    const email = String(manualEmail || '').trim();
    if (!email) {
      return { error: 'Введите email получателя.', payload: null };
    }
    payload.manual_email = email;
  }

  if (mode === 'employee') {
    const ownerNo = toTransferNumberOrNull(recipient?.OWNER_NO ?? recipient?.owner_no);
    if (!ownerNo) {
      return { error: 'Выберите сотрудника-получателя.', payload: null };
    }
    payload.owner_no = ownerNo;
  }

  return { error: '', payload };
};

export const isTransferJobPending = (response) =>
  Boolean(response?.job_id) &&
  ['queued', 'processing'].includes(String(response?.job_status || '').toLowerCase());

export const getTransferResultActionError = (response, successLabel) =>
  Number(response?.failed_count || 0) > 0
    ? `${successLabel} ${response.success_count}, ошибок ${response.failed_count}`
    : '';
