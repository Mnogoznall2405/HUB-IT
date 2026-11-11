import { useCallback, useState } from 'react';

import { warehouse1cAPI } from '../../api/warehouse1c';
import { exportEmployeeEquipmentWorkbook } from './employeeEquipmentExcel';

// Excel export of the currently visible (filtered/sorted) dialog contents.
// Loads up to 500 movements on demand when the movements tab was never opened.
export default function useEmployeeEquipmentExport({
  canViewWarehouse1C,
  compareMaps,
  employeeName,
  hubLoading,
  movementsDateFrom,
  movementsDateTo,
  movementsLoaded,
  sharedFilter,
  statusFilter,
  statusFilterActive,
  typeFilter,
  visibleHubItems,
  visibleWarehouseBalances,
  warehouseBalancesLoading,
  warehouseInfo,
  warehouseLoaded,
  warehouseLoading,
  warehouseMovements,
  warehouseStatus,
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportDisabled = exporting
    || hubLoading
    || (canViewWarehouse1C && (warehouseLoading || warehouseBalancesLoading));

  const handleExportExcel = useCallback(async () => {
    setExportError('');
    setExporting(true);
    try {
      let movements = warehouseMovements;
      if (canViewWarehouse1C && warehouseInfo?.ref && !movementsLoaded) {
        try {
          const data = await warehouse1cAPI.getWarehouseMovements({
            warehouseRef: warehouseInfo.ref,
            limit: 500,
            dateFrom: movementsDateFrom,
            dateTo: movementsDateTo,
          });
          movements = Array.isArray(data?.items) ? data.items : [];
        } catch (err) {
          console.warn('Failed to load movements for export:', err);
          movements = [];
        }
      }
      await exportEmployeeEquipmentWorkbook({
        employeeName,
        hubItems: visibleHubItems,
        warehouseBalances: visibleWarehouseBalances,
        warehouseName: warehouseInfo?.name || '',
        warehouseStatus: warehouseLoaded ? warehouseStatus : '',
        includeWarehouse: canViewWarehouse1C,
        filterText: sharedFilter,
        statusFilter: statusFilterActive ? statusFilter : '',
        typeFilter,
        compareMaps: canViewWarehouse1C ? compareMaps : null,
        movements,
      });
    } catch (err) {
      console.error('Failed to export employee equipment Excel:', err);
      setExportError('Не удалось выгрузить Excel. Попробуйте ещё раз.');
    } finally {
      setExporting(false);
    }
  }, [
    canViewWarehouse1C,
    compareMaps,
    employeeName,
    movementsDateFrom,
    movementsDateTo,
    movementsLoaded,
    sharedFilter,
    statusFilter,
    statusFilterActive,
    typeFilter,
    visibleHubItems,
    visibleWarehouseBalances,
    warehouseInfo?.name,
    warehouseInfo?.ref,
    warehouseLoaded,
    warehouseMovements,
    warehouseStatus,
  ]);

  return { exporting, exportError, exportDisabled, handleExportExcel };
}
