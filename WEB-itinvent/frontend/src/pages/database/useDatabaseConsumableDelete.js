import { useCallback, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { readFirst } from './databaseRecordModel';
import { toInvNo } from './equipmentModel';

export function useDatabaseConsumableDelete({
  canDatabaseDelete = false,
  fetchAllEquipment,
  notifyDatabaseSuccess,
} = {}) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openDeleteConsumableModal = useCallback((item) => {
    if (!canDatabaseDelete) return;
    if (!item || typeof item !== 'object') return;

    const itemId = Number(readFirst(item, ['ID', 'id'], 0));
    if (!Number.isFinite(itemId) || itemId <= 0) return;

    setDeleteError('');
    setDeleteTarget({
      itemId,
      invNo: toInvNo(item),
      item,
    });
  }, [canDatabaseDelete]);

  const closeDeleteConsumableModal = useCallback(() => {
    if (deleteLoading) return;
    setDeleteTarget(null);
    setDeleteError('');
  }, [deleteLoading]);

  const confirmDeleteConsumable = useCallback(async () => {
    const itemId = Number(deleteTarget?.itemId || 0);
    if (!itemId || !canDatabaseDelete) return;

    setDeleteLoading(true);
    setDeleteError('');
    try {
      await equipmentAPI.deleteConsumable(itemId);
      const invNo = String(deleteTarget?.invNo || '').trim();
      notifyDatabaseSuccess?.(
        invNo ? `Расходник ${invNo} удалён.` : 'Расходник удалён.',
      );
      setDeleteTarget(null);
      await fetchAllEquipment?.({ force: true });
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setDeleteError(
        typeof apiDetail === 'string'
          ? apiDetail
          : 'Не удалось удалить расходник.',
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [
    canDatabaseDelete,
    deleteTarget?.invNo,
    deleteTarget?.itemId,
    fetchAllEquipment,
    notifyDatabaseSuccess,
  ]);

  return {
    deleteConsumableTarget: deleteTarget,
    deleteConsumableLoading: deleteLoading,
    deleteConsumableError: deleteError,
    openDeleteConsumableModal,
    closeDeleteConsumableModal,
    confirmDeleteConsumable,
  };
}

export default useDatabaseConsumableDelete;
