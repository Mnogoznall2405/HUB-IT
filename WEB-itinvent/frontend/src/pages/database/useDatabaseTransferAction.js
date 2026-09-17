import { useCallback, useMemo, useState } from 'react';

import { normalizeText, toIdOrNull } from './databaseRecordModel';
import { toOwnerOption } from './detailModel';
import { TRANSFER_OPERATION_ACT_ONLY } from './equipmentModel';
import { ACT_ONLY_EMPLOYEE_LABEL, useTransferFormState } from './useTransferFormState';
import { useTransferActJob } from './useTransferActJob';
import { useTransferEmail } from './useTransferEmail';

// Transfer dialog composer: wires the form-state, act-job and e-mail hooks and
// exposes the historical flat contract consumed by DatabaseDialogsLayer.
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
  setAllEquipment,
  setFilteredData,
  setActionError,
  setSelectedItems,
  detailInvNo = '',
  resetDetailHistory,
  navigate,
  openUploadActModalForReminder,
  onTransferJobDone,
  onDataVersion,
  pollingMaxAttempts = 240,
} = {}) {
  const [transferResult, setTransferResult] = useState(null);

  const form = useTransferFormState({
    actionModal,
    selectedItems,
    branchOptions,
    findEquipmentByInvNo,
    searchOwnersCached,
    getOwnerDepartmentsCached,
    getLocationsCached,
    setActionError,
    transferResult,
  });

  const emailHook = useTransferEmail({
    actionModal,
    canDatabaseWrite,
    transferResult,
    searchOwnersCached,
  });

  const job = useTransferActJob({
    actionModal,
    canDatabaseWrite,
    selectedItems,
    transferOperationMode: form.transferOperationMode,
    newEmployee: form.newEmployee,
    newEmployeeNo: form.newEmployeeNo,
    transferDepartment: form.transferDepartment,
    transferBranchNo: form.transferBranchNo,
    transferLocationNo: form.transferLocationNo,
    transferEmployeeInput: form.transferEmployeeInput,
    transferResult,
    setTransferResult,
    findEquipmentByInvNo,
    fetchAllEquipment,
    setAllEquipment,
    setFilteredData,
    setActionError,
    setSelectedItems,
    setTransferEmailStatus: emailHook.setTransferEmailStatus,
    setTransferEmailError: emailHook.setTransferEmailError,
    detailInvNo,
    resetDetailHistory,
    onTransferJobDone,
    onDataVersion,
    pollingMaxAttempts,
  });

  const {
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
    setTransferEmployeeOptions,
    transferEmployeeAutocompleteOptions,
    transferEmployeeInputTrimmed,
    transferEmployeeLoading,
    selectedTransferEmployeeOption,
    transferUsesManualEmployee,
    transferSourceDefaults,
    resetTransferFields,
    handleCreateTransferEmployee,
  } = form;
  const { setTransferLocations } = form;

  const {
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
    resetTransferEmail,
    handleTransferEmailSend,
  } = emailHook;

  const {
    transferJobPolling,
    transferRetrySubmitting,
    resetTransferJob,
    handleTransferActDownload,
    pollTransferActJob,
    handleTransferActionSubmit,
    handleRetryFailed,
  } = job;

  const resetTransferState = useCallback(() => {
    resetTransferJob();
    resetTransferFields();
    resetTransferEmail();
  }, [resetTransferJob, resetTransferFields, resetTransferEmail]);

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
    setNewEmployee,
    setNewEmployeeNo,
    setTransferBranchNo,
    setTransferDepartment,
    setTransferEmailMode,
    setTransferEmployeeInput,
    setTransferEmployeeOptions,
    setTransferLocationNo,
    setTransferLocations,
    setTransferManualEmail,
    setTransferOperationMode,
    setTransferRecipient,
    setTransferRecipientInput,
    transferOperationMode,
  ]);

  const transfer = useMemo(() => ({
    mode: transferOperationMode,
    result: transferResult,
    jobPolling: transferJobPolling,
    retrySubmitting: transferRetrySubmitting,
    employeeInput: transferEmployeeInput,
    employeeInputTrimmed: transferEmployeeInputTrimmed,
    employeeOptions: transferEmployeeAutocompleteOptions,
    employeeLoading: transferEmployeeLoading,
    selectedEmployeeOption: selectedTransferEmployeeOption,
    usesManualEmployee: transferUsesManualEmployee,
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
    transferEmployeeAutocompleteOptions,
    transferEmployeeInput,
    transferEmployeeInputTrimmed,
    transferEmployeeLoading,
    transferJobPolling,
    transferRetrySubmitting,
    transferLocationNo,
    transferLocationsLoading,
    transferOperationMode,
    transferResult,
    transferUsesManualEmployee,
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
    transferEmployeeAutocompleteOptions,
    transferEmployeeInputTrimmed,
    transferEmployeeLoading,
    selectedTransferEmployeeOption,
    transferUsesManualEmployee,
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
