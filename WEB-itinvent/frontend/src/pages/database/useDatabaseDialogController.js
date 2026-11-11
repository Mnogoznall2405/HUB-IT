import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { isCartridgeLikeConsumable } from './consumableModel';
import { normalizeActionTargets } from './databaseListModel';
import { createMaintenanceOperationSeed, executeMaintenanceAction, getActionErrorMessage } from './actionExecution';
import { useDatabaseAddWorkflows } from './useDatabaseAddWorkflows';
import { useDatabaseConsumableQty } from './useDatabaseConsumableQty';
import { useConsumableCard } from './useConsumableCard';
import { useConsumableQrLabel } from './useConsumableQrLabel';
import { useDatabaseDeleteEquipment } from './useDatabaseDeleteEquipment';
import { useDatabaseConsumableDelete } from './useDatabaseConsumableDelete';
import { useDatabaseDetailRuntime } from './useDatabaseDetailRuntime';
import {
  buildConsumableLookupErrorMessage,
  buildQrLookupErrorMessage,
  useDatabaseQrScanner,
} from './useDatabaseQrScanner';
import useEquipmentQrBatchPrint from './useEquipmentQrBatchPrint';
import { useDatabaseTransferAction } from './useDatabaseTransferAction';
import { useDatabaseUploadActWorkflow } from './useDatabaseUploadActWorkflow';
import { useDatabaseMaintenanceData } from './useDatabaseMaintenanceData';
import {
  resolveSingleActionTarget as resolveActionTarget,
} from './actionModel';

const QR_PHOTO_MODE_STORAGE_KEY = 'database_qr_photo_mode';

