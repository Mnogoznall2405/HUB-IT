import { normalizeText, toIdOrNull, toNumberOrNull } from './databaseRecordModel';

export const normalizeLocationOption = (location) => {
  const locNo = toIdOrNull(location?.LOC_NO ?? location?.loc_no);
  const locName = String(location?.LOC_NAME || location?.loc_name || location?.DESCR || '').trim();
  const searchBlob = `${locName} ${locNo || ''}`.toLowerCase();
  return {
    loc_no: locNo,
    loc_name: locName,
    search_blob: searchBlob,
  };
};

export const formatLocationOptionLabel = (option) => {
  const locName = String(option?.loc_name || '').trim();
  const locNo = String(option?.loc_no || '').trim();
  if (locName && locNo && normalizeText(locName) !== normalizeText(locNo)) {
    return `${locName} (${locNo})`;
  }
  return locName || locNo || '-';
};

export const filterLocationOptions = (options, state) => {
  const needle = normalizeText(state?.inputValue || '');
  if (!needle) return options;
  return options.filter((option) => String(option?.search_blob || '').includes(needle));
};

export const buildStatusOptions = (statuses) =>
  (statuses || [])
    .map((status) => ({
      status_no: toNumberOrNull(status?.STATUS_NO ?? status?.status_no),
      status_name: String(status?.STATUS_NAME || status?.status_name || status?.DESCR || ''),
    }))
    .filter((status) => status.status_no !== null);

export const buildBranchOptions = (branches) =>
  (branches || [])
    .map((branch) => ({
      branch_no: toIdOrNull(branch?.BRANCH_NO ?? branch?.branch_no ?? branch?.id),
      branch_name: String(branch?.BRANCH_NAME || branch?.branch_name || branch?.name || ''),
    }))
    .filter((branch) => branch.branch_no !== null);

export const buildLocationOptions = (locations) =>
  (locations || [])
    .map(normalizeLocationOption)
    .filter((location) => location.loc_no !== null);

export const buildTypeOptions = (equipmentTypes) =>
  (equipmentTypes || [])
    .map((type) => ({
      ci_type: toNumberOrNull(type?.CI_TYPE ?? type?.ci_type),
      type_no: toNumberOrNull(type?.TYPE_NO ?? type?.type_no),
      type_name: String(type?.TYPE_NAME || type?.type_name || ''),
    }))
    .filter((type) => type.type_no !== null);

export const getEquipmentTypeOptions = (typeOptions) =>
  (typeOptions || []).filter((type) => type.ci_type === 1);

export const getConsumableTypeOptions = (typeOptions) =>
  (typeOptions || []).filter((type) => type.ci_type === 4);

export const buildDetailModelOptions = (models) =>
  (models || [])
    .map((model) => ({
      model_no: toNumberOrNull(model?.MODEL_NO ?? model?.model_no),
      model_name: String(model?.MODEL_NAME || model?.model_name || ''),
      type_no: toNumberOrNull(model?.TYPE_NO ?? model?.type_no),
    }))
    .filter((model) => model.model_no !== null);

export const buildNamedModelOptions = (models) =>
  (models || [])
    .map((model) => ({
      model_no: toNumberOrNull(model?.MODEL_NO ?? model?.model_no),
      model_name: String(model?.MODEL_NAME || model?.model_name || ''),
    }))
    .filter((model) => model.model_name);

export const getSelectedOwnerOption = ({ ownerOptions, ownerNo, ownerName, ownerDept }) => {
  const normalizedOwnerNo = toNumberOrNull(ownerNo);
  if (normalizedOwnerNo === null) return null;

  const matched = (ownerOptions || []).find(
    (owner) => toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no) === normalizedOwnerNo
  );
  if (matched) return matched;

  return {
    OWNER_NO: ownerNo,
    OWNER_DISPLAY_NAME: ownerName || 'Не указан',
    OWNER_DEPT: ownerDept || '',
  };
};

export const usesManualOwner = ({ ownerNo, ownerName }) =>
  toNumberOrNull(ownerNo) === null && String(ownerName || '').trim().length >= 2;

export const usesManualModel = ({ modelNo, modelName, typeNo }) =>
  toNumberOrNull(modelNo) === null &&
  String(modelName || '').trim().length >= 2 &&
  toNumberOrNull(typeNo) !== null;
