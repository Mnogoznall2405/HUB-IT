// Page view-model composer: auth/permissions, database selection and lookups,
// then three domain controllers (list → dialogs → employee flow) and a small
// amount of cross-domain glue. The container (Database.jsx) only composes
// this view-model with the view.

import { useCallback, useMemo, useRef } from 'react';

import { equipmentAPI } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { createNavigateToastAction } from '../../components/feedback/toastActions';
import { getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import { toInvNo } from './equipmentModel';
import { useDatabaseLookups } from './useDatabaseLookups';
import { useDatabaseSelection } from './useDatabaseSelection';
import { DATABASE_SWR_STALE_TIME_MS } from './useDatabaseEquipmentData';
import { useDatabaseListController } from './useDatabaseListController';
import { useDatabaseDialogController } from './useDatabaseDialogController';
import { useDatabaseEmployeeFlow } from './useDatabaseEmployeeFlow';


export {
  UPLOAD_ACT_MAX_SIZE_MB,
  UPLOAD_ACT_MAX_SIZE_BYTES,
  buildUploadActInvVerification,
  buildUploadActEmailDefaults,
  buildUploadActEmailResultState,
  buildUploadActCommitPayload,
  buildUploadActDraftFormState,
  buildUploadActSelectedEmailPayload,
  buildUploadActParseErrorMessage,
  clearUploadActReminderSearch,
  createEmptyUploadActEmailSummary,
  getUploadActReminderDeepLinkAction,
  getUploadActAutoEmailEmployees,
  getUploadActEmailErrorMessage,
  isApiUnavailableForActParseError,
  isUploadActParseNetworkError,
  isUploadActProxyUnavailableError,
  isUploadActCommitDisabled,
  parseInvNosInput,
  parseUploadActReminderDeepLink,
  resolveDataModeRefreshBehavior,
  validateUploadActPdfFile,
} from './uploadAct';

export {
  getEquipmentRowActions,
  removeItemFromGrouped,
} from './equipmentModel';


export function useDatabasePageViewModel() {
  const { user, hasPermission } = useAuth();
  const {
    notifySuccess: pushSuccessToast,
    notifyInfo: pushInfoToast,
    notifyWarning: pushWarningToast,
    notifyError: pushErrorToast,
  } = useNotification();
  const canDatabaseWrite = hasPermission('database.write');
  const canDatabaseDelete = hasPermission('database.delete');
  const canViewWarehouse1C = hasPermission('warehouse_1c.read');
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const location = useLocation();
  const navigate = useNavigate();
  const databaseToastAction = useMemo(() => createNavigateToastAction('/database', 'Открыть базу'), []);
  const notifyDatabaseSuccess = useCallback((message, options = {}) => {
    const text = String(message || '').trim();
    if (!text) return;
    pushSuccessToast(text, { source: 'database', action: databaseToastAction, ...options });
  }, [databaseToastAction, pushSuccessToast]);
  const notifyDatabaseInfo = useCallback((message, options = {}) => {
    const text = String(message || '').trim();
    if (!text) return;
    pushInfoToast(text, { source: 'database', action: databaseToastAction, ...options });
  }, [databaseToastAction, pushInfoToast]);
  const notifyDatabaseWarning = useCallback((message, options = {}) => {
    const text = String(message || '').trim();
    if (!text) return;
    pushWarningToast(text, { source: 'database', action: databaseToastAction, ...options });
  }, [databaseToastAction, pushWarningToast]);
  const notifyDatabaseError = useCallback((message, options = {}) => {
    const text = String(message || '').trim();
    if (!text) return;
    pushErrorToast(text, { source: 'database', action: databaseToastAction, ...options });
  }, [databaseToastAction, pushErrorToast]);

  const {
    dbName: db_name,
    databases,
    currentDb,
    databaseReady,
    selectedDatabaseName,
    handleDatabaseSelectChange,
  } = useDatabaseSelection({ notifyDatabaseError });
  const {
    getDbCacheScope,
    searchOwnersCached,
    getOwnerDepartmentsCached,
    getLocationsCached,
    getModelsCached,
  } = useDatabaseLookups({
    dbName: db_name,
    staleTimeMs: DATABASE_SWR_STALE_TIME_MS,
  });
  const list = useDatabaseListController({
    canViewWarehouse1C,
    dbName: db_name,
    currentDb,
    databaseReady,
    getDbCacheScope,
    notifyDatabaseSuccess,
    notifyDatabaseError,
  });

  const getUploadActEmailStatusItemSx = useCallback(
    (overrides) => getOfficeSubtlePanelSx(list.ui, overrides),
    [list.ui]
  );

  const dialogs = useDatabaseDialogController({
    canDatabaseWrite,
    canDatabaseDelete,
    isAdmin,
    dbName: db_name,
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
    dataMode: list.dataMode,
    selectedBranch: list.selectedBranch,
    selectedItems: list.selectedItems,
    setSelectedItems: list.setSelectedItems,
    setFilteredData: list.setFilteredData,
    setAllEquipment: list.setAllEquipment,
    setLoadedCount: list.setLoadedCount,
    setServerTotal: list.setServerTotal,
    setTotal: list.setTotal,
    fetchAllEquipment: list.fetchAllEquipment,
    notifyDataVersion: list.notifyDataVersion,
    findEquipmentByInvNo: list.findEquipmentByInvNo,
    getItemBranch: list.getItemBranch,
    branchOptions: list.branchOptions,
    statusOptions: list.statusOptions,
    allEquipment: list.allEquipment,
    tableSort: list.tableSort,
    isConsumablesMode: list.isConsumablesMode,
    handleClearSelection: list.handleClearSelection,
    touchRecentCard: list.touchRecentCard,
    removeRecentCard: list.removeRecentCard,
    refreshRecentCards: list.refreshRecentCards,
    refreshRecentActs: list.refreshRecentActs,
    handleDetailRecentActivity: list.handleDetailRecentActivity,
    handleTransferJobDone: list.handleTransferJobDone,
  });

  const employee = useDatabaseEmployeeFlow({
    canViewWarehouse1C,
    dbName: db_name,
    currentDb,
    initialLoading: list.initialLoading,
    isConsumablesMode: list.isConsumablesMode,
    searchScope: list.searchScope,
    searchQuery: list.searchQuery,
    appliedSearchQuery: list.appliedSearchQuery,
    modeLoading: list.modeLoading,
    loadingMoreEquipment: list.loadingMoreEquipment,
    nextEquipmentPage: list.nextEquipmentPage,
    hubSearchEmpty: list.hubSearchEmpty,
    findEquipmentByInvNo: list.findEquipmentByInvNo,
    applyUiSnapshot: list.applyUiSnapshot,
    detailModal: dialogs.detailModal,
    openDetailView: dialogs.openDetailView,
    handleDetailClose: dialogs.handleDetailClose,
    location,
    navigate,
    notifyDatabaseError,
  });

  // Кэш карточек для быстрого перехода из поиска актов (не ждём полный список Инвентаря).
  const actEquipmentCacheRef = useRef(new Map());

  const prefetchActSearchEquipment = useCallback(async (invNos = []) => {
    const list_ = Array.from(
      new Set((Array.isArray(invNos) ? invNos : []).map((value) => String(value || '').trim()).filter(Boolean)),
    );
    if (!list_.length) return;

    const missing = list_.filter((invNo) => {
      if (actEquipmentCacheRef.current.has(invNo)) return false;
      if (list.findEquipmentByInvNo?.(invNo)) return false;
      return true;
    });
    if (!missing.length) return;

    try {
      const response = await equipmentAPI.getByInvNos(missing);
      const rows = Array.isArray(response?.equipment) ? response.equipment : [];
      if (!rows.length) return;

      const mergedRows = [];
      rows.forEach((row) => {
        const invNo = String(row?.INV_NO ?? row?.inv_no ?? '').trim();
        if (!invNo) return;
        const prev = actEquipmentCacheRef.current.get(invNo) || {};
        const next = { ...prev, ...row };
        actEquipmentCacheRef.current.delete(invNo);
        actEquipmentCacheRef.current.set(invNo, next);
        while (actEquipmentCacheRef.current.size > 24) {
          const oldestKey = actEquipmentCacheRef.current.keys().next().value;
          if (oldestKey === undefined) break;
          actEquipmentCacheRef.current.delete(oldestKey);
        }
        mergedRows.push(next);
      });

      // Кладём в общий индекс Инвентаря — следующие открытия мгновенные.
      if (mergedRows.length && typeof list.setAllEquipment === 'function') {
        list.setAllEquipment((prev) => {
          const prevList = Array.isArray(prev) ? prev : [];
          const byInv = new Map(
            prevList.map((item) => [String(item?.INV_NO ?? item?.inv_no ?? '').trim(), item]),
          );
          mergedRows.forEach((row) => {
            const invNo = String(row?.INV_NO ?? row?.inv_no ?? '').trim();
            if (!invNo) return;
            byInv.set(invNo, { ...(byInv.get(invNo) || {}), ...row });
          });
          return Array.from(byInv.values());
        });
      }
    } catch (error) {
      console.error('Failed to prefetch equipment from act search:', error);
    }
  }, [list.findEquipmentByInvNo, list.setAllEquipment]);

  const handleOpenActSearchEquipment = useCallback((invNoOrAct, maybeMeta) => {
    // Новый UI: (invNo, itemMeta). Старый: (act, items[]).
    let invNo = '';
    let itemMeta = null;
    if (typeof invNoOrAct === 'string' || typeof invNoOrAct === 'number') {
      invNo = String(invNoOrAct || '').trim();
      if (maybeMeta && typeof maybeMeta === 'object' && !Array.isArray(maybeMeta)) {
        itemMeta = maybeMeta;
      }
    } else {
      const list_ = Array.isArray(maybeMeta)
        ? maybeMeta
        : (Array.isArray(invNoOrAct?.items) ? invNoOrAct.items : []);
      const firstItem = list_.find((item) => String(item?.inv_no || item?.invNo || '').trim());
      invNo = String(firstItem?.inv_no || firstItem?.invNo || '').trim();
      itemMeta = firstItem || null;
    }
    if (!invNo) return;

    const fromIndex = list.findEquipmentByInvNo?.(invNo) || null;
    const fromCache = actEquipmentCacheRef.current.get(invNo) || null;
    const fromMeta = itemMeta
      ? {
        INV_NO: invNo,
        MODEL_NAME: itemMeta.modelName || itemMeta.model_name || '',
        SERIAL_NO: itemMeta.serialNo || itemMeta.serial_no || '',
        ID: itemMeta.itemId || itemMeta.item_id || undefined,
      }
      : null;
    const snapshot = fromIndex || fromCache || fromMeta;
    // Открываем сразу с тем, что есть; полный fetch догрузится в фоне.
    dialogs.openDetailView(snapshot || invNo, {
      invNo,
      loading: false,
      initialTab: 'general',
    });
    // На всякий случай догружаем карточку, если ещё не в кэше.
    if (!fromIndex && !fromCache) {
      void prefetchActSearchEquipment([invNo]);
    }
  }, [list.findEquipmentByInvNo, dialogs.openDetailView, prefetchActSearchEquipment]);

  const handleRecentCardOpen = useCallback((item) => {
    const snapshot = (item?.snapshot && typeof item.snapshot === 'object') ? item.snapshot : null;
    const invNo = toInvNo(item) || toInvNo(snapshot);
    if (!invNo) return;
    void list.touchRecentCard({
      invNo,
      actionType: 'view',
      snapshot: snapshot || list.findEquipmentByInvNo(invNo),
    });
    dialogs.openDetailView(snapshot || invNo, { invNo, loading: !snapshot });
  }, [list.findEquipmentByInvNo, dialogs.openDetailView, list.touchRecentCard]);

  return {
    ...list,
    ...dialogs,
    ...employee,
    canDatabaseWrite,
    canDatabaseDelete,
    canViewWarehouse1C,
    isAdmin,
    db_name,
    databases,
    currentDb,
    selectedDatabaseName,
    handleDatabaseSelectChange,
    getUploadActEmailStatusItemSx,
    prefetchActSearchEquipment,
    handleOpenActSearchEquipment,
    handleRecentCardOpen,
  };
}

export default useDatabasePageViewModel;
