import { useCallback, useEffect, useMemo, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import {
  buildAddConsumableDefaults,
  buildAddConsumablePayload,
  buildAddConsumableSuccessMessage,
  createAddConsumableInitialForm,
} from './consumableModel';
import { toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import {
  buildAddEquipmentDefaults,
  buildAddEquipmentPayload,
  buildAddEquipmentSuccessMessage,
  createAddEquipmentInitialForm,
} from './detailModel';
import {
  buildLocationOptions,
  buildNamedModelOptions,
  getSelectedOwnerOption,
  usesManualModel,
  usesManualOwner,
} from './databaseOptionModel';

export function useDatabaseAddWorkflows({
  canDatabaseWrite = false,
  selectedBranch = '',
  branchOptions = [],
  statusOptions = [],
  searchOwnersCached,
  getLocationsCached,
  getModelsCached,
  fetchAllEquipment,
  notifyDatabaseSuccess,
} = {}) {
  const [addEquipmentModalOpen, setAddEquipmentModalOpen] = useState(false);
  const [addEquipmentForm, setAddEquipmentForm] = useState(() => createAddEquipmentInitialForm());
  const [addEquipmentLoading, setAddEquipmentLoading] = useState(false);
  const [addEquipmentError, setAddEquipmentError] = useState('');
  const [addEquipmentSuccess, setAddEquipmentSuccess] = useState('');
  const [addEmployeeInput, setAddEmployeeInput] = useState('');
  const [addEmployeeOptions, setAddEmployeeOptions] = useState([]);
  const [addEmployeeLoading, setAddEmployeeLoading] = useState(false);
  const [addLocations, setAddLocations] = useState([]);
  const [addLocationsLoading, setAddLocationsLoading] = useState(false);
  const [addModels, setAddModels] = useState([]);
  const [addModelsLoading, setAddModelsLoading] = useState(false);

  const [addConsumableModalOpen, setAddConsumableModalOpen] = useState(false);
  const [addConsumableForm, setAddConsumableForm] = useState(() => createAddConsumableInitialForm());
  const [addConsumableLoading, setAddConsumableLoading] = useState(false);
  const [addConsumableError, setAddConsumableError] = useState('');
  const [addConsumableSuccess, setAddConsumableSuccess] = useState('');
  const [addConsumableLocations, setAddConsumableLocations] = useState([]);
  const [addConsumableLocationsLoading, setAddConsumableLocationsLoading] = useState(false);
  const [addConsumableModels, setAddConsumableModels] = useState([]);
  const [addConsumableModelsLoading, setAddConsumableModelsLoading] = useState(false);

  const getAddEquipmentDefaults = useCallback(() => (
    buildAddEquipmentDefaults({ selectedBranch, branchOptions, statusOptions })
  ), [branchOptions, selectedBranch, statusOptions]);

  const getAddConsumableDefaults = useCallback(() => (
    buildAddConsumableDefaults({ selectedBranch, branchOptions })
  ), [branchOptions, selectedBranch]);

  const addLocationOptions = useMemo(() => buildLocationOptions(addLocations), [addLocations]);
  const addModelOptions = useMemo(() => buildNamedModelOptions(addModels), [addModels]);
  const addConsumableLocationOptions = useMemo(
    () => buildLocationOptions(addConsumableLocations),
    [addConsumableLocations]
  );
  const addConsumableModelOptions = useMemo(
    () => buildNamedModelOptions(addConsumableModels),
    [addConsumableModels]
  );
  const selectedAddEmployeeOption = useMemo(
    () => getSelectedOwnerOption({
      ownerOptions: addEmployeeOptions,
      ownerNo: addEquipmentForm?.employee_no,
      ownerName: addEquipmentForm?.employee_name,
      ownerDept: addEquipmentForm?.employee_dept,
    }),
    [addEmployeeOptions, addEquipmentForm?.employee_no, addEquipmentForm?.employee_name, addEquipmentForm?.employee_dept]
  );
  const addUsesManualEmployee = useMemo(
    () => usesManualOwner({
      ownerNo: addEquipmentForm?.employee_no,
      ownerName: addEquipmentForm?.employee_name,
      options: addEmployeeOptions,
    }),
    [addEquipmentForm?.employee_no, addEquipmentForm?.employee_name, addEmployeeOptions]
  );
  const addUsesManualModel = useMemo(
    () => usesManualModel({
      modelNo: addEquipmentForm?.model_no,
      modelName: addEquipmentForm?.model_name,
      typeNo: addEquipmentForm?.type_no,
    }),
    [addEquipmentForm?.model_no, addEquipmentForm?.model_name, addEquipmentForm?.type_no, addModelOptions]
  );

  const openAddEquipmentModal = useCallback(() => {
    if (!canDatabaseWrite) return;
    setAddEquipmentError('');
    setAddEquipmentSuccess('');
    setAddEmployeeInput('');
    setAddEmployeeOptions([]);
    setAddEmployeeLoading(false);
    setAddLocations([]);
    setAddLocationsLoading(false);
    setAddModels([]);
    setAddModelsLoading(false);
    setAddEquipmentForm(getAddEquipmentDefaults());
    setAddEquipmentModalOpen(true);
  }, [canDatabaseWrite, getAddEquipmentDefaults]);

  const closeAddEquipmentModal = useCallback(() => {
    setAddEquipmentModalOpen(false);
    setAddEquipmentLoading(false);
    setAddEquipmentError('');
    setAddEquipmentSuccess('');
    setAddEmployeeInput('');
    setAddEmployeeOptions([]);
    setAddEmployeeLoading(false);
    setAddLocations([]);
    setAddLocationsLoading(false);
    setAddModels([]);
    setAddModelsLoading(false);
    setAddEquipmentForm(createAddEquipmentInitialForm());
  }, []);

  const openAddConsumableModal = useCallback(() => {
    if (!canDatabaseWrite) return;
    setAddConsumableError('');
    setAddConsumableSuccess('');
    setAddConsumableForm(getAddConsumableDefaults());
    setAddConsumableLocations([]);
    setAddConsumableModels([]);
    setAddConsumableLocationsLoading(false);
    setAddConsumableModelsLoading(false);
    setAddConsumableModalOpen(true);
  }, [canDatabaseWrite, getAddConsumableDefaults]);

  const closeAddConsumableModal = useCallback(() => {
    setAddConsumableModalOpen(false);
    setAddConsumableLoading(false);
    setAddConsumableError('');
    setAddConsumableSuccess('');
    setAddConsumableLocations([]);
    setAddConsumableModels([]);
    setAddConsumableLocationsLoading(false);
    setAddConsumableModelsLoading(false);
    setAddConsumableForm(createAddConsumableInitialForm());
  }, []);

  const patchAddEquipmentForm = useCallback((patch) => {
    setAddEquipmentForm((prev) => ({ ...prev, ...patch }));
    setAddEquipmentError('');
  }, []);

  const patchAddConsumableForm = useCallback((patch) => {
    setAddConsumableForm((prev) => ({ ...prev, ...patch }));
    setAddConsumableError('');
  }, []);

  const resetAddEquipmentModels = useCallback(() => setAddModels([]), []);
  const resetAddConsumableModels = useCallback(() => setAddConsumableModels([]), []);

  useEffect(() => {
    if (!addEquipmentModalOpen) return;
    const query = String(addEmployeeInput || '').trim();
    if (query.length < 2) {
      setAddEmployeeLoading(false);
      return;
    }

    let canceled = false;
    setAddEmployeeLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await searchOwnersCached?.(query, 20);
        if (canceled) return;
        const owners = Array.isArray(response?.owners) ? response.owners : [];
        const currentOption = addEquipmentForm?.employee_no ? [{
          OWNER_NO: addEquipmentForm.employee_no,
          OWNER_DISPLAY_NAME: addEquipmentForm.employee_name || 'Не указан',
          OWNER_DEPT: '',
        }] : [];
        const merged = [...currentOption, ...owners].filter((owner, index, arr) => {
          const ownerNo = toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no);
          return ownerNo !== null && arr.findIndex((item) => toNumberOrNull(item?.OWNER_NO ?? item?.owner_no) === ownerNo) === index;
        });
        setAddEmployeeOptions(merged);
      } catch (error) {
        console.error('Error searching add-equipment employees:', error);
      } finally {
        if (!canceled) {
          setAddEmployeeLoading(false);
        }
      }
    }, 280);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [addEquipmentModalOpen, addEmployeeInput, addEquipmentForm?.employee_no, addEquipmentForm?.employee_name, searchOwnersCached]);

  useEffect(() => {
    if (!addEquipmentModalOpen) return;
    if (!addEquipmentForm?.branch_no) {
      setAddLocations([]);
      setAddLocationsLoading(false);
      return;
    }

    let canceled = false;
    setAddLocationsLoading(true);
    const loadLocations = async () => {
      try {
        const response = await getLocationsCached?.(addEquipmentForm.branch_no);
        if (canceled) return;
        const nextLocations = Array.isArray(response) ? response : [];
        setAddLocations(nextLocations);
        const currentLocNo = toIdOrNull(addEquipmentForm.loc_no);
        if (
          currentLocNo &&
          nextLocations.some((location) => toIdOrNull(location?.LOC_NO ?? location?.loc_no) === currentLocNo)
        ) {
          return;
        }
        setAddEquipmentForm((prev) => ({ ...prev, loc_no: '' }));
      } catch (error) {
        console.error('Error loading add-equipment locations:', error);
        if (!canceled) {
          setAddLocations([]);
          setAddEquipmentForm((prev) => ({ ...prev, loc_no: '' }));
        }
      } finally {
        if (!canceled) {
          setAddLocationsLoading(false);
        }
      }
    };

    void loadLocations();
    return () => {
      canceled = true;
    };
  }, [addEquipmentModalOpen, addEquipmentForm?.branch_no, addEquipmentForm?.loc_no, getLocationsCached]);

  useEffect(() => {
    if (!addEquipmentModalOpen) return;
    if (!addEquipmentForm?.type_no) {
      setAddModels([]);
      setAddModelsLoading(false);
      return;
    }

    let canceled = false;
    setAddModelsLoading(true);
    const loadModels = async () => {
      try {
        const response = await getModelsCached?.(addEquipmentForm.type_no);
        if (canceled) return;
        const nextModels = Array.isArray(response?.models) ? response.models : [];
        setAddModels(nextModels);
      } catch (error) {
        console.error('Error loading add-equipment models:', error);
        if (!canceled) {
          setAddModels([]);
        }
      } finally {
        if (!canceled) {
          setAddModelsLoading(false);
        }
      }
    };

    void loadModels();
    return () => {
      canceled = true;
    };
  }, [addEquipmentModalOpen, addEquipmentForm?.type_no, getModelsCached]);

  useEffect(() => {
    if (!addConsumableModalOpen) return;
    if (!addConsumableForm?.branch_no) {
      setAddConsumableLocations([]);
      setAddConsumableLocationsLoading(false);
      return;
    }

    let canceled = false;
    setAddConsumableLocationsLoading(true);
    const loadLocations = async () => {
      try {
        const response = await getLocationsCached?.(addConsumableForm.branch_no);
        if (canceled) return;
        const nextLocations = Array.isArray(response) ? response : [];
        setAddConsumableLocations(nextLocations);
        const currentLocNo = toIdOrNull(addConsumableForm.loc_no);
        if (
          currentLocNo &&
          nextLocations.some((location) => toIdOrNull(location?.LOC_NO ?? location?.loc_no) === currentLocNo)
        ) {
          return;
        }
        setAddConsumableForm((prev) => ({ ...prev, loc_no: '' }));
      } catch (error) {
        console.error('Error loading add-consumable locations:', error);
        if (!canceled) {
          setAddConsumableLocations([]);
          setAddConsumableForm((prev) => ({ ...prev, loc_no: '' }));
        }
      } finally {
        if (!canceled) {
          setAddConsumableLocationsLoading(false);
        }
      }
    };

    void loadLocations();
    return () => {
      canceled = true;
    };
  }, [addConsumableModalOpen, addConsumableForm?.branch_no, addConsumableForm?.loc_no, getLocationsCached]);

  useEffect(() => {
    if (!addConsumableModalOpen) return;
    if (!addConsumableForm?.type_no) {
      setAddConsumableModels([]);
      setAddConsumableModelsLoading(false);
      return;
    }

    let canceled = false;
    setAddConsumableModelsLoading(true);
    const loadModels = async () => {
      try {
        const response = await getModelsCached?.(addConsumableForm.type_no, 4);
        if (canceled) return;
        const nextModels = Array.isArray(response?.models) ? response.models : [];
        setAddConsumableModels(nextModels);
      } catch (error) {
        console.error('Error loading add-consumable models:', error);
        if (!canceled) {
          setAddConsumableModels([]);
        }
      } finally {
        if (!canceled) {
          setAddConsumableModelsLoading(false);
        }
      }
    };

    void loadModels();
    return () => {
      canceled = true;
    };
  }, [addConsumableModalOpen, addConsumableForm?.type_no, getModelsCached]);

  const handleAddEquipmentSubmit = useCallback(async () => {
    if (!canDatabaseWrite) {
      setAddEquipmentError('Недостаточно прав для изменения данных.');
      return;
    }

    const { error, payload } = buildAddEquipmentPayload(addEquipmentForm);
    if (error) {
      setAddEquipmentError(error);
      return;
    }

    setAddEquipmentLoading(true);
    setAddEquipmentError('');
    setAddEquipmentSuccess('');
    try {
      const response = await equipmentAPI.createEquipment(payload);
      const successMessage = buildAddEquipmentSuccessMessage(response);

      setAddEquipmentSuccess(successMessage);
      notifyDatabaseSuccess?.(successMessage);
      setAddEquipmentError('');
      setAddEquipmentForm(getAddEquipmentDefaults());
      setAddEmployeeInput('');
      setAddEmployeeOptions([]);
      setAddModels([]);
      await fetchAllEquipment?.({ force: true });
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setAddEquipmentError(typeof apiDetail === 'string' ? apiDetail : 'Не удалось добавить оборудование.');
    } finally {
      setAddEquipmentLoading(false);
    }
  }, [addEquipmentForm, canDatabaseWrite, fetchAllEquipment, getAddEquipmentDefaults, notifyDatabaseSuccess]);

  const handleAddConsumableSubmit = useCallback(async () => {
    if (!canDatabaseWrite) {
      setAddConsumableError('Недостаточно прав для изменения данных.');
      return;
    }

    const { error, payload } = buildAddConsumablePayload(addConsumableForm);
    if (error) {
      setAddConsumableError(error);
      return;
    }

    setAddConsumableLoading(true);
    setAddConsumableError('');
    setAddConsumableSuccess('');
    try {
      const response = await equipmentAPI.createConsumable(payload);
      const successMessage = buildAddConsumableSuccessMessage(response);

      setAddConsumableSuccess(successMessage);
      notifyDatabaseSuccess?.(successMessage);
      setAddConsumableForm(getAddConsumableDefaults());
      setAddConsumableModels([]);
      await fetchAllEquipment?.({ force: true });
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setAddConsumableError(typeof apiDetail === 'string' ? apiDetail : 'Не удалось добавить расходник.');
    } finally {
      setAddConsumableLoading(false);
    }
  }, [addConsumableForm, canDatabaseWrite, fetchAllEquipment, getAddConsumableDefaults, notifyDatabaseSuccess]);

  return {
    addEquipmentModalOpen,
    addEquipmentForm,
    setAddEquipmentForm,
    addEquipmentLoading,
    addEquipmentError,
    setAddEquipmentError,
    addEquipmentSuccess,
    addEmployeeInput,
    setAddEmployeeInput,
    addEmployeeOptions,
    addEmployeeLoading,
    addLocationOptions,
    addLocationsLoading,
    addModelOptions,
    addModelsLoading,
    selectedAddEmployeeOption,
    addUsesManualEmployee,
    addUsesManualModel,
    openAddEquipmentModal,
    closeAddEquipmentModal,
    patchAddEquipmentForm,
    resetAddEquipmentModels,
    handleAddEquipmentSubmit,

    addConsumableModalOpen,
    addConsumableForm,
    setAddConsumableForm,
    addConsumableLoading,
    addConsumableError,
    setAddConsumableError,
    addConsumableSuccess,
    addConsumableLocationOptions,
    addConsumableLocationsLoading,
    addConsumableModelOptions,
    addConsumableModelsLoading,
    openAddConsumableModal,
    closeAddConsumableModal,
    patchAddConsumableForm,
    resetAddConsumableModels,
    handleAddConsumableSubmit,
  };
}

export default useDatabaseAddWorkflows;
