import { useCallback, useEffect, useState } from 'react';

import { equipmentSearchAPI } from '../../api/equipmentSearch';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { resolveWarehouseErrorMessage } from './warehouse1cShared';

// Owns all remote state of the employee equipment dialog: Hub equipment list,
// the matched/candidate 1C warehouse with balances, and lazy warehouse
// movements. `resetView` is invoked whenever the dialog (re)opens or closes so
// the caller can clear its local filter state in the same pass.
export default function useEmployeeEquipmentData({
  open,
  ownerNo,
  employeeName,
  warehouseRef = '',
  canViewWarehouse1C = false,
  allowCrossDatabase = false,
  resetView,
}) {
  const [hubItems, setHubItems] = useState([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');

  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseBalancesLoading, setWarehouseBalancesLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState('');
  const [warehouseStatus, setWarehouseStatus] = useState('');
  const [warehouseInfo, setWarehouseInfo] = useState(null);
  const [warehouseCandidates, setWarehouseCandidates] = useState([]);
  const [warehouseBalances, setWarehouseBalances] = useState([]);
  const [warehouseBalancesMeta, setWarehouseBalancesMeta] = useState(null);
  const [warehouseTab, setWarehouseTab] = useState('balances');
  const [warehouseMovements, setWarehouseMovements] = useState([]);
  const [warehouseMovementsMeta, setWarehouseMovementsMeta] = useState(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState('');
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [movementsDateFrom, setMovementsDateFrom] = useState('');
  const [movementsDateTo, setMovementsDateTo] = useState('');
  const [warehouseLoaded, setWarehouseLoaded] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [employmentLabel, setEmploymentLabel] = useState('');

  const resetWarehouseState = useCallback(() => {
    setWarehouseLoading(false);
    setWarehouseBalancesLoading(false);
    setWarehouseError('');
    setWarehouseStatus('');
    setWarehouseInfo(null);
    setWarehouseCandidates([]);
    setWarehouseBalances([]);
    setWarehouseBalancesMeta(null);
    setWarehouseTab('balances');
    setWarehouseMovements([]);
    setWarehouseMovementsMeta(null);
    setMovementsLoading(false);
    setMovementsError('');
    setMovementsLoaded(false);
    setMovementsDateFrom('');
    setMovementsDateTo('');
    setWarehouseLoaded(false);
    setEmploymentStatus('');
    setEmploymentLabel('');
  }, []);

  useEffect(() => {
    const canLoadHub = Boolean(ownerNo);
    const canLoadWarehouse = Boolean(canViewWarehouse1C && (employeeName || warehouseRef));
    if (!open || (!canLoadHub && !canLoadWarehouse)) {
      setHubItems([]);
      setHubError('');
      setHubLoading(false);
      resetView?.();
      resetWarehouseState();
      return undefined;
    }

    let cancelled = false;
    setHubLoading(canLoadHub);
    setHubError('');
    if (!canLoadHub) setHubItems([]);
    resetView?.();
    resetWarehouseState();

    const hubPromise = canLoadHub
      ? equipmentSearchAPI.getEmployeeEquipment(ownerNo, {
          employeeName,
          allDatabases: allowCrossDatabase,
        })
          .then((data) => {
            if (cancelled) return;
            const items = Array.isArray(data)
              ? data
              : (Array.isArray(data?.equipment) ? data.equipment : []);
            setHubItems(items);
          })
          .catch((err) => {
            if (cancelled) return;
            console.error('Failed to load employee equipment:', err);
            setHubError('Не удалось загрузить оборудование сотрудника из Хаба.');
            setHubItems([]);
          })
          .finally(() => {
            if (!cancelled) setHubLoading(false);
          })
      : Promise.resolve();

    let warehousePromise = Promise.resolve();
    if (canLoadWarehouse) {
      setWarehouseLoading(true);
      warehousePromise = warehouse1cAPI.getEmployeeWarehouse({
        employeeName,
        warehouseRef,
        loadBalances: false,
      })
        .then((data) => {
          if (cancelled) return;
          setWarehouseStatus(data?.status || '');
          setWarehouseInfo(data?.warehouse || null);
          setWarehouseCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
          setWarehouseBalances(Array.isArray(data?.balances) ? data.balances : []);
          setWarehouseBalancesMeta(data?.balances_meta || null);
          setEmploymentStatus(data?.employment_status || '');
          setEmploymentLabel(data?.employment_label || '');
          setWarehouseLoaded(true);
          setWarehouseLoading(false);

          const matchedWarehouseRef = data?.status === 'matched' ? data?.warehouse?.ref : '';
          if (!matchedWarehouseRef) return;
          setWarehouseBalancesLoading(true);
          return warehouse1cAPI.getEmployeeWarehouse({
            employeeName,
            warehouseRef: matchedWarehouseRef,
            loadBalances: true,
          })
            .then((balancesData) => {
              if (cancelled) return;
              setWarehouseBalances(Array.isArray(balancesData?.balances) ? balancesData.balances : []);
              setWarehouseBalancesMeta(balancesData?.balances_meta || null);
              if (balancesData?.employment_status || balancesData?.employment_label) {
                setEmploymentStatus(balancesData.employment_status || '');
                setEmploymentLabel(balancesData.employment_label || '');
              }
            })
            .catch((err) => {
              if (cancelled) return;
              console.error('Failed to load employee warehouse balances from 1C:', err);
              setWarehouseError(resolveWarehouseErrorMessage(
                err,
                'Склад найден, но не удалось получить его остатки из 1С.',
              ));
            })
            .finally(() => {
              if (!cancelled) setWarehouseBalancesLoading(false);
            });
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('Failed to load employee warehouse from 1C:', err);
          setWarehouseError(resolveWarehouseErrorMessage(err, 'Не удалось получить данные склада из 1С.'));
          setWarehouseStatus('');
          setWarehouseInfo(null);
          setWarehouseCandidates([]);
          setWarehouseBalances([]);
          setWarehouseBalancesMeta(null);
          setEmploymentStatus('');
          setEmploymentLabel('');
          setWarehouseLoaded(true);
        })
        .finally(() => {
          if (!cancelled) setWarehouseLoading(false);
        });
    }

    void hubPromise;
    void warehousePromise;

    return () => {
      cancelled = true;
    };
  }, [open, ownerNo, employeeName, warehouseRef, canViewWarehouse1C, allowCrossDatabase, resetView, resetWarehouseState]);

  const loadWarehouseData = useCallback(async (nextWarehouseRef = '') => {
    if (!canViewWarehouse1C || (!employeeName && !nextWarehouseRef)) return;

    setWarehouseLoading(true);
    setWarehouseBalancesLoading(true);
    setWarehouseError('');
    try {
      const data = await warehouse1cAPI.getEmployeeWarehouse({
        employeeName,
        warehouseRef: nextWarehouseRef,
        loadBalances: true,
      });
      setWarehouseStatus(data?.status || '');
      setWarehouseInfo(data?.warehouse || null);
      setWarehouseCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
      setWarehouseBalances(Array.isArray(data?.balances) ? data.balances : []);
      setWarehouseBalancesMeta(data?.balances_meta || null);
      if (data?.employment_status || data?.employment_label) {
        setEmploymentStatus(data.employment_status || '');
        setEmploymentLabel(data.employment_label || '');
      }
      setWarehouseLoaded(true);
    } catch (err) {
      console.error('Failed to load employee warehouse from 1C:', err);
      setWarehouseError(resolveWarehouseErrorMessage(err, 'Не удалось получить данные склада из 1С.'));
      setWarehouseStatus('');
      setWarehouseInfo(null);
      setWarehouseCandidates([]);
      setWarehouseBalances([]);
      setWarehouseBalancesMeta(null);
      setWarehouseLoaded(true);
    } finally {
      setWarehouseLoading(false);
      setWarehouseBalancesLoading(false);
    }
  }, [canViewWarehouse1C, employeeName]);

  const loadWarehouseMovements = useCallback(async (cursor = '', dateFrom, dateTo) => {
    const ref = warehouseInfo?.ref;
    if (!canViewWarehouse1C || !ref) return;

    setMovementsLoading(true);
    setMovementsError('');
    try {
      const data = await warehouse1cAPI.getWarehouseMovements({
        warehouseRef: ref,
        limit: 100,
        cursor,
        dateFrom: dateFrom ?? movementsDateFrom,
        dateTo: dateTo ?? movementsDateTo,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setWarehouseMovements((prev) => (cursor ? [...prev, ...items] : items));
      setWarehouseMovementsMeta(data || null);
      setMovementsLoaded(true);
    } catch (err) {
      console.error('Failed to load warehouse movements from 1C:', err);
      setMovementsError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить перемещения склада из 1С.'));
      setMovementsLoaded(true);
    } finally {
      setMovementsLoading(false);
    }
  }, [canViewWarehouse1C, warehouseInfo?.ref, movementsDateFrom, movementsDateTo]);

  const handleLoadMoreMovements = useCallback((cursor) => {
    void loadWarehouseMovements(cursor || '');
  }, [loadWarehouseMovements]);

  const handleMovementsDatesChange = useCallback((from, to) => {
    setMovementsDateFrom(from);
    setMovementsDateTo(to);
    setWarehouseMovements([]);
    setWarehouseMovementsMeta(null);
    setMovementsLoaded(true);
    void loadWarehouseMovements('', from, to);
  }, [loadWarehouseMovements]);

  useEffect(() => {
    if (
      warehouseTab === 'movements'
      && warehouseInfo?.ref
      && !movementsLoaded
      && !movementsLoading
    ) {
      void loadWarehouseMovements();
    }
  }, [warehouseTab, warehouseInfo?.ref, movementsLoaded, movementsLoading, loadWarehouseMovements]);

  const handleSelectCandidate = useCallback((candidateRef) => {
    setMovementsLoaded(false);
    setWarehouseMovements([]);
    setWarehouseMovementsMeta(null);
    setWarehouseTab('balances');
    void loadWarehouseData(candidateRef);
  }, [loadWarehouseData]);

  return {
    hubItems,
    hubLoading,
    hubError,
    warehouseLoading,
    warehouseBalancesLoading,
    warehouseError,
    warehouseStatus,
    warehouseInfo,
    warehouseCandidates,
    warehouseBalances,
    warehouseBalancesMeta,
    warehouseTab,
    setWarehouseTab,
    warehouseMovements,
    warehouseMovementsMeta,
    movementsLoading,
    movementsError,
    movementsLoaded,
    movementsDateFrom,
    movementsDateTo,
    warehouseLoaded,
    employmentStatus,
    employmentLabel,
    handleSelectCandidate,
    handleMovementsDatesChange,
    handleLoadMoreMovements,
  };
}
