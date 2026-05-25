export const DATA_MODE_EQUIPMENT = 'equipment';
export const DATA_MODE_CONSUMABLES = 'consumables';
export const TRANSFER_OPERATION_MOVE = 'move';
export const TRANSFER_OPERATION_ACT_ONLY = 'act_only';
export const TRANSFER_OPERATION_LOCATION_ONLY = 'location_only';
export const DEFAULT_CARTRIDGE_COLOR = 'Универсальный';

const PRINTER_MFU_KEYWORDS = [
  'принтер',
  'мфу',
  'плоттер',
  'плотер',
  'printer',
  'plotter',
  'mfp',
  'mfc',
  'large format',
  'wide format',
  'laserjet',
  'officejet',
  'deskjet',
  'workcentre',
  'versalink',
  'i-sensys',
  'designjet',
  'imageprograf',
  'surecolor',
  'plotwave',
];

const UPS_KEYWORDS = [
  'ибп',
  'ups',
  'uninterruptible',
  'power supply',
];

const PC_KEYWORDS = [
  'системный блок',
  'системный',
  'пк',
  'pc',
  'system unit',
];

export const PRINTER_COMPONENT_OPTIONS = [
  { value: 'fuser', label: 'Фьюзер' },
  { value: 'photoconductor', label: 'Фотобарабан' },
  { value: 'waste_toner', label: 'Отработанный тонер' },
  { value: 'transfer_belt', label: 'Трансферный ролик' },
];

export const PC_COMPONENT_OPTIONS = [
  { value: 'ram', label: 'Оперативная память' },
  { value: 'ssd', label: 'SSD накопитель' },
  { value: 'hdd', label: 'HDD накопитель' },
  { value: 'gpu', label: 'Видеокарта' },
  { value: 'cpu', label: 'Процессор' },
  { value: 'motherboard', label: 'Материнская плата' },
  { value: 'psu', label: 'Блок питания' },
  { value: 'cooler', label: 'Кулер' },
  { value: 'fan', label: 'Вентилятор' },
];

const hasShortEquipmentToken = (text, token) => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
};

const hasAnyKeyword = (text, keywords) => keywords.some((keyword) => {
  if (keyword === 'pc' || keyword === 'пк') {
    return hasShortEquipmentToken(text, keyword);
  }
  return text.includes(keyword);
});

export const toInvNo = (itemOrInvNo) =>
  String(
    typeof itemOrInvNo === 'string' || typeof itemOrInvNo === 'number'
      ? itemOrInvNo
      : itemOrInvNo?.INV_NO || itemOrInvNo?.inv_no || ''
  ).trim();

export const getItemCapabilityFlags = (item) => {
  const typeName = String(item?.TYPE_NAME || item?.type_name || '').toLowerCase();
  const modelName = String(item?.MODEL_NAME || item?.model_name || '').toLowerCase();
  const vendorName = String(item?.VENDOR_NAME || item?.vendor_name || item?.MANUFACTURER || item?.manufacturer || '').toLowerCase();
  const allFields = `${typeName} ${modelName} ${vendorName}`.trim();

  return {
    isPrinterOrMfu: hasAnyKeyword(allFields, PRINTER_MFU_KEYWORDS),
    isUps: hasAnyKeyword(allFields, UPS_KEYWORDS),
    isPc: hasAnyKeyword(allFields, PC_KEYWORDS),
  };
};

export const getComponentOptionsByKind = (kind) =>
  kind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS;

export const normalizePrinterComponentType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'drum') return 'photoconductor';
  return normalized;
};

const getPrinterComponentOptionLabel = (value) => {
  const normalized = normalizePrinterComponentType(value);
  const known = PRINTER_COMPONENT_OPTIONS.find((option) => option.value === normalized);
  return known?.label || normalized || 'Компонент';
};

export const getComponentLabel = (kind, type) => {
  if (kind === 'pc') {
    const option = PC_COMPONENT_OPTIONS.find((entry) => entry.value === type);
    return option?.label || type || 'компонента';
  }
  return getPrinterComponentOptionLabel(type);
};

export const getEquipmentRowActions = ({
  item,
  dataMode = DATA_MODE_EQUIPMENT,
  canWrite = true,
  isAdmin = false,
}) => {
  if (dataMode === DATA_MODE_CONSUMABLES) {
    return [];
  }

  const flags = getItemCapabilityFlags(item);
  return Array.from(new Set([
    ...(canWrite ? ['view', 'location_transfer', 'transfer'] : ['view']),
    ...(canWrite && flags.isPrinterOrMfu ? ['cartridge', 'component'] : []),
    ...(canWrite && flags.isUps ? ['battery'] : []),
    ...(canWrite && flags.isPc && !flags.isPrinterOrMfu ? ['component'] : []),
    ...(canWrite && flags.isPc ? ['cleaning'] : []),
    ...(isAdmin ? ['delete'] : []),
  ]));
};

export const upsertItemInGrouped = (groupedData, nextItem) => {
  const targetInvNo = toInvNo(nextItem);
  const nextGrouped = {};

  Object.entries(groupedData || {}).forEach(([branchName, locations]) => {
    Object.entries(locations || {}).forEach(([locationName, items]) => {
      const filteredItems = (items || []).filter((item) => toInvNo(item) !== targetInvNo);
      if (filteredItems.length === 0) return;
      if (!nextGrouped[branchName]) nextGrouped[branchName] = {};
      nextGrouped[branchName][locationName] = filteredItems;
    });
  });

  const targetBranch = String(nextItem?.BRANCH_NAME || nextItem?.branch_name || 'Не указан').trim() || 'Не указан';
  const targetLocation = String(
    nextItem?.LOCATION_NAME || nextItem?.location_name || nextItem?.LOCATION || nextItem?.location || 'Не указано'
  ).trim() || 'Не указано';

  if (!nextGrouped[targetBranch]) nextGrouped[targetBranch] = {};
  if (!nextGrouped[targetBranch][targetLocation]) nextGrouped[targetBranch][targetLocation] = [];
  nextGrouped[targetBranch][targetLocation] = [nextItem, ...nextGrouped[targetBranch][targetLocation]];

  return nextGrouped;
};

export const removeItemFromGrouped = (groupedData, targetInvNo) => {
  const normalizedInvNo = String(targetInvNo || '').trim();
  if (!normalizedInvNo) return groupedData || {};

  const nextGrouped = {};
  Object.entries(groupedData || {}).forEach(([branchName, locations]) => {
    const nextLocations = {};
    Object.entries(locations || {}).forEach(([locationName, items]) => {
      const filteredItems = (items || []).filter((item) => toInvNo(item) !== normalizedInvNo);
      if (filteredItems.length > 0) {
        nextLocations[locationName] = filteredItems;
      }
    });
    if (Object.keys(nextLocations).length > 0) {
      nextGrouped[branchName] = nextLocations;
    }
  });
  return nextGrouped;
};
