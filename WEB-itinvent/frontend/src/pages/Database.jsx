import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Fade,
  CircularProgress,
  useTheme,
  useMediaQuery,
  alpha,
} from '@mui/material';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { equipmentAPI, settingsAPI } from '../api/client';
import jsonAPI from '../api/json_client';
import { LoadingSpinner } from '../components/common';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { createNavigateToastAction } from '../components/feedback/toastActions';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../theme/officeUiTokens';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  getItemCapabilityFlags,
  toInvNo,
} from './database/equipmentModel';
import UploadActDialog from './database/UploadActDialog';
import ActionDialog from './database/ActionDialog';
import DatabaseDataSections from './database/DatabaseDataSections';
import DetailQrDialog from './database/DetailQrDialog';
import DeleteEquipmentDialog from './database/DeleteEquipmentDialog';
import DeleteConsumableDialog from './database/DeleteConsumableDialog';
import EditConsumableQtyDialog from './database/EditConsumableQtyDialog';
import QrScannerDialog from './database/QrScannerDialog';
import EquipmentActFieldsDialog from './database/EquipmentActFieldsDialog';
import AddConsumableDialog from './database/AddConsumableDialog';
import AddEquipmentDialog from './database/AddEquipmentDialog';
import DatabaseRecentCards from './database/DatabaseRecentCards';
import EquipmentDetailDialog from './database/EquipmentDetailDialog';
import {
  normalizeDbId,
} from './database/databaseRecordModel';
import {
  buildEquipmentIndex,
  getVisibleBranchNames,
  normalizeActionTargets,
} from './database/databaseListModel';
import {
  formatDetailDate as formatDate,
  formatDetailHistoryTransition as formatHistoryTransition,
  formatDetailHistoryValue as formatHistoryValue,
} from './database/detailModel';
import {
  buildBranchOptions,
  buildStatusOptions,
  buildTypeOptions,
  getConsumableTypeOptions,
  getEquipmentTypeOptions,
} from './database/databaseOptionModel';
import { executeMaintenanceAction, getActionErrorMessage } from './database/actionExecution';
import { useDatabaseSearch } from './database/useDatabaseSearch';
import { useDatabaseLookups } from './database/useDatabaseLookups';
import { useDatabaseSelection } from './database/useDatabaseSelection';
import { useDatabaseAddWorkflows } from './database/useDatabaseAddWorkflows';
import { useDatabaseConsumableQty } from './database/useDatabaseConsumableQty';
import { useDatabaseDeleteEquipment } from './database/useDatabaseDeleteEquipment';
import { useDatabaseConsumableDelete } from './database/useDatabaseConsumableDelete';
import { useDatabaseDetailRuntime } from './database/useDatabaseDetailRuntime';
import { useDatabaseListNavigation } from './database/useDatabaseListNavigation';
import { useDatabaseQrScanner } from './database/useDatabaseQrScanner';
import { useDatabaseRecentCards } from './database/useDatabaseRecentCards';
import { useDatabaseTransferAction } from './database/useDatabaseTransferAction';
import { useDatabaseUploadActWorkflow } from './database/useDatabaseUploadActWorkflow';
import { useDatabaseWorkspaceIdentity } from './database/useDatabaseWorkspaceIdentity';
import {
  DATABASE_SWR_STALE_TIME_MS,
  useDatabaseEquipmentData,
} from './database/useDatabaseEquipmentData';
import { useDatabaseEquipmentInfiniteScroll } from './database/useDatabaseEquipmentInfiniteScroll';
import {
  flushPersistBranchFilters,
  getBranchForDatabase,
  mergeServerBranchFilters,
  resolveValidatedBranch,
  schedulePersistBranchFilters,
  setBranchForDatabase,
} from './database/databaseBranchPreferences';
import DatabaseSearchBar from './database/DatabaseSearchBar';
import DatabaseDesktopToolbar from './database/DatabaseDesktopToolbar';
import DatabaseMobileHeader from './database/DatabaseMobileHeader';
import DatabaseMobileControlStrip from './database/DatabaseMobileControlStrip';
import DatabaseMobileActionSheet from './database/DatabaseMobileActionSheet';
import DatabaseBulkActionBar, { MOBILE_BAR_GAP, MOBILE_BAR_HEIGHT } from './database/DatabaseBulkActionBar';
import DatabaseRecentCardsStrip from './database/DatabaseRecentCardsStrip';
import DatabaseSelectionBar from './database/DatabaseSelectionBar';
import { useDatabaseMaintenanceData } from './database/useDatabaseMaintenanceData';
import {
  resolveSingleActionTarget as resolveActionTarget,
} from './database/actionModel';

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
} from './database/uploadAct';

