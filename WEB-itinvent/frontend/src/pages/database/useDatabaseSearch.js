import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import {
  buildDatabaseSearchIndex,
  buildSearchResultState,
  filterGroupedByBranch,
  getVisibleLocationKeys,
  mergeGroupedEquipment,
} from './databaseListModel';
import { mergeCurrentActsIntoGrouped } from './equipmentModel';
import { normalizeGroupedDatabaseData } from './textEncoding';

export const DATABASE_SEARCH_PAGE_LIMIT = 200;

// Server rows (search/universal) are flat — group into the branch→location shape
// the list renders, with the same "Не указан"/"Не указано" fallbacks.
// Client-side type scope for the fallback path — keeps the same grouped
// branch→location shape while dropping items outside the selected CI_TYPES row.
export const filterGroupedByType = (grouped, typeNo) => {
  if (typeNo == null || typeNo === '') return grouped || {};
  const wanted = String(typeNo);
  const out = {};
  Object.entries(grouped || {}).forEach(([branch, locations]) => {
    Object.entries(locations || {}).forEach(([location, items]) => {
      const kept = (items || []).filter(
        (item) => String(item?.type_no ?? item?.TYPE_NO ?? '') === wanted
      );
      if (kept.length) {
        if (!out[branch]) out[branch] = {};
        out[branch][location] = kept;
      }
    });
  });
  return out;
};

// Row keys per single-field scope — covers both universal-search aliases
// (lowercase) and raw ITEMS columns from loaded list pages.
const SEARCH_FIELD_ROW_KEYS = {
  serial: ['serial_no', 'SERIAL_NO', 'hw_serial_no', 'HW_SERIAL_NO'],
  model: ['model_name', 'MODEL_NAME'],
  inv_no: ['inv_no', 'INV_NO'],
  part_no: ['part_no', 'PART_NO'],
  employee: ['employee_name', 'EMPL_NAME', 'OWNER_DISPLAY_NAME', 'employee_dept', 'OWNER_DEPT'],
  branch: ['branch_name', 'BRANCH_NAME'],
  location: ['location_name', 'LOC_NAME'],
  status: ['status_name', 'STATUS_NAME'],
  vendor: ['vendor_name', 'VENDOR_NAME'],
  type: ['type_name', 'TYPE_NAME'],
  ip: ['ip_address', 'IP_ADDRESS'],
  mac: ['mac_address', 'MAC_ADDRESS'],
  netbios: ['network_name', 'NETBIOS_NAME', 'domain_name', 'DOMAIN_NAME'],
};

// Field-scoped contains-match for the degraded path — mirrors the server-side
// single-field LIKE so offline results stay consistent.
export const filterGroupedByFieldTerm = (grouped, field, term) => {
  const keys = SEARCH_FIELD_ROW_KEYS[String(field || '')];
  const needle = String(term || '').trim().toLowerCase();
  if (!keys || !needle) return grouped || {};
  const out = {};
  Object.entries(grouped || {}).forEach(([branch, locations]) => {
    Object.entries(locations || {}).forEach(([location, items]) => {
      const kept = (items || []).filter((item) => keys.some((key) => {
        const value = item?.[key];
        return value != null && String(value).toLowerCase().includes(needle);
      }));
      if (kept.length) {
        if (!out[branch]) out[branch] = {};
        out[branch][location] = kept;
      }
    });
  });
  return out;
};

export const groupSearchRowsByBranchLocation = (rows) => {
  const grouped = {};
  (rows || []).forEach((row) => {
    const branch = String(row?.branch_name || row?.BRANCH_NAME || '').trim() || 'Не указан';
    const location = String(
      row?.location || row?.location_name || row?.LOCATION_NAME || ''
    ).trim() || 'Не указано';
    if (!grouped[branch]) grouped[branch] = {};
    if (!grouped[branch][location]) grouped[branch][location] = [];
    grouped[branch][location].push(row);
  });
  return grouped;
};

