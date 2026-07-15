import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { normalizeActionTargets } from './databaseListModel';
import { buildLocationOptions } from './databaseOptionModel';
import { normalizeText, toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import { toOwnerOption } from './detailModel';
import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';
import {
  buildTransferActOnlyPayload,
  buildTransferEmailPayload,
  buildTransferEmployeeInputState,
  buildTransferLocationPayload,
  buildTransferMovePayload,
  buildTransferSourceDefaults,
  getSelectedTransferEmployeeOption,
  getRetryOnlyFailedInvNos,
  getTransferResultActionError,
  isTransferJobPending,
  validateTransferEmployeeName,
} from './transferModel';

const DEFAULT_TRANSFER_EMAIL_MODE = 'old';
const ACT_ONLY_EMPLOYEE_LABEL = '\u0411\u0435\u0437 \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0430';
const NOT_ALLOWED_MESSAGE =
  '\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043f\u0440\u0430\u0432 \u0434\u043b\u044f \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0434\u0430\u043d\u043d\u044b\u0445.';
const INVALID_EMPLOYEE_MESSAGE =
  '\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0424\u0418\u041e. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0438\u043c\u044f (2-100 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432, \u0431\u0435\u0437 \u0441\u043f\u0435\u0446\u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432).';
const ACT_DOWNLOAD_ERROR =
  '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u0430\u043a\u0442.';
const JOB_FAILED_ERROR =
  '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0430\u043a\u0442\u043e\u0432 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043b\u043e\u0441\u044c \u043e\u0448\u0438\u0431\u043a\u043e\u0439.';
const JOB_POLL_ERROR =
  '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0430\u043a\u0442\u043e\u0432.';
const JOB_TIMEOUT_ERROR =
  '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0430\u043a\u0442\u043e\u0432 \u0432\u0441\u0435 \u0435\u0449\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442\u0441\u044f. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0430\u0442\u0443\u0441 \u043f\u043e\u0437\u0436\u0435.';
const EMAIL_SEND_ERROR =
  '\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 email.';

const createTransferOperationId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `web-${globalThis.crypto.randomUUID()}`;
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const readOwners = (response) => (Array.isArray(response?.owners) ? response.owners : []);

const dedupeOwners = (owners) => {
  const rows = Array.isArray(owners) ? owners : [];
  return rows.filter((owner, index, arr) => {
    const ownerNo = toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no);
    return (
      ownerNo !== null &&
      arr.findIndex((item) => toNumberOrNull(item?.OWNER_NO ?? item?.owner_no) === ownerNo) === index
    );
  });
};

