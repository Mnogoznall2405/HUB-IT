import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentSearchAPI } from '../../api/equipmentSearch';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { resolveWarehouseErrorMessage } from './warehouse1cShared';

const MIN_QUERY_LENGTH = 2;
const EMPLOYEE_RESULT_LIMIT = 10;

const createEmptyState = () => ({
  active: false,
  query: '',
  loading: false,
  employees: [],
  employeeError: '',
  warehouseError: '',
  warehouseStatus: '',
  warehouse: null,
  warehouseCandidates: [],
  warehouseQuantity: null,
  employeeWarehouseResults: {},
});

const isAbortError = (error, signal) => Boolean(
  signal?.aborted
  || error?.name === 'AbortError'
  || error?.name === 'CanceledError'
  || error?.code === 'ERR_CANCELED',
);

const resolveEmployeeErrorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (detail && typeof detail === 'object') {
    const message = String(detail.message || '').trim();
    if (message) return message;
  }
  return 'Не удалось проверить справочник сотрудников Хаба.';
};

const employeeResultKey = (employee) => String(
  employee?.owner_no ?? employee?.name ?? '',
).trim();

const sumWarehouseBalances = (balances) => (Array.isArray(balances) ? balances : [])
  .reduce((total, row) => {
    const value = Number(
      row?.qty_balance
      ?? row?.quantity
      ?? row?.qty
      ?? row?.balance
      ?? 0,
    );
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

export function useDatabaseEmployeeFallback({
  enabled = false,
  searchQuery = '',
  appliedSearchQuery = '',
  hubSearchEmpty = false,
}) {
  const [state, setState] = useState(createEmptyState);
  const [retryToken, setRetryToken] = useState(0);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState(createEmptyState());
  }, []);

  const retry = useCallback(() => {
    setRetryToken((value) => value + 1);
  }, []);

  const normalizedQuery = String(searchQuery || '').trim();
  const normalizedAppliedQuery = String(appliedSearchQuery || '').trim();
  const shouldSearch = Boolean(
    enabled
    && hubSearchEmpty
    && normalizedQuery.length >= MIN_QUERY_LENGTH
    && normalizedAppliedQuery === normalizedQuery,
  );

  useEffect(() => {
    if (!shouldSearch) {
      reset();
      return undefined;
    }

    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState({
      ...createEmptyState(),
      active: true,
      query: normalizedQuery,
      loading: true,
    });

    const run = async () => {
      let employees = [];
      let employeeError = '';

      try {
        const payload = await equipmentSearchAPI.searchByEmployee(
          normalizedQuery,
          1,
          EMPLOYEE_RESULT_LIMIT,
          { signal: controller.signal },
        );
        employees = Array.isArray(payload?.employees) ? payload.employees : [];
      } catch (error) {
        if (isAbortError(error, controller.signal) || requestId !== requestIdRef.current) return;
        employeeError = resolveEmployeeErrorMessage(error);
      }

      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      if (employees.length > 1) {
        const employeeWarehouseEntries = await Promise.all(employees.map(async (employee) => {
          try {
            const payload = await warehouse1cAPI.getEmployeeWarehouse({
              employeeName: String(employee?.name || '').trim(),
              warehouseRef: '',
              loadBalances: true,
              signal: controller.signal,
            });
            return [employeeResultKey(employee), {
              status: String(payload?.status || ''),
              warehouse: payload?.warehouse || null,
              candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
              quantity: payload?.status === 'matched'
                ? sumWarehouseBalances(payload?.balances)
                : null,
              error: '',
            }];
          } catch (error) {
            if (isAbortError(error, controller.signal)) return null;
            return [employeeResultKey(employee), {
              status: 'error',
              warehouse: null,
              candidates: [],
              quantity: null,
              error: resolveWarehouseErrorMessage(
                error,
                'Не удалось проверить склад сотрудника в 1С.',
              ),
            }];
          }
        }));

        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setState({
          ...createEmptyState(),
          active: true,
          query: normalizedQuery,
          employees,
          employeeError,
          employeeWarehouseResults: Object.fromEntries(
            employeeWarehouseEntries.filter(Boolean),
          ),
        });
        return;
      }

      setState({
        ...createEmptyState(),
        active: true,
        query: normalizedQuery,
        loading: true,
        employees,
        employeeError,
      });

      const warehouseQuery = String(employees[0]?.name || normalizedQuery).trim();
      let warehousePayload = null;
      let warehouseError = '';

      try {
        warehousePayload = await warehouse1cAPI.getEmployeeWarehouse({
          employeeName: warehouseQuery,
          warehouseRef: '',
          loadBalances: true,
          signal: controller.signal,
        });
      } catch (error) {
        if (isAbortError(error, controller.signal) || requestId !== requestIdRef.current) return;
        warehouseError = resolveWarehouseErrorMessage(
          error,
          'Не удалось проверить склад сотрудника в 1С.',
        );
      }

      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      setState({
        active: true,
        query: normalizedQuery,
        loading: false,
        employees,
        employeeError,
        warehouseError,
        warehouseStatus: String(warehousePayload?.status || ''),
        warehouse: warehousePayload?.warehouse || null,
        warehouseCandidates: Array.isArray(warehousePayload?.candidates)
          ? warehousePayload.candidates
          : [],
        warehouseQuantity: warehousePayload?.status === 'matched'
          ? sumWarehouseBalances(warehousePayload?.balances)
          : null,
        employeeWarehouseResults: {},
      });
    };

    void run();

    return () => {
      controller.abort();
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    };
  }, [normalizedQuery, reset, retryToken, shouldSearch]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
  }, []);

  return {
    ...state,
    retry,
    reset,
  };
}

export default useDatabaseEmployeeFallback;
