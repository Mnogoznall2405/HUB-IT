import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { settingsAPI } from '../../api/client';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  toInvNo,
} from './equipmentModel';
import { normalizeDbId } from './databaseRecordModel';
import {
  buildEquipmentIndex,
  countGroupedItems,
  getVisibleBranchNames,
} from './databaseListModel';
import {
  serializeDatabaseUiSnapshot,
} from './databaseReturnContext';
import {
  buildBranchOptions,
  buildStatusOptions,
  buildTypeOptions,
  getConsumableTypeOptions,
  getEquipmentTypeOptions,
} from './databaseOptionModel';
import { useDatabaseSearch } from './useDatabaseSearch';
import { useDatabaseActSearch } from './useDatabaseActSearch';
import { useDatabaseListNavigation } from './useDatabaseListNavigation';
import { useDatabaseRecentCards } from './useDatabaseRecentCards';
import { useDatabaseRecentActs } from './useDatabaseRecentActs';
import { useDatabaseWorkspaceIdentity } from './useDatabaseWorkspaceIdentity';
import {
  DATABASE_SWR_STALE_TIME_MS,
  useDatabaseEquipmentData,
} from './useDatabaseEquipmentData';
import { useDatabaseEquipmentInfiniteScroll } from './useDatabaseEquipmentInfiniteScroll';
import {
  flushPersistBranchFilters,
  getBranchForDatabase,
  mergeServerBranchFilters,
  resolveValidatedBranch,
  schedulePersistBranchFilters,
  setBranchForDatabase,
} from './databaseBranchPreferences';
import {
  SEARCH_SCOPE_ACTS,
  SEARCH_SCOPE_EQUIPMENT,
} from './DatabaseSearchBar';

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