// Dialog-scope controller: upload-act workflow, equipment detail runtime,
// add/edit/delete dialogs, QR scanner/batch print, transfer + maintenance
// action modal and the action confirm pipeline. Consumed by the page composer.
export function useDatabaseDialogController({
  canDatabaseWrite,
  canDatabaseDelete,
  canDeleteEquipment,
  canDeleteEquipmentWithHistory,
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
  photoWorklist = [],
}) {
  const [actionModal, setActionModal] = useState({ open: false, type: null, invNo: null, componentKind: null });
  // Стабильный seed operation_id на сессию диалога — повторная отправка после
  // сбоя возобновляет ту же durable-операцию, а не списывает расходник снова.
  const maintenanceOperationSeedRef = useRef('');

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
    setFilteredData,
    onRecentActivity: handleDetailRecentActivity,
    onDataVersion: notifyDataVersion,
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

  const consumableCard = useConsumableCard({
    canDatabaseWrite,
    location,
    dbName,
    currentDb,
    setAllEquipment,
    setFilteredData,
    notifyDatabaseSuccess,
    notifyDatabaseError,
    openEditConsumableQtyModal: consumableQty.openEditConsumableQtyModal,
  });

  const consumableQr = useConsumableQrLabel({
    databaseId: dbName || currentDb?.id || '',
  });

  const [cartridgeCompatOpen, setCartridgeCompatOpen] = useState(false);
  const openCartridgeCompatibilityDialog = useCallback(() => setCartridgeCompatOpen(true), []);
  const closeCartridgeCompatibilityDialog = useCallback(() => setCartridgeCompatOpen(false), []);

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

  // Пара «расходник ↔ МФУ»: сканер в pair-режиме не закрывается после первого
  // кода — onPayload заполняет слоты, после второго открывается карточка
  // расходника с уже выбранной МФУ.
  const [qrPairMode, setQrPairMode] = useState(false);
  const [qrPair, setQrPair] = useState({ consumable: null, printer: null, busy: false });
  const pairPayloadRef = useRef(null);
  // Ref-зеркала: lookup длится дольше кадра, и за это время режим могли
  // отменить — post-await решения читаем актуальное состояние, не замыкание.
  const qrPairModeRef = useRef(false);
  const qrPairRef = useRef(qrPair);
  const setQrPairTracked = useCallback((next) => {
    qrPairRef.current = typeof next === 'function' ? next(qrPairRef.current) : next;
    setQrPair(qrPairRef.current);
  }, []);

  // Режим «скан → фото»: после распознавания QR карточка сразу открывается на
  // вкладке фото, чтобы снимок делался одним тапом. Запоминается на устройстве.
  const [qrPhotoMode, setQrPhotoModeState] = useState(() => {
    try {
      return localStorage.getItem(QR_PHOTO_MODE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const qrPhotoModeRef = useRef(qrPhotoMode);
  qrPhotoModeRef.current = qrPhotoMode;
  const setQrPhotoMode = useCallback((enabled) => {
    const next = Boolean(enabled);
    qrPhotoModeRef.current = next;
    setQrPhotoModeState(next);
    try {
      localStorage.setItem(QR_PHOTO_MODE_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Режим просто не переживёт перезагрузку.
    }
  }, []);

  const handleQrEquipmentFoundForMode = useCallback((found, invNo) => {
    if (qrPhotoModeRef.current && canDatabaseWrite) {
      openDetailView(found || invNo, { invNo, loading: false, initialTab: 'photos' });
      return;
    }
    handleQrEquipmentFound(found, invNo);
  }, [canDatabaseWrite, handleQrEquipmentFound, openDetailView]);

  const qrScanner = useDatabaseQrScanner({
    continuous: qrPairMode,
    onPayload: (payload) => pairPayloadRef.current?.(payload),
    onEquipmentFound: handleQrEquipmentFoundForMode,
    onConsumableFound: consumableCard.openConsumableCard,
    notifyDatabaseError,
  });

  const qrPairReset = useCallback(() => {
    qrPairModeRef.current = false;
    qrPairRef.current = { consumable: null, printer: null, busy: false };
    setQrPairMode(false);
    setQrPair(qrPairRef.current);
  }, []);

  const completeQrPair = useCallback((consumable, printer) => {
    qrScanner.closeQrScanner();
    qrPairReset();
    consumableCard.completeConsumablePair(consumable, printer);
  }, [consumableCard.completeConsumablePair, qrPairReset, qrScanner]);

  // Завершение — эффектом по факту двух слотов, а не внутри handlePairPayload:
  // в замыкании второго запроса слот первого мог бы остаться невидимым.
  useEffect(() => {
    if (!qrPairMode || !qrPair.consumable || !qrPair.printer) return;
    completeQrPair(qrPair.consumable, qrPair.printer);
  }, [completeQrPair, qrPair, qrPairMode]);

  const handlePairPayload = useCallback(async (payload) => {
    if (!qrPairModeRef.current) return;
    const current = qrPairRef.current;
    if (payload.kind === 'consumable') {
      if (current.consumable) {
        notifyDatabaseInfo?.('Расходник уже выбран — сканируйте QR МФУ.');
        return;
      }
      setQrPairTracked((prev) => ({ ...prev, busy: true }));
      try {
        const item = await equipmentAPI.getConsumableById(payload.itemId);
        // Пока шёл запрос, режим могли отменить — не воскрешаем пару.
        if (!qrPairModeRef.current) return;
        if (!item) throw new Error('not_found');
        if (!isCartridgeLikeConsumable(item)) {
          setQrPairTracked((prev) => ({ ...prev, busy: false }));
          const label = String(item?.MODEL_NAME || item?.model_name || item?.TYPE_NAME || item?.type_name || 'Позиция').trim();
          notifyDatabaseInfo?.(`«${label}» списывается без привязки к МФУ — сканируйте QR картриджа.`);
          return;
        }
        const printerReady = Boolean(qrPairRef.current.printer);
        setQrPairTracked((prev) => ({ ...prev, consumable: item, busy: false }));
        if (!printerReady) notifyDatabaseInfo?.('Расходник выбран — теперь сканируйте QR МФУ.');
      } catch (error) {
        if (!qrPairModeRef.current) return;
        setQrPairTracked((prev) => ({ ...prev, busy: false }));
        notifyDatabaseError?.(buildConsumableLookupErrorMessage(error, payload.itemId));
      }
      return;
    }
    if (current.printer) {
      notifyDatabaseInfo?.('МФУ уже выбрана — сканируйте QR расходника.');
      return;
    }
    setQrPairTracked((prev) => ({ ...prev, busy: true }));
    try {
      const row = await equipmentAPI.getByInvNo(payload.invNo);
      if (!qrPairModeRef.current) return;
      if (!row) throw new Error('not_found');
      if (!getItemCapabilityFlags(row).isPrinterOrMfu) {
        setQrPairTracked((prev) => ({ ...prev, busy: false }));
        const model = String(row?.MODEL_NAME || row?.model_name || payload.invNo).trim();
        notifyDatabaseError?.(`«${model}» — не МФУ/принтер. Сканируйте QR целевой МФУ.`);
        return;
      }
      const consumableReady = Boolean(qrPairRef.current.consumable);
      setQrPairTracked((prev) => ({ ...prev, printer: row, busy: false }));
      if (!consumableReady) notifyDatabaseInfo?.('МФУ выбрана — теперь сканируйте QR расходника.');
    } catch (error) {
      if (!qrPairModeRef.current) return;
      setQrPairTracked((prev) => ({ ...prev, busy: false }));
      notifyDatabaseError?.(buildQrLookupErrorMessage(error, payload.invNo));
    }
  }, [notifyDatabaseError, notifyDatabaseInfo, setQrPairTracked]);

  pairPayloadRef.current = handlePairPayload;

  const startQrPairScan = useCallback(({ consumable = null, printer = null } = {}) => {
    qrPairModeRef.current = true;
    qrPairRef.current = { consumable, printer, busy: false };
    setQrPair(qrPairRef.current);
    setQrPairMode(true);
    qrScanner.openQrScanner();
  }, [qrScanner]);

  const startQrPairForConsumableCard = useCallback(() => {
    startQrPairScan({ consumable: consumableCard.consumableCardModal?.item || null });
  }, [consumableCard.consumableCardModal?.item, startQrPairScan]);

  const consumeConsumableQrForDetail = useCallback(() => {
    const row = detailModal?.data;
    if (!row || !getItemCapabilityFlags(row).isPrinterOrMfu) return;
    startQrPairScan({ printer: row });
  }, [detailModal?.data, startQrPairScan]);

  const handleQrScannerOpenWithPairReset = useCallback(() => {
    qrPairReset();
    qrScanner.openQrScanner();
  }, [qrPairReset, qrScanner]);

  const handleQrScannerCloseWithPairReset = useCallback(() => {
    qrPairReset();
    qrScanner.closeQrScanner();
  }, [qrPairReset, qrScanner]);

  // Из вкладки фото: закрыть карточку и сразу сканировать следующую технику.
  const scanNextForPhoto = useCallback(() => {
    handleDetailClose();
    handleQrScannerOpenWithPairReset();
  }, [handleDetailClose, handleQrScannerOpenWithPairReset]);

  // Очередь «Следующая без фото». Пропущенные в этой сессии карточки запоминаем,
  // иначе «следующая» вернула бы только что оставленную технику.
  const photoQueueVisitedRef = useRef(new Set());
  const photoQueueCurrentInvNo = detailModal?.open ? String(detailModal?.invNo || '') : '';
  useEffect(() => {
    if (!photoQueueCurrentInvNo) photoQueueVisitedRef.current = new Set();
  }, [photoQueueCurrentInvNo]);
  const [photoQueueVisitedVersion, setPhotoQueueVisitedVersion] = useState(0);
  const photoQueueCandidates = useMemo(() => {
    void photoQueueVisitedVersion;
    return (photoWorklist || []).filter((item) => {
      const invNo = toInvNo(item);
      return invNo && invNo !== photoQueueCurrentInvNo && !photoQueueVisitedRef.current.has(invNo);
    });
  }, [photoQueueCurrentInvNo, photoQueueVisitedVersion, photoWorklist]);
  const openNextWithoutPhoto = useCallback(() => {
    const next = photoQueueCandidates[0];
    if (!next) return;
    if (photoQueueCurrentInvNo) photoQueueVisitedRef.current.add(photoQueueCurrentInvNo);
    setPhotoQueueVisitedVersion((value) => value + 1);
    const invNo = toInvNo(next);
    openDetailView(next, { invNo, loading: false, initialTab: 'photos' });
  }, [openDetailView, photoQueueCandidates, photoQueueCurrentInvNo]);
  const photoQueue = useMemo(() => (
    isConsumablesMode ? null : { remaining: photoQueueCandidates.length, onNext: openNextWithoutPhoto }
  ), [isConsumablesMode, openNextWithoutPhoto, photoQueueCandidates.length]);

  const deleteEquipment = useDatabaseDeleteEquipment({
    canDeleteEquipment,
    canDeleteEquipmentWithHistory,
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
    maintenanceOperationSeedRef.current = '';
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
    if (actionType !== 'view' && actionType !== 'photos' && actionType !== 'delete' && !canDatabaseWrite) return;
    if (actionType === 'delete' && !canDeleteEquipment) return;
    const invNo = toInvNo(itemOrInvNo);
    if (actionType === 'view' || actionType === 'photos') {
      const item = (itemOrInvNo && typeof itemOrInvNo === 'object') ? itemOrInvNo : findEquipmentByInvNo(invNo);
      void touchRecentCard({ invNo, actionType: 'view', snapshot: item });
      openDetailView(item || invNo, {
        invNo,
        loading: !item,
        ...(actionType === 'photos' ? { initialTab: 'photos' } : {}),
      });
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
    canDeleteEquipment,
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

      if (!maintenanceOperationSeedRef.current) {
        maintenanceOperationSeedRef.current = createMaintenanceOperationSeed();
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
        operationSeed: maintenanceOperationSeedRef.current,
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
    ...consumableCard,
    ...consumableDelete,
    ...qrScanner,
    handleQrScannerOpen: handleQrScannerOpenWithPairReset,
    handleQrScannerClose: handleQrScannerCloseWithPairReset,
    qrPairMode,
    qrPair,
    startQrPairScan,
    cancelQrPairScan: qrPairReset,
    startQrPairForConsumableCard,
    consumeConsumableQrForDetail,
    qrPhotoMode,
    setQrPhotoMode,
    scanNextForPhoto,
    photoQueue,
    ...deleteEquipment,
    ...maintenance,
    qrBatchPrint,
    consumableQr,
    cartridgeCompatOpen,
    openCartridgeCompatibilityDialog,
    closeCartridgeCompatibilityDialog,
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
