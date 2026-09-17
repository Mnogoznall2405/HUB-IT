// Auto-extracted from Database.jsx: all page orchestration hooks/state.
// The container (Database.jsx) only composes this view-model with the view.

import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import {
  Alert,
  Box,
  Button,
  Typography,
  Paper,
  Tabs,
  Tab,
  Fade,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { equipmentAPI, settingsAPI } from '../../api/client';
import { databaseAPI } from '../../api/database';
import jsonAPI from '../../api/json_client';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { createNavigateToastAction } from '../../components/feedback/toastActions';
import {
  buildOfficeUiTokens,
  getOfficeActionTraySx,
  getOfficeSubtlePanelSx,
} from '../../theme/officeUiTokens';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  getItemCapabilityFlags,
  toInvNo,
} from './equipmentModel';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { parseEquipmentQrLink } from './qrModel';
import {
  normalizeDbId,
} from './databaseRecordModel';
import {
  buildEquipmentIndex,
  countGroupedItems,
  getVisibleBranchNames,
  normalizeActionTargets,
} from './databaseListModel';
import {
  deserializeDatabaseUiSnapshot,
  serializeDatabaseUiSnapshot,
} from './databaseReturnContext';
import {
  buildBranchOptions,
  buildStatusOptions,
  buildTypeOptions,
  getConsumableTypeOptions,
  getEquipmentTypeOptions,
} from './databaseOptionModel';
import { executeMaintenanceAction, getActionErrorMessage } from './actionExecution';
import { useDatabaseSearch } from './useDatabaseSearch';
import { useDatabaseActSearch } from './useDatabaseActSearch';
import { useDatabaseEmployeeFallback } from './useDatabaseEmployeeFallback';
import { useDatabaseLookups } from './useDatabaseLookups';
import { useDatabaseSelection } from './useDatabaseSelection';
import { useDatabaseAddWorkflows } from './useDatabaseAddWorkflows';
import { useDatabaseConsumableQty } from './useDatabaseConsumableQty';
import { useDatabaseDeleteEquipment } from './useDatabaseDeleteEquipment';
import { useDatabaseConsumableDelete } from './useDatabaseConsumableDelete';
import { useDatabaseDetailRuntime } from './useDatabaseDetailRuntime';
import { useDatabaseListNavigation } from './useDatabaseListNavigation';
import { useDatabaseQrScanner } from './useDatabaseQrScanner';
import useEquipmentQrBatchPrint from './useEquipmentQrBatchPrint';
import { useDatabaseRecentCards } from './useDatabaseRecentCards';
import { useDatabaseRecentActs } from './useDatabaseRecentActs';
import { useDatabaseTransferAction } from './useDatabaseTransferAction';
import { useDatabaseUploadActWorkflow } from './useDatabaseUploadActWorkflow';
import { useDatabaseWorkspaceIdentity } from './useDatabaseWorkspaceIdentity';
import {
  DATABASE_SWR_STALE_TIME_MS,
  useDatabaseEquipmentData,
} from './useDatabaseEquipmentData';
import { useDatabaseEquipmentInfiniteScroll } from './useDatabaseEquipmentInfiniteScroll';
import { isEmployeeCompareSummaryComplete } from './employeeCompareModel';
import { buildCacheKey, getOrFetchSWR } from '../../lib/swrCache';
import {
  flushPersistBranchFilters,
  getBranchForDatabase,
  mergeServerBranchFilters,
  resolveValidatedBranch,
  schedulePersistBranchFilters,
  setBranchForDatabase,
} from './databaseBranchPreferences';
import DatabaseSearchBar, {
  SEARCH_SCOPE_ACTS,
  SEARCH_SCOPE_EQUIPMENT,
} from './DatabaseSearchBar';
import { useDatabaseMaintenanceData } from './useDatabaseMaintenanceData';
import {
  resolveSingleActionTarget as resolveActionTarget,
} from './actionModel';


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
import {
  mergeCurrentActsIntoGrouped,
  upsertItemInGrouped,
} from './equipmentModel';

const DEFAULT_TABLE_SORT = { field: 'employee', direction: 'asc' };
const CONSUMABLES_DEFAULT_TABLE_SORT = { field: 'model', direction: 'asc' };

const createDefaultUiSnapshot = (mode) => ({
  searchQuery: '',
  searchScope: SEARCH_SCOPE_EQUIPMENT,
  filteredData: null,
  tableSort: mode === DATA_MODE_CONSUMABLES ? CONSUMABLES_DEFAULT_TABLE_SORT : DEFAULT_TABLE_SORT,
  expandedBranches: new Set(),
  expandedLocations: new Set(),
  selectedItems: [],
  mobileSelectionMode: false,
});

