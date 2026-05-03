import {
  DEFAULT_CARTRIDGE_COLOR,
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
  getComponentLabel,
  getItemCapabilityFlags,
} from './equipmentModel';
import { normalizeActionTargets, runInBatches } from './databaseListModel';

const NO_TARGET_ERROR = 'Не выбрано оборудование для операции';

export const getActionErrorMessage = (error) => {
  let errorMessage = error?.message || 'Ошибка выполнения операции';
  const errorData = error?.response?.data;

  if (!errorData?.detail) return errorMessage;
  if (typeof errorData.detail === 'string') return errorData.detail;
  if (Array.isArray(errorData.detail)) {
    return errorData.detail.map((entry) => `${entry.loc?.join('.')}: ${entry.msg}`).join('; ');
  }
  if (typeof errorData.detail === 'object') return 'Ошибка валидации данных';

  return errorMessage;
};

const getInvalidTargetInvNos = (targetInvNos, findEquipmentByInvNo, predicate) => (
  targetInvNos.filter((invNo) => {
    const item = findEquipmentByInvNo(invNo);
    if (!item) return true;
    return !predicate(item);
  })
);

const firstRejectedReason = (settled) => (
  (settled || []).find((result) => result.status === 'rejected')?.reason
);

export const ensureDetailedActionItem = async ({
  invNo,
  detailsMap,
  findEquipmentByInvNo,
  equipmentAPI,
}) => {
  let item = detailsMap?.get(invNo) || findEquipmentByInvNo(invNo);
  if (!item) {
    throw new Error(`Оборудование ${invNo} не найдено в текущем списке`);
  }

  const hasId = item?.ID !== undefined && item?.ID !== null;
  if (!hasId) {
    try {
      const eqResponse = await equipmentAPI.getByInvNos([invNo]);
      const fetched = Array.isArray(eqResponse?.equipment) ? eqResponse.equipment[0] : null;
      if (fetched) {
        item = { ...item, ...fetched };
      }
    } catch (eqErr) {
      console.error('Error fetching full equipment data:', eqErr);
    }
  }

  return item;
};

const getRequiredActionItemFields = ({ item, invNo, getItemBranch }) => {
  const serialNumber = String(item?.SERIAL_NO || item?.serial_no || '').trim();
  const employee = String(item?.OWNER_DISPLAY_NAME || item?.employee_name || 'Не указан').trim();
  const location = String(item?.LOCATION || item?.location || '').trim();
  const branchName = getItemBranch(item);

  if (!serialNumber) {
    throw new Error(`Для оборудования ${invNo} не указан серийный номер`);
  }
  if (!branchName) {
    throw new Error(`Для оборудования ${invNo} не указан филиал`);
  }
  if (!location) {
    throw new Error(`Для оборудования ${invNo} не указана локация`);
  }

  return { serialNumber, employee, location, branchName };
};

const getCommonHistoryPayload = ({ item, invNo, fields, effectiveDbName }) => ({
  serial_number: fields.serialNumber,
  employee: fields.employee,
  branch: fields.branchName,
  location: fields.location,
  inv_no: invNo,
  db_name: effectiveDbName,
  equipment_id: item?.ID,
  current_description: String(item?.DESCRIPTION || item?.description || item?.descr || ''),
  hw_serial_no: String(item?.HW_SERIAL_NO || item?.hw_serial_no || ''),
  model_name: String(item?.MODEL_NAME || item?.model_name || ''),
  manufacturer: String(item?.MANUFACTURER || item?.manufacturer || ''),
});

const runForDetailedTargets = async ({
  targetInvNos,
  loadDetailedItemsByInvNos,
  findEquipmentByInvNo,
  equipmentAPI,
  getItemBranch,
  worker,
}) => {
  const detailedItemsByInv = await loadDetailedItemsByInvNos(targetInvNos);

  const settled = await runInBatches(targetInvNos, async (invNo) => {
    const item = await ensureDetailedActionItem({
      invNo,
      detailsMap: detailedItemsByInv,
      findEquipmentByInvNo,
      equipmentAPI,
    });
    const fields = getRequiredActionItemFields({ item, invNo, getItemBranch });
    return worker({ invNo, item, fields });
  });

  const failed = firstRejectedReason(settled);
  if (failed) throw failed;
};

