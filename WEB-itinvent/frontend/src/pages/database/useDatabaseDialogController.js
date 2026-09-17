import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import jsonAPI from '../../api/json_client';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  getItemCapabilityFlags,
  mergeCurrentActsIntoGrouped,
  toInvNo,
  upsertItemInGrouped,
} from './equipmentModel';
import { normalizeDbId } from './databaseRecordModel';
import { normalizeActionTargets } from './databaseListModel';
import { executeMaintenanceAction, getActionErrorMessage } from './actionExecution';
import { useDatabaseAddWorkflows } from './useDatabaseAddWorkflows';
import { useDatabaseConsumableQty } from './useDatabaseConsumableQty';
import { useDatabaseDeleteEquipment } from './useDatabaseDeleteEquipment';
import { useDatabaseConsumableDelete } from './useDatabaseConsumableDelete';
import { useDatabaseDetailRuntime } from './useDatabaseDetailRuntime';
import { useDatabaseQrScanner } from './useDatabaseQrScanner';
import useEquipmentQrBatchPrint from './useEquipmentQrBatchPrint';
import { useDatabaseTransferAction } from './useDatabaseTransferAction';
import { useDatabaseUploadActWorkflow } from './useDatabaseUploadActWorkflow';
import { useDatabaseMaintenanceData } from './useDatabaseMaintenanceData';
import {
  resolveSingleActionTarget as resolveActionTarget,
} from './actionModel';

