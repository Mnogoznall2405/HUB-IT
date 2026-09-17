import { useCallback, useEffect, useMemo, useState } from 'react';

import { normalizeActionTargets } from './databaseListModel';
import { buildLocationOptions } from './databaseOptionModel';
import { normalizeText, toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';
import {
  buildTransferEmployeeInputState,
  buildTransferSourceDefaults,
  getSelectedTransferEmployeeOption,
  validateTransferEmployeeName,
} from './transferModel';

export const ACT_ONLY_EMPLOYEE_LABEL = 'Без владельца';
const INVALID_EMPLOYEE_MESSAGE =
  'Некорректное ФИО. Используйте корректное имя (2-100 символов, без спецсимволов).';

const readOwners = (response) => (Array.isArray(response?.owners) ? response.owners : []);

const dedupeOwners = (owners) => {
  const rows = Array.isArray(owners) ? owners : [];
  return rows.filter((owner, index, arr) => {
    const ownerNo = toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no);
    return (
      ownerNo !== null &&
      arr.findIndex((item) => toNumberOrNull(item?.OWNER_NO ?? item?.owner_no) === ownerNo) === index
    );
  });
};

// Form domain of the transfer dialog: field state, employee/department/location
// lookup effects and derived memos. Job polling and e-mail live in sibling
// hooks; the public contract is assembled in useDatabaseTransferAction.
export function useTransferFormState({
  actionModal,
  selectedItems = [],
  branchOptions = [],
  findEquipmentByInvNo,
  searchOwnersCached,
  getOwnerDepartmentsCached,
  getLocationsCached,
  setActionError,
  transferResult = null,
} = {}) {
  const [transferOperationMode, setTransferOperationMode] = useState(TRANSFER_OPERATION_MOVE);
  const [newEmployee, setNewEmployee] = useState('');
  const [newEmployeeNo, setNewEmployeeNo] = useState(null);
  const [transferDepartment, setTransferDepartment] = useState('');
  const [transferDepartmentOptions, setTransferDepartmentOptions] = useState([]);
  const [transferDepartmentLoading, setTransferDepartmentLoading] = useState(false);
  const [transferBranchNo, setTransferBranchNo] = useState(null);
  const [transferLocationNo, setTransferLocationNo] = useState(null);
  const [transferLocations, setTransferLocations] = useState([]);
  const [transferLocationsLoading, setTransferLocationsLoading] = useState(false);
  const [transferEmployeeInput, setTransferEmployeeInput] = useState('');
  const [transferEmployeeOptions, setTransferEmployeeOptions] = useState([]);
  const [transferEmployeeLoading, setTransferEmployeeLoading] = useState(false);

  const transferLocationOptions = useMemo(
    () => buildLocationOptions(transferLocations),
    [transferLocations]
  );

  const transferSourceDefaults = useMemo(() => {
    const invNos = normalizeActionTargets(selectedItems, actionModal?.invNo);
    const items = invNos.map((invNo) => findEquipmentByInvNo?.(invNo)).filter(Boolean);
    return buildTransferSourceDefaults({ items, branchOptions });
  }, [actionModal?.invNo, branchOptions, findEquipmentByInvNo, selectedItems]);

  const selectedTransferEmployeeOption = useMemo(
    () => getSelectedTransferEmployeeOption({
      employeeNo: newEmployeeNo,
      employeeName: newEmployee,
      employeeOptions: transferEmployeeOptions,
    }),
    [transferEmployeeOptions, newEmployeeNo, newEmployee]
  );

  const transferEmployeeInputState = useMemo(
    () => buildTransferEmployeeInputState({
      operationMode: transferOperationMode,
      transferResult,
      employeeNo: newEmployeeNo,
      employeeName: newEmployee,
      employeeInput: transferEmployeeInput,
      employeeOptions: transferEmployeeOptions,
    }),
    [
      transferOperationMode,
      transferResult,
      newEmployeeNo,
      newEmployee,
      transferEmployeeInput,
      transferEmployeeOptions,
    ]
  );

  const resetTransferFields = useCallback(() => {
    setTransferOperationMode(TRANSFER_OPERATION_MOVE);
    setNewEmployee('');
    setNewEmployeeNo(null);
    setTransferDepartment('');
    setTransferDepartmentOptions([]);
    setTransferDepartmentLoading(false);
    setTransferBranchNo(null);
    setTransferLocationNo(null);
    setTransferLocations([]);
    setTransferLocationsLoading(false);
    setTransferEmployeeInput('');
    setTransferEmployeeOptions([]);
    setTransferEmployeeLoading(false);
  }, []);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return undefined;
    const query = String(transferEmployeeInput || '').trim();
    if (query.length < 2) {
      setTransferEmployeeLoading(false);
      return undefined;
    }

    let canceled = false;
    setTransferEmployeeLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchOwnersCached?.(query, 20);
        if (canceled) return;
        const currentOption = newEmployeeNo ? [{
          OWNER_NO: newEmployeeNo,
          OWNER_DISPLAY_NAME: newEmployee || 'Не указан',
          OWNER_DEPT: '',
        }] : [];
        setTransferEmployeeOptions(dedupeOwners([...currentOption, ...readOwners(response)]));
      } catch (error) {
        console.error('Error searching transfer employees:', error);
      } finally {
        if (!canceled) setTransferEmployeeLoading(false);
      }
    }, 280);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [
    actionModal?.open,
    actionModal?.type,
    transferResult,
    transferEmployeeInput,
    newEmployeeNo,
    newEmployee,
    searchOwnersCached,
  ]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return undefined;
    if (![TRANSFER_OPERATION_MOVE, TRANSFER_OPERATION_LOCATION_ONLY].includes(transferOperationMode)) return undefined;

    let canceled = false;
    setTransferDepartmentLoading(true);
    const loadDepartments = async () => {
      try {
        const response = await getOwnerDepartmentsCached?.(1000);
        if (canceled) return;
        const raw = Array.isArray(response?.departments) ? response.departments : [];
        const normalized = raw
          .map((dept) => String(dept || '').trim())
          .filter(Boolean)
          .filter((dept, index, arr) => (
            arr.findIndex((entry) => normalizeText(entry) === normalizeText(dept)) === index
          ));
        setTransferDepartmentOptions(normalized);
      } catch (error) {
        console.error('Error loading owner departments:', error);
        if (!canceled) setTransferDepartmentOptions([]);
      } finally {
        if (!canceled) setTransferDepartmentLoading(false);
      }
    };

    void loadDepartments();
    return () => {
      canceled = true;
    };
  }, [actionModal?.open, actionModal?.type, transferResult, transferOperationMode, getOwnerDepartmentsCached]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return;
    if (transferBranchNo !== null || transferLocationNo !== null) return;
    setTransferBranchNo(transferSourceDefaults.branch_no);
    setTransferLocationNo(transferSourceDefaults.loc_no);
  }, [
    actionModal?.open,
    actionModal?.type,
    transferResult,
    transferBranchNo,
    transferLocationNo,
    transferSourceDefaults.branch_no,
    transferSourceDefaults.loc_no,
  ]);

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer' || transferResult) return undefined;
    if (![TRANSFER_OPERATION_MOVE, TRANSFER_OPERATION_LOCATION_ONLY].includes(transferOperationMode)) return undefined;
    if (!transferBranchNo) {
      setTransferLocations([]);
      setTransferLocationsLoading(false);
      setTransferLocationNo(null);
      return undefined;
    }

    let canceled = false;
    setTransferLocationsLoading(true);
    const loadLocations = async () => {
      try {
        const response = await getLocationsCached?.(transferBranchNo);
        if (canceled) return;
        const nextLocations = Array.isArray(response) ? response : [];
        setTransferLocations(nextLocations);
        setTransferLocationNo((prevLocNo) => {
          const normalizedPrev = toIdOrNull(prevLocNo);
          if (
            normalizedPrev &&
            nextLocations.some(
              (location) => toIdOrNull(location?.LOC_NO ?? location?.loc_no) === normalizedPrev
            )
          ) {
            return normalizedPrev;
          }

          const byDefaultNo = transferSourceDefaults.loc_no
            ? nextLocations.find(
              (location) => toIdOrNull(location?.LOC_NO ?? location?.loc_no) === transferSourceDefaults.loc_no
            )
            : null;
          if (byDefaultNo) return toIdOrNull(byDefaultNo?.LOC_NO ?? byDefaultNo?.loc_no);

          const byDefaultName = transferSourceDefaults.location_name
            ? nextLocations.find(
              (location) => (
                normalizeText(location?.LOC_NAME ?? location?.loc_name ?? location?.DESCR) ===
                normalizeText(transferSourceDefaults.location_name)
              )
            )
            : null;
          if (byDefaultName) return toIdOrNull(byDefaultName?.LOC_NO ?? byDefaultName?.loc_no);

          return normalizedPrev;
        });
      } catch (error) {
        console.error('Error loading transfer locations:', error);
        if (!canceled) {
          setTransferLocations([]);
          setTransferLocationNo(null);
        }
      } finally {
        if (!canceled) setTransferLocationsLoading(false);
      }
    };

    void loadLocations();
    return () => {
      canceled = true;
    };
  }, [
    actionModal?.open,
    actionModal?.type,
    transferResult,
    transferOperationMode,
    transferBranchNo,
    getLocationsCached,
    transferSourceDefaults.loc_no,
    transferSourceDefaults.location_name,
  ]);

  const handleCreateTransferEmployee = useCallback(() => {
    const candidate = String(transferEmployeeInput || '').trim();
    if (!validateTransferEmployeeName(candidate)) {
      setActionError?.(INVALID_EMPLOYEE_MESSAGE);
      return false;
    }
    setNewEmployee(candidate);
    setNewEmployeeNo(null);
    setTransferEmployeeInput(candidate);
    setActionError?.('');
    return true;
  }, [setActionError, transferEmployeeInput]);

  return {
    transferOperationMode,
    setTransferOperationMode,
    newEmployee,
    setNewEmployee,
    newEmployeeNo,
    setNewEmployeeNo,
    transferDepartment,
    setTransferDepartment,
    transferDepartmentOptions,
    transferDepartmentLoading,
    transferBranchNo,
    setTransferBranchNo,
    transferLocationNo,
    setTransferLocationNo,
    transferLocations,
    setTransferLocations,
    transferLocationOptions,
    transferLocationsLoading,
    transferEmployeeInput,
    setTransferEmployeeInput,
    transferEmployeeOptions,
    setTransferEmployeeOptions,
    transferEmployeeAutocompleteOptions: transferEmployeeInputState.autocompleteOptions,
    transferEmployeeInputTrimmed: transferEmployeeInputState.inputTrimmed,
    transferEmployeeLoading,
    selectedTransferEmployeeOption,
    transferUsesManualEmployee: transferEmployeeInputState.usesManualEmployee,
    transferSourceDefaults,
    resetTransferFields,
    handleCreateTransferEmployee,
  };
}

export default useTransferFormState;
