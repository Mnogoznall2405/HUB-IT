import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { isMeaningful1cRef, normalize1cRef, warehouse1cAPI } from '../api/warehouse1c';

const AUTOCOMPLETE_DEBOUNCE_MS = 300;
const AUTOCOMPLETE_MIN_CHARS = 2;


const buildWarehouseSearchParams = ({
  tab = 'balances',
  nomenclature = null,
  warehouse = null,
  series = null,
  dateFrom = '',
  dateTo = '',
  q = '',
} = {}) => {
  const params = new URLSearchParams();
  if (tab && tab !== 'balances') params.set('tab', tab);
  if (isMeaningful1cRef(nomenclature?.ref)) {
    params.set('nomenclatureRef', nomenclature.ref);
    if (nomenclature.name) params.set('nomenclatureName', nomenclature.name);
    if (nomenclature.code) params.set('nomenclatureCode', nomenclature.code);
  }
  if (isMeaningful1cRef(warehouse?.ref)) {
    params.set('warehouseRef', warehouse.ref);
    if (warehouse.name) params.set('warehouseName', warehouse.name);
  }
  if (isMeaningful1cRef(series?.ref)) {
    params.set('seriesRef', series.ref);
    if (series.name) params.set('seriesName', series.name);
  }
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (q) params.set('q', q);
  return params;
};

const useDebouncedValue = (value, delayMs = AUTOCOMPLETE_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
};

function useEntityAutocomplete(searchFn, limit = 20) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const debouncedInput = useDebouncedValue(inputValue);

  useEffect(() => {
    const text = String(debouncedInput || '').trim();
    if (text.length < AUTOCOMPLETE_MIN_CHARS) {
      setOptions([]);
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    let cancelled = false;
    searchFn(text, limit)
      .then((items) => {
        if (cancelled || requestRef.current !== requestId) return;
        setOptions(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (cancelled || requestRef.current !== requestId) return;
        setOptions([]);
      })
      .finally(() => {
        if (!cancelled && requestRef.current === requestId) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedInput, searchFn, limit]);

  const reset = useCallback(() => {
    setInputValue('');
    setOptions([]);
  }, []);

  // The backend caps results per page; when we get exactly `limit` items back
  // there may be more matches hidden past the cap (common for warehouses,
  // where many rows share a city/project name) — nudge the user to narrow it.
  const truncated = options.length >= limit;

  return { inputValue, setInputValue, options, loading, reset, truncated };
}

const resolveErrorMessage = (err, fallback) => {
  if (err?.code === 'ECONNABORTED') {
    return '1С не ответила вовремя. Сузьте фильтр (номенклатура/склад) и повторите запрос.';
  }
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return fallback;
};

const formatNumber = (value, digits = 2) => {
  const num = Number(value || 0);
  return num.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('ru-RU');
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('ru-RU');
};

const formatFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!size) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
};

const formatDocRequisite = (number, dateValue) => {
  const num = String(number || '').trim();
  if (!num) return '-';
  return `№ ${num} от ${formatDate(dateValue)}`;
};

function NomenclatureCell({ code, name }) {
  const codeText = String(code || '').trim();
  const nameText = String(name || '').trim() || '-';

  return (
    <Box>
      {codeText ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
          {codeText}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ lineHeight: 1.35 }}>
        {nameText}
      </Typography>
    </Box>
  );
}

function EntityAutocomplete({
  label,
  placeholder,
  field,
  value,
  onChange,
  disabled = false,
  showNomenclatureCode = false,
}) {
  const getOptionLabel = (option) => {
    if (!option) return '';
    if (!showNomenclatureCode) return option.name || '';
    const code = String(option.code || '').trim();
    if (code) return `${code} — ${option.name || ''}`;
    return option.name || '';
  };

  return (
    <Box sx={{ minWidth: 260, flex: 1 }}>
      <Autocomplete
        size="small"
        options={field.options}
        loading={field.loading}
        value={value}
        disabled={disabled}
        onChange={(_, nextValue) => onChange(nextValue)}
        inputValue={field.inputValue}
        onInputChange={(_, nextInputValue) => field.setInputValue(nextInputValue)}
        getOptionLabel={getOptionLabel}
        isOptionEqualToValue={(option, val) => option?.ref === val?.ref}
        renderOption={(props, option) => (
          <Box component="li" {...props} key={option.ref}>
            {showNomenclatureCode ? (
              <NomenclatureCell code={option.code} name={option.name} />
            ) : (
              option.name
            )}
          </Box>
        )}
        noOptionsText={
          String(field.inputValue || '').trim().length < AUTOCOMPLETE_MIN_CHARS
            ? 'Введите минимум 2 символа'
            : 'Ничего не найдено'
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={placeholder}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {field.loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />
      {field.truncated ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, ml: 0.5 }}>
          Показаны первые {field.options.length} совпадений — уточните запрос, если нужного нет в списке
        </Typography>
      ) : null}
    </Box>
  );
}

