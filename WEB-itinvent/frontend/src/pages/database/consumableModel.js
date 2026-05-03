import { normalizeText, readFirst, readQty, toIdOrNull, toNumberOrNull } from './databaseRecordModel';

const CARTRIDGE_TOKENS = ['\u043a\u0430\u0440\u0442\u0440\u0438\u0434\u0436', '\u043a\u0430\u0442\u0440\u0438\u0434\u0436', '\u0442\u043e\u043d\u0435\u0440', 'cartridge', 'toner'];
const ADD_CONSUMABLE_ERRORS = {
  type: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0438\u043f \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430.',
  model: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043c\u043e\u0434\u0435\u043b\u044c \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430.',
  branch: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0438\u043b\u0438\u0430\u043b.',
  location: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435.',
  qty: '\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435 0.',
};
const EDIT_CONSUMABLE_QTY_ERRORS = {
  item: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a.',
  qty: '\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0446\u0435\u043b\u044b\u043c \u0447\u0438\u0441\u043b\u043e\u043c 0 \u0438\u043b\u0438 \u0431\u043e\u043b\u044c\u0448\u0435.',
  identity: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c ID \u0438\u043b\u0438 \u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440 \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430.',
};

export const createAddConsumableInitialForm = () => ({
  branch_no: '',
  loc_no: '',
  type_no: '',
  model_name: '',
  model_no: null,
  qty: 1,
});

export const buildAddConsumableDefaults = ({ selectedBranch, branchOptions } = {}) => {
  const normalizedSelectedBranch = normalizeText(selectedBranch);
  const defaultBranch = normalizedSelectedBranch
    ? (branchOptions || []).find((option) => normalizeText(option?.branch_name) === normalizedSelectedBranch)
    : null;
  const branchNo = defaultBranch?.branch_no;

  return {
    ...createAddConsumableInitialForm(),
    branch_no: branchNo === undefined || branchNo === null ? '' : String(branchNo),
  };
};

export const buildAddConsumablePayload = (form = {}) => {
  const typeNo = toNumberOrNull(form.type_no);
  const branchNo = toIdOrNull(form.branch_no);
  const locNo = toIdOrNull(form.loc_no);
  const modelName = String(form.model_name || '').trim();
  const qty = Number(form.qty || 0);

  if (typeNo === null) {
    return { error: ADD_CONSUMABLE_ERRORS.type, payload: null };
  }
  if (!modelName) {
    return { error: ADD_CONSUMABLE_ERRORS.model, payload: null };
  }
  if (!branchNo) {
    return { error: ADD_CONSUMABLE_ERRORS.branch, payload: null };
  }
  if (!locNo) {
    return { error: ADD_CONSUMABLE_ERRORS.location, payload: null };
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: ADD_CONSUMABLE_ERRORS.qty, payload: null };
  }

  return {
    error: '',
    payload: {
      branch_no: branchNo,
      loc_no: locNo,
      type_no: typeNo,
      model_name: modelName,
      model_no: form.model_no || undefined,
      qty: Math.trunc(Number(form.qty || 0)),
    },
  };
};

export const buildAddConsumableSuccessMessage = (response) => {
  const invNo = String(response?.inv_no || '').trim();
  return invNo
    ? `\u0420\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d. \u0418\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440: ${invNo}.`
    : '\u0420\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d.';
};

export const getEditConsumableQtyInitialValue = (item) => (
  String(Math.max(0, Math.trunc(readQty(item, 0))))
);

export const buildEditConsumableQtyPayload = ({ item, value } = {}) => {
  if (!item || typeof item !== 'object') {
    return { error: EDIT_CONSUMABLE_QTY_ERRORS.item, payload: null };
  }

  const itemId = toNumberOrNull(readFirst(item, ['ID', 'id'], null));
  const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
  const parsedQty = Number(value);

  if (!Number.isFinite(parsedQty) || parsedQty < 0 || !Number.isInteger(parsedQty)) {
    return { error: EDIT_CONSUMABLE_QTY_ERRORS.qty, payload: null };
  }
  if (itemId === null && !invNo) {
    return { error: EDIT_CONSUMABLE_QTY_ERRORS.identity, payload: null };
  }

  return {
    error: '',
    payload: {
      item_id: itemId ?? undefined,
      inv_no: invNo || undefined,
      qty: Math.trunc(parsedQty),
    },
  };
};

export const toConsumableSourceOption = (entry) => ({
  id: toNumberOrNull(readFirst(entry, ['ID', 'id'], null)),
  inv_no: String(readFirst(entry, ['INV_NO', 'inv_no'], '') || '').trim(),
  type_name: String(readFirst(entry, ['TYPE_NAME', 'type_name'], '') || '').trim(),
  model_name: String(readFirst(entry, ['MODEL_NAME', 'model_name'], '') || '').trim(),
  qty: Number(readFirst(entry, ['QTY', 'qty'], 0)) || 0,
  branch_name: String(readFirst(entry, ['BRANCH_NAME', 'branch_name'], '') || '').trim(),
  location_name: String(
    readFirst(entry, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], '') || ''
  ).trim(),
});

export const formatConsumableSourceLabel = (entry) => {
  const option = toConsumableSourceOption(entry);
  const model = option.model_name || '-';
  const type = option.type_name || '-';
  const branch = option.branch_name || '-';
  const location = option.location_name || '-';
  return `${model} | ${type} | ${branch} / ${location} | \u041e\u0441\u0442\u0430\u0442\u043e\u043a: ${option.qty}`;
};

export const flattenGroupedConsumables = (grouped) => {
  const rows = [];
  Object.values(grouped || {}).forEach((locations) => {
    Object.values(locations || {}).forEach((items) => {
      (items || []).forEach((item) => rows.push(item));
    });
  });
  return rows;
};

export const isCartridgeLikeConsumable = (entry) => {
  const option = toConsumableSourceOption(entry);
  const haystack = `${option.type_name} ${option.model_name}`.toLowerCase();
  return CARTRIDGE_TOKENS.some((token) => haystack.includes(token));
};