const cloneUiSnapshot = (snapshot) => ({
  ...snapshot,
  tableSort: { ...snapshot.tableSort },
  expandedBranches: new Set(snapshot.expandedBranches),
  expandedLocations: new Set(snapshot.expandedLocations),
  selectedItems: [...snapshot.selectedItems],
});


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
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: true });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: true });
  const isMobile = isNarrowMobile || isTouchMobile;
  const location = useLocation();
  const navigate = useNavigate();
  const uiSnapshotsRef = useRef({
    [DATA_MODE_EQUIPMENT]: createDefaultUiSnapshot(DATA_MODE_EQUIPMENT),
    [DATA_MODE_CONSUMABLES]: createDefaultUiSnapshot(DATA_MODE_CONSUMABLES),
  });
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

  const [dataMode, setDataMode] = useState(DATA_MODE_EQUIPMENT);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [tableSort, setTableSort] = useState(DEFAULT_TABLE_SORT);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState(SEARCH_SCOPE_EQUIPMENT);
  const [filteredData, setFilteredData] = useState(null);

  const [expandedBranches, setExpandedBranches] = useState(() => new Set());
  const [expandedLocations, setExpandedLocations] = useState(() => new Set());
  const [selectedItems, setSelectedItems] = useState([]);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
  const [fabSheetOpen, setFabSheetOpen] = useState(false);
  const [actionModal, setActionModal] = useState({ open: false, type: null, invNo: null, componentKind: null });

  // Action form state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [componentType, setComponentType] = useState(PRINTER_COMPONENT_OPTIONS[0].value);
  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;

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
  const getUploadActEmailStatusItemSx = useCallback(
    (overrides) => getOfficeSubtlePanelSx(ui, overrides),
    [ui]
  );
  const {
    uploadActModalOpen,
    uploadActReminderBinding,
    uploadActReminderLoading,
    uploadActReminderError,
    uploadActFile,
    uploadActPreviewUrl,
    uploadActPreviewError,
    uploadActDraft,
    uploadActParsing,
    uploadActCommitting,
    uploadActError,
    setUploadActError,
    uploadActInvVerified,
    setUploadActInvVerified,
    uploadActAutoEmail,
    setUploadActAutoEmail,
    uploadActForm,
    uploadActCommitResult,
    uploadActEmailSubject,
    setUploadActEmailSubject,
    uploadActEmailBody,
    setUploadActEmailBody,
    uploadActEmailRecipientsInput,
    setUploadActEmailRecipientsInput,
    uploadActEmailRecipientOptions,
    uploadActEmailRecipients,
    setUploadActEmailRecipients,
    uploadActEmailRecipientsLoading,
    uploadActEmailLoading,
    uploadActEmailError,
    setUploadActEmailError,
    uploadActEmailStatus,
    uploadActEmailLastRecipients,
    uploadActEmailSummary,
    uploadActDownloading,
    uploadActDownloadError,
    setUploadActDownloadError,
    uploadActStep,
    uploadActInvVerification,
    uploadActCommitDisabled,
    openUploadActReminderTask,
    refreshUploadActReminderStatus,
    updateUploadActFormField,
    openUploadActModal,
    openUploadActModalForReminder,
    closeUploadActModal,
    handleUploadActFileSelect,
    handleUploadActParse,
    openUploadActPreviewInNewTab,
    handleUploadActInvNosChange,
    handleUploadActCommit,
    handleUploadActEmailSend,
    handleUploadActDownload,
  } = useDatabaseUploadActWorkflow({
    canDatabaseWrite,
    dbName: db_name,
    location,
    navigate,
    searchOwnersCached,
    notifyDatabaseSuccess,
    notifyDatabaseInfo,
    notifyDatabaseWarning,
    getEmailStatusItemSx: getUploadActEmailStatusItemSx,
  });
  const {
    initialLoading,
    modeLoading,
    equipmentTypes,
    branches,
    statuses,
    equipment,
    allEquipment,
    nextEquipmentPage,
    equipmentPagesTotal,
    loadingMoreEquipment,
    loadedCount,
    serverTotal,
    setAllEquipment,
    setLoadedCount,
    setServerTotal,
    setTotal,
    loadMoreEquipmentPages,
    fetchAllEquipment,
    refreshCurrentDbData,
    resetAllModeData,
    switchDataMode,
    dataVersionStale,
    notifyDataVersion,
  } = useDatabaseEquipmentData({
    enabled: databaseReady,
    dataMode,
    selectedBranch,
    getDbCacheScope,
    setFilteredData,
    staleTimeMs: DATABASE_SWR_STALE_TIME_MS,
  });
  const refreshedCurrentActDocNoRef = useRef('');

  // Prefetch the heaviest lazy chunks once first data renders — Vite dedupes
  // the import, so opening the dialogs later doesn't wait for the chunk.
  const didPrefetchDialogsRef = useRef(false);
  useEffect(() => {
    if (didPrefetchDialogsRef.current || !allEquipment?.length) return;
    didPrefetchDialogsRef.current = true;
    const prefetch = () => {
      void import('./EquipmentDetailDialog');
      void import('./EmployeeEquipmentDialog');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(prefetch, 2000);
    return () => clearTimeout(timer);
  }, [allEquipment]);

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

  const {
    handleSearchChange,
    handleSearchKeyDown,
    clearSearch,
    runSearchNow,
    appliedSearchQuery,
    searchLoading,
    searchLoadingMore,
    searchHasMore,
    searchTotal,
    serverSearchDegraded,
    loadMoreSearchResults,
  } = useDatabaseSearch({
    allEquipment,
    selectedBranch,
    setExpandedBranches,
    setExpandedLocations,
    searchQuery,
    setSearchQuery,
    filteredData,
    setFilteredData,
    equipmentSearchEnabled: isConsumablesMode || searchScope === SEARCH_SCOPE_EQUIPMENT,
    serverSearchEnabled: !isConsumablesMode && searchScope === SEARCH_SCOPE_EQUIPMENT,
  });
  const {
    actResults,
    actSearchLoading,
    actSearchError,
    actSearchTruncated,
    actFeedMode,
    resetActSearch,
    runActSearchNow,
    clearActSearchError,
  } = useDatabaseActSearch({
    searchQuery,
    searchScope,
    enabled: !isConsumablesMode,
  });
  const {
    identifyPCLoading,
    handleIdentifyWorkspace,
  } = useDatabaseWorkspaceIdentity({
    setSearchQuery,
    runSearchNow,
    setSelectedItems,
    notifyDatabaseSuccess,
    notifyDatabaseError,
  });

  const captureUiSnapshot = useCallback(() => ({
    searchQuery,
    searchScope,
    filteredData,
    tableSort,
    expandedBranches: new Set(expandedBranches),
    expandedLocations: new Set(expandedLocations),
    selectedItems: [...selectedItems],
    mobileSelectionMode,
  }), [
    expandedBranches,
    expandedLocations,
    filteredData,
    mobileSelectionMode,
    searchQuery,
    searchScope,
    selectedItems,
    tableSort,
  ]);

  const applyUiSnapshot = useCallback((snapshot) => {
    setSearchQuery(snapshot.searchQuery);
    setSearchScope(snapshot.searchScope || SEARCH_SCOPE_EQUIPMENT);
    setFilteredData(snapshot.filteredData);
    setTableSort(snapshot.tableSort);
    setExpandedBranches(new Set(snapshot.expandedBranches));
    setExpandedLocations(new Set(snapshot.expandedLocations));
    setSelectedItems([...snapshot.selectedItems]);
    setMobileSelectionMode(snapshot.mobileSelectionMode);
  }, []);

  const buildWarehouseReturnContext = useCallback((partial = {}) => ({
    returnTo: '/database',
    ...partial,
    uiSnapshot: serializeDatabaseUiSnapshot(captureUiSnapshot()),
  }), [captureUiSnapshot]);

  const applyPersistedBranchForDatabase = useCallback((databaseId, availableBranches = branches) => {
    const dbId = normalizeDbId(databaseId);
    if (!dbId) {
      setSelectedBranch('');
      return;
    }
    const persistedBranch = getBranchForDatabase(dbId);
    setSelectedBranch(resolveValidatedBranch(persistedBranch, availableBranches));
  }, [branches]);

  const handleDataModeChange = useCallback((_, nextMode) => {
    if (nextMode === dataMode) return;

    uiSnapshotsRef.current[dataMode] = captureUiSnapshot();
    const nextUi = cloneUiSnapshot(
      uiSnapshotsRef.current[nextMode] ?? createDefaultUiSnapshot(nextMode)
    );
    applyUiSnapshot(nextUi);
    setDataMode(nextMode);
    void switchDataMode(nextMode);
  }, [applyUiSnapshot, captureUiSnapshot, dataMode, switchDataMode]);

  useEffect(() => {
    const handleDatabaseChanged = () => {
      uiSnapshotsRef.current = {
        [DATA_MODE_EQUIPMENT]: createDefaultUiSnapshot(DATA_MODE_EQUIPMENT),
        [DATA_MODE_CONSUMABLES]: createDefaultUiSnapshot(DATA_MODE_CONSUMABLES),
      };
      const defaultUi = createDefaultUiSnapshot(dataMode);
      applyUiSnapshot(defaultUi);
      resetAllModeData();
      void refreshCurrentDbData({ force: true });
    };

    window.addEventListener('database-changed', handleDatabaseChanged);
    return () => {
      window.removeEventListener('database-changed', handleDatabaseChanged);
    };
  }, [applyUiSnapshot, dataMode, refreshCurrentDbData, resetAllModeData]);

  useEffect(() => {
    if (!db_name) return;
    applyPersistedBranchForDatabase(db_name, branches);
  }, [applyPersistedBranchForDatabase, branches, db_name]);

  useEffect(() => {
    const syncBranchFiltersFromServer = async () => {
      if (!localStorage.getItem('user')) return;
      try {
        const data = await settingsAPI.getMySettings({ suppressAuthRequired: true });
        mergeServerBranchFilters(data?.database_branch_filters);
        if (db_name) {
          applyPersistedBranchForDatabase(db_name, branches);
        }
      } catch (error) {
        console.error('Failed to sync database branch filters:', error);
      }
    };

    void syncBranchFiltersFromServer();
    const handleAuthChanged = () => {
      void syncBranchFiltersFromServer();
    };
    window.addEventListener('auth-changed', handleAuthChanged);
    return () => {
      window.removeEventListener('auth-changed', handleAuthChanged);
      flushPersistBranchFilters();
    };
  }, [applyPersistedBranchForDatabase, branches, db_name]);

  const displayData = filteredData !== null ? filteredData : equipment;
  const hubSearchEmpty = Boolean(
    filteredData !== null
    && Object.keys(filteredData || {}).length === 0,
  );
  const employeeFallback = useDatabaseEmployeeFallback({
    enabled: Boolean(
      canViewWarehouse1C
      && !isConsumablesMode
      && searchScope === SEARCH_SCOPE_EQUIPMENT
      && !modeLoading
      && !loadingMoreEquipment
      && !nextEquipmentPage,
    ),
    searchQuery,
    appliedSearchQuery,
    hubSearchEmpty,
  });
  const isServerSearchActive = Boolean(
    appliedSearchQuery && !isConsumablesMode && searchScope === SEARCH_SCOPE_EQUIPMENT
  );
  const canAutoLoadMoreEquipment = isServerSearchActive
    ? searchHasMore
    : Boolean(nextEquipmentPage) && !modeLoading;
  const equipmentLoadMoreSentinelRef = useDatabaseEquipmentInfiniteScroll({
    enabled: canAutoLoadMoreEquipment,
    hasMore: isServerSearchActive ? searchHasMore : Boolean(nextEquipmentPage),
    loading: isServerSearchActive ? searchLoadingMore : loadingMoreEquipment,
    nextPage: isServerSearchActive ? null : nextEquipmentPage,
    loadedCount: isServerSearchActive ? countGroupedItems(displayData) : loadedCount,
    serverTotal: isServerSearchActive ? (searchTotal ?? 0) : serverTotal,
    onLoadMore: isServerSearchActive
      ? loadMoreSearchResults
      : () => loadMoreEquipmentPages({ maxPages: 1 }),
  });
  const visibleBranchNames = useMemo(() => getVisibleBranchNames(displayData), [displayData]);

  // Create index Map for O(1) search instead of O(n)
  const equipmentIndex = useMemo(() => buildEquipmentIndex(allEquipment), [allEquipment]);

  // O(1) search using index
  const findEquipmentByInvNo = useCallback((invNo) => {
    return equipmentIndex.get(String(invNo)) || null;
  }, [equipmentIndex]);
  const {
    recentCards,
    recentCardsLoading,
    refreshRecentCards,
    touchRecentCard,
    removeRecentCard,
    clearRecentCards,
  } = useDatabaseRecentCards({
    // Prefetch with inventory page so scope switches stay instant.
    enabled: databaseReady && !isConsumablesMode,
    dbName: db_name,
  });
  const isActsScopeEnabled = !isConsumablesMode && searchScope === SEARCH_SCOPE_ACTS;
  const {
    recentActs,
    recentActsLoading,
    refreshRecentActs,
    touchRecentAct,
    removeRecentAct,
    clearRecentActs,
  } = useDatabaseRecentActs({
    // Prefetch acts history while still on equipment scope.
    enabled: databaseReady && !isConsumablesMode,
    dbName: db_name,
  });
  const [seededAct, setSeededAct] = useState(null);
  const handleDetailRecentActivity = useCallback(() => {
    void refreshRecentCards();
  }, [refreshRecentCards]);
  const handleTransferJobDone = useCallback(() => {
    void refreshRecentCards();
    void refreshRecentActs();
  }, [refreshRecentActs, refreshRecentCards]);
  useEffect(() => {
    if (isConsumablesMode || !uploadActCommitResult?.doc_no) return;
    void refreshRecentCards();
    void refreshRecentActs();
  }, [isConsumablesMode, refreshRecentActs, refreshRecentCards, uploadActCommitResult?.doc_no]);
  useEffect(() => {
    if (!isActsScopeEnabled) {
      setSeededAct(null);
    }
  }, [isActsScopeEnabled]);
  const {
    visibleLocationKeys,
    hasExpandedVisible,
    selectedItemsSet,
    selectedVisibleCount,
    selectedHiddenCount,
    selectedItemsCapabilities,
    handleCollapseAll,
    toggleBranch,
    toggleLocation,
    handleCheckboxChange,
    handleMobileCardSelect,
    handleSelectAll,
  } = useDatabaseListNavigation({
    displayData,
    visibleBranchNames,
    findEquipmentByInvNo,
    expandedBranches,
    setExpandedBranches,
    expandedLocations,
    setExpandedLocations,
    selectedItems,
    setSelectedItems,
    mobileSelectionMode,
    setMobileSelectionMode,
  });

  const getItemBranch = useCallback(
    (item) => String(item?.BRANCH_NAME || item?.branch_name || selectedBranch || '').trim(),
    [selectedBranch]
  );
  const {
    detailModal,
    detailEditMode,
    detailSaving,
    detailError,
    setDetailError,
    detailSuccess,
    setDetailSuccess,
    detailForm,
    detailModelsLoading,
    detailTab,
    setDetailTab,
    detailActs,
    detailActsLoading,
    detailActsError,
    setDetailActsError,
    detailHistory,
    detailHistoryLoading,
    detailHistoryError,
    setDetailHistoryError,
    setDetailHistory,
    setDetailHistoryLoadedInvNo,
    detailActOpeningDocNo,
    detailActFieldsOpen,
    detailActSelected,
    detailActSummary,
    detailQrOpen,
    setDetailQrOpen,
    detailQrUrl,
    detailQrUrlLoading,
    detailQrText,
    detailQrFileName,
    detailHasChanges,
    locationOptions,
    modelOptions,
    selectedEmployeeOption,
    loadDetailedItemsByInvNos,
    openDetailView,
    handleQrEquipmentFound,
    patchDetailForm,
    startDetailEdit,
    handleDetailClose,
    handleDetailCancel,
    handleDetailSave,
    handleDetailEditKeyDown,
    handleOpenEquipmentActFile,
    handleOpenActFields,
    handleCloseActFields,
    actFilePreview,
    closeActFilePreview,
  } = useDatabaseDetailRuntime({
    canDatabaseWrite,
    databaseId: db_name || currentDb?.id || '',
    findEquipmentByInvNo,
    searchOwnersCached,
    getLocationsCached,
    getModelsCached,
    setAllEquipment,
    onRecentActivity: handleDetailRecentActivity,
  });
  const handleRecentCardOpen = useCallback((item) => {
    const snapshot = (item?.snapshot && typeof item.snapshot === 'object') ? item.snapshot : null;
    const invNo = toInvNo(item) || toInvNo(snapshot);
    if (!invNo) return;
    void touchRecentCard({
      invNo,
      actionType: 'view',
      snapshot: snapshot || findEquipmentByInvNo(invNo),
    });
    openDetailView(snapshot || invNo, { invNo, loading: !snapshot });
  }, [findEquipmentByInvNo, openDetailView, touchRecentCard]);

  const buildActFromRecentItem = useCallback((item) => {
    const snapshot = (item?.snapshot && typeof item.snapshot === 'object') ? item.snapshot : {};
    const docNoRaw = item?.doc_no ?? snapshot?.doc_no ?? snapshot?.DOC_NO;
    const docNo = Number(docNoRaw);
    if (!Number.isFinite(docNo) || docNo <= 0) return null;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    return {
      doc_no: docNo,
      doc_number: String(item?.doc_number || snapshot?.doc_number || snapshot?.DOC_NUMBER || '').trim(),
      doc_date: snapshot?.doc_date || snapshot?.DOC_DATE || null,
      branch_name: String(snapshot?.branch_name || snapshot?.BRANCH_NAME || '').trim(),
      location_name: String(snapshot?.location_name || snapshot?.LOCATION_NAME || '').trim(),
      employee_name: String(snapshot?.employee_name || snapshot?.EMPLOYEE_NAME || '').trim(),
      has_file: Boolean(snapshot?.has_file),
      item_count: Number(snapshot?.item_count || items.length || 0) || items.length,
      items,
    };
  }, []);

  const handleRecentActOpen = useCallback((item) => {
    const act = buildActFromRecentItem(item);
    if (!act) return;
    setSeededAct(act);
    void touchRecentAct({
      docNo: act.doc_no,
      docNumber: act.doc_number,
      actionType: 'view',
      snapshot: act,
    });
  }, [buildActFromRecentItem, touchRecentAct]);

  const handleActSearchSelect = useCallback((act) => {
    const docNo = Number(act?.doc_no ?? act?.DOC_NO);
    if (!Number.isFinite(docNo) || docNo <= 0) return;
    void touchRecentAct({
      docNo,
      docNumber: String(act?.doc_number || act?.DOC_NUMBER || '').trim(),
      actionType: 'view',
      snapshot: act,
    });
  }, [touchRecentAct]);

  const handleActSearchOpenFile = useCallback((act) => {
    const docNo = Number(act?.doc_no ?? act?.DOC_NO);
    if (!Number.isFinite(docNo) || docNo <= 0) return;
    void touchRecentAct({
      docNo,
      docNumber: String(act?.doc_number || act?.DOC_NUMBER || '').trim(),
      actionType: 'open_file',
      snapshot: act,
    });
  }, [touchRecentAct]);

  const handleCombinedSearchKeyDown = useCallback((event) => {
    if (!isConsumablesMode && searchScope === SEARCH_SCOPE_ACTS) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void runActSearchNow(searchQuery);
      return;
    }
    handleSearchKeyDown(event);
  }, [handleSearchKeyDown, isConsumablesMode, runActSearchNow, searchQuery, searchScope]);

  const handleSearchScopeChange = useCallback((nextScope) => {
    const normalizedScope = nextScope === SEARCH_SCOPE_ACTS ? SEARCH_SCOPE_ACTS : SEARCH_SCOPE_EQUIPMENT;
    setSearchScope(normalizedScope);
    if (normalizedScope === SEARCH_SCOPE_ACTS) {
      setFilteredData(null);
      setSelectedItems([]);
      setMobileSelectionMode(false);
      return;
    }
    resetActSearch();
    if (String(searchQuery || '').trim().length >= 2) {
      runSearchNow(searchQuery);
    }
  }, [resetActSearch, runSearchNow, searchQuery]);

  // Кэш карточек для быстрого перехода из поиска актов (не ждём полный список Инвентаря).
  const actEquipmentCacheRef = useRef(new Map());

  const prefetchActSearchEquipment = useCallback(async (invNos = []) => {
    const list = Array.from(
      new Set((Array.isArray(invNos) ? invNos : []).map((value) => String(value || '').trim()).filter(Boolean)),
    );
    if (!list.length) return;

    const missing = list.filter((invNo) => {
      if (actEquipmentCacheRef.current.has(invNo)) return false;
      if (findEquipmentByInvNo?.(invNo)) return false;
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
      if (mergedRows.length && typeof setAllEquipment === 'function') {
        setAllEquipment((prev) => {
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
  }, [findEquipmentByInvNo, setAllEquipment]);

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
      const list = Array.isArray(maybeMeta)
        ? maybeMeta
        : (Array.isArray(invNoOrAct?.items) ? invNoOrAct.items : []);
      const firstItem = list.find((item) => String(item?.inv_no || item?.invNo || '').trim());
      invNo = String(firstItem?.inv_no || firstItem?.invNo || '').trim();
      itemMeta = firstItem || null;
    }
    if (!invNo) return;

    const fromIndex = findEquipmentByInvNo?.(invNo) || null;
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
    openDetailView(snapshot || invNo, {
      invNo,
      loading: false,
      initialTab: 'general',
    });
    // На всякий случай догружаем карточку, если ещё не в кэше.
    if (!fromIndex && !fromCache) {
      void prefetchActSearchEquipment([invNo]);
    }
  }, [findEquipmentByInvNo, openDetailView, prefetchActSearchEquipment]);

  const isActsScope = !isConsumablesMode && searchScope === SEARCH_SCOPE_ACTS;

  const statusOptions = useMemo(() => buildStatusOptions(statuses), [statuses]);

  const branchOptions = useMemo(() => buildBranchOptions(branches), [branches]);

  const typeOptions = useMemo(() => buildTypeOptions(equipmentTypes), [equipmentTypes]);

  const equipmentTypeOptions = useMemo(
    () => getEquipmentTypeOptions(typeOptions),
    [typeOptions]
  );

  const consumableTypeOptions = useMemo(
    () => getConsumableTypeOptions(typeOptions),
    [typeOptions]
  );

  const resetDetailHistory = useCallback(() => {
    setDetailHistory([]);
    setDetailHistoryLoadedInvNo('');
  }, []);

  const {
    transferOperationMode,
    setTransferOperationMode,
    newEmployee,
    setNewEmployee,
    transferDepartment,
    transferDepartmentOptions,
    transferDepartmentLoading,
    transferBranchNo,
    transferLocationNo,
    transferLocationOptions,
    transferLocationsLoading,
    transferEmployeeInput,
    setTransferEmployeeInput,
    transferEmployeeAutocompleteOptions,
    transferEmployeeInputTrimmed,
    transferEmployeeLoading,
    selectedTransferEmployeeOption,
    transferUsesManualEmployee,
    transferResult,
    transferJobPolling,
    transferRetrySubmitting,
    transferEmailMode,
    transferManualEmail,
    transferRecipientInput,
    transferRecipientOptions,
    transferRecipient,
    transferRecipientLoading,
    transferEmailLoading,
    transferEmailStatus,
    transferEmailError,
    transferSourceDefaults,
    resetTransferState,
    handleTransferActionSubmit,
    transferActionHandlers,
  } = useDatabaseTransferAction({
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

  const {
    addEquipmentModalOpen,
    addEquipmentForm,
    addEquipmentLoading,
    addEquipmentError,
    setAddEquipmentError,
    addEquipmentSuccess,
    addEmployeeInput,
    setAddEmployeeInput,
    addEmployeeOptions,
    addEmployeeLoading,
    addLocationOptions,
    addLocationsLoading,
    addModelOptions,
    addModelsLoading,
    selectedAddEmployeeOption,
    addUsesManualEmployee,
    addUsesManualModel,
    openAddEquipmentModal,
    closeAddEquipmentModal,
    patchAddEquipmentForm,
    resetAddEquipmentModels,
    handleAddEquipmentSubmit,
    addConsumableModalOpen,
    addConsumableForm,
    addConsumableLoading,
    addConsumableError,
    setAddConsumableError,
    addConsumableSuccess,
    addConsumableLocationOptions,
    addConsumableLocationsLoading,
    addConsumableModelOptions,
    addConsumableModelsLoading,
    openAddConsumableModal,
    closeAddConsumableModal,
    patchAddConsumableForm,
    resetAddConsumableModels,
    handleAddConsumableSubmit,
  } = useDatabaseAddWorkflows({
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
  const {
    editConsumableQtyModal,
    editConsumableQtyValue,
    editConsumableQtyLoading,
    editConsumableQtyError,
    openEditConsumableQtyModal,
    closeEditConsumableQtyModal,
    setEditConsumableQtyInput,
    handleEditConsumableQtySubmit,
  } = useDatabaseConsumableQty({
    canDatabaseWrite,
    fetchAllEquipment,
    setAllEquipment,
    setFilteredData,
    notifyDatabaseSuccess,
  });
  const {
    deleteConsumableTarget,
    deleteConsumableLoading,
    deleteConsumableError,
    openDeleteConsumableModal,
    closeDeleteConsumableModal,
    confirmDeleteConsumable,
  } = useDatabaseConsumableDelete({
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
  const {
    qrScannerOpen,
    qrScannerResult,
    qrScannerError,
    qrScannerLoading,
    qrScannerReady,
    openQrScanner: handleQrScannerOpen,
    closeQrScanner: handleQrScannerClose,
  } = useDatabaseQrScanner({
    onEquipmentFound: handleQrEquipmentFound,
    notifyDatabaseError,
  });

  const {
    deleteTarget,
    deleteLoading,
    deleteError,
    openDeleteEquipmentDialog,
    closeDeleteEquipmentDialog,
    confirmDeleteEquipment,
  } = useDatabaseDeleteEquipment({
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

  const resolveSingleActionTarget = useCallback(() => {
    return resolveActionTarget({
      selectedItems,
      fallbackInvNo: actionModal.invNo,
      findEquipmentByInvNo,
    });
  }, [actionModal.invNo, findEquipmentByInvNo, selectedItems]);

  const {
    cartridgeModel,
    setCartridgeModel,
    selectedWorkConsumable,
    setSelectedWorkConsumable,
    workConsumablesLoading,
    cartridgeHistory,
    batteryHistory,
    componentHistory,
    cleaningHistory,
    activeComponentOptions,
    actionWorkConsumableOptions,
    resetMaintenanceData,
  } = useDatabaseMaintenanceData({
    actionModal,
    resolveSingleActionTarget,
    componentType,
  });

  const handleBranchChange = useCallback((branch) => {
    const nextBranch = String(branch || '').trim();
    setSelectedBranch(nextBranch);
    setFilteredData(null);
    setSelectedItems([]);

    const dbId = normalizeDbId(db_name);
    if (!dbId) return;

    setBranchForDatabase(dbId, nextBranch);
    schedulePersistBranchFilters(settingsAPI.updateMySettings, { [dbId]: nextBranch });
  }, [db_name, setFilteredData]);

  const handleTableSort = useCallback((field) => {
    setTableSort((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        field,
        direction: 'asc',
      };
    });
  }, []);

  const closeActionModal = useCallback(({ clearSelection = false } = {}) => {
    setActionModal({ open: false, type: null, invNo: null, componentKind: null });
    if (clearSelection) {
      setSelectedItems([]);
    }
    setActionError('');
    resetTransferState();
    resetMaintenanceData();
    setComponentType(PRINTER_COMPONENT_OPTIONS[0].value);
  }, [resetMaintenanceData, resetTransferState]);

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
      const effectiveDbName = normalizeDbId(db_name || localStorage.getItem('selected_database'));
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
    db_name,
    fetchAllEquipment,
    findEquipmentByInvNo,
    getItemBranch,
    handleTransferActionSubmit,
    loadDetailedItemsByInvNos,
    refreshRecentCards,
    selectedItems,
    selectedWorkConsumable,
  ]);

  const handleClearSelection = useCallback(() => {
    setSelectedItems([]);
    setMobileSelectionMode(false);
  }, []);

  const qrBatchPrint = useEquipmentQrBatchPrint({
    groupedEquipment: allEquipment,
    selectedItems,
    tableSort,
    databaseId: db_name || currentDb?.id || '',
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

  const [employeeEquipmentDialog, setEmployeeEquipmentDialog] = useState({
    open: false,
    ownerNo: null,
    employeeName: '',
    warehouseRef: '',
    stackAboveParent: false,
  });
  const [detailOpenedFromEmployee, setDetailOpenedFromEmployee] = useState(false);
  const [employeeCompareSummaries, setEmployeeCompareSummaries] = useState([]);

  // One batched 1C call — badges next to employee names in the list.
  useEffect(() => {
    if (!canViewWarehouse1C || initialLoading || !db_name) {
      setEmployeeCompareSummaries([]);
      return undefined;
    }
    setEmployeeCompareSummaries([]);
    let cancelled = false;
    getOrFetchSWR(
      buildCacheKey('warehouse-1c', 'employee-compare-summary', currentDb?.id || db_name || ''),
      () => warehouse1cAPI.getEmployeeCompareSummary(),
      { staleTimeMs: 120_000 },
    )
      .then(({ data }) => {
        if (cancelled) return;
        setEmployeeCompareSummaries(
          isEmployeeCompareSummaryComplete(data?.meta) && Array.isArray(data?.items)
            ? data.items
            : [],
        );
      })
      .catch((err) => {
        console.warn('Failed to load employee compare summary:', err);
      });
    return () => { cancelled = true; };
  }, [canViewWarehouse1C, initialLoading, db_name, currentDb?.id]);

  const handleOpenEmployee = useCallback(({ ownerNo, employeeName, warehouseRef = '' }) => {
    const normalizedEmployeeName = String(employeeName || '').trim();
    const normalizedWarehouseRef = String(warehouseRef || '').trim();
    if (!ownerNo && !normalizedEmployeeName && !normalizedWarehouseRef) return;
    if (!ownerNo && !canViewWarehouse1C) return;
    // Close equipment card first — otherwise it stays on top and the employee
    // dialog only becomes visible after the equipment window is closed.
    if (detailModal.open) {
      handleDetailClose();
    }
    setEmployeeEquipmentDialog({
      open: true,
      ownerNo: ownerNo || null,
      employeeName: normalizedEmployeeName,
      warehouseRef: normalizedWarehouseRef,
      stackAboveParent: false,
    });
  }, [canViewWarehouse1C, detailModal.open, handleDetailClose]);

  const handleCloseEmployeeEquipmentDialog = useCallback(() => {
    setEmployeeEquipmentDialog({
      open: false,
      ownerNo: null,
      employeeName: '',
      warehouseRef: '',
      stackAboveParent: false,
    });
  }, []);

  const handleOpenEquipmentFromEmployee = useCallback(async (invNo, meta = {}) => {
    const normalized = String(invNo || '').trim();
    if (!normalized || normalized === '-') return;

    const targetDb = normalizeDbId(meta?.databaseId || '');
    const current = normalizeDbId(db_name || currentDb?.id || localStorage.getItem('selected_database') || '');
    if (targetDb && targetDb !== current) {
      try {
        await databaseAPI.switchDatabase(targetDb);
        localStorage.setItem('selected_database', targetDb);
        window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: targetDb } }));
      } catch (error) {
        console.error('Failed to switch database for Hub match open:', error);
        notifyDatabaseError?.(error?.response?.data?.detail || 'Не удалось переключить базу для открытия карточки.');
        return;
      }
    }

    const item = findEquipmentByInvNo?.(normalized);
    setDetailOpenedFromEmployee(true);
    openDetailView(item || normalized, { invNo: normalized, loading: !item });
  }, [currentDb?.id, db_name, findEquipmentByInvNo, notifyDatabaseError, openDetailView]);

  const handleBackToEmployeeEquipment = useCallback(() => {
    setDetailOpenedFromEmployee(false);
    handleDetailClose();
  }, [handleDetailClose]);

  const handleCloseEquipmentDetail = useCallback(() => {
    setDetailOpenedFromEmployee(false);
    handleDetailClose();
    if (detailOpenedFromEmployee) {
      handleCloseEmployeeEquipmentDialog();
    }
  }, [detailOpenedFromEmployee, handleCloseEmployeeEquipmentDialog, handleDetailClose]);

  useEffect(() => {
    if (!detailModal.open) {
      setDetailOpenedFromEmployee(false);
    }
  }, [detailModal.open]);

  const equipmentDeepLinkHandledRef = useRef('');

  useEffect(() => {
    const deepLink = parseEquipmentQrLink(`${location.pathname}${location.search}`);
    if (!deepLink) {
      equipmentDeepLinkHandledRef.current = '';
      return;
    }

    const signature = [deepLink.invNo, deepLink.databaseId, deepLink.tab].join('|');
    if (equipmentDeepLinkHandledRef.current === signature) return;

    const currentDatabaseId = normalizeDbId(
      db_name || currentDb?.id || localStorage.getItem('selected_database') || ''
    );
    const targetDatabaseId = normalizeDbId(deepLink.databaseId);
    if (targetDatabaseId && !currentDatabaseId) return;

    equipmentDeepLinkHandledRef.current = signature;

    const openLinkedEquipment = async () => {
      const mustSwitchDatabase = Boolean(
        targetDatabaseId && targetDatabaseId !== currentDatabaseId
      );

      try {
        if (mustSwitchDatabase) {
          await databaseAPI.switchDatabase(targetDatabaseId);
          localStorage.setItem('selected_database', targetDatabaseId);
          window.dispatchEvent(new CustomEvent('database-changed', {
            detail: { databaseId: targetDatabaseId },
          }));
        }

        const item = mustSwitchDatabase ? null : findEquipmentByInvNo?.(deepLink.invNo);
        openDetailView(item || deepLink.invNo, {
          invNo: deepLink.invNo,
          loading: !item,
          initialTab: deepLink.tab,
        });
      } catch (error) {
        console.error('Failed to open equipment QR link:', error);
        notifyDatabaseError?.(
          error?.response?.data?.detail || 'Не удалось открыть карточку оборудования по QR-ссылке.'
        );
      }
    };

    void openLinkedEquipment();
  }, [
    currentDb?.id,
    db_name,
    findEquipmentByInvNo,
    location.pathname,
    location.search,
    notifyDatabaseError,
    openDetailView,
  ]);

  useEffect(() => {
    const state = location.state;
    if (!state || typeof state !== 'object') return;

    const reopenDetail = state.reopenDetail && typeof state.reopenDetail === 'object'
      ? state.reopenDetail
      : null;
    const reopenEmployee = state.reopenEmployee && typeof state.reopenEmployee === 'object'
      ? state.reopenEmployee
      : null;

    let handled = false;

    if (state.uiSnapshot && typeof state.uiSnapshot === 'object') {
      applyUiSnapshot(deserializeDatabaseUiSnapshot(state.uiSnapshot));
      handled = true;
    }

    if (reopenDetail?.invNo) {
      const invNo = String(reopenDetail.invNo).trim();
      if (invNo) {
        const targetDb = normalizeDbId(reopenDetail.databaseId || '');
        const current = normalizeDbId(db_name || currentDb?.id || localStorage.getItem('selected_database') || '');
        const openReopenedDetail = () => {
          const snapshot = reopenDetail.detailSnapshot && typeof reopenDetail.detailSnapshot === 'object'
            ? reopenDetail.detailSnapshot
            : null;
          const item = findEquipmentByInvNo?.(invNo) || snapshot;
          openDetailView(item || invNo, {
            invNo,
            data: snapshot || undefined,
            loading: !item && !snapshot,
            initialTab: reopenDetail.detailTab || 'warehouse1c',
          });
        };

        if (targetDb && targetDb !== current) {
          (async () => {
            try {
              await databaseAPI.switchDatabase(targetDb);
              localStorage.setItem('selected_database', targetDb);
              window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: targetDb } }));
            } catch (error) {
              console.error('Failed to switch database for reopenDetail:', error);
              notifyDatabaseError?.(error?.response?.data?.detail || 'Не удалось переключить базу для открытия карточки.');
              return;
            }
            openReopenedDetail();
          })();
        } else {
          openReopenedDetail();
        }
        handled = true;
      }
    } else if (
      reopenEmployee?.ownerNo
      || reopenEmployee?.employeeName
      || reopenEmployee?.warehouseRef
      || (reopenDetail?.kind === 'employee' && (reopenDetail?.ownerNo || reopenDetail?.employeeName))
    ) {
      const employee = reopenEmployee || reopenDetail;
      setEmployeeEquipmentDialog({
        open: true,
        ownerNo: employee.ownerNo || null,
        employeeName: String(employee.employeeName || '').trim(),
        warehouseRef: String(employee.warehouseRef || '').trim(),
        stackAboveParent: false,
      });
      handled = true;
    }

    if (handled) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [applyUiSnapshot, currentDb?.id, db_name, findEquipmentByInvNo, location.pathname, location.state, navigate, notifyDatabaseError, openDetailView]);


  return {
    actFeedMode,
    actFilePreview,
    actResults,
    actSearchError,
    actSearchLoading,
    actSearchTruncated,
    actionError,
    actionLoading,
    actionModal,
    actionWorkConsumableOptions,
    activeComponentOptions,
    addConsumableError,
    addConsumableForm,
    addConsumableLoading,
    addConsumableLocationOptions,
    addConsumableLocationsLoading,
    addConsumableModalOpen,
    addConsumableModelOptions,
    addConsumableModelsLoading,
    addConsumableSuccess,
    addEmployeeInput,
    addEmployeeLoading,
    addEmployeeOptions,
    addEquipmentError,
    addEquipmentForm,
    addEquipmentLoading,
    addEquipmentModalOpen,
    addEquipmentSuccess,
    addLocationOptions,
    addLocationsLoading,
    addModelOptions,
    addModelsLoading,
    addUsesManualEmployee,
    addUsesManualModel,
    batteryHistory,
    branchOptions,
    branches,
    buildWarehouseReturnContext,
    canAutoLoadMoreEquipment,
    canDatabaseDelete,
    canDatabaseWrite,
    canViewWarehouse1C,
    cartridgeHistory,
    cartridgeModel,
    cleaningHistory,
    clearActSearchError,
    clearRecentActs,
    clearRecentCards,
    clearSearch,
    closeActFilePreview,
    closeActionModal,
    closeAddConsumableModal,
    closeAddEquipmentModal,
    closeDeleteConsumableModal,
    closeDeleteEquipmentDialog,
    closeEditConsumableQtyModal,
    closeUploadActModal,
    componentHistory,
    componentType,
    confirmDeleteConsumable,
    confirmDeleteEquipment,
    consumableTypeOptions,
    currentDb,
    dataMode,
    dataVersionStale,
    databases,
    db_name,
    deleteConsumableError,
    deleteConsumableLoading,
    deleteConsumableTarget,
    deleteError,
    deleteLoading,
    deleteTarget,
    detailActFieldsOpen,
    detailActOpeningDocNo,
    detailActSelected,
    detailActSummary,
    detailActs,
    detailActsError,
    detailActsLoading,
    detailEditMode,
    detailError,
    detailForm,
    detailHasChanges,
    detailHistory,
    detailHistoryError,
    detailHistoryLoading,
    detailModal,
    detailModelsLoading,
    detailOpenedFromEmployee,
    detailQrFileName,
    detailQrOpen,
    detailQrText,
    detailQrUrl,
    detailQrUrlLoading,
    detailSaving,
    detailSuccess,
    detailTab,
    displayData,
    editConsumableQtyError,
    editConsumableQtyLoading,
    editConsumableQtyModal,
    editConsumableQtyValue,
    employeeCompareSummaries,
    employeeEquipmentDialog,
    employeeFallback,
    equipment,
    equipmentLoadMoreSentinelRef,
    equipmentPagesTotal,
    equipmentTypeOptions,
    expandedBranches,
    expandedLocations,
    fabSheetOpen,
    getUploadActEmailStatusItemSx,
    handleActSearchOpenFile,
    handleActSearchSelect,
    handleAction,
    handleActionConfirm,
    handleAddConsumableSubmit,
    handleAddEquipmentSubmit,
    handleBackToEmployeeEquipment,
    handleBranchChange,
    handleCheckboxChange,
    handleClearSelection,
    handleCloseActFields,
    handleCloseEmployeeEquipmentDialog,
    handleCloseEquipmentDetail,
    handleCollapseAll,
    handleCombinedSearchKeyDown,
    handleDataModeChange,
    handleDatabaseSelectChange,
    handleDetailCancel,
    handleDetailEditKeyDown,
    handleDetailSave,
    handleEditConsumableQtySubmit,
    handleIdentifyWorkspace,
    handleMobileCardSelect,
    handleOpenActFields,
    handleOpenActSearchEquipment,
    handleOpenBatteryForSelection,
    handleOpenCartridgeForSelection,
    handleOpenComponentForSelection,
    handleOpenEmployee,
    handleOpenEquipmentActFile,
    handleOpenEquipmentFromEmployee,
    handleOpenLocationTransferForSelection,
    handleOpenTransferActForSelection,
    handleOpenTransferForSelection,
    handleQrScannerClose,
    handleQrScannerOpen,
    handleRecentActOpen,
    handleRecentCardOpen,
    handleSearchChange,
    handleSearchScopeChange,
    handleSelectAll,
    handleTableSort,
    handleUploadActCommit,
    handleUploadActDownload,
    handleUploadActEmailSend,
    handleUploadActFileSelect,
    handleUploadActInvNosChange,
    handleUploadActParse,
    hasExpandedVisible,
    identifyPCLoading,
    initialLoading,
    isActsScope,
    isAdmin,
    isConsumablesMode,
    isMobile,
    isServerSearchActive,
    loadedCount,
    loadingMoreEquipment,
    locationOptions,
    mobileSelectionMode,
    modeLoading,
    modelOptions,
    newEmployee,
    nextEquipmentPage,
    openAddConsumableModal,
    openAddEquipmentModal,
    openDeleteConsumableModal,
    openEditConsumableQtyModal,
    openUploadActModal,
    openUploadActPreviewInNewTab,
    openUploadActReminderTask,
    patchAddConsumableForm,
    patchAddEquipmentForm,
    patchDetailForm,
    prefetchActSearchEquipment,
    qrBatchPrint,
    qrScannerError,
    qrScannerLoading,
    qrScannerOpen,
    qrScannerReady,
    qrScannerResult,
    recentActs,
    recentActsLoading,
    recentCards,
    recentCardsLoading,
    refreshCurrentDbData,
    refreshUploadActReminderStatus,
    removeRecentAct,
    removeRecentCard,
    resetAddConsumableModels,
    resetAddEquipmentModels,
    searchLoading,
    searchLoadingMore,
    searchQuery,
    searchScope,
    searchTotal,
    seededAct,
    selectedAddEmployeeOption,
    selectedBranch,
    selectedDatabaseName,
    selectedEmployeeOption,
    selectedHiddenCount,
    selectedItems,
    selectedItemsCapabilities,
    selectedItemsSet,
    selectedTransferEmployeeOption,
    selectedVisibleCount,
    selectedWorkConsumable,
    serverSearchDegraded,
    serverTotal,
    setAddConsumableError,
    setAddEmployeeInput,
    setAddEquipmentError,
    setComponentType,
    setDetailActsError,
    setDetailError,
    setDetailHistoryError,
    setDetailQrOpen,
    setDetailSuccess,
    setDetailTab,
    setEditConsumableQtyInput,
    setFabSheetOpen,
    setMobileSelectionMode,
    setSelectedWorkConsumable,
    setUploadActAutoEmail,
    setUploadActDownloadError,
    setUploadActEmailBody,
    setUploadActEmailError,
    setUploadActEmailRecipients,
    setUploadActEmailRecipientsInput,
    setUploadActEmailSubject,
    setUploadActError,
    setUploadActInvVerified,
    startDetailEdit,
    statusOptions,
    statuses,
    tableSort,
    theme,
    toggleBranch,
    toggleLocation,
    transferActionHandlers,
    transferBranchNo,
    transferDepartment,
    transferDepartmentLoading,
    transferDepartmentOptions,
    transferEmailError,
    transferEmailLoading,
    transferEmailMode,
    transferEmailStatus,
    transferEmployeeAutocompleteOptions,
    transferEmployeeInput,
    transferEmployeeInputTrimmed,
    transferEmployeeLoading,
    transferJobPolling,
    transferLocationNo,
    transferLocationOptions,
    transferLocationsLoading,
    transferManualEmail,
    transferOperationMode,
    transferRecipient,
    transferRecipientInput,
    transferRecipientLoading,
    transferRecipientOptions,
    transferResult,
    transferRetrySubmitting,
    transferSourceDefaults,
    transferUsesManualEmployee,
    typeOptions,
    ui,
    updateUploadActFormField,
    uploadActAutoEmail,
    uploadActCommitDisabled,
    uploadActCommitResult,
    uploadActCommitting,
    uploadActDownloadError,
    uploadActDownloading,
    uploadActDraft,
    uploadActEmailBody,
    uploadActEmailError,
    uploadActEmailLastRecipients,
    uploadActEmailLoading,
    uploadActEmailRecipientOptions,
    uploadActEmailRecipients,
    uploadActEmailRecipientsInput,
    uploadActEmailRecipientsLoading,
    uploadActEmailStatus,
    uploadActEmailSubject,
    uploadActEmailSummary,
    uploadActError,
    uploadActFile,
    uploadActForm,
    uploadActInvVerification,
    uploadActInvVerified,
    uploadActModalOpen,
    uploadActParsing,
    uploadActPreviewError,
    uploadActPreviewUrl,
    uploadActReminderBinding,
    uploadActReminderError,
    uploadActReminderLoading,
    uploadActStep,
    workConsumablesLoading,
  };
}

export default useDatabasePageViewModel;