const waitForPoll = (ms) => {
  if (Number(ms || 0) <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
};

export function useDatabaseTransferAction({
  actionModal,
  canDatabaseWrite = false,
  selectedItems = [],
  branchOptions = [],
  findEquipmentByInvNo,
  searchOwnersCached,
  getOwnerDepartmentsCached,
  getLocationsCached,
  fetchAllEquipment,
  setActionError,
  setSelectedItems,
  detailInvNo = '',
  resetDetailHistory,
  navigate,
  openUploadActModalForReminder,
  onTransferJobDone,
  pollingMaxAttempts = 240,
} = {}) {
  const [transferOperationMode, setTransferOperationMode] = useState(TRANSFER_OPERATION_MOVE);
  const [newEmployee, setNewEmployee] = useState('');
  const [newEmployeeNo, setNewEmployeeNo] = useState(null);
  const [transferDepartment, setTransferDepartment] = useState('');
  const [transferDepartmentOptions, setTransferDepartmentOptions] = useState([]);
  const [transferDepartmentLoading, setTransferDepartmentLoading] = useState(false);
  const [transferBranchNo, setTransferBranchNo] = useState(null);
  const [transferLocationNo, setTransferLocationNo] = useState(null);
  const [transferLocations, setTransferLocations] = useState([]);
  const [transferLocationsLoading, setTransferLocationsLoading] = useState(false);
  const [transferEmployeeInput, setTransferEmployeeInput] = useState('');
  const [transferEmployeeOptions, setTransferEmployeeOptions] = useState([]);
  const [transferEmployeeLoading, setTransferEmployeeLoading] = useState(false);
  const [transferResult, setTransferResult] = useState(null);
  const [transferJobPolling, setTransferJobPolling] = useState(false);
  const [transferRetrySubmitting, setTransferRetrySubmitting] = useState(false);
  const transferJobPollSeqRef = useRef(0);
  const transferOperationRef = useRef({ fingerprint: '', operationId: '' });
  const transferRetryInFlightRef = useRef(false);
  const [transferEmailMode, setTransferEmailMode] = useState(DEFAULT_TRANSFER_EMAIL_MODE);
  const [transferManualEmail, setTransferManualEmail] = useState('');
  const [transferRecipientInput, setTransferRecipientInput] = useState('');
  const [transferRecipientOptions, setTransferRecipientOptions] = useState([]);
  const [transferRecipient, setTransferRecipient] = useState(null);
  const [transferRecipientLoading, setTransferRecipientLoading] = useState(false);
  const [transferEmailLoading, setTransferEmailLoading] = useState(false);
  const [transferEmailStatus, setTransferEmailStatus] = useState('');
  const [transferEmailError, setTransferEmailError] = useState('');

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

  const transferLocationOptions = useMemo(
    () => buildLocationOptions(transferLocations),
    [transferLocations]
  );

  const transferSourceDefaults = useMemo(() => {
    const invNos = normalizeActionTargets(selectedItems, actionModal?.invNo);
    const items = invNos.map((invNo) => findEquipmentByInvNo?.(invNo)).filter(Boolean);
    return buildTransferSourceDefaults({ items, branchOptions });
  }, [actionModal?.invNo, branchOptions, findEquipmentByInvNo, selectedItems]);

  const selectedTransferEmployeeOption = useMemo(
    () => getSelectedTransferEmployeeOption({
      employeeNo: newEmployeeNo,
      employeeName: newEmployee,
      employeeOptions: transferEmployeeOptions,
    }),
    [transferEmployeeOptions, newEmployeeNo, newEmployee]
  );

  const transferEmployeeInputState = useMemo(
    () => buildTransferEmployeeInputState({
      operationMode: transferOperationMode,
      transferResult,
      employeeNo: newEmployeeNo,
      employeeName: newEmployee,
      employeeInput: transferEmployeeInput,
      employeeOptions: transferEmployeeOptions,
    }),
    [
      transferOperationMode,
      transferResult,
      newEmployeeNo,
      newEmployee,
      transferEmployeeInput,
      transferEmployeeOptions,
    ]
  );

  const resetTransferState = useCallback(() => {
    transferJobPollSeqRef.current += 1;
    setTransferOperationMode(TRANSFER_OPERATION_MOVE);
    setNewEmployee('');
    setNewEmployeeNo(null);
    setTransferDepartment('');
    setTransferDepartmentOptions([]);
    setTransferDepartmentLoading(false);
    setTransferBranchNo(null);
    setTransferLocationNo(null);
    setTransferLocations([]);
    setTransferLocationsLoading(false);
    setTransferEmployeeInput('');
    setTransferEmployeeOptions([]);
    setTransferEmployeeLoading(false);
    setTransferResult(null);
    setTransferJobPolling(false);
    setTransferRetrySubmitting(false);
    transferRetryInFlightRef.current = false;
    setTransferEmailMode(DEFAULT_TRANSFER_EMAIL_MODE);
    setTransferManualEmail('');
    setTransferRecipientInput('');
    setTransferRecipientOptions([]);
    setTransferRecipient(null);
    setTransferRecipientLoading(false);
    setTransferEmailLoading(false);
    setTransferEmailStatus('');
    setTransferEmailError('');
  }, []);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return undefined;
    const query = String(transferEmployeeInput || '').trim();
    if (query.length < 2) {
      setTransferEmployeeLoading(false);
      return undefined;
    }

    let canceled = false;
    setTransferEmployeeLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchOwnersCached?.(query, 20);
        if (canceled) return;
        const currentOption = newEmployeeNo ? [{
          OWNER_NO: newEmployeeNo,
          OWNER_DISPLAY_NAME: newEmployee || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d',
          OWNER_DEPT: '',
        }] : [];
        setTransferEmployeeOptions(dedupeOwners([...currentOption, ...readOwners(response)]));
      } catch (error) {
        console.error('Error searching transfer employees:', error);
      } finally {
        if (!canceled) setTransferEmployeeLoading(false);
      }
    }, 280);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [
    actionModal?.open,
    actionModal?.type,
    transferResult,
    transferEmployeeInput,
    newEmployeeNo,
    newEmployee,
    searchOwnersCached,
  ]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return undefined;
    if (![TRANSFER_OPERATION_MOVE, TRANSFER_OPERATION_LOCATION_ONLY].includes(transferOperationMode)) return undefined;

    let canceled = false;
    setTransferDepartmentLoading(true);
    const loadDepartments = async () => {
      try {
        const response = await getOwnerDepartmentsCached?.(1000);
        if (canceled) return;
        const raw = Array.isArray(response?.departments) ? response.departments : [];
        const normalized = raw
          .map((dept) => String(dept || '').trim())
          .filter(Boolean)
          .filter((dept, index, arr) => (
            arr.findIndex((entry) => normalizeText(entry) === normalizeText(dept)) === index
          ));
        setTransferDepartmentOptions(normalized);
      } catch (error) {
        console.error('Error loading owner departments:', error);
        if (!canceled) setTransferDepartmentOptions([]);
      } finally {
        if (!canceled) setTransferDepartmentLoading(false);
      }
    };

    void loadDepartments();
    return () => {
      canceled = true;
    };
  }, [actionModal?.open, actionModal?.type, transferResult, transferOperationMode, getOwnerDepartmentsCached]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return;
    if (transferBranchNo !== null || transferLocationNo !== null) return;
    setTransferBranchNo(transferSourceDefaults.branch_no);
    setTransferLocationNo(transferSourceDefaults.loc_no);
  }, [
    actionModal?.open,
    actionModal?.type,
    transferResult,
    transferBranchNo,
    transferLocationNo,
    transferSourceDefaults.branch_no,
    transferSourceDefaults.loc_no,
  ]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return undefined;
    if (![TRANSFER_OPERATION_MOVE, TRANSFER_OPERATION_LOCATION_ONLY].includes(transferOperationMode)) return undefined;
    if (!transferBranchNo) {
      setTransferLocations([]);
      setTransferLocationsLoading(false);
      setTransferLocationNo(null);
      return undefined;
    }

    let canceled = false;
    setTransferLocationsLoading(true);
    const loadLocations = async () => {
      try {
        const response = await getLocationsCached?.(transferBranchNo);
        if (canceled) return;
        const nextLocations = Array.isArray(response) ? response : [];
        setTransferLocations(nextLocations);
        setTransferLocationNo((prevLocNo) => {
          const normalizedPrev = toIdOrNull(prevLocNo);
          if (
            normalizedPrev &&
            nextLocations.some(
              (location) => toIdOrNull(location?.LOC_NO ?? location?.loc_no) === normalizedPrev
            )
          ) {
            return normalizedPrev;
          }

          const byDefaultNo = transferSourceDefaults.loc_no
            ? nextLocations.find(
              (location) => toIdOrNull(location?.LOC_NO ?? location?.loc_no) === transferSourceDefaults.loc_no
            )
            : null;
          if (byDefaultNo) return toIdOrNull(byDefaultNo?.LOC_NO ?? byDefaultNo?.loc_no);

          const byDefaultName = transferSourceDefaults.location_name
            ? nextLocations.find(
              (location) => (
                normalizeText(location?.LOC_NAME ?? location?.loc_name ?? location?.DESCR) ===
                normalizeText(transferSourceDefaults.location_name)
              )
            )
            : null;
          if (byDefaultName) return toIdOrNull(byDefaultName?.LOC_NO ?? byDefaultName?.loc_no);

          return normalizedPrev;
        });
      } catch (error) {
        console.error('Error loading transfer locations:', error);
        if (!canceled) {
          setTransferLocations([]);
          setTransferLocationNo(null);
        }
      } finally {
        if (!canceled) setTransferLocationsLoading(false);
      }
    };

    void loadLocations();
    return () => {
      canceled = true;
    };
  }, [
    actionModal?.open,
    actionModal?.type,
    transferResult,
    transferOperationMode,
    transferBranchNo,
    getLocationsCached,
    transferSourceDefaults.loc_no,
    transferSourceDefaults.location_name,
  ]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer') return undefined;
    if (transferEmailMode !== 'employee') {
      setTransferRecipientInput('');
      setTransferRecipientOptions([]);
      setTransferRecipient(null);
      setTransferRecipientLoading(false);
      return undefined;
    }

    const query = String(transferRecipientInput || '').trim();
    if (query.length < 2) {
      setTransferRecipientLoading(false);
      return undefined;
    }

    let canceled = false;
    setTransferRecipientLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchOwnersCached?.(query, 20);
        if (!canceled) setTransferRecipientOptions(readOwners(response));
      } catch (error) {
        console.error('Error searching email recipient employees:', error);
      } finally {
        if (!canceled) setTransferRecipientLoading(false);
      }
    }, 280);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [actionModal?.open, actionModal?.type, transferEmailMode, transferRecipientInput, searchOwnersCached]);

  const handleCreateTransferEmployee = useCallback(() => {
    const candidate = String(transferEmployeeInput || '').trim();
    if (!validateTransferEmployeeName(candidate)) {
      setActionError?.(INVALID_EMPLOYEE_MESSAGE);
      return false;
    }
    setNewEmployee(candidate);
    setNewEmployeeNo(null);
    setTransferEmployeeInput(candidate);
    setActionError?.('');
    return true;
  }, [setActionError, transferEmployeeInput]);

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
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const defaultDelay = attempt < 4 ? 1200 : 2500;
      await waitForPoll(options.pollDelayMs ?? defaultDelay);
      if (transferJobPollSeqRef.current !== pollSeq) return null;

      try {
        const result = await equipmentAPI.getTransferActJob(normalizedJobId);
        if (transferJobPollSeqRef.current !== pollSeq) return null;

        setTransferResult(result);
        const status = String(result?.job_status || '').toLowerCase();
        if (status === 'done' || status === 'failed') {
          setTransferJobPolling(false);
          const failedCount = Number(result?.failed_count || 0);
          if (status === 'failed') {
            setActionError?.(result?.job_error || JOB_FAILED_ERROR);
          } else if (failedCount > 0) {
            setActionError?.(`\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u043e ${result.success_count}, \u043e\u0448\u0438\u0431\u043e\u043a ${failedCount}`);
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
            await fetchAllEquipment?.({ force: true });
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
        console.error('Transfer act job polling error:', error);
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
    fetchAllEquipment,
    onTransferJobDone,
    pollingMaxAttempts,
    resetDetailHistory,
    setActionError,
    transferOperationMode,
  ]);

  const handleTransferEmailSend = useCallback(async () => {
    if (!canDatabaseWrite) {
      setTransferEmailError(NOT_ALLOWED_MESSAGE);
      return null;
    }
    if (!transferResult?.acts?.length) return null;

    const { error: payloadError, payload } = buildTransferEmailPayload({
      acts: transferResult.acts,
      mode: transferEmailMode,
      manualEmail: transferManualEmail,
      recipient: transferRecipient,
    });
    if (payloadError) {
      setTransferEmailError(payloadError);
      return null;
    }
    if (!payload) return null;

    setTransferEmailLoading(true);
    setTransferEmailError('');
    setTransferEmailStatus('');
    try {
      const result = await equipmentAPI.sendTransferActsEmail(payload);
      const successCount = Number(result?.success_count || 0);
      const failedCount = Number(result?.failed_count || 0);
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      setTransferEmailStatus(`\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e: ${successCount}, \u043e\u0448\u0438\u0431\u043e\u043a: ${failedCount}`);
      setTransferEmailError(errors.length > 0 ? errors.join('; ') : '');
      return result;
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setTransferEmailError(typeof apiDetail === 'string' ? apiDetail : EMAIL_SEND_ERROR);
      return null;
    } finally {
      setTransferEmailLoading(false);
    }
  }, [
    canDatabaseWrite,
    transferResult,
    transferEmailMode,
    transferManualEmail,
    transferRecipient,
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
      setActionError?.(response?.job_id ? '' : getTransferResultActionError(response, '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043b\u0435\u043d\u043e'));
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
      await fetchAllEquipment?.({ force: true });
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
    await fetchAllEquipment?.({ force: true });
    setActionError?.(getTransferResultActionError(response, '\u041f\u0435\u0440\u0435\u043d\u0435\u0441\u0435\u043d\u043e'));
    return response;
  }, [
    actionModal?.invNo,
    canDatabaseWrite,
    detailInvNo,
    fetchAllEquipment,
    newEmployee,
    newEmployeeNo,
    pollTransferActJob,
    resetDetailHistory,
    selectedItems,
    setActionError,
    setSelectedItems,
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

  const transferActionHandlers = useMemo(() => ({
    onModeChange: (nextMode) => {
      setTransferOperationMode(nextMode);
      setActionError?.('');
      setTransferResult(null);
      const isActOnly = nextMode === TRANSFER_OPERATION_ACT_ONLY;
      setNewEmployee(isActOnly ? ACT_ONLY_EMPLOYEE_LABEL : '');
      setNewEmployeeNo(null);
      setTransferDepartment('');
      setTransferEmployeeInput(isActOnly ? ACT_ONLY_EMPLOYEE_LABEL : '');
      setTransferEmployeeOptions([]);
    },
    onEmployeeInputChange: (nextValue) => {
      const normalizedNext = normalizeText(nextValue);
      const normalizedCurrent = normalizeText(newEmployee);
      setTransferEmployeeInput(nextValue);
      setActionError?.('');
      if (transferOperationMode === TRANSFER_OPERATION_ACT_ONLY) {
        setNewEmployee(nextValue);
        setNewEmployeeNo(null);
        setTransferDepartment('');
      } else if (newEmployeeNo || (newEmployee && normalizedNext !== normalizedCurrent)) {
        setNewEmployee('');
        setNewEmployeeNo(null);
        setTransferDepartment('');
      }
    },
    onEmployeeChange: (value) => {
      const option = toOwnerOption(value);
      if (!option?.owner_no) {
        setNewEmployee('');
        setNewEmployeeNo(null);
        setTransferDepartment('');
        setTransferEmployeeInput('');
        setActionError?.('');
        return;
      }
      setNewEmployee(option.owner_display_name || '');
      setNewEmployeeNo(option.owner_no);
      setTransferDepartment(option.owner_dept || '');
      setTransferEmployeeInput(option.owner_display_name || '');
      setActionError?.('');
    },
    onCreateEmployee: handleCreateTransferEmployee,
    onDepartmentChange: (value) => {
      setTransferDepartment(String(value || '').trim());
      setActionError?.('');
    },
    onBranchChange: (value) => {
      const nextBranchNo = toIdOrNull(value);
      setTransferBranchNo(nextBranchNo);
      setTransferLocationNo(null);
      setTransferLocations([]);
      setActionError?.('');
    },
    onLocationChange: (locNo) => {
      setTransferLocationNo(toIdOrNull(locNo));
      setActionError?.('');
    },
    onRefreshJob: (jobId, options) => {
      void pollTransferActJob(jobId, options);
    },
    onOpenReminderTask: (taskId) => {
      navigate?.(`/tasks?task=${encodeURIComponent(taskId)}`);
    },
    onOpenUploadReminder: (payload) => {
      void openUploadActModalForReminder?.(payload);
    },
    onDownloadAct: handleTransferActDownload,
    onEmailModeChange: setTransferEmailMode,
    onManualEmailChange: setTransferManualEmail,
    onRecipientInputChange: setTransferRecipientInput,
    onRecipientChange: setTransferRecipient,
    onSendEmail: handleTransferEmailSend,
    onRetryFailed: handleRetryFailed,
  }), [
    handleCreateTransferEmployee,
    handleTransferActDownload,
    handleTransferEmailSend,
    handleRetryFailed,
    navigate,
    newEmployee,
    newEmployeeNo,
    openUploadActModalForReminder,
    pollTransferActJob,
    setActionError,
    transferOperationMode,
  ]);

  const transfer = useMemo(() => ({
    mode: transferOperationMode,
    result: transferResult,
    jobPolling: transferJobPolling,
    retrySubmitting: transferRetrySubmitting,
    employeeInput: transferEmployeeInput,
    employeeInputTrimmed: transferEmployeeInputState.inputTrimmed,
    employeeOptions: transferEmployeeInputState.autocompleteOptions,
    employeeLoading: transferEmployeeLoading,
    selectedEmployeeOption: selectedTransferEmployeeOption,
    usesManualEmployee: transferEmployeeInputState.usesManualEmployee,
    newEmployee,
    department: transferDepartment,
    departmentOptions: transferDepartmentOptions,
    departmentLoading: transferDepartmentLoading,
    branchNo: transferBranchNo,
    locationNo: transferLocationNo,
    locationsLoading: transferLocationsLoading,
  }), [
    newEmployee,
    selectedTransferEmployeeOption,
    transferBranchNo,
    transferDepartment,
    transferDepartmentLoading,
    transferDepartmentOptions,
    transferEmployeeInput,
    transferEmployeeInputState,
    transferEmployeeLoading,
    transferJobPolling,
    transferRetrySubmitting,
    transferLocationNo,
    transferLocationsLoading,
    transferOperationMode,
    transferResult,
  ]);

  const email = useMemo(() => ({
    mode: transferEmailMode,
    manualEmail: transferManualEmail,
    recipientInput: transferRecipientInput,
    recipientOptions: transferRecipientOptions,
    recipient: transferRecipient,
    recipientLoading: transferRecipientLoading,
    loading: transferEmailLoading,
    status: transferEmailStatus,
    error: transferEmailError,
  }), [
    transferEmailError,
    transferEmailLoading,
    transferEmailMode,
    transferEmailStatus,
    transferManualEmail,
    transferRecipient,
    transferRecipientInput,
    transferRecipientLoading,
    transferRecipientOptions,
  ]);

  return {
    transferOperationMode,
    setTransferOperationMode,
    newEmployee,
    setNewEmployee,
    newEmployeeNo,
    setNewEmployeeNo,
    transferDepartment,
    setTransferDepartment,
    transferDepartmentOptions,
    transferDepartmentLoading,
    transferBranchNo,
    setTransferBranchNo,
    transferLocationNo,
    setTransferLocationNo,
    transferLocations,
    transferLocationOptions,
    transferLocationsLoading,
    transferEmployeeInput,
    setTransferEmployeeInput,
    transferEmployeeOptions,
    transferEmployeeAutocompleteOptions: transferEmployeeInputState.autocompleteOptions,
    transferEmployeeInputTrimmed: transferEmployeeInputState.inputTrimmed,
    transferEmployeeLoading,
    selectedTransferEmployeeOption,
    transferUsesManualEmployee: transferEmployeeInputState.usesManualEmployee,
    transferResult,
    setTransferResult,
    transferJobPolling,
    transferRetrySubmitting,
    transferEmailMode,
    setTransferEmailMode,
    transferManualEmail,
    setTransferManualEmail,
    transferRecipientInput,
    setTransferRecipientInput,
    transferRecipientOptions,
    transferRecipient,
    setTransferRecipient,
    transferRecipientLoading,
    transferEmailLoading,
    transferEmailStatus,
    transferEmailError,
    transferSourceDefaults,
    resetTransferState,
    handleCreateTransferEmployee,
    handleTransferActDownload,
    pollTransferActJob,
    handleTransferEmailSend,
    handleTransferActionSubmit,
    handleRetryFailed,
    transferActionHandlers,
    transfer,
    email,
    transferContentProps: {
      locationOptions: transferLocationOptions,
      sourceDefaults: transferSourceDefaults,
      transfer,
      email,
      actions: transferActionHandlers,
    },
  };
}

export default useDatabaseTransferAction;
