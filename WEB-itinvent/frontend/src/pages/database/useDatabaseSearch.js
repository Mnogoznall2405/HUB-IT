import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import {
  buildDatabaseSearchIndex,
  buildSearchResultState,
  filterGroupedByBranch,
  getVisibleLocationKeys,
  mergeGroupedEquipment,
} from './databaseListModel';
import { normalizeGroupedDatabaseData } from './textEncoding';

export const DATABASE_SEARCH_PAGE_LIMIT = 200;

// Server rows (search/universal) are flat — group into the branch→location shape
// the list renders, with the same "Не указан"/"Не указано" fallbacks.
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
}) {
  const debounceTimerRef = useRef(null);
  const searchQueryRef = useRef(searchQuery);
  const searchSeqRef = useRef(0);
  const searchNextPageRef = useRef(null);
  const searchLoadingMoreRef = useRef(false);
  // Latest loaded rows for the offline/error fallback — kept in a ref so
  // load-more never retriggers an active search or resets expansion state.
  const allEquipmentRef = useRef(allEquipment);
  const selectedBranchRef = useRef(selectedBranch);
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
      const sourceData = filterGroupedByBranch(allEquipmentRef.current, selectedBranchRef.current);
      const { filteredData: nextFilteredData, expandedBranches, expandedLocations } =
        buildSearchResultState(buildDatabaseSearchIndex(sourceData), query);
      setFilteredData(nextFilteredData ?? {});
      if (expandedBranches != null) setExpandedBranches(expandedBranches);
      if (expandedLocations != null) setExpandedLocations(expandedLocations);
    },
    [setExpandedBranches, setExpandedLocations, setFilteredData]
  );

  const runSearchNow = useCallback(
    (query) => {
      const normalized = String(query || '').trim();
      const seq = ++searchSeqRef.current;

      if (!equipmentSearchEnabled || normalized.length < 2) {
        setAppliedSearchQuery('');
        setFilteredData(null);
        setSearchLoading(false);
        setServerSearchDegraded(false);
        resetSearchPagination();
        return;
      }

      setAppliedSearchQuery(normalized);
      searchNextPageRef.current = null;
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
        .searchUniversal(normalized, 1, searchPageLimit)
        .then((response) => {
          if (seq !== searchSeqRef.current) return;
          const grouped = filterGroupedByBranch(
            normalizeGroupedDatabaseData(groupSearchRowsByBranchLocation(response?.equipment)),
            selectedBranchRef.current
          );
          setFilteredData(grouped);
          expandGrouped(grouped);
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
    [equipmentSearchEnabled, serverSearchEnabled, searchPageLimit, expandGrouped, resetSearchPagination, runClientFallbackSearch, setFilteredData]
  );

  const loadMoreSearchResults = useCallback(() => {
    const page = searchNextPageRef.current;
    const query = String(searchQueryRef.current || '').trim();
    if (!page || !query || searchLoadingMoreRef.current) return;

    const seq = searchSeqRef.current;
    searchLoadingMoreRef.current = true;
    setSearchLoadingMore(true);

    equipmentAPI
      .searchUniversal(query, page, searchPageLimit)
      .then((response) => {
        if (seq !== searchSeqRef.current) return;
        const grouped = filterGroupedByBranch(
          normalizeGroupedDatabaseData(groupSearchRowsByBranchLocation(response?.equipment)),
          selectedBranchRef.current
        );
        setFilteredData((prev) => mergeGroupedEquipment(prev || {}, grouped));
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
  }, [searchPageLimit, setExpandedBranches, setExpandedLocations, setFilteredData]);

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

      if (String(query || '').trim().length < 2) {
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

  // Re-run the active server query only when the branch scope or the feature
  // flag changes — never on load-more (runSearchNow is ref-stable to data).
  useEffect(() => {
    if (!equipmentSearchEnabled) {
      cancelSearchDebounce();
      return;
    }
    cancelSearchDebounce();
    const activeQuery = String(searchQueryRef.current || '').trim();
    if (activeQuery.length >= 2) {
      runSearchNow(activeQuery);
      return;
    }
    setFilteredData(null);
  }, [equipmentSearchEnabled, selectedBranch, cancelSearchDebounce, runSearchNow, setFilteredData]);

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