function MovementDetailDialog({
  open,
  row,
  detail,
  loading,
  error,
  onClose,
}) {
  const fromName = detail?.transfer_from_warehouse_name || row?.transfer_from_warehouse_name;
  const toName = detail?.transfer_to_warehouse_name || row?.transfer_to_warehouse_name;
  const registrarNumber = detail?.registrar_number || row?.registrar_number;
  const registrarDate = detail?.registrar_date || row?.registrar_date;
  const registrarName = detail?.registrar_name || row?.registrar_name;
  const files = Array.isArray(detail?.files) ? detail.files : [];
  const filesStatus = detail?.files_status || 'pending';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        Перемещение между складами
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Документ
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {registrarNumber ? `№ ${registrarNumber}` : registrarName || '-'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatDateTime(registrarDate)}
            </Typography>
            {row?.nomenclature_name ? (
              <Box sx={{ mt: 1 }}>
                <NomenclatureCell
                  code={row.nomenclature_code}
                  name={`${row.nomenclature_name}${row.series_name ? ` · ${row.series_name}` : ''}`}
                />
              </Box>
            ) : null}
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Маршрут перемещения
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip label={fromName || 'Не указан'} color="default" variant="outlined" />
              <TrendingFlatIcon fontSize="small" color="action" />
              <Chip label={toName || 'Не указан'} color="primary" variant="outlined" />
            </Stack>
          </Box>

          {detail?.comment ? (
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Комментарий
              </Typography>
              <Typography variant="body2">{detail.comment}</Typography>
            </Box>
          ) : null}

          <Divider />

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Прикреплённые файлы
            </Typography>
            {loading ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Загрузка списка файлов...
                </Typography>
              </Stack>
            ) : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
            {!loading && !error && filesStatus === 'access_denied' ? (
              <Alert severity="warning">
                {detail?.files_message || 'Нет прав на чтение прикреплённых файлов в 1С.'}
              </Alert>
            ) : null}
            {!loading && !error && filesStatus === 'ok' && files.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                К этому документу файлы не прикреплены.
              </Typography>
            ) : null}
            {!loading && !error && files.length > 0 ? (
              <List dense disablePadding>
                {files.map((file) => (
                  <ListItem key={file.ref || file.name} disableGutters>
                    <AttachFileIcon fontSize="small" color="action" sx={{ mr: 1 }} />
                    <ListItemText
                      primary={file.name}
                      secondary={formatFileSize(file.size) || null}
                    />
                  </ListItem>
                ))}
              </List>
            ) : null}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

