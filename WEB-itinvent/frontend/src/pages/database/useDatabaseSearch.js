import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  debounceMs = 1200,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredData, setFilteredData] = useState(null);
  const debounceTimerRef = useRef(null);
  const searchQueryRef = useRef('');

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
  }, [searchIndex, setExpandedBranches, setExpandedLocations]);

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
    [applySearchDebounced, cancelSearchDebounce, runSearchNow]
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
  }, [selectedBranch, searchIndex, cancelSearchDebounce, runSearchNow]);

  useEffect(() => () => {
    cancelSearchDebounce();
  }, [cancelSearchDebounce]);

  const clearFilteredData = useCallback(() => {
    cancelSearchDebounce();
    setFilteredData(null);
  }, [cancelSearchDebounce]);

  const clearSearch = useCallback(() => {
    cancelSearchDebounce();
    searchQueryRef.current = '';
    setSearchQuery('');
    setFilteredData(null);
  }, [cancelSearchDebounce]);

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
