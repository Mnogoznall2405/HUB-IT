import { useCallback, useEffect, useMemo, useState } from 'react';

import { API_V1_BASE, equipmentAPI } from '../../api/client';
import {
  buildDetailActSummary,
  buildDetailFormState,
  buildDetailQrFileName,
  buildDetailUpdatePayload,
  hasDetailFormChanges,
  normalizeDetailComparable,
  toGroupedItem,
} from './detailModel';
import { readFirst, normalizeDbId, toNumberOrNull } from './databaseRecordModel';
import {
  buildDetailModelOptions,
  buildLocationOptions,
  getSelectedOwnerOption,
} from './databaseOptionModel';
import { toInvNo, upsertItemInGrouped } from './equipmentModel';
import { buildEquipmentQrDataUrl, buildEquipmentQrText } from './qrModel';

const NO_WRITE_ERROR = 'Недостаточно прав для изменения данных.';
const LOCATION_REQUIRED_ERROR = 'Выберите местоположение.';
const MODEL_REQUIRED_ERROR = 'Выберите модель для выбранного типа.';
const SAVE_ERROR = 'Ошибка при сохранении изменений.';
const ACTS_LOAD_ERROR = 'Не удалось загрузить акты оборудования.';
const HISTORY_LOAD_ERROR = 'Не удалось загрузить историю перемещений.';
const ACT_DOC_NO_ERROR = 'У акта отсутствует DOC_NO, открыть файл невозможно.';
const ACT_OPEN_ERROR = 'Не удалось открыть файл акта.';
const POPUP_BLOCKED_ERROR = 'Браузер заблокировал открытие новой вкладки. Разрешите pop-up для сайта.';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const hasFullDetailFields = (item) => {
  if (!item) return false;
  const hasPartNoField = hasOwn(item, 'PART_NO') || hasOwn(item, 'part_no');
  const hasEmployeeDeptField =
    hasOwn(item, 'OWNER_DEPT') || hasOwn(item, 'employee_dept') || hasOwn(item, 'owner_dept');
  const hasVendorField =
    hasOwn(item, 'VENDOR_NAME') || hasOwn(item, 'vendor_name') || hasOwn(item, 'MANUFACTURER') || hasOwn(item, 'manufacturer');
  const hasNetworkMetaFields =
    hasOwn(item, 'MAC_ADDRESS') ||
    hasOwn(item, 'mac_address') ||
    hasOwn(item, 'NETBIOS_NAME') ||
    hasOwn(item, 'network_name') ||
    hasOwn(item, 'DOMAIN_NAME') ||
    hasOwn(item, 'domain_name');

  return Boolean(item?.ID !== undefined && item?.ID !== null)
    && hasPartNoField
    && hasEmployeeDeptField
    && hasVendorField
    && hasNetworkMetaFields;
};

