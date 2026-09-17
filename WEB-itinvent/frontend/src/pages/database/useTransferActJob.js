import { useCallback, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { normalizeActionTargets } from './databaseListModel';
import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  TRANSFER_OPERATION_MOVE,
  upsertItemInGrouped,
} from './equipmentModel';
import {
  buildTransferActOnlyPayload,
  buildTransferLocationPayload,
  buildTransferMovePayload,
  getRetryOnlyFailedInvNos,
  getTransferResultActionError,
  isTransferJobPending,
} from './transferModel';

const NOT_ALLOWED_MESSAGE =
  'Недостаточно прав для изменения данных.';
const ACT_DOWNLOAD_ERROR =
  'Не удалось скачать акт.';
const JOB_FAILED_ERROR =
  'Создание актов завершилось ошибкой.';
const JOB_POLL_ERROR =
  'Не удалось обновить статус создания актов.';
const JOB_TIMEOUT_ERROR =
  'Создание актов все еще выполняется. Обновите статус позже.';

const createTransferOperationId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `web-${globalThis.crypto.randomUUID()}`;
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const waitForPoll = (ms) => {
  if (Number(ms || 0) <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
};

// Act-job domain of the transfer dialog: submit payloads, idempotent
// operation ids, job polling, retry of failed positions, act download and the
// point refresh of transferred rows. Form fields come from
// useTransferFormState; e-mail state lives in useTransferEmail.
export function useTransferActJob({
  actionModal,
  canDatabaseWrite = false,
  selectedItems = [],
  transferOperationMode,
  newEmployee,
  newEmployeeNo,
  transferDepartment,
  transferBranchNo,
  transferLocationNo,
  transferEmployeeInput,
  transferResult = null,
  setTransferResult,
  findEquipmentByInvNo,
  fetchAllEquipment,
  setAllEquipment,
  setFilteredData,
  setActionError,
  setSelectedItems,
  setTransferEmailStatus,
  setTransferEmailError,
  detailInvNo = '',
  resetDetailHistory,
  onTransferJobDone,
  onDataVersion,
  pollingMaxAttempts = 240,
} = {}) {
  const [transferJobPolling, setTransferJobPolling] = useState(false);
  const [transferRetrySubmitting, setTransferRetrySubmitting] = useState(false);
  const transferJobPollSeqRef = useRef(0);
  const transferOperationRef = useRef({ fingerprint: '', operationId: '' });
  const transferRetryInFlightRef = useRef(false);

  // Point refresh: re-fetch only the transferred rows and upsert them into the
  // grouped cache; falls back to a full refetch if the batch read fails.
  const refreshTransferredItems = useCallback(async (invNos) => {
    const list = (Array.isArray(invNos) ? invNos : []).map((v) => String(v || '').trim()).filter(Boolean);
    if (!list.length || typeof setAllEquipment !== 'function') {
      await fetchAllEquipment?.({ force: true });
      return;
    }
    try {
      const fresh = await equipmentAPI.getByInvNos(list);
      onDataVersion?.(fresh?.data_version);
      const items = Array.isArray(fresh?.equipment) ? fresh.equipment : [];
      if (!items.length) {
        await fetchAllEquipment?.({ force: true });
        return;
      }
      const upsertAll = (prev) => items.reduce(upsertItemInGrouped, prev);
      setAllEquipment(upsertAll);
      setFilteredData?.((prev) => (prev == null ? prev : upsertAll(prev)));
    } catch {
      await fetchAllEquipment?.({ force: true });
    }
  }, [fetchAllEquipment, onDataVersion, setAllEquipment, setFilteredData]);

  const withTransferOperationId = useCallback((payload, forceNew = false) => {
    const fingerprint = JSON.stringify(payload || {});
    if (
      forceNew ||
      transferOperationRef.current.fingerprint !== fingerprint ||
      !transferOperationRef.current.operationId
    ) {
      transferOperationRef.current = {
        fingerprint,
        operationId: createTransferOperationId(),
      };
    }
    return {
      ...payload,
      operation_id: transferOperationRef.current.operationId,
    };
  }, []);

  const resetTransferJob = useCallback(() => {
    transferJobPollSeqRef.current += 1;
    setTransferResult?.(null);
    setTransferJobPolling(false);
    setTransferRetrySubmitting(false);
    transferRetryInFlightRef.current = false;
  }, [setTransferResult]);

  const handleTransferActDownload = useCallback(async (act) => {
    try {
      const response = await equipmentAPI.downloadTransferAct(act.act_id);
      const blob = new Blob([response.data], {
        type: response.headers?.['content-type'] || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = act.file_name || `transfer_act_${act.act_id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading transfer act:', error);
      setActionError?.(ACT_DOWNLOAD_ERROR);
    }
  }, [setActionError]);

  const pollTransferActJob = useCallback(async (jobId, options = {}) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return null;

    const pollSeq = transferJobPollSeqRef.current + 1;
    transferJobPollSeqRef.current = pollSeq;
    setTransferJobPolling(true);
    setActionError?.('');

    const maxAttempts = Number(options.maxAttempts || pollingMaxAttempts);
    // Transient network blips must not kill polling — the server-side job
    // keeps running either way. Give up only after repeated failures.
    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const defaultDelay = attempt < 4 ? 1200 : 2500;
      await waitForPoll(options.pollDelayMs ?? defaultDelay);
      if (transferJobPollSeqRef.current !== pollSeq) return null;

      try {
        const result = await equipmentAPI.getTransferActJob(normalizedJobId);
        if (transferJobPollSeqRef.current !== pollSeq) return null;
        consecutiveErrors = 0;

        setTransferResult(result);
        const status = String(result?.job_status || '').toLowerCase();
        if (status === 'done' || status === 'failed') {
          setTransferJobPolling(false);
          const failedCount = Number(result?.failed_count || 0);
          if (status === 'failed') {
            setActionError?.(result?.job_error || JOB_FAILED_ERROR);
          } else if (failedCount > 0) {
            setActionError?.(`Подготовлено ${result.success_count}, ошибок ${failedCount}`);
          } else {
            setActionError?.('');
          }

          if (options.refreshEquipment && status === 'done') {
            const targetInvNos = Array.isArray(options.targetInvNos) ? options.targetInvNos : [];
            if (
              Number(result?.success_count || 0) > 0 &&
              targetInvNos.includes(String(detailInvNo || '').trim())
            ) {
              resetDetailHistory?.();
            }
            await refreshTransferredItems(targetInvNos);
          }
          if (status === 'done') {
            await Promise.resolve(onTransferJobDone?.({
              result,
              targetInvNos: Array.isArray(options.targetInvNos) ? options.targetInvNos : [],
              operationMode: options.operationMode || transferOperationMode,
            }));
          }
          return result;
        }
      } catch (error) {
        if (transferJobPollSeqRef.current !== pollSeq) return null;
        consecutiveErrors += 1;
        console.error('Transfer act job polling error:', error);
        if (consecutiveErrors < 3) {
          // Keep polling — the job may still be running server-side.
          continue;
        }
        setTransferJobPolling(false);
        const apiDetail = error?.response?.data?.detail;
        setActionError?.(typeof apiDetail === 'string' ? apiDetail : JOB_POLL_ERROR);
        return null;
      }
    }

    if (transferJobPollSeqRef.current === pollSeq) {
      setTransferJobPolling(false);
      setActionError?.(JOB_TIMEOUT_ERROR);
    }
    return null;
  }, [
    detailInvNo,
    onTransferJobDone,
    pollingMaxAttempts,
    refreshTransferredItems,
    resetDetailHistory,
    setActionError,
    transferOperationMode,
  ]);

  const handleTransferActionSubmit = useCallback(async ({
    targetInvNos: explicitTargetInvNos,
    forceNewOperation = false,
  } = {}) => {
    if (!canDatabaseWrite) {
      setActionError?.(NOT_ALLOWED_MESSAGE);
      return null;
    }

    const targetInvNos = explicitTargetInvNos || normalizeActionTargets(selectedItems, actionModal?.invNo);
    if (transferOperationMode === TRANSFER_OPERATION_ACT_ONLY) {
      const { error: payloadError, payload } = buildTransferActOnlyPayload({
        targetInvNos,
        issuerName: newEmployee || transferEmployeeInput,
        issuerOwnerNo: newEmployeeNo,
      });
      if (payloadError) {
        setActionError?.(payloadError);
        return null;
      }

      const response = await equipmentAPI.createTransferActOnly(
        withTransferOperationId(payload, forceNewOperation || Boolean(transferResult))
      );
      setTransferResult(response);
      if (isTransferJobPending(response)) {
        void pollTransferActJob(response.job_id, {
          operationMode: TRANSFER_OPERATION_ACT_ONLY,
          targetInvNos,
        });
      }
      setTransferEmailStatus('');
      setTransferEmailError('');
      setSelectedItems?.([]);
      setActionError?.(response?.job_id ? '' : getTransferResultActionError(response, 'Подготовлено'));
      return response;
    }

    if (transferOperationMode === TRANSFER_OPERATION_LOCATION_ONLY) {
      const { error: payloadError, payload } = buildTransferLocationPayload({
        targetInvNos,
        branchNo: transferBranchNo,
        locationNo: transferLocationNo,
      });
      if (payloadError) {
        setActionError?.(payloadError);
        return null;
      }

      const response = await equipmentAPI.transferLocation(
        // Keep the same idempotency key while the location job is queued or
        // recovering after a timeout. A fresh key is reserved for an explicit
        // retry of only server-confirmed failed positions below.
        withTransferOperationId(payload, forceNewOperation)
      );
      setTransferResult(response);
      setTransferEmailStatus('');
      setTransferEmailError('');
      setSelectedItems?.([]);

      if (isTransferJobPending(response)) {
        void pollTransferActJob(response.job_id, {
          operationMode: TRANSFER_OPERATION_LOCATION_ONLY,
          refreshEquipment: true,
          targetInvNos,
        });
        setActionError?.('');
        return response;
      }

      if (
        Number(response?.success_count || 0) > 0 &&
        targetInvNos.includes(String(detailInvNo || '').trim())
      ) {
        resetDetailHistory?.();
      }
      await refreshTransferredItems(targetInvNos);
      setActionError?.(getTransferResultActionError(response, 'Перемещено'));
      return response;
    }

    const { error: payloadError, payload } = buildTransferMovePayload({
      targetInvNos,
      employeeName: newEmployee,
      employeeNo: newEmployeeNo,
      department: transferDepartment,
      branchNo: transferBranchNo,
      locationNo: transferLocationNo,
    });
    if (payloadError) {
      setActionError?.(payloadError);
      return null;
    }

    const response = await equipmentAPI.transfer(
      withTransferOperationId(payload, forceNewOperation || Boolean(transferResult))
    );
    setTransferResult(response);
    if (isTransferJobPending(response)) {
      void pollTransferActJob(response.job_id, {
        operationMode: TRANSFER_OPERATION_MOVE,
        refreshEquipment: true,
        targetInvNos,
      });
    }
    setTransferEmailStatus('');
    setTransferEmailError('');
    setSelectedItems?.([]);

    if (response?.job_id) {
      setActionError?.('');
      return response;
    }
    if (
      Number(response?.success_count || 0) > 0 &&
      targetInvNos.includes(String(detailInvNo || '').trim())
    ) {
      resetDetailHistory?.();
    }
    await refreshTransferredItems(targetInvNos);
    setActionError?.(getTransferResultActionError(response, 'Перенесено'));
    return response;
  }, [
    actionModal?.invNo,
    canDatabaseWrite,
    detailInvNo,
    newEmployee,
    newEmployeeNo,
    pollTransferActJob,
    refreshTransferredItems,
    resetDetailHistory,
    selectedItems,
    setActionError,
    setSelectedItems,
    setTransferEmailError,
    setTransferEmailStatus,
    transferBranchNo,
    transferDepartment,
    transferEmployeeInput,
    transferLocationNo,
    transferOperationMode,
    transferResult,
    withTransferOperationId,
  ]);

  const handleRetryFailed = useCallback(async (requestedInvNos) => {
    if (transferRetryInFlightRef.current) return null;

    const allowedInvNos = getRetryOnlyFailedInvNos(transferResult);
    const requested = Array.isArray(requestedInvNos) ? requestedInvNos : allowedInvNos;
    const retryInvNos = allowedInvNos.filter((invNo) => requested.includes(invNo));
    if (retryInvNos.length === 0) {
      setActionError?.('Нет позиций, которые безопасно повторить.');
      return null;
    }

    transferRetryInFlightRef.current = true;
    setTransferRetrySubmitting(true);
    setActionError?.('');
    // The original selection can already contain successfully moved items.
    // Retry only server-confirmed failures under a fresh operation id.
    setTransferResult(null);
    try {
      return await handleTransferActionSubmit({
        targetInvNos: retryInvNos,
        forceNewOperation: true,
      });
    } finally {
      transferRetryInFlightRef.current = false;
      setTransferRetrySubmitting(false);
    }
  }, [handleTransferActionSubmit, setActionError, transferResult]);

  return {
    transferJobPolling,
    transferRetrySubmitting,
    refreshTransferredItems,
    resetTransferJob,
    handleTransferActDownload,
    pollTransferActJob,
    handleTransferActionSubmit,
    handleRetryFailed,
  };
}

export default useTransferActJob;
