import { useCallback, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { removeItemFromGrouped } from './equipmentModel';

export function useDatabaseDeleteEquipment({
  isAdmin = false,
  setAllEquipment,
  setFilteredData,
  setSelectedItems,
  setLoadedCount,
  setServerTotal,
  setTotal,
  detailInvNo = '',
  onDetailDeleted,
  onEquipmentDeleted,
  notifyDatabaseSuccess,
} = {}) {
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openDeleteEquipmentDialog = useCallback(({ invNo, item = null } = {}) => {
    const normalizedInvNo = String(invNo || '').trim();
    if (!normalizedInvNo || !isAdmin) return;
    setDeleteError('');
    setDeleteTarget({
      invNo: normalizedInvNo,
      item: item || null,
    });
  }, [isAdmin]);

  const closeDeleteEquipmentDialog = useCallback(() => {
    if (deleteLoading) return;
    setDeleteTarget(null);
    setDeleteError('');
  }, [deleteLoading]);

  const confirmDeleteEquipment = useCallback(async () => {
    const invNo = String(deleteTarget?.invNo || '').trim();
    if (!invNo || !isAdmin) return;

    setDeleteLoading(true);
    setDeleteError('');
    try {
      await equipmentAPI.deleteByInvNo(invNo);
      setAllEquipment?.((prev) => removeItemFromGrouped(prev, invNo));
      setFilteredData?.((prev) => (prev === null ? prev : removeItemFromGrouped(prev, invNo)));
      setSelectedItems?.((prev) => prev.filter((value) => String(value || '').trim() !== invNo));
      setLoadedCount?.((prev) => Math.max(0, Number(prev || 0) - 1));
      setServerTotal?.((prev) => Math.max(0, Number(prev || 0) - 1));
      setTotal?.((prev) => Math.max(0, Number(prev || 0) - 1));
      if (String(detailInvNo || '').trim() === invNo) {
        onDetailDeleted?.();
      }
      onEquipmentDeleted?.(invNo);
      setDeleteTarget(null);
      notifyDatabaseSuccess?.(`Оборудование ${invNo} удалено.`);
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setDeleteError(typeof apiDetail === 'string' ? apiDetail : 'Не удалось удалить оборудование.');
    } finally {
      setDeleteLoading(false);
    }
  }, [
    deleteTarget?.invNo,
    detailInvNo,
    isAdmin,
    notifyDatabaseSuccess,
    onDetailDeleted,
    onEquipmentDeleted,
    setAllEquipment,
    setFilteredData,
    setLoadedCount,
    setSelectedItems,
    setServerTotal,
    setTotal,
  ]);

  return {
    deleteTarget,
    deleteLoading,
    deleteError,
    openDeleteEquipmentDialog,
    closeDeleteEquipmentDialog,
    confirmDeleteEquipment,
    setDeleteError,
  };
}

export default useDatabaseDeleteEquipment;
