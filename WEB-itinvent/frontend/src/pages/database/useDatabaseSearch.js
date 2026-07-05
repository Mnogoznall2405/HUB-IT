import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  buildDatabaseSearchIndex,
  buildSearchResultState,
  filterGroupedByBranch,
} from './databaseListModel';

export function useDatabaseSearch({
  allEquipment,
  selectedBranch,
  setExpandedBranches,
  setExpandedLocations,
  searchQuery,
  setSearchQuery,
  filteredData,
  setFilteredData,
  debounceMs = 1200,
}) {
  const debounceTimerRef = useRef(null);
  const searchQueryRef = useRef(searchQuery);

  const cancelSearchDebounce = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const searchSourceData = useMemo(
    () => filterGroupedByBranch(allEquipment, selectedBranch),
    [allEquipment, selectedBranch]
  );

  const searchIndex = useMemo(() => buildDatabaseSearchIndex(searchSourceData), [searchSourceData]);

  const runSearchNow = useCallback((query) => {
    const {
      filteredData: nextFilteredData,
      expandedBranches: nextExpandedBranches,
      expandedLocations: nextExpandedLocations,
    } = buildSearchResultState(searchIndex, query);

    setFilteredData(nextFilteredData);
    if (nextExpandedBranches != null) {
      setExpandedBranches(nextExpandedBranches);
    }
    if (nextExpandedLocations != null) {
      setExpandedLocations(nextExpandedLocations);
    }
  }, [searchIndex, setExpandedBranches, setExpandedLocations, setFilteredData]);

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

      if (String(query || '').trim().length < 2) {
        cancelSearchDebounce();
        runSearchNow(query);
        return;
      }

      applySearchDebounced(query);
    },
    [applySearchDebounced, cancelSearchDebounce, runSearchNow, setSearchQuery]
  );

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      cancelSearchDebounce();
      runSearchNow(searchQueryRef.current);
    },
    [cancelSearchDebounce, runSearchNow]
  );

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    cancelSearchDebounce();
    const activeQuery = String(searchQueryRef.current || '').trim();
    if (activeQuery.length >= 2) {
      runSearchNow(activeQuery);
      return;
    }
    setFilteredData(null);
  }, [selectedBranch, searchIndex, cancelSearchDebounce, runSearchNow, setFilteredData]);

  useEffect(() => () => {
    cancelSearchDebounce();
  }, [cancelSearchDebounce]);

  const clearFilteredData = useCallback(() => {
    cancelSearchDebounce();
    setFilteredData(null);
  }, [cancelSearchDebounce, setFilteredData]);

  const clearSearch = useCallback(() => {
    cancelSearchDebounce();
    searchQueryRef.current = '';
    setSearchQuery('');
    setFilteredData(null);
  }, [cancelSearchDebounce, setFilteredData, setSearchQuery]);

  return {
    searchQuery,
    filteredData,
    setSearchQuery,
    setFilteredData,
    searchSourceData,
    searchIndex,
    handleSearchChange,
    handleSearchKeyDown,
    clearSearch,
    clearFilteredData,
    runSearchNow,
  };
}

export default useDatabaseSearch;