function Warehouse1C() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('balances');
  const [deepLinkRequest, setDeepLinkRequest] = useState(null);
  const deepLinkHandledRef = useRef(false);

  const balNomenclatureField = useEntityAutocomplete(warehouse1cAPI.searchNomenclature, 20);
  const [balNomenclatureValue, setBalNomenclatureValue] = useState(null);
  const balWarehouseField = useEntityAutocomplete(warehouse1cAPI.searchWarehouses, 50);
  const [balWarehouseValue, setBalWarehouseValue] = useState(null);
  const [balTextQuery, setBalTextQuery] = useState('');

  const [balances, setBalances] = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState('');
  const [balancesSearched, setBalancesSearched] = useState(false);

  const movNomenclatureField = useEntityAutocomplete(warehouse1cAPI.searchNomenclature, 20);
  const [movNomenclatureValue, setMovNomenclatureValue] = useState(null);
  const movWarehouseField = useEntityAutocomplete(warehouse1cAPI.searchWarehouses, 50);
  const [movWarehouseValue, setMovWarehouseValue] = useState(null);
  const [movSeriesFilter, setMovSeriesFilter] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState('');
  const [movementsSearched, setMovementsSearched] = useState(false);

  const [movementDetailOpen, setMovementDetailOpen] = useState(false);
  const [movementDetailRow, setMovementDetailRow] = useState(null);
  const [movementDetailData, setMovementDetailData] = useState(null);
  const [movementDetailLoading, setMovementDetailLoading] = useState(false);
  const [movementDetailError, setMovementDetailError] = useState('');
  const [cameFromBalances, setCameFromBalances] = useState(false);
  const returnContext = useMemo(() => {
    const state = location.state;
    if (!state || typeof state !== 'object') return null;

    const reopenDetail = state.reopenDetail && typeof state.reopenDetail === 'object'
      ? state.reopenDetail
      : null;
    const reopenEmployee = state.reopenEmployee && typeof state.reopenEmployee === 'object'
      ? state.reopenEmployee
      : null;

    const invNo = String(
      reopenDetail?.invNo
      || state.invNo
      || '',
    ).trim();
    const ownerNo = String(
      reopenEmployee?.ownerNo
      || state.ownerNo
      || '',
    ).trim();
    const employeeName = String(
      reopenEmployee?.employeeName
      || state.employeeName
      || '',
    ).trim();
    const detailTab = String(
      reopenDetail?.detailTab
      || state.detailTab
      || 'warehouse1c',
    ).trim() || 'warehouse1c';
    const returnTo = String(state.returnTo || '').trim() || '/database';
    const returnLabel = String(state.returnLabel || '').trim()
      || (invNo ? 'Назад к карточке' : ownerNo ? 'Назад к сотруднику' : 'Назад в Инвентарь');
    const detailSnapshot = reopenDetail?.detailSnapshot && typeof reopenDetail.detailSnapshot === 'object'
      ? reopenDetail.detailSnapshot
      : (state.detailSnapshot && typeof state.detailSnapshot === 'object' ? state.detailSnapshot : null);
    const uiSnapshot = state.uiSnapshot && typeof state.uiSnapshot === 'object'
      ? state.uiSnapshot
      : null;

    if (!invNo && !ownerNo && !state.returnTo && !reopenDetail && !reopenEmployee) {
      return null;
    }

    return {
      invNo,
      ownerNo,
      employeeName,
      detailTab,
      detailSnapshot,
      uiSnapshot,
      returnTo,
      returnLabel,
    };
  }, [location.state]);

  const canSearchBalances = Boolean(
    balNomenclatureValue || balWarehouseValue || balTextQuery.trim(),
  );

  const handleSearchBalances = useCallback(async () => {
    if (!canSearchBalances) return;
    setBalancesLoading(true);
    setBalancesError('');
    setBalancesSearched(true);
    try {
      const data = await warehouse1cAPI.getBalances({
        nomenclatureRef: balNomenclatureValue?.ref || '',
        warehouseRef: balWarehouseValue?.ref || '',
        q: balTextQuery.trim(),
      });
      setBalances(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load 1C balances:', err);
      setBalancesError(resolveErrorMessage(err, 'Не удалось получить остатки из 1С.'));
      setBalances([]);
    } finally {
      setBalancesLoading(false);
    }
  }, [balNomenclatureValue, balWarehouseValue, balTextQuery, canSearchBalances]);

  const runMovementsSearch = useCallback(async (overrides = {}) => {
    const nomenclature = 'nomenclature' in overrides ? overrides.nomenclature : movNomenclatureValue;
    const warehouse = 'warehouse' in overrides ? overrides.warehouse : movWarehouseValue;
    const series = 'series' in overrides ? overrides.series : movSeriesFilter;
    const from = 'dateFrom' in overrides ? overrides.dateFrom : dateFrom;
    const to = 'dateTo' in overrides ? overrides.dateTo : dateTo;

    if (!nomenclature?.ref) {
      setMovementsError('Выберите номенклатуру, чтобы посмотреть движение.');
      return;
    }

    setMovementsLoading(true);
    setMovementsError('');
    setMovementsSearched(true);
    try {
      const data = await warehouse1cAPI.getMovements({
        nomenclatureRef: nomenclature.ref,
        warehouseRef: warehouse?.ref || '',
        seriesRef: series?.ref || '',
        dateFrom: from || '',
        dateTo: to || '',
      });
      setMovements(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load 1C movements:', err);
      setMovementsError(resolveErrorMessage(err, 'Не удалось получить ведомость движений из 1С.'));
      setMovements([]);
    } finally {
      setMovementsLoading(false);
    }
  }, [movNomenclatureValue, movWarehouseValue, movSeriesFilter, dateFrom, dateTo]);

  const handleSearchMovementsClick = useCallback(() => {
    void runMovementsSearch();
  }, [runMovementsSearch]);

  useEffect(() => {
    if (deepLinkHandledRef.current) return;

    const tabParam = searchParams.get('tab');
    const nomenclatureRef = normalize1cRef(searchParams.get('nomenclatureRef'));
    const nomenclatureName = String(searchParams.get('nomenclatureName') || '').trim();
    const nomenclatureCode = String(searchParams.get('nomenclatureCode') || '').trim();
    const warehouseRef = normalize1cRef(searchParams.get('warehouseRef'));
    const warehouseName = String(searchParams.get('warehouseName') || '').trim();
    const seriesRef = normalize1cRef(searchParams.get('seriesRef'));
    const seriesName = String(searchParams.get('seriesName') || '').trim();

    if (!tabParam && !nomenclatureRef && !warehouseRef) return;

    deepLinkHandledRef.current = true;

    const targetTab = tabParam === 'movements' ? 'movements' : 'balances';
    setTab(targetTab);

    const nomenclature = nomenclatureRef
      ? { ref: nomenclatureRef, name: nomenclatureName, code: nomenclatureCode }
      : null;
    const warehouse = warehouseRef
      ? { ref: warehouseRef, name: warehouseName }
      : null;
    const series = seriesRef
      ? { ref: seriesRef, name: seriesName }
      : null;

    if (targetTab === 'balances') {
      if (nomenclature) {
        setBalNomenclatureValue(nomenclature);
        balNomenclatureField.setInputValue(nomenclatureName || nomenclatureCode || nomenclatureRef);
      }
      if (warehouse) {
        setBalWarehouseValue(warehouse);
        balWarehouseField.setInputValue(warehouseName || warehouseRef);
      }
      if (nomenclature || warehouse) {
        setDeepLinkRequest({ type: 'balances', nomenclature, warehouse });
      }
    } else if (nomenclature) {
      setMovNomenclatureValue(nomenclature);
      movNomenclatureField.setInputValue(nomenclatureName || nomenclatureCode || nomenclatureRef);
      if (warehouse) {
        setMovWarehouseValue(warehouse);
        movWarehouseField.setInputValue(warehouseName || warehouseRef);
      }
      if (series) {
        setMovSeriesFilter(series);
      }
      setDeepLinkRequest({ type: 'movements', nomenclature, warehouse, series });
    }
  }, [
    balNomenclatureField,
    balWarehouseField,
    movNomenclatureField,
    movWarehouseField,
    searchParams,
  ]);

  useEffect(() => {
    if (!deepLinkRequest) return;

    const request = deepLinkRequest;
    setDeepLinkRequest(null);

    if (request.type === 'balances' && (request.nomenclature || request.warehouse)) {
      setBalancesLoading(true);
      setBalancesError('');
      setBalancesSearched(true);
      warehouse1cAPI.getBalances({
        nomenclatureRef: request.nomenclature?.ref || '',
        warehouseRef: request.warehouse?.ref || '',
      })
        .then((data) => {
          setBalances(Array.isArray(data) ? data : []);
        })
        .catch((err) => {
          console.error('Failed to load 1C balances from deep link:', err);
          setBalancesError(resolveErrorMessage(err, 'Не удалось получить остатки из 1С.'));
          setBalances([]);
        })
        .finally(() => {
          setBalancesLoading(false);
        });
      return;
    }

    if (request.type === 'movements' && request.nomenclature?.ref) {
      void runMovementsSearch({
        nomenclature: request.nomenclature,
        warehouse: request.warehouse,
        series: request.series || null,
      });
    }
  }, [deepLinkRequest, runMovementsSearch]);

  useEffect(() => {
    // Avoid wiping deep-link query params before they are applied to state.
    const hasIncomingDeepLink = Boolean(
      searchParams.get('nomenclatureRef')
      || searchParams.get('warehouseRef')
      || searchParams.get('seriesRef'),
    );
    if (hasIncomingDeepLink && !deepLinkHandledRef.current) {
      return;
    }
    if (
      hasIncomingDeepLink
      && deepLinkHandledRef.current
      && tab === 'balances'
      && !balNomenclatureValue?.ref
      && !balWarehouseValue?.ref
    ) {
      return;
    }
    if (
      hasIncomingDeepLink
      && deepLinkHandledRef.current
      && tab === 'movements'
      && !movNomenclatureValue?.ref
      && !movWarehouseValue?.ref
    ) {
      return;
    }
    const next = new URLSearchParams();
    next.set('tab', tab);
    if (tab === 'balances') {
      if (balNomenclatureValue?.ref) {
        next.set('nomenclatureRef', balNomenclatureValue.ref);
        if (balNomenclatureValue.name) next.set('nomenclatureName', balNomenclatureValue.name);
        if (balNomenclatureValue.code) next.set('nomenclatureCode', balNomenclatureValue.code);
      }
      if (balWarehouseValue?.ref) {
        next.set('warehouseRef', balWarehouseValue.ref);
        if (balWarehouseValue.name) next.set('warehouseName', balWarehouseValue.name);
      }
    } else {
      if (movNomenclatureValue?.ref) {
        next.set('nomenclatureRef', movNomenclatureValue.ref);
        if (movNomenclatureValue.name) next.set('nomenclatureName', movNomenclatureValue.name);
        if (movNomenclatureValue.code) next.set('nomenclatureCode', movNomenclatureValue.code);
      }
      if (movWarehouseValue?.ref) {
        next.set('warehouseRef', movWarehouseValue.ref);
        if (movWarehouseValue.name) next.set('warehouseName', movWarehouseValue.name);
      }
      if (movSeriesFilter?.ref) {
        next.set('seriesRef', movSeriesFilter.ref);
        if (movSeriesFilter.name) next.set('seriesName', movSeriesFilter.name);
      }
    }
    const nextStr = next.toString();
    const currStr = searchParams.toString();
    if (nextStr !== currStr) {
      setSearchParams(next, { replace: true });
    }
  }, [
    tab,
    balNomenclatureValue,
    balWarehouseValue,
    movNomenclatureValue,
    movWarehouseValue,
    movSeriesFilter,
    searchParams,
    setSearchParams,
  ]);

  const handleShowMovement = useCallback((row) => {
    const nomenclature = isMeaningful1cRef(row.nomenclature_ref)
      ? { ref: row.nomenclature_ref, code: row.nomenclature_code, name: row.nomenclature_name }
      : null;
    const warehouse = isMeaningful1cRef(row.warehouse_ref)
      ? { ref: row.warehouse_ref, name: row.warehouse_name }
      : null;
    const series = isMeaningful1cRef(row.series_ref)
      ? { ref: row.series_ref, name: row.series_name || row.series_number }
      : null;

    setMovNomenclatureValue(nomenclature);
    movNomenclatureField.setInputValue(nomenclature?.name || '');
    setMovWarehouseValue(warehouse);
    movWarehouseField.setInputValue(warehouse?.name || '');
    setMovSeriesFilter(series);
    setDateFrom('');
    setDateTo('');
    setCameFromBalances(true);
    setTab('movements');
    void runMovementsSearch({
      nomenclature,
      warehouse,
      series,
      dateFrom: '',
      dateTo: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movNomenclatureField, movWarehouseField, runMovementsSearch]);

  const handleClearSeriesFilter = useCallback(() => {
    setMovSeriesFilter(null);
    void runMovementsSearch({ series: null });
  }, [runMovementsSearch]);

  const handleBackToBalances = useCallback(() => {
    setCameFromBalances(false);
    setTab('balances');
    if (movNomenclatureValue) {
      setBalNomenclatureValue(movNomenclatureValue);
      balNomenclatureField.setInputValue(movNomenclatureValue.name || movNomenclatureValue.code || '');
    }
    if (movWarehouseValue) {
      setBalWarehouseValue(movWarehouseValue);
      balWarehouseField.setInputValue(movWarehouseValue.name || '');
    }
  }, [balNomenclatureField, balWarehouseField, movNomenclatureValue, movWarehouseValue]);

  const handleReturnBack = useCallback(() => {
    if (!returnContext) return;
    const sharedState = {
      uiSnapshot: returnContext.uiSnapshot || null,
    };
    if (returnContext.invNo) {
      navigate(returnContext.returnTo || '/database', {
        state: {
          ...sharedState,
          reopenDetail: {
            kind: 'equipment',
            invNo: returnContext.invNo,
            detailTab: returnContext.detailTab || 'warehouse1c',
            detailSnapshot: returnContext.detailSnapshot || null,
          },
        },
      });
      return;
    }
    if (returnContext.ownerNo) {
      navigate(returnContext.returnTo || '/database', {
        state: {
          ...sharedState,
          reopenEmployee: {
            ownerNo: returnContext.ownerNo,
            employeeName: returnContext.employeeName || '',
          },
        },
      });
      return;
    }
    navigate(returnContext.returnTo || '/database', { state: sharedState });
  }, [navigate, returnContext]);

  const handleCloseMovementDetail = useCallback(() => {
    setMovementDetailOpen(false);
    setMovementDetailRow(null);
    setMovementDetailData(null);
    setMovementDetailError('');
    setMovementDetailLoading(false);
  }, []);

  const handleOpenMovementDetail = useCallback((row) => {
    if (!row?.is_transfer || !row?.registrar_ref) return;

    setMovementDetailRow(row);
    setMovementDetailData(null);
    setMovementDetailError('');
    setMovementDetailLoading(true);
    setMovementDetailOpen(true);

    warehouse1cAPI.getMovementDetail(row.registrar_ref)
      .then((data) => {
        setMovementDetailData(data);
      })
      .catch((err) => {
        console.error('Failed to load movement detail:', err);
        setMovementDetailError(resolveErrorMessage(err, 'Не удалось загрузить карточку перемещения.'));
      })
      .finally(() => {
        setMovementDetailLoading(false);
      });
  }, []);

  const balancesResultLabel = useMemo(() => {
    if (!balancesSearched) return '';
    return `Найдено позиций: ${balances.length}`;
  }, [balancesSearched, balances.length]);

  const movementsResultLabel = useMemo(() => {
    if (!movementsSearched) return '';
    return `Найдено движений: ${movements.length}`;
  }, [movementsSearched, movements.length]);

  return (
    <MainLayout>
      <PageShell>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          spacing={1}
          sx={{ mb: 2 }}
        >
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            {returnContext ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={handleReturnBack}
              >
                {returnContext.returnLabel}
              </Button>
            ) : null}
            {cameFromBalances && tab === 'movements' ? (
              <Button
                size="small"
                variant="text"
                startIcon={<ArrowBackIcon />}
                onClick={handleBackToBalances}
              >
                Назад к остаткам
              </Button>
            ) : null}
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Склад 1С
            </Typography>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button
            variant={tab === 'balances' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => {
              setCameFromBalances(false);
              setTab('balances');
            }}
          >
            Остатки
          </Button>
          <Button
            variant={tab === 'movements' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setTab('movements')}
          >
            Ведомость с деньгами
          </Button>
        </Stack>

        {tab === 'balances' ? (
          <>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'flex-start' }}>
                <EntityAutocomplete
                  label="Номенклатура"
                  placeholder="Код или наименование"
                  field={balNomenclatureField}
                  value={balNomenclatureValue}
                  onChange={setBalNomenclatureValue}
                  showNomenclatureCode
                />
                <EntityAutocomplete
                  label="Склад"
                  placeholder="Начните вводить название склада"
                  field={balWarehouseField}
                  value={balWarehouseValue}
                  onChange={setBalWarehouseValue}
                />
                <TextField
                  size="small"
                  label="Текстовый поиск"
                  placeholder="По наименованию номенклатуры"
                  value={balTextQuery}
                  onChange={(event) => setBalTextQuery(event.target.value)}
                  sx={{ minWidth: 220 }}
                />
                <Button
                  variant="contained"
                  startIcon={balancesLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                  onClick={handleSearchBalances}
                  disabled={!canSearchBalances || balancesLoading}
                  sx={{ flexShrink: 0, height: 40 }}
                >
                  Найти
                </Button>
              </Stack>
              {!canSearchBalances ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Укажите номенклатуру, склад или текст поиска перед запросом остатков.
                </Typography>
              ) : null}
            </Paper>

            {balancesLoading ? <LinearProgress sx={{ mb: 2 }} /> : null}
            {balancesError ? <Alert severity="error" sx={{ mb: 2 }}>{balancesError}</Alert> : null}
            {balancesResultLabel ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {balancesResultLabel}
              </Typography>
            ) : null}

            {balancesSearched && !balancesLoading ? (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Номенклатура</TableCell>
                      <TableCell>Характеристика</TableCell>
                      <TableCell>Серия</TableCell>
                      <TableCell>Склад</TableCell>
                      <TableCell align="right">Кол-во остаток</TableCell>
                      <TableCell align="right">Стоимость остаток</TableCell>
                      <TableCell align="right">Стоимость Бух</TableCell>
                      <TableCell align="right">Средняя цена</TableCell>
                      <TableCell>Статус партии</TableCell>
                      <TableCell>Вид себестоимости</TableCell>
                      <TableCell>№ ТН / дата</TableCell>
                      <TableCell>№ СчФ / дата</TableCell>
                      <TableCell align="center">Движение</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {balances.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} align="center">
                          <Typography variant="body2" color="text.secondary">
                            По заданному фильтру остатков не найдено
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {balances.map((row, index) => (
                      <TableRow
                        key={`${row.nomenclature_ref}|${row.series_ref}|${row.warehouse_ref}|${index}`}
                        hover
                      >
                        <TableCell>
                          <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
                        </TableCell>
                        <TableCell>{row.characteristic_name || '-'}</TableCell>
                        <TableCell>{row.series_name || row.series_number || '-'}</TableCell>
                        <TableCell>{row.warehouse_name || '-'}</TableCell>
                        <TableCell align="right">{formatNumber(row.qty_balance, 3)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_balance)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_accounting_balance)}</TableCell>
                        <TableCell align="right">{formatNumber(row.avg_price)}</TableCell>
                        <TableCell>{row.batch_status_name || '-'}</TableCell>
                        <TableCell>{row.cost_method_name || '-'}</TableCell>
                        <TableCell>{formatDocRequisite(row.torg12_number, row.torg12_date)}</TableCell>
                        <TableCell>{formatDocRequisite(row.invoice_number, row.invoice_date)}</TableCell>
                        <TableCell align="center">
                          <Tooltip title="Показать движение этой позиции">
                            <IconButton size="small" onClick={() => handleShowMovement(row)}>
                              <TrendingFlatIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : null}
          </>
        ) : (
          <>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'flex-start' }}>
                <EntityAutocomplete
                  label="Номенклатура *"
                  placeholder="Код или наименование"
                  field={movNomenclatureField}
                  value={movNomenclatureValue}
                  onChange={setMovNomenclatureValue}
                  showNomenclatureCode
                />
                <EntityAutocomplete
                  label="Склад"
                  placeholder="Начните вводить название склада"
                  field={movWarehouseField}
                  value={movWarehouseValue}
                  onChange={setMovWarehouseValue}
                />
                <TextField
                  size="small"
                  type="date"
                  label="Период с"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: 170 }}
                />
                <TextField
                  size="small"
                  type="date"
                  label="Период по"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: 170 }}
                />
                <Button
                  variant="contained"
                  startIcon={movementsLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                  onClick={handleSearchMovementsClick}
                  disabled={!movNomenclatureValue || movementsLoading}
                  sx={{ flexShrink: 0, height: 40 }}
                >
                  Найти
                </Button>
              </Stack>
              {!movNomenclatureValue ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Номенклатура обязательна для ведомости — без неё запрос слишком тяжёлый для 1С.
                </Typography>
              ) : null}
              {movSeriesFilter ? (
                <Chip
                  sx={{ mt: 1.5 }}
                  size="small"
                  label={`Серия/партия: ${movSeriesFilter.name || '-'}`}
                  onDelete={handleClearSeriesFilter}
                  deleteIcon={<CloseIcon fontSize="small" />}
                />
              ) : null}
            </Paper>

            {movementsLoading ? <LinearProgress sx={{ mb: 2 }} /> : null}
            {movementsError ? <Alert severity="error" sx={{ mb: 2 }}>{movementsError}</Alert> : null}
            {movementsResultLabel ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {movementsResultLabel}
              </Typography>
            ) : null}

            {movementsSearched && !movementsLoading ? (
              <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 1550 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell rowSpan={2}>Регистратор</TableCell>
                      <TableCell rowSpan={2}>Перемещение (откуда → куда)</TableCell>
                      <TableCell rowSpan={2}>Период</TableCell>
                      <TableCell align="center" colSpan={4}>Количество</TableCell>
                      <TableCell align="center" colSpan={4}>Стоимость</TableCell>
                      <TableCell align="center" colSpan={4}>Стоимость Бух</TableCell>
                      <TableCell align="center" colSpan={2}>Средняя цена</TableCell>
                      <TableCell rowSpan={2}>№ ТН / дата</TableCell>
                      <TableCell rowSpan={2}>№ СчФ / дата</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell align="right">Начало</TableCell>
                      <TableCell align="right">Приход</TableCell>
                      <TableCell align="right">Расход</TableCell>
                      <TableCell align="right">Конец</TableCell>
                      <TableCell align="right">Начало</TableCell>
                      <TableCell align="right">Приход</TableCell>
                      <TableCell align="right">Расход</TableCell>
                      <TableCell align="right">Конец</TableCell>
                      <TableCell align="right">Начало</TableCell>
                      <TableCell align="right">Приход</TableCell>
                      <TableCell align="right">Расход</TableCell>
                      <TableCell align="right">Конец</TableCell>
                      <TableCell align="right">Начало</TableCell>
                      <TableCell align="right">Конец</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {movements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={19} align="center">
                          <Typography variant="body2" color="text.secondary">
                            По заданному фильтру движений не найдено
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {movements.map((row, index) => (
                      <TableRow
                        key={`${row.registrar_ref || row.registrar_name}|${row.period}|${index}`}
                        hover
                        onClick={row.is_transfer ? () => handleOpenMovementDetail(row) : undefined}
                        sx={row.is_transfer ? { cursor: 'pointer' } : undefined}
                      >
                        <TableCell>
                          {row.is_transfer ? (
                            <Tooltip title="Открыть карточку перемещения">
                              <Typography variant="body2" component="span">
                                {row.registrar_name || '-'}
                              </Typography>
                            </Tooltip>
                          ) : (
                            row.registrar_name || '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {row.transfer_from_warehouse_name || row.transfer_to_warehouse_name ? (
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ whiteSpace: 'nowrap' }}>
                              <Typography variant="body2">{row.transfer_from_warehouse_name || '-'}</Typography>
                              <TrendingFlatIcon fontSize="small" color="action" />
                              <Typography variant="body2">{row.transfer_to_warehouse_name || '-'}</Typography>
                            </Stack>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>{formatDate(row.period)}</TableCell>
                        <TableCell align="right">{formatNumber(row.qty_start, 3)}</TableCell>
                        <TableCell align="right">{formatNumber(row.qty_in, 3)}</TableCell>
                        <TableCell align="right">{formatNumber(row.qty_out, 3)}</TableCell>
                        <TableCell align="right">{formatNumber(row.qty_end, 3)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_start)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_in)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_out)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_end)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_accounting_start)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_accounting_in)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_accounting_out)}</TableCell>
                        <TableCell align="right">{formatNumber(row.cost_accounting_end)}</TableCell>
                        <TableCell align="right">{formatNumber(row.avg_price_start)}</TableCell>
                        <TableCell align="right">{formatNumber(row.avg_price_end)}</TableCell>
                        <TableCell>{formatDocRequisite(row.torg12_number, row.torg12_date)}</TableCell>
                        <TableCell>{formatDocRequisite(row.invoice_number, row.invoice_date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : null}
          </>
        )}

        <MovementDetailDialog
          open={movementDetailOpen}
          row={movementDetailRow}
          detail={movementDetailData}
          loading={movementDetailLoading}
          error={movementDetailError}
          onClose={handleCloseMovementDetail}
        />
      </PageShell>
    </MainLayout>
  );
}

export default Warehouse1C;
