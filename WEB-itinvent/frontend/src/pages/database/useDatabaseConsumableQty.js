import { useCallback, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import {
  buildEditConsumableQtyPayload,
  getEditConsumableQtyInitialValue,
} from './consumableModel';
import { readFirst } from './databaseRecordModel';
import { toInvNo, updateItemFieldsInGrouped } from './equipmentModel';

const createClosedModal = () => ({ open: false, item: null });

const buildQtySuccessMessage = (item, qty) => {
  const label = String(readFirst(item, ['MODEL_NAME', 'model_name'], '') || '').trim();
  return label
    ? `Количество обновлено: ${label} -> ${qty}.`
    : `Количество обновлено: ${qty}.`;
};

export function useDatabaseConsumableQty({
  canDatabaseWrite = false,
  fetchAllEquipment,
  setAllEquipment,
  setFilteredData,
  notifyDatabaseSuccess,
} = {}) {
  const [editConsumableQtyModal, setEditConsumableQtyModal] = useState(createClosedModal);
  const [editConsumableQtyValue, setEditConsumableQtyValue] = useState('');
  const [editConsumableQtyLoading, setEditConsumableQtyLoading] = useState(false);
  const [editConsumableQtyError, setEditConsumableQtyError] = useState('');

  const openEditConsumableQtyModal = useCallback((item) => {
    if (!canDatabaseWrite) return;
    if (!item || typeof item !== 'object') return;
    setEditConsumableQtyError('');
    setEditConsumableQtyLoading(false);
    setEditConsumableQtyValue(getEditConsumableQtyInitialValue(item));
    setEditConsumableQtyModal({ open: true, item });
  }, [canDatabaseWrite]);

  const closeEditConsumableQtyModal = useCallback(() => {
    setEditConsumableQtyModal(createClosedModal());
    setEditConsumableQtyValue('');
    setEditConsumableQtyLoading(false);
    setEditConsumableQtyError('');
  }, []);

  const setEditConsumableQtyInput = useCallback((value) => {
    setEditConsumableQtyValue(value);
    setEditConsumableQtyError('');
  }, []);

  const handleEditConsumableQtySubmit = useCallback(async () => {
    if (!canDatabaseWrite) {
      setEditConsumableQtyError('Недостаточно прав для изменения данных.');
      return;
    }

    const item = editConsumableQtyModal.item;
    const { error, payload } = buildEditConsumableQtyPayload({
      item,
      value: editConsumableQtyValue,
    });
    if (error) {
      setEditConsumableQtyError(error);
      return;
    }

    setEditConsumableQtyLoading(true);
    setEditConsumableQtyError('');
    try {
      await equipmentAPI.updateConsumableQty(payload);

      const message = buildQtySuccessMessage(item, payload.qty);
      notifyDatabaseSuccess?.(message);
      closeEditConsumableQtyModal();

      const invNo = toInvNo(item);
      const patch = { QTY: payload.qty, qty: payload.qty };
      if (invNo && typeof setAllEquipment === 'function') {
        setAllEquipment((prev) => updateItemFieldsInGrouped(prev, invNo, patch));
        setFilteredData?.((prev) =>
          prev === null ? prev : updateItemFieldsInGrouped(prev, invNo, patch));
      } else {
        await fetchAllEquipment?.({ force: true });
      }
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setEditConsumableQtyError(
        typeof apiDetail === 'string'
          ? apiDetail
          : 'Не удалось обновить количество расходника.'
      );
    } finally {
      setEditConsumableQtyLoading(false);
    }
  }, [
    canDatabaseWrite,
    closeEditConsumableQtyModal,
    editConsumableQtyModal.item,
    editConsumableQtyValue,
    fetchAllEquipment,
    notifyDatabaseSuccess,
    setAllEquipment,
    setFilteredData,
  ]);

  return {
    editConsumableQtyModal,
    editConsumableQtyValue,
    editConsumableQtyLoading,
    editConsumableQtyError,
    openEditConsumableQtyModal,
    closeEditConsumableQtyModal,
    setEditConsumableQtyInput,
    handleEditConsumableQtySubmit,
  };
}

export default useDatabaseConsumableQty;
