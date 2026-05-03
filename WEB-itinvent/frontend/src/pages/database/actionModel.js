import {
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
  toInvNo,
} from './equipmentModel';
import { isCartridgeLikeConsumable } from './consumableModel';

export const resolveSingleActionTarget = ({
  selectedItems = [],
  fallbackInvNo = null,
  findEquipmentByInvNo,
} = {}) => {
  const selectedInvNos = Array.isArray(selectedItems) ? selectedItems : [];
  if (selectedInvNos.length > 1) {
    return { multiple: true, item: null };
  }

  const invNo = toInvNo(selectedInvNos.length > 0 ? selectedInvNos[0] : fallbackInvNo);
  if (!invNo || typeof findEquipmentByInvNo !== 'function') {
    return { multiple: false, item: null };
  }

  return { multiple: false, item: findEquipmentByInvNo(invNo) || null };
};

export const getActiveComponentOptions = (componentKind) => (
  componentKind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS
);

export const filterActionWorkConsumableOptions = ({
  options,
  actionType,
  componentKind,
} = {}) => {
  const sourceOptions = Array.isArray(options) ? options : [];

  if (actionType === 'cartridge') {
    return sourceOptions.filter((entry) => isCartridgeLikeConsumable(entry));
  }

  if (actionType === 'component' && componentKind === 'printer') {
    return sourceOptions.filter((entry) => !isCartridgeLikeConsumable(entry));
  }

  return sourceOptions;
};

export const shouldLoadWorkConsumables = (actionModal = {}) => (
  Boolean(actionModal?.open) && (
    actionModal?.type === 'cartridge' ||
    (actionModal?.type === 'component' && Boolean(actionModal?.componentKind))
  )
);
