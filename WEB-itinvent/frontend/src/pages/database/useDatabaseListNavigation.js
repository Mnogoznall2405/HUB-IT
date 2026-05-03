import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildLocationKey,
  buildVisibleInvNoSet,
  countSelectedVisible,
  getSelectedItemsCapabilities,
  getVisibleLocationKeys,
  hasExpandedVisible as getHasExpandedVisible,
} from './databaseListModel';
import { toInvNo } from './equipmentModel';

export function useDatabaseListNavigation({
  displayData = {},
  visibleBranchNames = [],
  findEquipmentByInvNo,
  expandedBranches: controlledExpandedBranches,
  setExpandedBranches: controlledSetExpandedBranches,
  expandedLocations: controlledExpandedLocations,
  setExpandedLocations: controlledSetExpandedLocations,
  selectedItems: controlledSelectedItems,
  setSelectedItems: controlledSetSelectedItems,
  mobileSelectionMode: controlledMobileSelectionMode,
  setMobileSelectionMode: controlledSetMobileSelectionMode,
} = {}) {
  const [internalExpandedBranches, internalSetExpandedBranches] = useState(() => new Set());
  const [internalExpandedLocations, internalSetExpandedLocations] = useState(() => new Set());
  const [internalSelectedItems, internalSetSelectedItems] = useState([]);
  const [internalMobileSelectionMode, internalSetMobileSelectionMode] = useState(false);
  const expandedBranches = controlledExpandedBranches ?? internalExpandedBranches;
  const expandedLocations = controlledExpandedLocations ?? internalExpandedLocations;
  const selectedItems = controlledSelectedItems ?? internalSelectedItems;
  const mobileSelectionMode = controlledMobileSelectionMode ?? internalMobileSelectionMode;
  const setExpandedBranches = controlledSetExpandedBranches ?? internalSetExpandedBranches;
  const setExpandedLocations = controlledSetExpandedLocations ?? internalSetExpandedLocations;
  const setSelectedItems = controlledSetSelectedItems ?? internalSetSelectedItems;
  const setMobileSelectionMode = controlledSetMobileSelectionMode ?? internalSetMobileSelectionMode;

  const visibleLocationKeys = useMemo(
    () => getVisibleLocationKeys(displayData, visibleBranchNames),
    [displayData, visibleBranchNames]
  );

  const hasExpandedVisible = useMemo(
    () => getHasExpandedVisible({
      branchNames: visibleBranchNames,
      locationKeys: visibleLocationKeys,
      expandedBranches,
      expandedLocations,
    }),
    [visibleBranchNames, visibleLocationKeys, expandedBranches, expandedLocations]
  );

  const handleCollapseAll = useCallback(() => {
    setExpandedBranches(new Set());
    setExpandedLocations(new Set());
  }, []);

  const toggleBranch = useCallback((branchName) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchName)) {
        next.delete(branchName);
        setExpandedLocations((prevLocations) => {
          const filtered = new Set();
          prevLocations.forEach((key) => {
            if (!key.startsWith(`${branchName}::`)) {
              filtered.add(key);
            }
          });
          return filtered;
        });
      } else {
        next.add(branchName);
      }
      return next;
    });
  }, []);

  const toggleLocation = useCallback((branchName, locationName) => {
    const key = buildLocationKey(branchName, locationName);
    setExpandedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleCheckboxChange = useCallback((invNo) => {
    const normalizedInvNo = String(invNo || '').trim();
    if (!normalizedInvNo) return;

    setSelectedItems((prev) =>
      prev.includes(normalizedInvNo)
        ? prev.filter((id) => id !== normalizedInvNo)
        : [...prev, normalizedInvNo]
    );
  }, []);

  const handleMobileCardSelect = useCallback((invNo) => {
    setMobileSelectionMode(true);
    handleCheckboxChange(invNo);
  }, [handleCheckboxChange]);

  useEffect(() => {
    if (selectedItems.length === 0) {
      setMobileSelectionMode(false);
    }
  }, [selectedItems.length]);

  const handleSelectAll = useCallback((items, event) => {
    const isChecked = event?.target?.checked;
    if (isChecked) {
      const allInvNos = (items || [])
        .map((item) => toInvNo(item))
        .filter(Boolean);
      setSelectedItems(allInvNos);
    } else {
      setSelectedItems([]);
    }
  }, []);

  const selectedItemsSet = useMemo(() => new Set(selectedItems), [selectedItems]);
  const visibleInvNoSet = useMemo(() => buildVisibleInvNoSet(displayData), [displayData]);
  const selectedVisibleCount = useMemo(
    () => countSelectedVisible(selectedItems, visibleInvNoSet),
    [selectedItems, visibleInvNoSet]
  );
  const selectedHiddenCount = Math.max(0, selectedItems.length - selectedVisibleCount);

  const selectedItemsCapabilities = useMemo(
    () => getSelectedItemsCapabilities(selectedItems, findEquipmentByInvNo),
    [selectedItems, findEquipmentByInvNo]
  );

  return {
    expandedBranches,
    expandedLocations,
    selectedItems,
    mobileSelectionMode,
    visibleLocationKeys,
    hasExpandedVisible,
    selectedItemsSet,
    visibleInvNoSet,
    selectedVisibleCount,
    selectedHiddenCount,
    selectedItemsCapabilities,
    setExpandedBranches,
    setExpandedLocations,
    setSelectedItems,
    setMobileSelectionMode,
    handleCollapseAll,
    toggleBranch,
    toggleLocation,
    handleCheckboxChange,
    handleMobileCardSelect,
    handleSelectAll,
  };
}

export default useDatabaseListNavigation;