export function useDatabaseSearch({
  allEquipment,
  selectedBranch,
  setExpandedBranches,
  setExpandedLocations,
  searchQuery,
  setSearchQuery,
  filteredData,
  setFilteredData,
  equipmentSearchEnabled = true,
  // Universal search hits only CI_TYPE=1 equipment — consumables mode and any
  // non-equipment scope stay on the client index over loaded rows.
  serverSearchEnabled = true,
  debounceMs = 300,
  searchPageLimit = DATABASE_SEARCH_PAGE_LIMIT,
  // Optional CI_TYPES.TYPE_NO scope — narrows the server search and lists the
  // whole type when the text query is empty.
  searchTypeNo = null,
  // Optional single-field scope (serial/model/inv_no/...) for the text query.
  searchField = '',
}) {
  const debounceTimerRef = useRef(null);
  const searchQueryRef = useRef(searchQuery);
  const searchTypeNoRef = useRef(searchTypeNo);
  const searchFieldRef = useRef(searchField);
  const searchSeqRef = useRef(0);
  const searchNextPageRef = useRef(null);
  const searchLoadingMoreRef = useRef(false);
  // Latest loaded rows for the offline/error fallback — kept in a ref so
  // load-more never retriggers an active search or resets expansion state.
  const allEquipmentRef = useRef(allEquipment);
  const selectedBranchRef = useRef(selectedBranch);
  // ITEMS.ID already sent to /equipment/current-acts for search rows — the list
  // loader covers only loaded list pages, so search results fetch their own badges.
  const searchActsFetchedRef = useRef(new Set());
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchTotal, setSearchTotal] = useState(null);
  const [serverSearchDegraded, setServerSearchDegraded] = useState(false);

  const cancelSearchDebounce = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const resetSearchPagination = useCallback(() => {
    searchNextPageRef.current = null;
    searchLoadingMoreRef.current = false;
    setSearchHasMore(false);
    setSearchTotal(null);
    setSearchLoadingMore(false);
  }, []);

  const expandGrouped = useCallback(
    (grouped) => {
      setExpandedBranches(new Set(Object.keys(grouped || {})));
      setExpandedLocations(new Set(getVisibleLocationKeys(grouped)));
    },
    [setExpandedBranches, setExpandedLocations]
  );

  // Degradation path: client-side index over currently loaded rows. Built
  // lazily here (not memoized) so the hot path never pays the O(n) rebuild.
  const runClientFallbackSearch = useCallback(
    (query) => {
      const typeNo = searchTypeNoRef.current;
      const field = searchFieldRef.current;
      const sourceData = filterGroupedByType(
        filterGroupedByBranch(allEquipmentRef.current, selectedBranchRef.current),
        typeNo,
      );
      const { filteredData: nextFilteredData, expandedBranches, expandedLocations } =
        field
          ? (() => {
              const scoped = filterGroupedByFieldTerm(sourceData, field, query);
              return {
                filteredData: scoped,
                expandedBranches: new Set(Object.keys(scoped)),
                expandedLocations: new Set(getVisibleLocationKeys(scoped)),
              };
            })()
          : buildSearchResultState(buildDatabaseSearchIndex(sourceData), query);
      setFilteredData(nextFilteredData ?? {});
      if (expandedBranches != null) setExpandedBranches(expandedBranches);
      if (expandedLocations != null) setExpandedLocations(expandedLocations);
    },
    [setExpandedBranches, setExpandedLocations, setFilteredData]
  );

  // Lazy act badges for search rows: same batch endpoint the list uses, merged
  // into filteredData. Silent on failure — badges stay "?" instead of blocking.
  const loadActsForSearchGrouped = useCallback((grouped, seq) => {
    if (!grouped || typeof equipmentAPI.getCurrentActs !== 'function') return;
    const freshIds = [];
    Object.values(grouped).forEach((locations) => {
      Object.values(locations || {}).forEach((items) => {
        (items || []).forEach((item) => {
          const id = Number(item?.ID ?? item?.id);
          if (Number.isFinite(id) && id > 0 && !searchActsFetchedRef.current.has(id)) {
            searchActsFetchedRef.current.add(id);
            freshIds.push(id);
          }
        });
      });
    });
    if (!freshIds.length) return;
    equipmentAPI.getCurrentActs(freshIds).then((response) => {
      if (seq !== searchSeqRef.current) return;
      const actsByItemId = {};
      (response?.items || []).forEach((entry) => {
        if (entry && entry.item_id != null) actsByItemId[entry.item_id] = entry;
      });
      if (!Object.keys(actsByItemId).length) return;
      setFilteredData((prev) => (prev == null ? prev : mergeCurrentActsIntoGrouped(prev, actsByItemId)));
    }).catch(() => {
      freshIds.forEach((id) => searchActsFetchedRef.current.delete(id));
    });
  }, [setFilteredData]);

  const runSearchNow = useCallback(
    (query) => {
      const normalized = String(query || '').trim();
      const typeNo = searchTypeNoRef.current;
      const seq = ++searchSeqRef.current;

      const hasTerm = normalized.length >= 2;
      const hasType = typeNo != null && typeNo !== '';
      if (!equipmentSearchEnabled || (!hasTerm && !hasType)) {
        setAppliedSearchQuery('');
        setFilteredData(null);
        setSearchLoading(false);
        setServerSearchDegraded(false);
        resetSearchPagination();
        return;
      }

      setAppliedSearchQuery(normalized);
      searchNextPageRef.current = null;
      searchActsFetchedRef.current.clear();
      setSearchHasMore(false);
      setSearchTotal(null);

      if (!serverSearchEnabled) {
        setSearchLoading(false);
        runClientFallbackSearch(normalized);
        return;
      }

      setSearchLoading(true);
      setServerSearchDegraded(false);

      equipmentAPI
        .searchUniversal(normalized, 1, searchPageLimit, {
          typeNo: hasType ? typeNo : null,
          field: searchFieldRef.current || '',
        })
        .then((response) => {
          if (seq !== searchSeqRef.current) return;
          const grouped = filterGroupedByBranch(
            normalizeGroupedDatabaseData(groupSearchRowsByBranchLocation(response?.equipment)),
            selectedBranchRef.current
          );
          setFilteredData(grouped);
          expandGrouped(grouped);
          loadActsForSearchGrouped(grouped, seq);
          const page = Number(response?.page) || 1;
          const pages = Number(response?.pages) || 1;
          searchNextPageRef.current = page < pages ? page + 1 : null;
          setSearchHasMore(page < pages);
          setSearchTotal(Number.isFinite(Number(response?.total)) ? Number(response.total) : null);
        })
        .catch(() => {
          if (seq !== searchSeqRef.current) return;
          runClientFallbackSearch(normalized);
          setServerSearchDegraded(true);
          resetSearchPagination();
        })
        .finally(() => {
          if (seq === searchSeqRef.current) setSearchLoading(false);
        });
    },
    [equipmentSearchEnabled, serverSearchEnabled, searchPageLimit, expandGrouped, loadActsForSearchGrouped, resetSearchPagination, runClientFallbackSearch, setFilteredData]
  );

  const loadMoreSearchResults = useCallback(() => {
    const page = searchNextPageRef.current;
    const query = String(searchQueryRef.current || '').trim();
    if (!page || !query || searchLoadingMoreRef.current) return;

    const seq = searchSeqRef.current;
    searchLoadingMoreRef.current = true;
    setSearchLoadingMore(true);

    equipmentAPI
      .searchUniversal(query, page, searchPageLimit, {
        typeNo: searchTypeNoRef.current,
        field: searchFieldRef.current || '',
      })
      .then((response) => {
        if (seq !== searchSeqRef.current) return;
        const grouped = filterGroupedByBranch(
          normalizeGroupedDatabaseData(groupSearchRowsByBranchLocation(response?.equipment)),
          selectedBranchRef.current
        );
        setFilteredData((prev) => mergeGroupedEquipment(prev || {}, grouped));
        loadActsForSearchGrouped(grouped, seq);
        // Expand newly matched branches/locations without collapsing existing.
        setExpandedBranches((prev) => new Set([...(prev || []), ...Object.keys(grouped)]));
        setExpandedLocations((prev) => new Set([...(prev || []), ...getVisibleLocationKeys(grouped)]));
        const respPage = Number(response?.page) || page;
        const pages = Number(response?.pages) || respPage;
        searchNextPageRef.current = respPage < pages ? respPage + 1 : null;
        setSearchHasMore(respPage < pages);
      })
      .catch(() => {
        // Keep what we have; next sentinel intersection retries the same page.
      })
      .finally(() => {
        searchLoadingMoreRef.current = false;
        if (seq === searchSeqRef.current) setSearchLoadingMore(false);
      });
  }, [searchPageLimit, loadActsForSearchGrouped, setExpandedBranches, setExpandedLocations, setFilteredData]);

  const applySearchDebounced = useCallback(
    (query) => {
      cancelSearchDebounce();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        runSearchNow(query);
      }, debounceMs);
    },
    [cancelSearchDebounce, debounceMs, runSearchNow]
  );

  const handleSearchChange = useCallback(
    (e) => {
      const query = e.target.value;
      setSearchQuery(query);
      searchQueryRef.current = query;

      if (!equipmentSearchEnabled) {
        cancelSearchDebounce();
        return;
      }

      // With a type scope a <2-char query still hits the server (type-only
      // listing) — debounce it like normal input instead of firing per key.
      const typeSelected = searchTypeNoRef.current != null && searchTypeNoRef.current !== '';
      if (String(query || '').trim().length < 2 && !typeSelected) {
        cancelSearchDebounce();
        runSearchNow(query);
        return;
      }

      applySearchDebounced(query);
    },
    [applySearchDebounced, cancelSearchDebounce, equipmentSearchEnabled, runSearchNow, setSearchQuery]
  );

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (!equipmentSearchEnabled) return;
      if (e.key !== 'Enter') return;
      e.preventDefault();
      cancelSearchDebounce();
      runSearchNow(searchQueryRef.current);
    },
    [cancelSearchDebounce, equipmentSearchEnabled, runSearchNow]
  );

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    allEquipmentRef.current = allEquipment;
  }, [allEquipment]);

  useEffect(() => {
    selectedBranchRef.current = selectedBranch;
  }, [selectedBranch]);

  useEffect(() => {
    searchTypeNoRef.current = searchTypeNo;
  }, [searchTypeNo]);

  useEffect(() => {
    searchFieldRef.current = searchField;
  }, [searchField]);

  // Re-run the active server query only when the branch scope, the type filter,
  // the field scope or the feature flag changes — never on load-more
  // (runSearchNow is ref-stable to data).
  useEffect(() => {
    if (!equipmentSearchEnabled) {
      cancelSearchDebounce();
      return;
    }
    cancelSearchDebounce();
    const activeQuery = String(searchQueryRef.current || '').trim();
    const typeNo = searchTypeNoRef.current;
    if (activeQuery.length >= 2 || (typeNo != null && typeNo !== '')) {
      runSearchNow(activeQuery);
      return;
    }
    setFilteredData(null);
  }, [equipmentSearchEnabled, selectedBranch, searchTypeNo, searchField, cancelSearchDebounce, runSearchNow, setFilteredData]);

  useEffect(() => () => {
    cancelSearchDebounce();
    searchSeqRef.current += 1;
  }, [cancelSearchDebounce]);

  const clearFilteredData = useCallback(() => {
    cancelSearchDebounce();
    setFilteredData(null);
  }, [cancelSearchDebounce, setFilteredData]);

  const clearSearch = useCallback(() => {
    cancelSearchDebounce();
    searchSeqRef.current += 1;
    searchActsFetchedRef.current.clear();
    searchQueryRef.current = '';
    setSearchQuery('');
    setAppliedSearchQuery('');
    setFilteredData(null);
    setSearchLoading(false);
    setServerSearchDegraded(false);
    resetSearchPagination();
  }, [cancelSearchDebounce, resetSearchPagination, setFilteredData, setSearchQuery]);

  return {
    searchQuery,
    appliedSearchQuery,
    filteredData,
    setSearchQuery,
    setFilteredData,
    searchLoading,
    searchLoadingMore,
    searchHasMore,
    searchTotal,
    serverSearchDegraded,
    loadMoreSearchResults,
    handleSearchChange,
    handleSearchKeyDown,
    clearSearch,
    clearFilteredData,
    runSearchNow,
  };
}

export default useDatabaseSearch;
