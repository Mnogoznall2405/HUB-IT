const DEFAULT_TABLE_SORT = { field: 'employee', direction: 'asc' };

export const serializeDatabaseUiSnapshot = (snapshot = {}) => ({
  searchQuery: String(snapshot.searchQuery || ''),
  searchScope: String(snapshot.searchScope || 'equipment'),
  filteredData: snapshot.filteredData ?? null,
  tableSort: snapshot.tableSort && typeof snapshot.tableSort === 'object'
    ? {
        field: String(snapshot.tableSort.field || DEFAULT_TABLE_SORT.field),
        direction: String(snapshot.tableSort.direction || DEFAULT_TABLE_SORT.direction),
      }
    : { ...DEFAULT_TABLE_SORT },
  expandedBranches: Array.from(snapshot.expandedBranches || []),
  expandedLocations: Array.from(snapshot.expandedLocations || []),
  selectedItems: Array.from(snapshot.selectedItems || []).map((value) => String(value)),
  mobileSelectionMode: Boolean(snapshot.mobileSelectionMode),
  dataMode: String(snapshot.dataMode || 'equipment'),
});

export const deserializeDatabaseUiSnapshot = (snapshot = {}) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      searchQuery: '',
      searchScope: 'equipment',
      filteredData: null,
      tableSort: { ...DEFAULT_TABLE_SORT },
      expandedBranches: new Set(),
      expandedLocations: new Set(),
      selectedItems: [],
      mobileSelectionMode: false,
      dataMode: 'equipment',
    };
  }

  const normalized = serializeDatabaseUiSnapshot(snapshot);
  return {
    searchQuery: normalized.searchQuery,
    searchScope: normalized.searchScope || 'equipment',
    filteredData: normalized.filteredData ?? null,
    tableSort: { ...normalized.tableSort },
    expandedBranches: new Set(normalized.expandedBranches || []),
    expandedLocations: new Set(normalized.expandedLocations || []),
    selectedItems: [...(normalized.selectedItems || [])],
    mobileSelectionMode: Boolean(normalized.mobileSelectionMode),
    dataMode: normalized.dataMode || 'equipment',
  };
};

export const normalizeDatabaseReturnContext = (state) => {
  if (!state || typeof state !== 'object') return null;

  const reopenDetail = state.reopenDetail && typeof state.reopenDetail === 'object'
    ? state.reopenDetail
    : null;
  const reopenEmployee = state.reopenEmployee && typeof state.reopenEmployee === 'object'
    ? state.reopenEmployee
    : null;
  const uiSnapshot = state.uiSnapshot && typeof state.uiSnapshot === 'object'
    ? serializeDatabaseUiSnapshot(state.uiSnapshot)
    : null;

  const invNo = String(reopenDetail?.invNo || state.invNo || '').trim();
  const ownerNo = String(reopenEmployee?.ownerNo || state.ownerNo || '').trim();
  const employeeName = String(reopenEmployee?.employeeName || state.employeeName || '').trim();
  const detailTab = String(reopenDetail?.detailTab || state.detailTab || 'warehouse1c').trim() || 'warehouse1c';
  const detailData = reopenDetail?.detailData && typeof reopenDetail.detailData === 'object'
    ? reopenDetail.detailData
    : (state.detailData && typeof state.detailData === 'object' ? state.detailData : null);
  const returnTo = String(state.returnTo || '').trim() || '/database';
  const returnLabel = String(state.returnLabel || '').trim()
    || (invNo ? 'Назад к карточке' : ownerNo ? 'Назад к сотруднику' : 'Назад в Инвентарь');

  if (!invNo && !ownerNo && !state.returnTo && !reopenDetail && !reopenEmployee) {
    return null;
  }

  return {
    invNo,
    ownerNo,
    employeeName,
    detailTab,
    detailData,
    returnTo,
    returnLabel,
    uiSnapshot,
    reopenDetail,
    reopenEmployee,
  };
};