// List-scope controller: data mode, branch selection, search scopes, grouped
// equipment data with infinite scroll, selection/expansion state, recents and
// per-mode UI snapshots. Consumed by the page composer.
export function useDatabaseListController({
  canViewWarehouse1C,
  dbName,
  currentDb,
  databaseReady,
  getDbCacheScope,
  notifyDatabaseSuccess,
  notifyDatabaseError,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: true });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: true });
  const isMobile = isNarrowMobile || isTouchMobile;

  const uiSnapshotsRef = useRef({
    [DATA_MODE_EQUIPMENT]: createDefaultUiSnapshot(DATA_MODE_EQUIPMENT),
    [DATA_MODE_CONSUMABLES]: createDefaultUiSnapshot(DATA_MODE_CONSUMABLES),
  });

  const [dataMode, setDataMode] = useState(DATA_MODE_EQUIPMENT);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [tableSort, setTableSort] = useState(DEFAULT_TABLE_SORT);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState(SEARCH_SCOPE_EQUIPMENT);
  const [searchTypeNo, setSearchTypeNo] = useState(null);
  const [searchField, setSearchField] = useState('');
  const [filteredData, setFilteredData] = useState(null);

  const [expandedBranches, setExpandedBranches] = useState(() => new Set());
  const [expandedLocations, setExpandedLocations] = useState(() => new Set());
  const [expandedCards, setExpandedCards] = useState(() => new Set());
  const [selectedItems, setSelectedItems] = useState([]);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
  const [fabSheetOpen, setFabSheetOpen] = useState(false);

  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;

  const equipmentData = useDatabaseEquipmentData({
    enabled: databaseReady,
    dataMode,
    selectedBranch,
    getDbCacheScope,
    setFilteredData,
    staleTimeMs: DATABASE_SWR_STALE_TIME_MS,
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
    loadingMoreEquipment,
    loadedCount,
    serverTotal,
    setAllEquipment,
    fetchAllEquipment,
    refreshCurrentDbData,
    resetAllModeData,
    switchDataMode,
    notifyDataVersion,
  } = equipmentData;

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

  const search = useDatabaseSearch({
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
    searchTypeNo,
    searchField,
  });
  const {
    handleSearchKeyDown,
    runSearchNow,
    appliedSearchQuery,
    searchLoadingMore,
    searchHasMore,
    searchTotal,
    loadMoreSearchResults,
  } = search;

  const actSearch = useDatabaseActSearch({
    searchQuery,
    searchScope,
    enabled: !isConsumablesMode,
  });
  const { resetActSearch, runActSearchNow } = actSearch;

  const workspaceIdentity = useDatabaseWorkspaceIdentity({
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
    if (!dbName) return;
    applyPersistedBranchForDatabase(dbName, branches);
  }, [applyPersistedBranchForDatabase, branches, dbName]);

  useEffect(() => {
    const syncBranchFiltersFromServer = async () => {
      if (!localStorage.getItem('user')) return;
      try {
        const data = await settingsAPI.getMySettings({ suppressAuthRequired: true });
        mergeServerBranchFilters(data?.database_branch_filters);
        if (dbName) {
          applyPersistedBranchForDatabase(dbName, branches);
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
  }, [applyPersistedBranchForDatabase, branches, dbName]);

  const displayData = filteredData !== null ? filteredData : equipment;
  const hubSearchEmpty = Boolean(
    filteredData !== null
    && Object.keys(filteredData || {}).length === 0,
  );
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
      : () => equipmentData.loadMoreEquipmentPages({ maxPages: 1 }),
  });
  const visibleBranchNames = useMemo(() => getVisibleBranchNames(displayData), [displayData]);

  // Create index Map for O(1) search instead of O(n)
  const equipmentIndex = useMemo(() => buildEquipmentIndex(allEquipment), [allEquipment]);

  // O(1) search using index
  const findEquipmentByInvNo = useCallback((invNo) => {
    return equipmentIndex.get(String(invNo)) || null;
  }, [equipmentIndex]);

  const recentCards = useDatabaseRecentCards({
    // Prefetch with inventory page so scope switches stay instant.
    enabled: databaseReady && !isConsumablesMode,
    dbName,
  });
  const isActsScopeEnabled = !isConsumablesMode && searchScope === SEARCH_SCOPE_ACTS;
  const recentActs = useDatabaseRecentActs({
    // Prefetch acts history while still on equipment scope.
    enabled: databaseReady && !isConsumablesMode,
    dbName,
  });
  const { refreshRecentCards, touchRecentCard } = recentCards;
  const { refreshRecentActs, touchRecentAct } = recentActs;
  const [seededAct, setSeededAct] = useState(null);
  const handleDetailRecentActivity = useCallback(() => {
    void refreshRecentCards();
  }, [refreshRecentCards]);
  const handleTransferJobDone = useCallback(() => {
    void refreshRecentCards();
    void refreshRecentActs();
  }, [refreshRecentActs, refreshRecentCards]);
  useEffect(() => {
    if (!isActsScopeEnabled) {
      setSeededAct(null);
    }
  }, [isActsScopeEnabled]);

  const listNavigation = useDatabaseListNavigation({
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

  const toggleCardExpanded = useCallback((invNo) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(invNo)) {
        next.delete(invNo);
      } else {
        next.add(invNo);
      }
      return next;
    });
  }, []);

  const getItemBranch = useCallback(
    (item) => String(item?.BRANCH_NAME || item?.branch_name || selectedBranch || '').trim(),
    [selectedBranch]
  );

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

  const handleBranchChange = useCallback((branch) => {
    const nextBranch = String(branch || '').trim();
    setSelectedBranch(nextBranch);
    setFilteredData(null);
    setSelectedItems([]);

    const dbId = normalizeDbId(dbName);
    if (!dbId) return;

    setBranchForDatabase(dbId, nextBranch);
    schedulePersistBranchFilters(settingsAPI.updateMySettings, { [dbId]: nextBranch });
  }, [dbName, setFilteredData]);

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

  const handleClearSelection = useCallback(() => {
    setSelectedItems([]);
    setMobileSelectionMode(false);
  }, []);

  return {
    ...equipmentData,
    ...search,
    ...actSearch,
    ...workspaceIdentity,
    ...recentCards,
    ...recentActs,
    ...listNavigation,
    theme,
    ui,
    isMobile,
    dataMode,
    setDataMode,
    selectedBranch,
    tableSort,
    searchQuery,
    setSearchQuery,
    searchScope,
    searchTypeNo,
    setSearchTypeNo,
    searchField,
    setSearchField,
    filteredData,
    setFilteredData,
    expandedBranches,
    expandedLocations,
    expandedCards,
    selectedItems,
    setSelectedItems,
    mobileSelectionMode,
    setMobileSelectionMode,
    fabSheetOpen,
    setFabSheetOpen,
    isConsumablesMode,
    isActsScope,
    displayData,
    hubSearchEmpty,
    isServerSearchActive,
    canAutoLoadMoreEquipment,
    equipmentLoadMoreSentinelRef,
    findEquipmentByInvNo,
    seededAct,
    setSeededAct,
    handleDetailRecentActivity,
    handleTransferJobDone,
    captureUiSnapshot,
    applyUiSnapshot,
    buildWarehouseReturnContext,
    handleDataModeChange,
    handleBranchChange,
    handleTableSort,
    handleClearSelection,
    handleCombinedSearchKeyDown,
    handleSearchScopeChange,
    handleRecentActOpen,
    handleActSearchSelect,
    handleActSearchOpenFile,
    toggleCardExpanded,
    getItemBranch,
    statusOptions,
    branchOptions,
    typeOptions,
    equipmentTypeOptions,
    consumableTypeOptions,
  };
}