export function useDatabaseDetailRuntime({
  canDatabaseWrite = false,
  findEquipmentByInvNo,
  searchOwnersCached,
  getLocationsCached,
  getModelsCached,
  setAllEquipment,
  onRecentActivity,
} = {}) {
  const [detailModal, setDetailModal] = useState({ open: false, data: null, loading: false, invNo: null });
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailSuccess, setDetailSuccess] = useState('');
  const [detailForm, setDetailForm] = useState(null);
  const [detailInitialForm, setDetailInitialForm] = useState(null);
  const [detailLocations, setDetailLocations] = useState([]);
  const [detailModels, setDetailModels] = useState([]);
  const [detailModelsLoading, setDetailModelsLoading] = useState(false);
  const [detailEmployeeOptions, setDetailEmployeeOptions] = useState([]);
  const [detailEmployeeInput, setDetailEmployeeInput] = useState('');
  const [detailEmployeeLoading, setDetailEmployeeLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('general');
  const [detailActs, setDetailActs] = useState([]);
  const [detailActsLoading, setDetailActsLoading] = useState(false);
  const [detailActsError, setDetailActsError] = useState('');
  const [detailActsLoadedInvNo, setDetailActsLoadedInvNo] = useState('');
  const [detailHistory, setDetailHistory] = useState([]);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [detailHistoryError, setDetailHistoryError] = useState('');
  const [detailHistoryLoadedInvNo, setDetailHistoryLoadedInvNo] = useState('');
  const [detailActOpeningDocNo, setDetailActOpeningDocNo] = useState('');
  const [detailActFieldsOpen, setDetailActFieldsOpen] = useState(false);
  const [detailActSelected, setDetailActSelected] = useState(null);
  const [detailQrOpen, setDetailQrOpen] = useState(false);
  const [detailQrUrl, setDetailQrUrl] = useState('');
  const [detailQrUrlLoading, setDetailQrUrlLoading] = useState(false);

  const resetDetailTransientState = useCallback(() => {
    setDetailEditMode(false);
    setDetailSaving(false);
    setDetailError('');
    setDetailSuccess('');
    setDetailForm(null);
    setDetailInitialForm(null);
    setDetailLocations([]);
    setDetailModels([]);
    setDetailModelsLoading(false);
    setDetailEmployeeOptions([]);
    setDetailEmployeeInput('');
    setDetailEmployeeLoading(false);
    setDetailTab('general');
    setDetailActs([]);
    setDetailActsLoading(false);
    setDetailActsError('');
    setDetailActsLoadedInvNo('');
    setDetailHistory([]);
    setDetailHistoryLoading(false);
    setDetailHistoryError('');
    setDetailHistoryLoadedInvNo('');
    setDetailActOpeningDocNo('');
    setDetailActFieldsOpen(false);
    setDetailActSelected(null);
    setDetailQrOpen(false);
  }, []);

  const openDetailView = useCallback((itemOrInvNo, options = {}) => {
    const data = (itemOrInvNo && typeof itemOrInvNo === 'object') ? itemOrInvNo : options?.data || null;
    const invNo = toInvNo(itemOrInvNo) || String(options?.invNo || '').trim();
    if (!invNo) return;

    resetDetailTransientState();
    const initialTab = String(options?.initialTab || '').trim();
    if (initialTab) {
      setDetailTab(initialTab);
    }
    setDetailModal({
      open: true,
      data,
      loading: options?.loading !== undefined ? Boolean(options.loading) : !data,
      invNo,
    });
  }, [resetDetailTransientState]);

  const handleQrEquipmentFound = useCallback((found, invNo) => {
    openDetailView(found || invNo, { invNo, loading: false });
  }, [openDetailView]);

  const loadDetailedItemsByInvNos = useCallback(async (invNos) => {
    const invNoList = Array.from(
      new Set((invNos || []).map((value) => String(value || '').trim()).filter(Boolean))
    );
    const detailsMap = new Map();

    invNoList.forEach((invNo) => {
      const existingItem = findEquipmentByInvNo?.(invNo);
      if (existingItem) {
        detailsMap.set(invNo, existingItem);
      }
    });

    const missingInvNos = invNoList.filter((invNo) => !hasFullDetailFields(detailsMap.get(invNo)));
    if (missingInvNos.length === 0) return detailsMap;

    const response = await equipmentAPI.getByInvNos(missingInvNos);
    const rows = Array.isArray(response?.equipment) ? response.equipment : [];
    rows.forEach((row) => {
      const invNo = toInvNo(row);
      if (!invNo) return;
      const prev = detailsMap.get(invNo) || {};
      detailsMap.set(invNo, { ...prev, ...row });
    });

    return detailsMap;
  }, [findEquipmentByInvNo]);

  useEffect(() => {
    if (!detailModal.open || !detailModal.invNo) return undefined;
    let canceled = false;
    const invNo = String(detailModal.invNo);
    const item = findEquipmentByInvNo?.(invNo);

    if (item) {
      setDetailModal((prev) => ({ ...prev, data: item, loading: false }));
    }

    const fetchDetail = async () => {
      try {
        const detailsMap = await loadDetailedItemsByInvNos([invNo]);
        const data = detailsMap.get(invNo) || item || null;
        if (!canceled) {
          setDetailModal((prev) => ({
            ...prev,
            data: data || prev.data || null,
            loading: false,
          }));
        }
      } catch (error) {
        console.error('Error fetching equipment detail:', error);
        if (!canceled) {
          // Keep prev.data (e.g. detailSnapshot from Warehouse1C return).
          setDetailModal((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    void fetchDetail();
    return () => {
      canceled = true;
    };
  }, [detailModal.open, detailModal.invNo, findEquipmentByInvNo, loadDetailedItemsByInvNos]);

  useEffect(() => {
    if (!detailModal.open || !detailModal.data) return;
    const formState = buildDetailFormState(detailModal.data);
    setDetailForm(formState);
    setDetailInitialForm(formState);
    setDetailEditMode(false);
    setDetailError('');

    setDetailEmployeeOptions(formState.empl_no ? [{
      OWNER_NO: formState.empl_no,
      OWNER_DISPLAY_NAME: formState.employee_name || 'Не указан',
      OWNER_DEPT: formState.employee_dept || '',
    }] : []);

    setDetailModels(formState.model_no ? [{
      MODEL_NO: formState.model_no,
      MODEL_NAME: formState.model_name || 'Не указана',
      TYPE_NO: formState.type_no,
    }] : []);
  }, [detailModal.open, detailModal.data]);

  useEffect(() => {
    if (!detailModal.open || detailTab !== 'acts' || !detailModal.invNo) return undefined;
    if (detailActsLoadedInvNo === detailModal.invNo) return undefined;

    let canceled = false;
    setDetailActsLoading(true);
    setDetailActsError('');

    const loadActs = async () => {
      try {
        const response = await equipmentAPI.getEquipmentActs(detailModal.invNo);
        if (canceled) return;
        setDetailActs(Array.isArray(response?.acts) ? response.acts : []);
        setDetailActsLoadedInvNo(detailModal.invNo);
      } catch (error) {
        console.error('Error loading equipment acts:', error);
        if (canceled) return;
        const apiDetail = error?.response?.data?.detail;
        setDetailActs([]);
        setDetailActsError(typeof apiDetail === 'string' ? apiDetail : ACTS_LOAD_ERROR);
      } finally {
        if (!canceled) {
          setDetailActsLoading(false);
        }
      }
    };

    void loadActs();
    return () => {
      canceled = true;
    };
  }, [detailModal.open, detailModal.invNo, detailTab, detailActsLoadedInvNo]);

  useEffect(() => {
    if (!detailModal.open || detailTab !== 'history' || !detailModal.invNo) return undefined;
    if (detailHistoryLoadedInvNo === detailModal.invNo) return undefined;

    let canceled = false;
    setDetailHistoryLoading(true);
    setDetailHistoryError('');

    const loadHistory = async () => {
      try {
        const response = await equipmentAPI.getEquipmentHistory(detailModal.invNo);
        if (canceled) return;
        setDetailHistory(Array.isArray(response?.history) ? response.history : []);
        setDetailHistoryLoadedInvNo(detailModal.invNo);
      } catch (error) {
        console.error('Error loading equipment history:', error);
        if (canceled) return;
        const apiDetail = error?.response?.data?.detail;
        setDetailHistory([]);
        setDetailHistoryError(typeof apiDetail === 'string' ? apiDetail : HISTORY_LOAD_ERROR);
      } finally {
        if (!canceled) {
          setDetailHistoryLoading(false);
        }
      }
    };

    void loadHistory();
    return () => {
      canceled = true;
    };
  }, [detailModal.open, detailModal.invNo, detailTab, detailHistoryLoadedInvNo]);

  useEffect(() => {
    if (!detailModal.open || !detailEditMode) return undefined;

    let canceled = false;
    const loadLocations = async () => {
      try {
        const response = await getLocationsCached?.(detailForm?.branch_no);
        if (!canceled) {
          setDetailLocations(Array.isArray(response) ? response : []);
        }
      } catch (error) {
        console.error('Error loading locations for detail edit:', error);
        if (!canceled) {
          setDetailLocations([]);
        }
      }
    };

    void loadLocations();
    return () => {
      canceled = true;
    };
  }, [detailModal.open, detailEditMode, detailForm?.branch_no, getLocationsCached]);

  useEffect(() => {
    if (!detailModal.open || !detailEditMode) return undefined;
    if (!detailForm?.type_no) {
      setDetailModels([]);
      setDetailModelsLoading(false);
      return undefined;
    }

    let canceled = false;
    setDetailModelsLoading(true);
    const loadModels = async () => {
      try {
        const response = await getModelsCached?.(detailForm.type_no);
        if (!canceled) {
          setDetailModels(Array.isArray(response?.models) ? response.models : []);
        }
      } catch (error) {
        console.error('Error loading models for detail edit:', error);
        if (!canceled) {
          setDetailModels([]);
        }
      } finally {
        if (!canceled) {
          setDetailModelsLoading(false);
        }
      }
    };

    void loadModels();
    return () => {
      canceled = true;
    };
  }, [detailModal.open, detailEditMode, detailForm?.type_no, getModelsCached]);

  useEffect(() => {
    if (!detailModal.open || !detailEditMode) return undefined;
    const query = String(detailEmployeeInput || '').trim();
    if (query.length < 2) {
      setDetailEmployeeLoading(false);
      return undefined;
    }

    let canceled = false;
    setDetailEmployeeLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await searchOwnersCached?.(query, 20);
        if (canceled) return;
        const owners = Array.isArray(response?.owners) ? response.owners : [];
        const currentOption = detailForm?.empl_no ? [{
          OWNER_NO: detailForm.empl_no,
          OWNER_DISPLAY_NAME: detailForm.employee_name || 'Не указан',
          OWNER_DEPT: detailForm.employee_dept || '',
        }] : [];
        const merged = [...currentOption, ...owners].filter((owner, index, arr) => {
          const ownerNo = toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no);
          return ownerNo !== null && arr.findIndex((item) => (
            toNumberOrNull(item?.OWNER_NO ?? item?.owner_no) === ownerNo
          )) === index;
        });
        setDetailEmployeeOptions(merged);
      } catch (error) {
        console.error('Error searching owners:', error);
      } finally {
        if (!canceled) {
          setDetailEmployeeLoading(false);
        }
      }
    }, 280);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [
    detailModal.open,
    detailEditMode,
    detailEmployeeInput,
    detailForm?.empl_no,
    detailForm?.employee_name,
    detailForm?.employee_dept,
    searchOwnersCached,
  ]);

  const detailHasChanges = useMemo(
    () => hasDetailFormChanges(detailForm, detailInitialForm),
    [detailForm, detailInitialForm]
  );

  const detailQrText = useMemo(
    () => (detailModal?.data ? buildEquipmentQrText(detailModal.data) : ''),
    [detailModal?.data]
  );

  useEffect(() => {
    let canceled = false;
    const generateQr = async () => {
      const text = String(detailQrText || '').trim();
      setDetailQrUrl('');
      if (!text) {
        setDetailQrUrlLoading(false);
        return;
      }

      setDetailQrUrlLoading(true);
      try {
        const dataUrl = await buildEquipmentQrDataUrl(text);
        if (!canceled) {
          setDetailQrUrl(dataUrl);
        }
      } catch (error) {
        console.error('Error generating equipment QR:', error);
        if (!canceled) {
          setDetailQrUrl('');
        }
      } finally {
        if (!canceled) {
          setDetailQrUrlLoading(false);
        }
      }
    };

    void generateQr();
    return () => {
      canceled = true;
    };
  }, [detailQrText]);

  const detailQrFileName = useMemo(
    () => buildDetailQrFileName(detailModal?.data),
    [detailModal?.data]
  );

  const detailActSummary = useMemo(
    () => buildDetailActSummary(detailActSelected),
    [detailActSelected]
  );

  const locationOptions = useMemo(() => buildLocationOptions(detailLocations), [detailLocations]);
  const modelOptions = useMemo(() => buildDetailModelOptions(detailModels), [detailModels]);
  const selectedEmployeeOption = useMemo(
    () => getSelectedOwnerOption({
      ownerOptions: detailEmployeeOptions,
      ownerNo: detailForm?.empl_no,
      ownerName: detailForm?.employee_name,
      ownerDept: detailForm?.employee_dept,
    }),
    [detailEmployeeOptions, detailForm?.empl_no, detailForm?.employee_name, detailForm?.employee_dept]
  );

  const patchDetailForm = useCallback((patch) => {
    setDetailForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const startDetailEdit = useCallback(() => {
    setDetailError('');
    setDetailSuccess('');
    setDetailEditMode(true);
  }, []);

  const handleDetailClose = useCallback(() => {
    resetDetailTransientState();
    setDetailModal({ open: false, data: null, loading: false, invNo: null });
  }, [resetDetailTransientState]);

  const handleDetailCancel = useCallback(() => {
    if (detailInitialForm) {
      setDetailForm(detailInitialForm);
    }
    setDetailError('');
    setDetailSuccess('');
    setDetailEditMode(false);
  }, [detailInitialForm]);

  const handleDetailSave = useCallback(async () => {
    if (!canDatabaseWrite) {
      setDetailError(NO_WRITE_ERROR);
      return;
    }
    if (!detailModal?.invNo || !detailForm || !detailInitialForm) return;

    const payload = buildDetailUpdatePayload(detailForm, detailInitialForm);
    const comparableCurrent = normalizeDetailComparable(detailForm);

    if (Object.keys(payload).length === 0) {
      setDetailEditMode(false);
      return;
    }

    if (payload.branch_no !== undefined && comparableCurrent.loc_no === null) {
      setDetailError(LOCATION_REQUIRED_ERROR);
      return;
    }

    if ((payload.type_no !== undefined || payload.model_no !== undefined) && comparableCurrent.model_no === null) {
      setDetailError(MODEL_REQUIRED_ERROR);
      return;
    }

    setDetailSaving(true);
    setDetailError('');
    setDetailSuccess('');

    try {
      const updated = await equipmentAPI.updateByInvNo(detailModal.invNo, payload);
      const nextForm = buildDetailFormState(updated);
      setDetailModal((prev) => ({ ...prev, data: updated, loading: false }));
      setDetailForm(nextForm);
      setDetailInitialForm(nextForm);
      setDetailEditMode(false);
      setDetailSuccess('Изменения сохранены.');
      setAllEquipment?.((prev) => upsertItemInGrouped(prev, toGroupedItem(updated)));
      onRecentActivity?.({
        invNo: detailModal.invNo,
        actionType: 'edit',
        snapshot: updated,
      });
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setDetailError(typeof apiDetail === 'string' ? apiDetail : SAVE_ERROR);
    } finally {
      setDetailSaving(false);
    }
  }, [canDatabaseWrite, detailModal?.invNo, detailForm, detailInitialForm, onRecentActivity, setAllEquipment]);

  const handleDetailEditKeyDown = useCallback((event) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!canDatabaseWrite || !detailModal.open || !detailEditMode || detailTab !== 'general') return;
    if (detailSaving || !detailHasChanges) return;

    const target = event.target;
    const tagName = String(target?.tagName || '').toLowerCase();
    if (tagName === 'textarea' || target?.isContentEditable) return;

    const role = target?.getAttribute?.('role');
    if (role === 'combobox' || role === 'listbox' || role === 'option' || role === 'menuitem') return;
    if (target?.closest?.('.MuiAutocomplete-popper, [role="listbox"], [role="menu"]')) return;

    event.preventDefault();
    event.stopPropagation();
    void handleDetailSave();
  }, [
    canDatabaseWrite,
    detailModal.open,
    detailEditMode,
    detailTab,
    detailSaving,
    detailHasChanges,
    handleDetailSave,
  ]);

  const handleOpenEquipmentActFile = useCallback((act) => {
    const docNo = String(readFirst(act, ['doc_no', 'DOC_NO'], '')).trim();
    if (!docNo) {
      setDetailActsError(ACT_DOC_NO_ERROR);
      return;
    }

    const itemId = toNumberOrNull(readFirst(act, ['item_id', 'ITEM_ID'], null));
    setDetailActOpeningDocNo(docNo);
    setDetailActsError('');
    try {
      const selectedDb = normalizeDbId(localStorage.getItem('selected_database') || '');
      const requestUrl = new URL(
        `${API_V1_BASE}/equipment/acts/${encodeURIComponent(docNo)}/file`,
        window.location.origin
      );
      if (itemId !== null) {
        requestUrl.searchParams.set('item_id', String(itemId));
      }
      if (detailModal?.invNo) {
        requestUrl.searchParams.set('inv_no', String(detailModal.invNo));
      }
      if (selectedDb) {
        requestUrl.searchParams.set('db_id', selectedDb);
      }
      const opened = window.open(requestUrl.toString(), '_blank', 'noopener,noreferrer');
      if (!opened) {
        setDetailActsError(POPUP_BLOCKED_ERROR);
      }
    } catch (error) {
      console.error('Error opening equipment act file:', error);
      const apiDetail = error?.response?.data?.detail;
      setDetailActsError(typeof apiDetail === 'string' ? apiDetail : ACT_OPEN_ERROR);
    } finally {
      setDetailActOpeningDocNo('');
    }
  }, [detailModal?.invNo]);

  const handleOpenActFields = useCallback((act) => {
    setDetailActSelected(act || null);
    setDetailActFieldsOpen(true);
  }, []);

  const handleCloseActFields = useCallback(() => {
    setDetailActFieldsOpen(false);
    setDetailActSelected(null);
  }, []);

  return {
    detailModal,
    setDetailModal,
    detailEditMode,
    setDetailEditMode,
    detailSaving,
    setDetailSaving,
    detailError,
    setDetailError,
    detailSuccess,
    setDetailSuccess,
    detailForm,
    setDetailForm,
    detailInitialForm,
    setDetailInitialForm,
    detailLocations,
    setDetailLocations,
    detailModels,
    setDetailModels,
    detailModelsLoading,
    setDetailModelsLoading,
    detailEmployeeOptions,
    setDetailEmployeeOptions,
    detailEmployeeInput,
    setDetailEmployeeInput,
    detailEmployeeLoading,
    setDetailEmployeeLoading,
    detailTab,
    setDetailTab,
    detailActs,
    setDetailActs,
    detailActsLoading,
    setDetailActsLoading,
    detailActsError,
    setDetailActsError,
    detailActsLoadedInvNo,
    setDetailActsLoadedInvNo,
    detailHistory,
    setDetailHistory,
    detailHistoryLoading,
    setDetailHistoryLoading,
    detailHistoryError,
    setDetailHistoryError,
    detailHistoryLoadedInvNo,
    setDetailHistoryLoadedInvNo,
    detailActOpeningDocNo,
    setDetailActOpeningDocNo,
    detailActFieldsOpen,
    setDetailActFieldsOpen,
    detailActSelected,
    setDetailActSelected,
    detailActSummary,
    detailQrOpen,
    setDetailQrOpen,
    detailQrUrl,
    setDetailQrUrl,
    detailQrUrlLoading,
    setDetailQrUrlLoading,
    detailQrText,
    detailQrFileName,
    detailHasChanges,
    locationOptions,
    modelOptions,
    selectedEmployeeOption,
    loadDetailedItemsByInvNos,
    openDetailView,
    handleQrEquipmentFound,
    patchDetailForm,
    startDetailEdit,
    handleDetailClose,
    handleDetailCancel,
    handleDetailSave,
    handleDetailEditKeyDown,
    handleOpenEquipmentActFile,
    handleOpenActFields,
    handleCloseActFields,
  };
}

export default useDatabaseDetailRuntime;
