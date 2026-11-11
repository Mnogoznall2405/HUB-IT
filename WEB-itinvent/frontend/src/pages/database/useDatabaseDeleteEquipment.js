import { useCallback, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { removeItemFromGrouped } from './equipmentModel';

// Backend message: "... cannot be deleted (acts=1, history=3)".
function parseDependencyCounts(detail) {
  const text = String(detail || '');
  const acts = Number((/acts=(\d+)/.exec(text) || [])[1] || 0);
  const history = Number((/history=(\d+)/.exec(text) || [])[1] || 0);
  return { acts, history };
}

export function useDatabaseDeleteEquipment({
  canDeleteEquipment = false,
  canDeleteEquipmentWithHistory = false,
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
  const [deleteBlocked, setDeleteBlocked] = useState(null);

  const openDeleteEquipmentDialog = useCallback(({ invNo, item = null } = {}) => {
    const normalizedInvNo = String(invNo || '').trim();
    if (!normalizedInvNo || !canDeleteEquipment) return;
    setDeleteError('');
    setDeleteBlocked(null);
    setDeleteTarget({
      invNo: normalizedInvNo,
      item: item || null,
    });
  }, [canDeleteEquipment]);

  const closeDeleteEquipmentDialog = useCallback(() => {
    if (deleteLoading) return;
    setDeleteTarget(null);
    setDeleteError('');
    setDeleteBlocked(null);
  }, [deleteLoading]);

  const runDelete = useCallback(async (withHistory) => {
    const invNo = String(deleteTarget?.invNo || '').trim();
    if (!invNo || !canDeleteEquipment) return;
    if (withHistory && !canDeleteEquipmentWithHistory) return;

    setDeleteLoading(true);
    setDeleteError('');
    try {
      await (withHistory
        ? equipmentAPI.deleteByInvNo(invNo, { withHistory: true })
        : equipmentAPI.deleteByInvNo(invNo));
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
      setDeleteBlocked(null);
      notifyDatabaseSuccess?.(
        withHistory
          ? `Оборудование ${invNo} удалено вместе с актами и историей.`
          : `Оборудование ${invNo} удалено.`,
      );
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      if (error?.response?.status === 409 && /acts=|history=/.test(String(apiDetail || ''))) {
        setDeleteBlocked(parseDependencyCounts(apiDetail));
      } else {
        setDeleteError(typeof apiDetail === 'string' ? apiDetail : 'Не удалось удалить оборудование.');
      }
    } finally {
      setDeleteLoading(false);
    }
  }, [
    deleteTarget?.invNo,
    detailInvNo,
    canDeleteEquipment,
    canDeleteEquipmentWithHistory,
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

  const confirmDeleteEquipment = useCallback(() => runDelete(false), [runDelete]);
  const confirmDeleteEquipmentWithHistory = useCallback(() => runDelete(true), [runDelete]);

  return {
    deleteTarget,
    deleteLoading,
    deleteError,
    deleteBlocked,
    canDeleteEquipmentWithHistory,
    openDeleteEquipmentDialog,
    closeDeleteEquipmentDialog,
    confirmDeleteEquipment,
    confirmDeleteEquipmentWithHistory,
    setDeleteError,
  };
}

export default useDatabaseDeleteEquipment;
