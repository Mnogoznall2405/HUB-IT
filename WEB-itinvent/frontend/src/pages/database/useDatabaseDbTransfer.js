import { useCallback, useState } from 'react';

import equipmentDbTransferAPI from '../../api/equipmentDbTransfer';

// State for the "transfer to another database" dialog. The dialog collects the
// target DB fields; this hook only owns open/running/result and the submit call.
export function useDatabaseDbTransfer({ notifyDatabaseError } = {}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const openDbTransfer = useCallback(() => {
    setResult(null);
    setError('');
    setOpen(true);
  }, []);

  const closeDbTransfer = useCallback(() => {
    if (running) return;
    setOpen(false);
  }, [running]);

  const submitDbTransfer = useCallback(async ({
    invNos,
    targetDb,
    targetOwnerNo,
    newOwnerName,
    targetBranchNo,
    targetLocNo,
    taskAssigneeUserIds,
    taskDueAt,
    comment,
  }) => {
    if (running) return null;
    setRunning(true);
    setError('');
    try {
      const response = await equipmentDbTransferAPI.transferToDb({
        inv_nos: invNos,
        target_db: targetDb,
        target_owner_no: targetOwnerNo ?? null,
        new_owner_name: newOwnerName || null,
        target_branch_no: targetBranchNo ?? null,
        target_loc_no: targetLocNo ?? null,
        task_assignee_user_ids: Array.isArray(taskAssigneeUserIds) && taskAssigneeUserIds.length
          ? taskAssigneeUserIds
          : null,
        task_due_at: taskDueAt || null,
        comment: comment || null,
      });
      setResult(response);
      return response;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const message = typeof detail === 'string' && detail
        ? detail
        : 'Не удалось выполнить перенос в другую базу.';
      setError(message);
      notifyDatabaseError?.(message);
      return null;
    } finally {
      setRunning(false);
    }
  }, [running, notifyDatabaseError]);

  return {
    dbTransferOpen: open,
    dbTransferRunning: running,
    dbTransferResult: result,
    dbTransferError: error,
    openDbTransfer,
    closeDbTransfer,
    submitDbTransfer,
  };
}

export default useDatabaseDbTransfer;
