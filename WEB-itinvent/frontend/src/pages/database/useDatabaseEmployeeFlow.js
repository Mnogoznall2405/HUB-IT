import { useCallback, useEffect, useRef, useState } from 'react';

import { databaseAPI } from '../../api/database';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { parseEquipmentQrLink } from './qrModel';
import { normalizeDbId } from './databaseRecordModel';
import { deserializeDatabaseUiSnapshot } from './databaseReturnContext';
import { useDatabaseEmployeeFallback } from './useDatabaseEmployeeFallback';
import {
  EMPLOYEE_COMPARE_MAX_AGE_MS,
  EMPLOYEE_COMPARE_REFRESH_INTERVAL_MS,
  isEmployeeCompareSnapshotFresh,
  isEmployeeCompareSummaryComplete,
} from './employeeCompareModel';
import { SEARCH_SCOPE_EQUIPMENT } from './DatabaseSearchBar';

// Employee-scope controller: employee search fallback, the employee equipment
// dialog state, the batched 1C compare-summary badges, detail↔employee
// navigation, and the QR/location-state deep links. Consumed by the composer.
export function useDatabaseEmployeeFlow({
  canViewWarehouse1C,
  dbName,
  currentDb,
  initialLoading,
  equipmentRevision = 0,
  isConsumablesMode,
  searchScope,
  searchQuery,
  appliedSearchQuery,
  modeLoading,
  loadingMoreEquipment,
  nextEquipmentPage,
  hubSearchEmpty,
  employeeSearch,
  findEquipmentByInvNo,
  applyUiSnapshot,
  detailModal,
  openDetailView,
  handleDetailClose,
  location,
  navigate,
  notifyDatabaseError,
}) {
  const employeeFallback = useDatabaseEmployeeFallback({
    enabled: Boolean(
      canViewWarehouse1C
      && !isConsumablesMode
      && searchScope === SEARCH_SCOPE_EQUIPMENT
      && (!employeeSearch || employeeSearch.active)
      && !modeLoading
      && !loadingMoreEquipment
      && !nextEquipmentPage,
    ),
    searchQuery,
    appliedSearchQuery,
    hubSearchEmpty,
    employeeSearch,
  });

  const [employeeEquipmentDialog, setEmployeeEquipmentDialog] = useState({
    open: false,
    ownerNo: null,
    employeeName: '',
    warehouseRef: '',
    stackAboveParent: false,
  });
  const [detailOpenedFromEmployee, setDetailOpenedFromEmployee] = useState(false);
  const [employeeCompareSummaries, setEmployeeCompareSummaries] = useState([]);

  const compareStoreRef = useRef({ scope: '', items: new Map(), overrides: new Map() });
  const compareRequestSeqRef = useRef(0);
  const compareInFlightRef = useRef({ scope: '', seq: 0 });
  const compareRetryRef = useRef({ timer: null, attempts: 0 });
  const compareExpiryTimerRef = useRef(null);
  const compareRearmRef = useRef(() => {});
  const employeeDialogScopeRef = useRef('');

  const publishCompareSummaries = useCallback(() => {
    const store = compareStoreRef.current;
    const now = Date.now();
    for (const [ownerNo, entry] of store.items) {
      if (!isEmployeeCompareSnapshotFresh(entry.asOfMs, now)) store.items.delete(ownerNo);
    }
    for (const [ownerNo, entry] of store.overrides) {
      if (!isEmployeeCompareSnapshotFresh(entry.at, now)) store.overrides.delete(ownerNo);
    }
    const merged = new Map();
    for (const [ownerNo, entry] of store.items) merged.set(ownerNo, entry.summary);
    for (const [ownerNo, entry] of store.overrides) {
      if (entry.summary) merged.set(ownerNo, entry.summary);
      else merged.delete(ownerNo);
    }
    setEmployeeCompareSummaries([...merged.values()]);
    compareRearmRef.current();
  }, []);

  // One batched 1C call — badges next to employee names in the list.
  const fetchCompareSummaries = useCallback(async ({ refresh = false } = {}) => {
    const store = compareStoreRef.current;
    const scope = store.scope;
    if (!canViewWarehouse1C || !scope) return;
    if (!refresh && compareInFlightRef.current.scope === scope) return;
    const seq = ++compareRequestSeqRef.current;
    compareInFlightRef.current = { scope, seq };
    publishCompareSummaries();
    try {
      const data = await warehouse1cAPI.getEmployeeCompareSummary(refresh ? { refresh: true } : {});
      if (seq !== compareRequestSeqRef.current || store.scope !== scope) return;
      compareRetryRef.current.attempts = 0;
      if (!isEmployeeCompareSummaryComplete(data?.meta) || !Array.isArray(data?.items)) {
        store.items.clear();
        publishCompareSummaries();
        return;
      }
      const metaAsOf = data.meta.as_of ?? data.meta.asOf;
      const asOfMs = Date.parse(metaAsOf);
      if (!isEmployeeCompareSnapshotFresh(asOfMs)) {
        store.items.clear();
        publishCompareSummaries();
        return;
      }
      const nextItems = new Map();
      for (const item of data.items) {
        const ownerNo = Number(item?.owner_no);
        if (!Number.isInteger(ownerNo) || ownerNo <= 0) continue;
        const itemAsOf = item?.as_of ?? item?.asOf;
        const itemAsOfMs = Date.parse(itemAsOf);
        const effectiveAsOfMs = Number.isFinite(itemAsOfMs)
          ? Math.min(itemAsOfMs, asOfMs)
          : asOfMs;
        nextItems.set(ownerNo, {
          summary: { ...item, as_of: itemAsOf || metaAsOf },
          asOfMs: effectiveAsOfMs,
        });
        const override = store.overrides.get(ownerNo);
        if (override && effectiveAsOfMs > override.at) store.overrides.delete(ownerNo);
      }
      store.items = nextItems;
      publishCompareSummaries();
    } catch (err) {
      console.warn('Failed to load employee compare summary:', err);
      if (seq !== compareRequestSeqRef.current || store.scope !== scope) return;
      store.items.clear();
      publishCompareSummaries();
      const retry = compareRetryRef.current;
      if (retry.attempts < 2) {
        retry.attempts += 1;
        retry.timer = setTimeout(() => {
          retry.timer = null;
          void fetchCompareSummaries();
        }, 5000);
      }
    } finally {
      if (compareInFlightRef.current.seq === seq) {
        compareInFlightRef.current = { scope: '', seq: 0 };
      }
    }
  }, [canViewWarehouse1C, publishCompareSummaries]);

  compareRearmRef.current = () => {
    if (compareExpiryTimerRef.current) {
      clearTimeout(compareExpiryTimerRef.current);
      compareExpiryTimerRef.current = null;
    }
    const store = compareStoreRef.current;
    const scope = store.scope;
    let earliest = Infinity;
    for (const entry of store.items.values()) {
      if (Number.isFinite(entry.asOfMs) && entry.asOfMs < earliest) earliest = entry.asOfMs;
    }
    for (const entry of store.overrides.values()) {
      if (Number.isFinite(entry.at) && entry.at < earliest) earliest = entry.at;
    }
    if (!Number.isFinite(earliest)) return;
    const delay = Math.max(0, earliest + EMPLOYEE_COMPARE_MAX_AGE_MS - Date.now());
    compareExpiryTimerRef.current = setTimeout(() => {
      compareExpiryTimerRef.current = null;
      if (compareStoreRef.current.scope !== scope) return;
      publishCompareSummaries();
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (compareInFlightRef.current.scope === scope) return;
      void fetchCompareSummaries({ refresh: true });
    }, delay);
  };

  useEffect(() => {
    const scope = normalizeDbId(currentDb?.id || dbName || '');
    const store = compareStoreRef.current;
    compareRequestSeqRef.current += 1;
    const scopeChanged = Boolean(store.scope) && store.scope !== scope;
    store.scope = scope;
    store.items.clear();
    store.overrides.clear();
    if (scopeChanged) {
      employeeDialogScopeRef.current = '';
      setEmployeeEquipmentDialog((prev) => (prev.open ? {
        open: false,
        ownerNo: null,
        employeeName: '',
        warehouseRef: '',
        stackAboveParent: false,
      } : prev));
    }
    setEmployeeCompareSummaries([]);
    compareRearmRef.current();

    if (!canViewWarehouse1C || initialLoading || !scope) return undefined;

    void fetchCompareSummaries();

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchCompareSummaries();
    }, EMPLOYEE_COMPARE_REFRESH_INTERVAL_MS);

    const handleWindowFocus = () => { void fetchCompareSummaries(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void fetchCompareSummaries();
    };
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      compareRequestSeqRef.current += 1;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (compareRetryRef.current.timer) {
        clearTimeout(compareRetryRef.current.timer);
        compareRetryRef.current.timer = null;
      }
      compareRetryRef.current.attempts = 0;
      if (compareExpiryTimerRef.current) {
        clearTimeout(compareExpiryTimerRef.current);
        compareExpiryTimerRef.current = null;
      }
    };
  }, [canViewWarehouse1C, initialLoading, dbName, currentDb?.id, fetchCompareSummaries]);

  const lastCompareRevisionRef = useRef(equipmentRevision);
  useEffect(() => {
    if (equipmentRevision === lastCompareRevisionRef.current) return;
    lastCompareRevisionRef.current = equipmentRevision;
    const store = compareStoreRef.current;
    if (!canViewWarehouse1C || !store.scope) return;
    compareRequestSeqRef.current += 1;
    store.items.clear();
    store.overrides.clear();
    publishCompareSummaries();
    void fetchCompareSummaries({ refresh: true });
  }, [equipmentRevision, canViewWarehouse1C, fetchCompareSummaries, publishCompareSummaries]);

  const handleEmployeeComparisonChange = useCallback(({ ownerNo, summary } = {}) => {
    const owner = Number(ownerNo);
    if (!Number.isInteger(owner) || owner <= 0) return;
    const store = compareStoreRef.current;
    if (!store.scope || employeeDialogScopeRef.current !== store.scope) return;
    const at = Date.now();
    if (summary && typeof summary === 'object') {
      const summaryAsOf = summary.as_of ?? summary.asOf;
      const summaryAsOfMs = Date.parse(summaryAsOf);
      store.overrides.set(owner, {
        summary: {
          ...summary,
          as_of: summaryAsOf || new Date(at).toISOString(),
        },
        at: Number.isFinite(summaryAsOfMs) ? summaryAsOfMs : at,
      });
    } else {
      store.items.delete(owner);
      store.overrides.set(owner, { summary: null, at });
    }
    publishCompareSummaries();
  }, [publishCompareSummaries]);

  const handleOpenEmployee = useCallback(({ ownerNo, employeeName, warehouseRef = '' }) => {
    const normalizedEmployeeName = String(employeeName || '').trim();
    const normalizedWarehouseRef = String(warehouseRef || '').trim();
    if (!ownerNo && !normalizedEmployeeName && !normalizedWarehouseRef) return;
    if (!ownerNo && !canViewWarehouse1C) return;
    employeeDialogScopeRef.current = compareStoreRef.current.scope;
    if (ownerNo) {
      handleEmployeeComparisonChange({ ownerNo, summary: null });
    }
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
  }, [canViewWarehouse1C, detailModal.open, handleDetailClose, handleEmployeeComparisonChange]);

  const handleCloseEmployeeEquipmentDialog = useCallback(() => {
    employeeDialogScopeRef.current = '';
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
    const current = normalizeDbId(dbName || currentDb?.id || localStorage.getItem('selected_database') || '');
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
    openDetailView(item || normalized, {
      invNo: normalized,
      loading: !item,
      ...(meta?.initialTab ? { initialTab: meta.initialTab } : {}),
    });
  }, [currentDb?.id, dbName, findEquipmentByInvNo, notifyDatabaseError, openDetailView]);

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
      dbName || currentDb?.id || localStorage.getItem('selected_database') || ''
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
    dbName,
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
        const current = normalizeDbId(dbName || currentDb?.id || localStorage.getItem('selected_database') || '');
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
      employeeDialogScopeRef.current = compareStoreRef.current.scope;
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
  }, [applyUiSnapshot, currentDb?.id, dbName, findEquipmentByInvNo, location.pathname, location.state, navigate, notifyDatabaseError, openDetailView]);

  return {
    employeeFallback,
    employeeEquipmentDialog,
    detailOpenedFromEmployee,
    employeeCompareSummaries,
    handleEmployeeComparisonChange,
    handleOpenEmployee,
    handleCloseEmployeeEquipmentDialog,
    handleOpenEquipmentFromEmployee,
    handleBackToEmployeeEquipment,
    handleCloseEquipmentDetail,
  };
}
