import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import jsonAPI from '../../api/json_client';
import { readFirst } from './databaseRecordModel';
import { isCartridgeLikeConsumable } from './consumableModel';
import { getItemCapabilityFlags } from './equipmentModel';

const MAX_MODEL_LOOKUPS = 8;
const MODEL_LOOKUP_LIMIT = 8;
const MAX_SUGGESTED_PRINTERS = 12;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 350;

export const readPrinterInvNo = (item) =>
  String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();

const printerKey = (row) => {
  const invNo = readPrinterInvNo(row);
  if (invNo) return `inv:${invNo}`;
  const id = readFirst(row, ['ID', 'id'], null);
  return id !== null && id !== undefined ? `id:${id}` : null;
};

const dedupePrinters = (rows) => {
  const seen = new Set();
  const result = [];
  (rows || []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const key = printerKey(row);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
};

const onlyPrinterLike = (rows) =>
  (rows || []).filter((row) => getItemCapabilityFlags(row).isPrinterOrMfu);

const readRowLocation = (row) =>
  String(readFirst(row, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], '') || '')
    .trim().toLowerCase();

const readRowBranch = (row) =>
  String(readFirst(row, ['BRANCH_NAME', 'branch_name'], '') || '').trim().toLowerCase();

// Units stored where the consumable lives surface first — most write-offs
// happen in the same branch/location.
const sortByStorageProximity = (rows, consumableBranch, consumableLocation) =>
  (rows || [])
    .map((row, index) => {
      const sameBranch = Boolean(consumableBranch) && readRowBranch(row) === consumableBranch;
      const sameLocation = Boolean(consumableLocation) && readRowLocation(row) === consumableLocation;
      const rank = sameBranch && sameLocation ? 0 : (sameBranch || sameLocation ? 1 : 2);
      return { row, index, rank };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ row }) => row);

// Picker state for the "which MFU gets this consumable" step of the QR card.
// Compatibility is layered: cartridge_database.json suggests printer models,
// then those models are resolved against the real inventory so the user picks
// a concrete unit (inv_no/serial/branch). A free search stays available for
// models the compatibility table does not know yet.
export function useConsumableQrPrinterPicker({ open = false, item = null } = {}) {
  const isCartridgeLike = useMemo(() => isCartridgeLikeConsumable(item), [item]);
  const modelName = String(readFirst(item, ['MODEL_NAME', 'model_name'], '') || '').trim();
  const consumableBranch = readRowBranch(item);
  const consumableLocation = readRowLocation(item);
  // Identity for reset: item object is re-created after each qty patch, so
  // key on the record id (and model) instead of the reference.
  const itemKey = `${readFirst(item, ['ID', 'id'], '')}|${modelName}`;

  const [compatibleModels, setCompatibleModels] = useState(null);
  const [suggestedPrinters, setSuggestedPrinters] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [printerQuery, setPrinterQueryState] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    setCompatibleModels(null);
    setSuggestedPrinters([]);
    setSuggestionsLoading(false);
    setPrinterQueryState('');
    setSearchResults(null);
    setSearching(false);
    setSelectedPrinter(null);
  }, [open, itemKey]);

  useEffect(() => {
    if (!open || !isCartridgeLike || !modelName) return undefined;
    let cancelled = false;
    jsonAPI.getPrintersForCartridge(modelName)
      .then((response) => {
        if (cancelled) return;
        const rows = Array.isArray(response?.data?.printer_models)
          ? response.data.printer_models
          : [];
        setCompatibleModels(rows);
      })
      .catch(() => {
        if (!cancelled) setCompatibleModels([]);
      });
    return () => { cancelled = true; };
  }, [isCartridgeLike, modelName, open]);

  useEffect(() => {
    if (!open || !isCartridgeLike || !Array.isArray(compatibleModels) || compatibleModels.length === 0) {
      return undefined;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    const models = compatibleModels.slice(0, MAX_MODEL_LOOKUPS);
    Promise.all(
      models.map((model) =>
        equipmentAPI.searchUniversal(model, 1, MODEL_LOOKUP_LIMIT, { field: 'model' }).catch(() => null)
      )
    )
      .then((responses) => {
        if (cancelled) return;
        const rows = [];
        responses.forEach((response) => {
          (Array.isArray(response?.equipment) ? response.equipment : []).forEach((entry) => rows.push(entry));
        });
        setSuggestedPrinters(
          sortByStorageProximity(
            onlyPrinterLike(dedupePrinters(rows)),
            consumableBranch,
            consumableLocation
          ).slice(0, MAX_SUGGESTED_PRINTERS)
        );
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [compatibleModels, consumableBranch, consumableLocation, isCartridgeLike, open]);

  useEffect(() => {
    if (!open || !isCartridgeLike) return undefined;
    const query = printerQuery.trim();
    if (!query) {
      searchSeqRef.current += 1;
      setSearchResults(null);
      setSearching(false);
      return undefined;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      equipmentAPI.searchUniversal(query, 1, SEARCH_LIMIT)
        .then((response) => {
          if (searchSeqRef.current !== seq) return;
          const rows = Array.isArray(response?.equipment) ? response.equipment : [];
          setSearchResults(onlyPrinterLike(dedupePrinters(rows)));
        })
        .catch(() => {
          if (searchSeqRef.current === seq) setSearchResults([]);
        })
        .finally(() => {
          if (searchSeqRef.current === seq) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isCartridgeLike, open, printerQuery]);

  const setPrinterQuery = useCallback((value) => setPrinterQueryState(value), []);
  const selectPrinter = useCallback((printer) => setSelectedPrinter(printer || null), []);
  const clearPrinter = useCallback(() => setSelectedPrinter(null), []);

  return {
    isCartridgeLike,
    compatibleModels,
    suggestedPrinters,
    suggestionsLoading,
    printerQuery,
    setPrinterQuery,
    searchResults,
    searching,
    selectedPrinter,
    selectPrinter,
    clearPrinter,
  };
}

export default useConsumableQrPrinterPicker;
