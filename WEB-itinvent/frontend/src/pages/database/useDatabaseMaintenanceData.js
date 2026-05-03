import { useCallback, useEffect, useMemo, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import jsonAPI from '../../api/json_client';
import {
  filterActionWorkConsumableOptions,
  getActiveComponentOptions,
  shouldLoadWorkConsumables,
} from './actionModel';
import {
  flattenGroupedConsumables,
  toConsumableSourceOption,
} from './consumableModel';
import { toNumberOrNull } from './databaseRecordModel';
import { getComponentLabel } from './equipmentModel';

export const EMPTY_MAINTENANCE_HISTORY = {
  count: 0,
  last_date: null,
  time_ago_str: null,
};

const readHistoryResponse = (response) => (
  response?.data || response || { ...EMPTY_MAINTENANCE_HISTORY }
);

const readSerialFields = (item) => ({
  serialNo: item?.SERIAL_NO || item?.serial_no || '',
  hwSerialNo: item?.HW_SERIAL_NO || item?.hw_serial_no || '',
  invNo: String(item?.INV_NO || item?.inv_no || '').trim(),
});

const toWorkConsumableOptions = (rows) => (Array.isArray(rows) ? rows : [])
  .map((entry) => toConsumableSourceOption(entry))
  .filter((entry) => entry.id !== null);

const dedupeWorkConsumableOptions = (rows) => {
  const seen = new Set();
  return rows.filter((entry) => {
    const id = toNumberOrNull(entry?.id);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export function useDatabaseMaintenanceData({
  actionModal,
  resolveSingleActionTarget,
  componentType,
} = {}) {
  const [cartridgeModel, setCartridgeModel] = useState('');
  const [selectedWorkConsumable, setSelectedWorkConsumable] = useState(null);
  const [workConsumableOptions, setWorkConsumableOptions] = useState([]);
  const [workConsumablesLoading, setWorkConsumablesLoading] = useState(false);
  const [cartridgeHistory, setCartridgeHistory] = useState(null);
  const [batteryHistory, setBatteryHistory] = useState(null);
  const [componentHistory, setComponentHistory] = useState(null);
  const [cleaningHistory, setCleaningHistory] = useState(null);

  const activeComponentOptions = useMemo(
    () => getActiveComponentOptions(actionModal?.componentKind),
    [actionModal?.componentKind]
  );

  const actionWorkConsumableOptions = useMemo(() => (
    filterActionWorkConsumableOptions({
      options: workConsumableOptions,
      actionType: actionModal?.type,
      componentKind: actionModal?.componentKind,
    })
  ), [actionModal?.type, actionModal?.componentKind, workConsumableOptions]);

  const resetMaintenanceData = useCallback(() => {
    setCartridgeModel('');
    setSelectedWorkConsumable(null);
    setWorkConsumableOptions([]);
    setWorkConsumablesLoading(false);
    setCartridgeHistory(null);
    setBatteryHistory(null);
    setComponentHistory(null);
    setCleaningHistory(null);
  }, []);

  useEffect(() => {
    const loadWorkConsumables = async () => {
      if (!shouldLoadWorkConsumables(actionModal)) return;

      setWorkConsumablesLoading(true);
      try {
        let options = [];
        try {
          const primaryResponse = await equipmentAPI.lookupConsumables({
            only_positive_qty: true,
            limit: 500,
          });
          options = toWorkConsumableOptions(primaryResponse);
        } catch (error) {
          console.warn('Primary consumables lookup failed, trying fallback:', error);
        }

        if (options.length === 0) {
          try {
            const secondaryResponse = await equipmentAPI.lookupConsumables({
              only_positive_qty: false,
              limit: 500,
            });
            options = toWorkConsumableOptions(secondaryResponse);
          } catch (error) {
            console.warn('Secondary consumables lookup failed, trying grouped fallback:', error);
          }
        }

        if (options.length === 0) {
          const groupedResponse = await equipmentAPI.getAllConsumablesGrouped({
            page: 1,
            limit: 1000,
          });
          const groupedRows = flattenGroupedConsumables(groupedResponse?.grouped || {});
          options = toWorkConsumableOptions(groupedRows);
        }

        const dedupedOptions = dedupeWorkConsumableOptions(options);
        setWorkConsumableOptions(dedupedOptions);
        setSelectedWorkConsumable((prev) => {
          const prevId = toNumberOrNull(prev?.id);
          if (prevId === null) return null;
          return dedupedOptions.find((entry) => entry.id === prevId) || null;
        });
      } catch (error) {
        console.error('Error loading consumables for works:', error);
        setWorkConsumableOptions([]);
        setSelectedWorkConsumable(null);
      } finally {
        setWorkConsumablesLoading(false);
      }
    };

    void loadWorkConsumables();
  }, [actionModal?.open, actionModal?.type, actionModal?.componentKind]);

  useEffect(() => {
    if (!selectedWorkConsumable) return;
    if (actionModal?.type === 'cartridge') {
      setCartridgeModel(selectedWorkConsumable.model_name || '');
    }
  }, [selectedWorkConsumable, actionModal?.type]);

  useEffect(() => {
    const selectedId = toNumberOrNull(selectedWorkConsumable?.id);
    if (selectedId === null) return;
    const existsInCurrentList = actionWorkConsumableOptions.some(
      (entry) => toNumberOrNull(entry?.id) === selectedId
    );
    if (!existsInCurrentList) {
      setSelectedWorkConsumable(null);
    }
  }, [actionWorkConsumableOptions, selectedWorkConsumable]);

  useEffect(() => {
    const loadCartridgeHistory = async () => {
      if (!actionModal?.open || actionModal?.type !== 'cartridge') return;

      setCartridgeHistory(null);
      const { multiple, item } = resolveSingleActionTarget?.() || {};
      if (multiple) {
        setCartridgeHistory({ ...EMPTY_MAINTENANCE_HISTORY, multiple: true });
        return;
      }
      if (!item) {
        setCartridgeHistory({ ...EMPTY_MAINTENANCE_HISTORY });
        return;
      }

      try {
        const { serialNo, hwSerialNo, invNo } = readSerialFields(item);
        if (!serialNo && !hwSerialNo && !invNo) {
          setCartridgeHistory({ ...EMPTY_MAINTENANCE_HISTORY });
          return;
        }
        const response = await jsonAPI.getCartridgeReplacementHistory(
          serialNo || undefined,
          hwSerialNo || undefined,
          invNo || undefined,
          undefined,
          cartridgeModel || undefined
        );
        setCartridgeHistory(readHistoryResponse(response));
      } catch (error) {
        console.error('Error fetching cartridge history:', error);
        setCartridgeHistory({ ...EMPTY_MAINTENANCE_HISTORY });
      }
    };

    void loadCartridgeHistory();
  }, [actionModal?.open, actionModal?.type, cartridgeModel, resolveSingleActionTarget]);

  useEffect(() => {
    const loadBatteryHistory = async () => {
      if (!actionModal?.open || actionModal?.type !== 'battery') return;

      setBatteryHistory(null);
      const { multiple, item } = resolveSingleActionTarget?.() || {};
      if (multiple) {
        setBatteryHistory({ ...EMPTY_MAINTENANCE_HISTORY, multiple: true });
        return;
      }
      if (!item) {
        setBatteryHistory({ ...EMPTY_MAINTENANCE_HISTORY });
        return;
      }

      try {
        const { serialNo, hwSerialNo } = readSerialFields(item);
        if (!serialNo && !hwSerialNo) {
          setBatteryHistory({ ...EMPTY_MAINTENANCE_HISTORY });
          return;
        }
        const response = await jsonAPI.getBatteryReplacementHistory(serialNo, hwSerialNo);
        setBatteryHistory(readHistoryResponse(response));
      } catch (error) {
        console.error('Error fetching battery history:', error);
        setBatteryHistory({ ...EMPTY_MAINTENANCE_HISTORY });
      }
    };

    void loadBatteryHistory();
  }, [actionModal?.open, actionModal?.type, resolveSingleActionTarget]);

  useEffect(() => {
    const loadComponentHistory = async () => {
      if (!actionModal?.open || actionModal?.type !== 'component') return;

      setComponentHistory(null);
      const { multiple, item } = resolveSingleActionTarget?.() || {};
      if (multiple) {
        setComponentHistory({ ...EMPTY_MAINTENANCE_HISTORY, multiple: true });
        return;
      }
      if (!item) {
        setComponentHistory({ ...EMPTY_MAINTENANCE_HISTORY });
        return;
      }

      try {
        const { serialNo, hwSerialNo } = readSerialFields(item);
        if (!serialNo && !hwSerialNo) {
          setComponentHistory({ ...EMPTY_MAINTENANCE_HISTORY });
          return;
        }
        const componentName = getComponentLabel(actionModal?.componentKind, componentType);
        const response = await jsonAPI.getComponentReplacementHistory(
          serialNo,
          hwSerialNo,
          componentType,
          componentName
        );
        setComponentHistory(readHistoryResponse(response));
      } catch (error) {
        console.error('Error fetching component history:', error);
        setComponentHistory({ ...EMPTY_MAINTENANCE_HISTORY });
      }
    };

    void loadComponentHistory();
  }, [
    actionModal?.open,
    actionModal?.type,
    actionModal?.componentKind,
    componentType,
    resolveSingleActionTarget,
  ]);

  useEffect(() => {
    const loadCleaningHistory = async () => {
      if (!actionModal?.open || actionModal?.type !== 'cleaning') return;

      setCleaningHistory(null);
      const { multiple, item } = resolveSingleActionTarget?.() || {};
      if (multiple) {
        setCleaningHistory({ ...EMPTY_MAINTENANCE_HISTORY, multiple: true });
        return;
      }
      if (!item) {
        setCleaningHistory({ ...EMPTY_MAINTENANCE_HISTORY });
        return;
      }

      try {
        const { serialNo, hwSerialNo } = readSerialFields(item);
        if (!serialNo && !hwSerialNo) {
          setCleaningHistory({ ...EMPTY_MAINTENANCE_HISTORY });
          return;
        }
        const response = await jsonAPI.getPcCleaningHistory(serialNo, hwSerialNo);
        setCleaningHistory(readHistoryResponse(response));
      } catch (error) {
        console.error('Error fetching cleaning history:', error);
        setCleaningHistory({ ...EMPTY_MAINTENANCE_HISTORY });
      }
    };

    void loadCleaningHistory();
  }, [actionModal?.open, actionModal?.type, resolveSingleActionTarget]);

  return {
    cartridgeModel,
    setCartridgeModel,
    selectedWorkConsumable,
    setSelectedWorkConsumable,
    workConsumableOptions,
    setWorkConsumableOptions,
    workConsumablesLoading,
    setWorkConsumablesLoading,
    cartridgeHistory,
    setCartridgeHistory,
    batteryHistory,
    setBatteryHistory,
    componentHistory,
    setComponentHistory,
    cleaningHistory,
    setCleaningHistory,
    activeComponentOptions,
    actionWorkConsumableOptions,
    resetMaintenanceData,
  };
}
