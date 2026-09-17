import { useCallback, useEffect, useRef, useState } from 'react';

import { databaseAPI } from '../../api/database';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { parseEquipmentQrLink } from './qrModel';
import { normalizeDbId } from './databaseRecordModel';
import { deserializeDatabaseUiSnapshot } from './databaseReturnContext';
import { useDatabaseEmployeeFallback } from './useDatabaseEmployeeFallback';
import { isEmployeeCompareSummaryComplete } from './employeeCompareModel';
import { buildCacheKey, getOrFetchSWR } from '../../lib/swrCache';
import { SEARCH_SCOPE_EQUIPMENT } from './DatabaseSearchBar';

// Employee-scope controller: employee search fallback, the employee equipment
// dialog state, the batched 1C compare-summary badges, detail↔employee
// navigation, and the QR/location-state deep links. Consumed by the composer.
export function useDatabaseEmployeeFlow({
  canViewWarehouse1C,
  dbName,
  currentDb,
  initialLoading,
  isConsumablesMode,
  searchScope,
  searchQuery,
  appliedSearchQuery,
  modeLoading,
  loadingMoreEquipment,
  nextEquipmentPage,
  hubSearchEmpty,
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
      && !modeLoading
      && !loadingMoreEquipment
      && !nextEquipmentPage,
    ),
    searchQuery,
    appliedSearchQuery,
    hubSearchEmpty,
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

  // One batched 1C call — badges next to employee names in the list.
  useEffect(() => {
    if (!canViewWarehouse1C || initialLoading || !dbName) {
      setEmployeeCompareSummaries([]);
      return undefined;
    }
    setEmployeeCompareSummaries([]);
    let cancelled = false;
    getOrFetchSWR(
      buildCacheKey('warehouse-1c', 'employee-compare-summary', currentDb?.id || dbName || ''),
      () => warehouse1cAPI.getEmployeeCompareSummary(),
      { staleTimeMs: 120_000 },
    )
      .then(({ data }) => {
        if (cancelled) return;
        setEmployeeCompareSummaries(
          isEmployeeCompareSummaryComplete(data?.meta) && Array.isArray(data?.items)
            ? data.items
            : [],
        );
      })
      .catch((err) => {
        console.warn('Failed to load employee compare summary:', err);
      });
    return () => { cancelled = true; };
  }, [canViewWarehouse1C, initialLoading, dbName, currentDb?.id]);

  const handleOpenEmployee = useCallback(({ ownerNo, employeeName, warehouseRef = '' }) => {
    const normalizedEmployeeName = String(employeeName || '').trim();
    const normalizedWarehouseRef = String(warehouseRef || '').trim();
    if (!ownerNo && !normalizedEmployeeName && !normalizedWarehouseRef) return;
    if (!ownerNo && !canViewWarehouse1C) return;
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
  }, [canViewWarehouse1C, detailModal.open, handleDetailClose]);

  const handleCloseEmployeeEquipmentDialog = useCallback(() => {
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
    openDetailView(item || normalized, { invNo: normalized, loading: !item });
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
    handleOpenEmployee,
    handleCloseEmployeeEquipmentDialog,
    handleOpenEquipmentFromEmployee,
    handleBackToEmployeeEquipment,
    handleCloseEquipmentDetail,
  };
}
