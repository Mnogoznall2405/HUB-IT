import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// Navigation out of the employee equipment dialog into the standalone 1C
// warehouse page, carrying a return state that reopens this dialog.
export default function useEmployeeWarehouseNavigation({
  ownerNo,
  employeeName,
  warehouseRef = '',
  warehouseInfo,
  buildWarehouseReturnContext = null,
}) {
  const navigate = useNavigate();

  const returnState = useCallback(() => {
    const base = {
      returnTo: '/database',
      returnLabel: ownerNo ? 'Назад к сотруднику' : 'Назад к результату поиска',
      reopenEmployee: {
        ownerNo,
        employeeName,
        warehouseRef: warehouseInfo?.ref || warehouseRef || '',
      },
    };
    if (typeof buildWarehouseReturnContext === 'function') {
      return buildWarehouseReturnContext(base);
    }
    return base;
  }, [buildWarehouseReturnContext, employeeName, ownerNo, warehouseInfo?.ref, warehouseRef]);

  const handleOpenWarehousePage = useCallback((warehouse) => {
    if (!warehouse?.ref) return;
    const params = new URLSearchParams({
      tab: 'balances',
      warehouseRef: warehouse.ref,
      warehouseName: warehouse.name || '',
    });
    navigate(`/warehouse-1c?${params.toString()}`, { state: returnState() });
  }, [navigate, returnState]);

  const handleOpenBalanceInWarehouse1C = useCallback((row, warehouse) => {
    if (!row?.nomenclature_ref) return;
    const params = new URLSearchParams({
      tab: 'balances',
      nomenclatureRef: row.nomenclature_ref,
      nomenclatureName: row.nomenclature_name || '',
      nomenclatureCode: row.nomenclature_code || '',
    });
    if (warehouse?.ref) {
      params.set('warehouseRef', warehouse.ref);
      if (warehouse.name) params.set('warehouseName', warehouse.name);
    } else if (row.warehouse_ref) {
      params.set('warehouseRef', row.warehouse_ref);
      if (row.warehouse_name) params.set('warehouseName', row.warehouse_name);
    }
    navigate(`/warehouse-1c?${params.toString()}`, { state: returnState() });
  }, [navigate, returnState]);

  return { handleOpenWarehousePage, handleOpenBalanceInWarehouse1C };
}