export {
  getEquipmentRowActions,
  removeItemFromGrouped,
} from './database/equipmentModel';

const DEFAULT_TABLE_SORT = { field: 'employee', direction: 'asc' };
const CONSUMABLES_DEFAULT_TABLE_SORT = { field: 'model', direction: 'asc' };

const createDefaultUiSnapshot = (mode) => ({
  searchQuery: '',
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

function Database() {
  const { user, hasPermission } = useAuth();
  const {
    notifySuccess: pushSuccessToast,
    notifyInfo: pushInfoToast,
    notifyWarning: pushWarningToast,
    notifyError: pushErrorToast,
  } = useNotification();
  const canDatabaseWrite = hasPermission('database.write');
  const canDatabaseDelete = hasPermission('database.delete');
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
  } = useDatabaseEquipmentData({
    dataMode,
    selectedBranch,
    getDbCacheScope,
    staleTimeMs: DATABASE_SWR_STALE_TIME_MS,
  });
  const {
    handleSearchChange,
    handleSearchKeyDown,
    clearSearch,
    runSearchNow,
  } = useDatabaseSearch({
    allEquipment,
    selectedBranch,
    setExpandedBranches,
    setExpandedLocations,
    searchQuery,
    setSearchQuery,
    filteredData,
    setFilteredData,
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
    selectedItems,
    tableSort,
  ]);

  const applyUiSnapshot = useCallback((snapshot) => {
    setSearchQuery(snapshot.searchQuery);
    setFilteredData(snapshot.filteredData);
    setTableSort(snapshot.tableSort);
    setExpandedBranches(new Set(snapshot.expandedBranches));
    setExpandedLocations(new Set(snapshot.expandedLocations));
    setSelectedItems([...snapshot.selectedItems]);
    setMobileSelectionMode(snapshot.mobileSelectionMode);
  }, []);

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
  const canAutoLoadMoreEquipment = filteredData === null && Boolean(nextEquipmentPage) && !modeLoading;
  const equipmentLoadMoreSentinelRef = useDatabaseEquipmentInfiniteScroll({
    enabled: canAutoLoadMoreEquipment,
    hasMore: Boolean(nextEquipmentPage),
    loading: loadingMoreEquipment,
    nextPage: nextEquipmentPage,
    loadedCount,
    serverTotal,
    onLoadMore: () => loadMoreEquipmentPages({ maxPages: 1 }),
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
    enabled: !isConsumablesMode,
    dbName: db_name,
  });
  const handleDetailRecentActivity = useCallback(() => {
    void refreshRecentCards();
  }, [refreshRecentCards]);
  const handleTransferJobDone = useCallback(() => {
    void refreshRecentCards();
  }, [refreshRecentCards]);
  useEffect(() => {
    if (isConsumablesMode || !uploadActCommitResult?.doc_no) return;
    void refreshRecentCards();
  }, [isConsumablesMode, refreshRecentCards, uploadActCommitResult?.doc_no]);
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
  } = useDatabaseDetailRuntime({
    canDatabaseWrite,
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
    setActionError,
    setSelectedItems,
    detailInvNo: detailModal?.invNo,
    resetDetailHistory,
    navigate,
    openUploadActModalForReminder,
    onTransferJobDone: handleTransferJobDone,
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

  const dataSections = useMemo(() => {
    if (Object.keys(displayData).length === 0) return null;
    return (
      <DatabaseDataSections
        displayData={displayData}
        expandedBranches={expandedBranches}
        expandedLocations={expandedLocations}
        isMobile={isMobile}
        theme={theme}
        selectedItemsSet={selectedItemsSet}
        tableSort={tableSort}
        onTableSort={handleTableSort}
        onSelectAll={handleSelectAll}
        onSelect={handleCheckboxChange}
        onAction={handleAction}
        onEditConsumableQty={canDatabaseWrite ? openEditConsumableQtyModal : null}
        onDeleteConsumable={canDatabaseDelete ? openDeleteConsumableModal : null}
        dataMode={dataMode}
        canWrite={canDatabaseWrite}
        canDelete={canDatabaseDelete}
        isAdmin={isAdmin}
        mobileSelectionMode={mobileSelectionMode}
        onMobileCardSelect={handleMobileCardSelect}
        onToggleBranch={toggleBranch}
        onToggleLocation={toggleLocation}
      />
    );
  }, [
    canDatabaseWrite,
    canDatabaseDelete,
    dataMode,
    displayData,
    expandedBranches,
    expandedLocations,
    handleAction,
    handleCheckboxChange,
    handleMobileCardSelect,
    handleSelectAll,
    handleTableSort,
    isAdmin,
    isMobile,
    mobileSelectionMode,
    openEditConsumableQtyModal,
    openDeleteConsumableModal,
    selectedItemsSet,
    tableSort,
    theme,
    toggleBranch,
    toggleLocation,
  ]);

  if (initialLoading) {
    return (
      <MainLayout headerMode={isMobile ? 'hidden' : 'default'} showDatabaseSelector>
        <PageShell>
          <LoadingSpinner message="Загрузка данных..." />
        </PageShell>
      </MainLayout>
    );
  }

  return (
    <MainLayout headerMode={isMobile ? 'hidden' : 'default'} showDatabaseSelector>
      <PageShell sx={{
        pb: isMobile
          ? `calc(var(--app-shell-mobile-bottom-nav-height, 64px) + ${!isConsumablesMode && canDatabaseWrite && selectedItems.length > 0 ? `${MOBILE_BAR_HEIGHT + MOBILE_BAR_GAP + 4}px` : '8px'})`
          : 3,
      }}>
        {isMobile && (
          <DatabaseMobileHeader
            databases={databases}
            dbName={db_name}
            currentDb={currentDb}
            selectedDatabaseName={selectedDatabaseName}
            onDatabaseSelectChange={handleDatabaseSelectChange}
          />
        )}

        <Paper variant="outlined" sx={{ mb: isMobile ? 0.75 : 2, p: isMobile ? 0.25 : 0.5 }}>
          <Tabs
            value={dataMode}
            onChange={handleDataModeChange}
            variant="fullWidth"
            sx={isMobile ? {
              minHeight: 36,
              '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: '0.8rem' },
            } : undefined}
          >
            <Tab value={DATA_MODE_EQUIPMENT} label="Оборудование" />
            <Tab value={DATA_MODE_CONSUMABLES} label="Расходники" />
          </Tabs>
        </Paper>

        {isMobile && (
          <DatabaseMobileControlStrip
            theme={theme}
            isConsumablesMode={isConsumablesMode}
            canDatabaseWrite={canDatabaseWrite}
            branches={branches}
            selectedBranch={selectedBranch}
            onBranchChange={handleBranchChange}
            hasExpandedVisible={hasExpandedVisible}
            onCollapseAll={handleCollapseAll}
            onOpenQrScanner={handleQrScannerOpen}
            onOpenUploadAct={openUploadActModal}
            onOpenAddEquipment={openAddEquipmentModal}
            onOpenAddConsumable={openAddConsumableModal}
            onOpenMore={() => setFabSheetOpen(true)}
          />
        )}

        <DatabaseSearchBar
          theme={theme}
          compact={isMobile}
          isConsumablesMode={isConsumablesMode}
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          onClear={clearSearch}
        />

        {!isConsumablesMode && (
          isMobile ? (
            <DatabaseRecentCardsStrip
              items={recentCards}
              loading={recentCardsLoading}
              theme={theme}
              onOpen={handleRecentCardOpen}
              onClear={clearRecentCards}
            />
          ) : (
            <DatabaseRecentCards
              items={recentCards}
              loading={recentCardsLoading}
              theme={theme}
              onOpen={handleRecentCardOpen}
              onRemove={removeRecentCard}
              onClear={clearRecentCards}
            />
          )
        )}

        {!isMobile && (
          <DatabaseDesktopToolbar
            theme={theme}
            ui={ui}
            isConsumablesMode={isConsumablesMode}
            canDatabaseWrite={canDatabaseWrite}
            identifyPCLoading={identifyPCLoading}
            onOpenQrScanner={handleQrScannerOpen}
            onIdentifyWorkspace={handleIdentifyWorkspace}
            onOpenUploadAct={openUploadActModal}
            onOpenAddEquipment={openAddEquipmentModal}
            onOpenAddConsumable={openAddConsumableModal}
            branches={branches}
            selectedBranch={selectedBranch}
            onBranchChange={handleBranchChange}
            hasExpandedVisible={hasExpandedVisible}
            onCollapseAll={handleCollapseAll}
          />
        )}

        {isMobile && (
          <DatabaseMobileActionSheet
            theme={theme}
            open={fabSheetOpen}
            onClose={() => setFabSheetOpen(false)}
            isConsumablesMode={isConsumablesMode}
            identifyWorkspaceLoading={identifyPCLoading}
            hasExpandedVisible={hasExpandedVisible}
            onIdentifyWorkspace={handleIdentifyWorkspace}
            onCollapseAll={handleCollapseAll}
            onEnterSelectionMode={() => setMobileSelectionMode(true)}
          />
        )}

        {isMobile && !isConsumablesMode && canDatabaseWrite && selectedItems.length > 0 && (
          <DatabaseBulkActionBar
            theme={theme}
            ui={ui}
            variant="mobile"
            selectedItemsCount={selectedItems.length}
            selectedVisibleCount={selectedVisibleCount}
            selectedHiddenCount={selectedHiddenCount}
            selectedItemsCapabilities={selectedItemsCapabilities}
            onClearSelection={handleClearSelection}
            onOpenLocationTransfer={handleOpenLocationTransferForSelection}
            onOpenTransfer={handleOpenTransferForSelection}
            onOpenTransferAct={handleOpenTransferActForSelection}
            onOpenCartridge={handleOpenCartridgeForSelection}
            onOpenBattery={handleOpenBatteryForSelection}
            onOpenComponent={handleOpenComponentForSelection}
          />
        )}

        {!isMobile && !isConsumablesMode && canDatabaseWrite && selectedItems.length > 0 && (
          <DatabaseSelectionBar
            theme={theme}
            ui={ui}
            selectedItemsCount={selectedItems.length}
            selectedVisibleCount={selectedVisibleCount}
            selectedHiddenCount={selectedHiddenCount}
            selectedItemsCapabilities={selectedItemsCapabilities}
            onClearSelection={handleClearSelection}
            onOpenLocationTransfer={handleOpenLocationTransferForSelection}
            onOpenTransfer={handleOpenTransferForSelection}
            onOpenTransferAct={handleOpenTransferActForSelection}
            onOpenCartridge={handleOpenCartridgeForSelection}
            onOpenBattery={handleOpenBatteryForSelection}
            onOpenComponent={handleOpenComponentForSelection}
          />
        )}

        <Fade key={dataMode} in timeout={{ enter: 320, exit: 160 }}>
          <Box
            sx={{
              animation: 'database-tab-slide 320ms ease',
              '@keyframes database-tab-slide': {
                from: { opacity: 0, transform: 'translateY(8px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
              },
            }}
          >
            {modeLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, py: 6 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
            {dataSections || (
              !selectedBranch ? (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                  <Typography color="text.secondary">Выберите филиал</Typography>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                  <Typography color="text.secondary">Нет данных</Typography>
                </Box>
              )
            )}
            {canAutoLoadMoreEquipment && (
              <Box
                ref={equipmentLoadMoreSentinelRef}
                data-testid="equipment-load-more-sentinel"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  py: 3,
                  minHeight: 56,
                }}
              >
                {loadingMoreEquipment ? (
                  <CircularProgress size={24} />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Загружено {loadedCount} из {serverTotal || loadedCount}
                    {nextEquipmentPage && equipmentPagesTotal > 1
                      ? ` · стр. ${Math.max(1, nextEquipmentPage - 1)}/${equipmentPagesTotal}`
                      : ''}
                  </Typography>
                )}
              </Box>
            )}
              </>
            )}
          </Box>
        </Fade>

        <UploadActDialog
          open={uploadActModalOpen}
          onClose={closeUploadActModal}
          isMobile={isMobile}
          ui={ui}
          step={uploadActStep}
          reminderBinding={uploadActReminderBinding}
          reminderLoading={uploadActReminderLoading}
          reminderError={uploadActReminderError}
          onOpenReminderTask={openUploadActReminderTask}
          onRefreshReminder={refreshUploadActReminderStatus}
          file={uploadActFile}
          previewUrl={uploadActPreviewUrl}
          previewError={uploadActPreviewError}
          onOpenPreview={openUploadActPreviewInNewTab}
          parsing={uploadActParsing}
          committing={uploadActCommitting}
          onFileSelect={handleUploadActFileSelect}
          onParse={handleUploadActParse}
          error={uploadActError}
          onErrorClear={() => setUploadActError('')}
          draft={uploadActDraft}
          form={uploadActForm}
          autoEmail={uploadActAutoEmail}
          invVerification={uploadActInvVerification}
          invVerified={uploadActInvVerified}
          onFieldChange={updateUploadActFormField}
          onInvNosChange={handleUploadActInvNosChange}
          onAutoEmailChange={setUploadActAutoEmail}
          onInvVerifiedChange={setUploadActInvVerified}
          commitResult={uploadActCommitResult}
          commitDisabled={uploadActCommitDisabled}
          onCommit={handleUploadActCommit}
          emailSubject={uploadActEmailSubject}
          emailBody={uploadActEmailBody}
          emailRecipientOptions={uploadActEmailRecipientOptions}
          emailRecipients={uploadActEmailRecipients}
          emailRecipientsInput={uploadActEmailRecipientsInput}
          emailRecipientsLoading={uploadActEmailRecipientsLoading}
          emailLoading={uploadActEmailLoading}
          emailStatus={uploadActEmailStatus}
          emailError={uploadActEmailError}
          emailLastRecipients={uploadActEmailLastRecipients}
          emailSummary={uploadActEmailSummary}
          onEmailSubjectChange={setUploadActEmailSubject}
          onEmailBodyChange={setUploadActEmailBody}
          onEmailRecipientsInputChange={setUploadActEmailRecipientsInput}
          onEmailRecipientsChange={setUploadActEmailRecipients}
          onEmailErrorClear={() => setUploadActEmailError('')}
          onEmailSend={handleUploadActEmailSend}
          getEmailStatusItemSx={getUploadActEmailStatusItemSx}
        />

        <AddEquipmentDialog
          open={addEquipmentModalOpen}
          onClose={closeAddEquipmentModal}
          isMobile={isMobile}
          ui={ui}
          form={addEquipmentForm}
          employeeOptions={addEmployeeOptions}
          employeeLoading={addEmployeeLoading}
          selectedEmployeeOption={selectedAddEmployeeOption}
          employeeInput={addEmployeeInput}
          branchOptions={branchOptions}
          locationOptions={addLocationOptions}
          locationsLoading={addLocationsLoading}
          typeOptions={equipmentTypeOptions}
          statusOptions={statusOptions}
          modelOptions={addModelOptions}
          modelsLoading={addModelsLoading}
          usesManualEmployee={addUsesManualEmployee}
          usesManualModel={addUsesManualModel}
          loading={addEquipmentLoading}
          error={addEquipmentError}
          success={addEquipmentSuccess}
          onEmployeeInputChange={setAddEmployeeInput}
          onEmployeeSelect={setAddEmployeeInput}
          onFormPatch={patchAddEquipmentForm}
          onErrorClear={() => setAddEquipmentError('')}
          onModelsReset={resetAddEquipmentModels}
          onSubmit={handleAddEquipmentSubmit}
        />

        <AddConsumableDialog
          open={addConsumableModalOpen}
          onClose={closeAddConsumableModal}
          isMobile={isMobile}
          form={addConsumableForm}
          branchOptions={branchOptions}
          locationOptions={addConsumableLocationOptions}
          locationsLoading={addConsumableLocationsLoading}
          typeOptions={consumableTypeOptions}
          modelOptions={addConsumableModelOptions}
          modelsLoading={addConsumableModelsLoading}
          loading={addConsumableLoading}
          error={addConsumableError}
          success={addConsumableSuccess}
          onFormPatch={patchAddConsumableForm}
          onErrorClear={() => setAddConsumableError('')}
          onModelsReset={resetAddConsumableModels}
          onSubmit={handleAddConsumableSubmit}
        />

        <EditConsumableQtyDialog
          open={editConsumableQtyModal.open}
          item={editConsumableQtyModal.item}
          value={editConsumableQtyValue}
          error={editConsumableQtyError}
          loading={editConsumableQtyLoading}
          isMobile={isMobile}
          onClose={closeEditConsumableQtyModal}
          onValueChange={setEditConsumableQtyInput}
          onSubmit={handleEditConsumableQtySubmit}
        />

        <EquipmentDetailDialog
          open={detailModal.open}
          loading={detailModal.loading}
          data={detailModal.data}
          form={detailForm}
          tab={detailTab}
          editMode={detailEditMode}
          saving={detailSaving}
          hasChanges={detailHasChanges}
          canWrite={canDatabaseWrite}
          isMobile={isMobile}
          messages={{
            error: detailError,
            success: detailSuccess,
            actsError: detailActsError,
            historyError: detailHistoryError,
          }}
          options={{
            statuses: statusOptions,
            types: equipmentTypeOptions,
            models: modelOptions,
            modelsLoading: detailModelsLoading,
            branches: branchOptions,
            locations: locationOptions,
          }}
          acts={{
            items: detailActs,
            loading: detailActsLoading,
            openingDocNo: detailActOpeningDocNo,
          }}
          history={{
            items: detailHistory,
            loading: detailHistoryLoading,
          }}
          onClose={handleDetailClose}
          onKeyDown={handleDetailEditKeyDown}
          onTabChange={setDetailTab}
          onFormPatch={patchDetailForm}
          onClearError={() => setDetailError('')}
          onClearSuccess={() => setDetailSuccess('')}
          onClearActsError={() => setDetailActsError('')}
          onClearHistoryError={() => setDetailHistoryError('')}
          onStartEdit={startDetailEdit}
          onCancel={handleDetailCancel}
          onSave={handleDetailSave}
          onOpenQr={() => setDetailQrOpen(true)}
          onOpenActFields={handleOpenActFields}
          onOpenActFile={handleOpenEquipmentActFile}
          formatDate={formatDate}
          formatHistoryValue={formatHistoryValue}
          formatHistoryTransition={formatHistoryTransition}
        />

        <EquipmentActFieldsDialog
          open={detailActFieldsOpen}
          onClose={handleCloseActFields}
          isMobile={isMobile}
          selectedAct={detailActSelected}
          summary={detailActSummary}
          openingDocNo={detailActOpeningDocNo}
          onOpenFile={handleOpenEquipmentActFile}
          formatDate={formatDate}
        />

        {/* QR Scanner Dialog */}
        <QrScannerDialog
          open={qrScannerOpen}
          onClose={handleQrScannerClose}
          isMobile={isMobile}
          loading={qrScannerLoading}
          ready={qrScannerReady}
          error={qrScannerError}
          result={qrScannerResult}
          overlayBgcolor={alpha(theme.palette.background.paper, 0.82)}
        />

        <DetailQrDialog
          open={detailQrOpen}
          onClose={() => setDetailQrOpen(false)}
          isMobile={isMobile}
          borderColor={ui.borderSoft}
          loading={detailQrUrlLoading}
          url={detailQrUrl}
          text={detailQrText}
          fileName={detailQrFileName}
        />

        <DeleteEquipmentDialog
          target={deleteTarget}
          error={deleteError}
          loading={deleteLoading}
          onClose={closeDeleteEquipmentDialog}
          onConfirm={() => void confirmDeleteEquipment()}
        />

        <DeleteConsumableDialog
          target={deleteConsumableTarget}
          error={deleteConsumableError}
          loading={deleteConsumableLoading}
          onClose={closeDeleteConsumableModal}
          onConfirm={() => void confirmDeleteConsumable()}
        />

        <ActionDialog
          open={actionModal.open}
          actionModal={actionModal}
          selectedCount={selectedItems.length}
          isMobile={isMobile}
          canDatabaseWrite={canDatabaseWrite}
          actionLoading={actionLoading}
          actionError={actionError}
          onClose={() => closeActionModal()}
          transferOperationMode={transferOperationMode}
          transferResult={transferResult}
          transferContentProps={{
            isMobile,
            canDatabaseWrite,
            ui,
            theme,
            branchOptions,
            locationOptions: transferLocationOptions,
            sourceDefaults: transferSourceDefaults,
            transfer: {
              mode: transferOperationMode,
              result: transferResult,
              jobPolling: transferJobPolling,
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
            },
            email: {
              mode: transferEmailMode,
              manualEmail: transferManualEmail,
              recipientInput: transferRecipientInput,
              recipientOptions: transferRecipientOptions,
              recipient: transferRecipient,
              recipientLoading: transferRecipientLoading,
              loading: transferEmailLoading,
              status: transferEmailStatus,
              error: transferEmailError,
            },
            actions: transferActionHandlers,
          }}
          maintenanceContentProps={{
            ui,
            consumableOptions: actionWorkConsumableOptions,
            consumablesLoading: workConsumablesLoading,
            selectedConsumable: selectedWorkConsumable,
            onSelectedConsumableChange: setSelectedWorkConsumable,
            cartridgeModel,
            cartridgeHistory,
            batteryHistory,
            componentType,
            componentOptions: activeComponentOptions,
            onComponentTypeChange: setComponentType,
            componentHistory,
            cleaningHistory,
            formatDate,
          }}
          onConfirm={() => void handleActionConfirm()}
        />
      </PageShell>
    </MainLayout>
  );
}

export default Database;