// Dialog-scope controller: upload-act workflow, equipment detail runtime,
// add/edit/delete dialogs, QR scanner/batch print, transfer + maintenance
// action modal and the action confirm pipeline. Consumed by the page composer.
export function useDatabaseDialogController({
  canDatabaseWrite,
  canDatabaseDelete,
  isAdmin,
  dbName,
  currentDb,
  location,
  navigate,
  searchOwnersCached,
  getOwnerDepartmentsCached,
  getLocationsCached,
  getModelsCached,
  getUploadActEmailStatusItemSx,
  notifyDatabaseSuccess,
  notifyDatabaseInfo,
  notifyDatabaseWarning,
  notifyDatabaseError,
  dataMode,
  selectedBranch,
  selectedItems,
  setSelectedItems,
  setFilteredData,
  setAllEquipment,
  setLoadedCount,
  setServerTotal,
  setTotal,
  fetchAllEquipment,
  notifyDataVersion,
  findEquipmentByInvNo,
  getItemBranch,
  branchOptions,
  statusOptions,
  allEquipment,
  tableSort,
  isConsumablesMode,
  handleClearSelection,
  touchRecentCard,
  removeRecentCard,
  refreshRecentCards,
  refreshRecentActs,
  handleDetailRecentActivity,
  handleTransferJobDone,
}) {
  const [actionModal, setActionModal] = useState({ open: false, type: null, invNo: null, componentKind: null });

  // Action form state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [componentType, setComponentType] = useState(PRINTER_COMPONENT_OPTIONS[0].value);

  const uploadAct = useDatabaseUploadActWorkflow({
    canDatabaseWrite,
    dbName,
    location,
    navigate,
    searchOwnersCached,
    notifyDatabaseSuccess,
    notifyDatabaseInfo,
    notifyDatabaseWarning,
    getEmailStatusItemSx: getUploadActEmailStatusItemSx,
  });
  const { uploadActCommitResult, openUploadActModalForReminder } = uploadAct;

  const refreshedCurrentActDocNoRef = useRef('');

  useEffect(() => {
    const docNo = String(uploadActCommitResult?.doc_no || '').trim();
    if (!docNo || refreshedCurrentActDocNoRef.current === docNo) return;
    refreshedCurrentActDocNoRef.current = docNo;
    // Point refresh: re-fetch only the linked rows and refresh their act badges
    // instead of a full equipment reload.
    const invNos = (uploadActCommitResult?.linked_inv_nos || [])
      .map((v) => String(v || '').trim()).filter(Boolean);
    const itemIds = (uploadActCommitResult?.linked_item_ids || [])
      .map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (!invNos.length && !itemIds.length) {
      // No linked targets in the response — nothing to patch, reload fully.
      void fetchAllEquipment({ force: true, mode: DATA_MODE_EQUIPMENT });
      return;
    }
    void (async () => {
      try {
        if (invNos.length) {
          const fresh = await equipmentAPI.getByInvNos(invNos);
          notifyDataVersion(fresh?.data_version);
          const items = Array.isArray(fresh?.equipment) ? fresh.equipment : [];
          if (items.length) {
            const upsertAll = (prev) => items.reduce(upsertItemInGrouped, prev);
            setAllEquipment(upsertAll);
            setFilteredData((prev) => (prev == null ? prev : upsertAll(prev)));
          }
        }
        if (itemIds.length && typeof equipmentAPI.getCurrentActs === 'function') {
          const acts = await equipmentAPI.getCurrentActs(itemIds);
          const actsByItemId = {};
          (acts?.items || []).forEach((entry) => {
            if (entry && entry.item_id != null) actsByItemId[entry.item_id] = entry;
          });
          if (Object.keys(actsByItemId).length) {
            const merge = (prev) => mergeCurrentActsIntoGrouped(prev, actsByItemId);
            setAllEquipment((prev) => merge(prev));
            setFilteredData((prev) => (prev == null ? prev : merge(prev)));
          }
        }
      } catch {
        // Point refresh failed — fall back to a full reload once.
        void fetchAllEquipment({ force: true, mode: DATA_MODE_EQUIPMENT });
      }
    })();
  }, [fetchAllEquipment, notifyDataVersion, uploadActCommitResult?.doc_no]);

  const detail = useDatabaseDetailRuntime({
    canDatabaseWrite,
    databaseId: dbName || currentDb?.id || '',
    findEquipmentByInvNo,
    searchOwnersCached,
    getLocationsCached,
    getModelsCached,
    setAllEquipment,
    onRecentActivity: handleDetailRecentActivity,
  });
  const {
    detailModal,
    loadDetailedItemsByInvNos,
    openDetailView,
    handleQrEquipmentFound,
    handleDetailClose,
    setDetailHistory,
    setDetailHistoryLoadedInvNo,
  } = detail;

  useEffect(() => {
    if (isConsumablesMode || !uploadActCommitResult?.doc_no) return;
    void refreshRecentCards();
    void refreshRecentActs();
  }, [isConsumablesMode, refreshRecentActs, refreshRecentCards, uploadActCommitResult?.doc_no]);

  const resetDetailHistory = useCallback(() => {
    setDetailHistory([]);
    setDetailHistoryLoadedInvNo('');
  }, [setDetailHistory, setDetailHistoryLoadedInvNo]);

  const transfer = useDatabaseTransferAction({
    actionModal,
    canDatabaseWrite,
    selectedItems,
    branchOptions,
    findEquipmentByInvNo,
    searchOwnersCached,
    getOwnerDepartmentsCached,
    getLocationsCached,
    fetchAllEquipment,
    setAllEquipment,
    setFilteredData,
    setActionError,
    setSelectedItems,
    detailInvNo: detailModal?.invNo,
    resetDetailHistory,
    navigate,
    openUploadActModalForReminder,
    onTransferJobDone: handleTransferJobDone,
    onDataVersion: notifyDataVersion,
  });
  const { resetTransferState, setTransferOperationMode, setNewEmployee, setTransferEmployeeInput, handleTransferActionSubmit } = transfer;

  const addWorkflows = useDatabaseAddWorkflows({
    canDatabaseWrite,
    selectedBranch,
    branchOptions,
    statusOptions,
    searchOwnersCached,
    getLocationsCached,
    getModelsCached,
    fetchAllEquipment,
    setAllEquipment,
    setFilteredData,
    notifyDatabaseSuccess,
  });

  const consumableQty = useDatabaseConsumableQty({
    canDatabaseWrite,
    fetchAllEquipment,
    setAllEquipment,
    setFilteredData,
    notifyDatabaseSuccess,
  });

  const consumableDelete = useDatabaseConsumableDelete({
    canDatabaseDelete,
    fetchAllEquipment,
    setAllEquipment,
    setFilteredData,
    setSelectedItems,
    setLoadedCount,
    setServerTotal,
    setTotal,
    notifyDatabaseSuccess,
  });

  const qrScanner = useDatabaseQrScanner({
    onEquipmentFound: handleQrEquipmentFound,
    notifyDatabaseError,
  });

  const deleteEquipment = useDatabaseDeleteEquipment({
    isAdmin,
    setAllEquipment,
    setFilteredData,
    setSelectedItems,
    setLoadedCount,
    setServerTotal,
    setTotal,
    detailInvNo: detailModal?.invNo,
    onDetailDeleted: handleDetailClose,
    onEquipmentDeleted: removeRecentCard,
    notifyDatabaseSuccess,
  });
  const { openDeleteEquipmentDialog } = deleteEquipment;

  const resolveSingleActionTarget = useCallback(() => {
    return resolveActionTarget({
      selectedItems,
      fallbackInvNo: actionModal.invNo,
      findEquipmentByInvNo,
    });
  }, [actionModal.invNo, findEquipmentByInvNo, selectedItems]);

  const maintenance = useDatabaseMaintenanceData({
    actionModal,
    resolveSingleActionTarget,
    componentType,
  });
  const { selectedWorkConsumable, cartridgeModel, resetMaintenanceData } = maintenance;

  const closeActionModal = useCallback(({ clearSelection = false } = {}) => {
    setActionModal({ open: false, type: null, invNo: null, componentKind: null });
    if (clearSelection) {
      setSelectedItems([]);
    }
    setActionError('');
    resetTransferState();
    resetMaintenanceData();
    setComponentType(PRINTER_COMPONENT_OPTIONS[0].value);
  }, [resetMaintenanceData, resetTransferState, setSelectedItems]);

  const handleAction = useCallback((actionType, itemOrInvNo) => {
    if (dataMode === DATA_MODE_CONSUMABLES) return;
    if (actionType !== 'view' && !canDatabaseWrite) return;
    if (actionType === 'delete' && !isAdmin) return;
    const invNo = toInvNo(itemOrInvNo);
    if (actionType === 'view') {
      const item = (itemOrInvNo && typeof itemOrInvNo === 'object') ? itemOrInvNo : findEquipmentByInvNo(invNo);
      void touchRecentCard({ invNo, actionType: 'view', snapshot: item });
      openDetailView(item || invNo, { invNo, loading: !item });
    } else if (actionType === 'delete') {
      const item = (itemOrInvNo && typeof itemOrInvNo === 'object') ? itemOrInvNo : findEquipmentByInvNo(invNo);
      openDeleteEquipmentDialog({ invNo, item });
    } else {
      if (actionType === 'transfer' || actionType === 'location_transfer') {
        resetTransferState();
        if (actionType === 'location_transfer') {
          setTransferOperationMode(TRANSFER_OPERATION_LOCATION_ONLY);
        }
      }
      const item = findEquipmentByInvNo(invNo);
      const flags = getItemCapabilityFlags(item);
      const componentKind =
        actionType === 'component'
          ? (flags.isPc && !flags.isPrinterOrMfu ? 'pc' : 'printer')
          : null;
      if (actionType === 'component') {
        setComponentType(componentKind === 'pc' ? PC_COMPONENT_OPTIONS[0].value : PRINTER_COMPONENT_OPTIONS[0].value);
      }
      setActionModal({
        open: true,
        type: actionType === 'location_transfer' ? 'transfer' : actionType,
        invNo,
        componentKind,
      });
    }
  }, [
    canDatabaseWrite,
    dataMode,
    findEquipmentByInvNo,
    isAdmin,
    openDeleteEquipmentDialog,
    openDetailView,
    resetTransferState,
    setTransferOperationMode,
    touchRecentCard,
  ]);

  const handleActionConfirm = useCallback(async () => {
    if (!canDatabaseWrite) {
      setActionError('Not enough permissions to change database records.');
      return;
    }
    try {
      setActionLoading(true);
      setActionError('');
      const effectiveDbName = normalizeDbId(dbName || localStorage.getItem('selected_database'));
      const targetInvNos = normalizeActionTargets(selectedItems, actionModal.invNo);

      if (actionModal.type === 'transfer') {
        const transferResponse = await handleTransferActionSubmit({ targetInvNos });
        if (Number(transferResponse?.success_count || 0) > 0 && !transferResponse?.job_id) {
          await refreshRecentCards();
        }
        return;
      }

      const maintenanceResult = await executeMaintenanceAction({
        actionType: actionModal.type,
        selectedItems,
        fallbackInvNo: actionModal.invNo,
        selectedWorkConsumable,
        cartridgeModel,
        componentType,
        effectiveDbName,
        findEquipmentByInvNo,
        loadDetailedItemsByInvNos,
        getItemBranch,
        equipmentAPI,
        jsonAPI,
      });

      if (maintenanceResult?.error) {
        setActionError(maintenanceResult.error);
        return;
      }

      if (maintenanceResult?.shouldRefreshEquipment) {
        await fetchAllEquipment({ force: true });
      }

      await refreshRecentCards();
      closeActionModal({ clearSelection: true });
    } catch (error) {
      console.error('Action error:', error);
      console.error('Error response:', error.response?.data);
      setActionError(getActionErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }, [
    actionModal.invNo,
    actionModal.type,
    canDatabaseWrite,
    cartridgeModel,
    closeActionModal,
    componentType,
    dbName,
    fetchAllEquipment,
    findEquipmentByInvNo,
    getItemBranch,
    handleTransferActionSubmit,
    loadDetailedItemsByInvNos,
    refreshRecentCards,
    selectedItems,
    selectedWorkConsumable,
  ]);

  const qrBatchPrint = useEquipmentQrBatchPrint({
    groupedEquipment: allEquipment,
    selectedItems,
    tableSort,
    databaseId: dbName || currentDb?.id || '',
    onClearSelection: handleClearSelection,
  });

  const handleOpenLocationTransferForSelection = useCallback(() => {
    resetTransferState();
    setTransferOperationMode(TRANSFER_OPERATION_LOCATION_ONLY);
    setActionModal({ open: true, type: 'transfer', invNo: null, componentKind: null });
  }, [resetTransferState, setTransferOperationMode]);

  const handleOpenTransferForSelection = useCallback(() => {
    resetTransferState();
    setActionModal({ open: true, type: 'transfer', invNo: null, componentKind: null });
  }, [resetTransferState]);

  const handleOpenTransferActForSelection = useCallback(() => {
    resetTransferState();
    setTransferOperationMode(TRANSFER_OPERATION_ACT_ONLY);
    setNewEmployee('Без владельца');
    setTransferEmployeeInput('Без владельца');
    setActionModal({ open: true, type: 'transfer', invNo: null, componentKind: null });
  }, [resetTransferState, setNewEmployee, setTransferEmployeeInput, setTransferOperationMode]);

  const handleOpenCartridgeForSelection = useCallback(() => {
    setActionModal({ open: true, type: 'cartridge', invNo: null, componentKind: null });
  }, []);

  const handleOpenBatteryForSelection = useCallback(() => {
    setActionModal({ open: true, type: 'battery', invNo: null, componentKind: null });
  }, []);

  const handleOpenComponentForSelection = useCallback(({ componentKind, componentType: nextComponentType }) => {
    setComponentType(nextComponentType);
    setActionModal({ open: true, type: 'component', invNo: null, componentKind });
  }, []);

  return {
    ...uploadAct,
    ...detail,
    ...transfer,
    ...addWorkflows,
    ...consumableQty,
    ...consumableDelete,
    ...qrScanner,
    ...deleteEquipment,
    ...maintenance,
    qrBatchPrint,
    actionModal,
    actionLoading,
    actionError,
    componentType,
    setComponentType,
    closeActionModal,
    handleAction,
    handleActionConfirm,
    handleOpenLocationTransferForSelection,
    handleOpenTransferForSelection,
    handleOpenTransferActForSelection,
    handleOpenCartridgeForSelection,
    handleOpenBatteryForSelection,
    handleOpenComponentForSelection,
    openDetailView,
    handleDetailClose,
  };
}