export const executeMaintenanceAction = async ({
  actionType,
  selectedItems = [],
  fallbackInvNo = null,
  selectedWorkConsumable = null,
  cartridgeModel = '',
  componentType = '',
  effectiveDbName = '',
  findEquipmentByInvNo,
  loadDetailedItemsByInvNos,
  getItemBranch,
  equipmentAPI,
  jsonAPI,
}) => {
  const targetInvNos = normalizeActionTargets(selectedItems, fallbackInvNo);
  if (targetInvNos.length === 0) {
    return { error: NO_TARGET_ERROR };
  }

  if (actionType === 'cartridge') {
    const invalidInvNos = getInvalidTargetInvNos(
      targetInvNos,
      findEquipmentByInvNo,
      (item) => getItemCapabilityFlags(item).isPrinterOrMfu
    );
    if (invalidInvNos.length > 0) {
      return {
        error: `Замена картриджа доступна только для МФУ/принтеров/плоттеров. Неверные INV: ${invalidInvNos.slice(0, 5).join(', ')}`,
      };
    }
    if (!selectedWorkConsumable?.id) {
      return { error: 'Выберите картридж из таблицы расходников.' };
    }

    await runForDetailedTargets({
      targetInvNos,
      loadDetailedItemsByInvNos,
      findEquipmentByInvNo,
      equipmentAPI,
      getItemBranch,
      worker: async ({ invNo, item, fields }) => {
        await equipmentAPI.consumeConsumable({
          item_id: selectedWorkConsumable.id,
          qty: 1,
          reason: 'cartridge',
        });

        return jsonAPI.addCartridgeReplacement({
          printer_model: item?.MODEL_NAME || item?.model_name || 'Unknown',
          cartridge_color: DEFAULT_CARTRIDGE_COLOR,
          component_type: 'cartridge',
          component_color: DEFAULT_CARTRIDGE_COLOR,
          cartridge_model: selectedWorkConsumable.model_name || cartridgeModel || undefined,
          detection_source: 'sql-consumables',
          printer_is_color: undefined,
          ...getCommonHistoryPayload({ item, invNo, fields, effectiveDbName }),
          additional_data: {
            consumable_item_id: selectedWorkConsumable.id,
            consumable_inv_no: selectedWorkConsumable.inv_no || '',
            consumable_model: selectedWorkConsumable.model_name || '',
            consumable_branch: selectedWorkConsumable.branch_name || '',
            consumable_location: selectedWorkConsumable.location_name || '',
          },
        });
      },
    });

    return { shouldRefreshEquipment: true };
  }

  if (actionType === 'battery') {
    const invalidInvNos = getInvalidTargetInvNos(
      targetInvNos,
      findEquipmentByInvNo,
      (item) => getItemCapabilityFlags(item).isUps
    );
    if (invalidInvNos.length > 0) {
      return {
        error: `Замена батареи доступна только для ИБП. Неверные INV: ${invalidInvNos.slice(0, 5).join(', ')}`,
      };
    }

    await runForDetailedTargets({
      targetInvNos,
      loadDetailedItemsByInvNos,
      findEquipmentByInvNo,
      equipmentAPI,
      getItemBranch,
      worker: ({ invNo, item, fields }) => jsonAPI.addBatteryReplacement(
        getCommonHistoryPayload({ item, invNo, fields, effectiveDbName })
      ),
    });

    return { shouldRefreshEquipment: false };
  }

  if (actionType === 'component') {
    const targetItems = targetInvNos.map((invNo) => ({ invNo, item: findEquipmentByInvNo(invNo) }));
    const unresolvedInvNos = targetItems.filter((entry) => !entry.item).map((entry) => entry.invNo);
    if (unresolvedInvNos.length > 0) {
      return { error: `Не удалось определить оборудование: ${unresolvedInvNos.slice(0, 5).join(', ')}` };
    }

    const allPrinter = targetItems.every(({ item }) => getItemCapabilityFlags(item).isPrinterOrMfu);
    const allPc = targetItems.every(({ item }) => getItemCapabilityFlags(item).isPc);
    if (!allPrinter && !allPc) {
      return {
        error: 'Замена комплектующих выполняется отдельно: либо только МФУ/принтеры/плоттеры, либо только системные блоки.',
      };
    }

    const componentKind = allPc ? 'pc' : 'printer';
    const validComponentTypes = (
      componentKind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS
    ).map((entry) => entry.value);
    if (!validComponentTypes.includes(componentType)) {
      return { error: 'Выберите тип компонента из доступного списка.' };
    }
    if (!selectedWorkConsumable?.id) {
      return { error: 'Выберите запчасть из таблицы расходников.' };
    }

    await runForDetailedTargets({
      targetInvNos,
      loadDetailedItemsByInvNos,
      findEquipmentByInvNo,
      equipmentAPI,
      getItemBranch,
      worker: async ({ invNo, item, fields }) => {
        const componentName = getComponentLabel(componentKind, componentType);
        const resolvedComponentModel = String(selectedWorkConsumable?.model_name || '').trim();
        if (!resolvedComponentModel) {
          throw new Error('Не удалось определить модель компонента из выбранного расходника');
        }

        await equipmentAPI.consumeConsumable({
          item_id: selectedWorkConsumable.id,
          qty: 1,
          reason: 'component',
        });

        return jsonAPI.addComponentReplacement({
          ...getCommonHistoryPayload({ item, invNo, fields, effectiveDbName }),
          component_type: componentType,
          component_name: componentName,
          component_model: resolvedComponentModel,
          equipment_kind: componentKind,
          detection_source: 'sql-consumables',
          additional_data: {
            consumable_item_id: selectedWorkConsumable.id,
            consumable_inv_no: selectedWorkConsumable.inv_no || '',
            consumable_model: selectedWorkConsumable.model_name || '',
            consumable_branch: selectedWorkConsumable.branch_name || '',
            consumable_location: selectedWorkConsumable.location_name || '',
          },
        });
      },
    });

    return { shouldRefreshEquipment: true };
  }

  if (actionType === 'cleaning') {
    const invalidInvNos = getInvalidTargetInvNos(
      targetInvNos,
      findEquipmentByInvNo,
      (item) => getItemCapabilityFlags(item).isPc
    );
    if (invalidInvNos.length > 0) {
      return { error: `Чистка доступна только для ПК. Неверные INV: ${invalidInvNos.slice(0, 5).join(', ')}` };
    }

    await runForDetailedTargets({
      targetInvNos,
      loadDetailedItemsByInvNos,
      findEquipmentByInvNo,
      equipmentAPI,
      getItemBranch,
      worker: ({ invNo, item, fields }) => jsonAPI.addPcCleaning(
        getCommonHistoryPayload({
          item,
          invNo: String(invNo || ''),
          fields,
          effectiveDbName,
        })
      ),
    });
  }

  return { shouldRefreshEquipment: false };
};
