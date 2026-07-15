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
  TableFooter,
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
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import MainLayout from '../components/layout/MainLayout';
import MobileShellPageHeader from '../components/layout/MobileShellPageHeader';
import PageShell from '../components/layout/PageShell';
import DocumentPreviewDialog from '../components/documentPreview/DocumentPreviewDialog';
import { useAuth } from '../contexts/AuthContext';
import HubNomenclatureMatchDialog from './database/HubNomenclatureMatchDialog';
import Warehouse1CReconcilePanel from './database/Warehouse1CReconcilePanel';
import {
  fileNameFromContentDisposition,
  resolveDocumentPreviewKind,
  sniffBlobKind,
} from '../lib/documentPreviewKind';
import {
  isMeaningful1cRef,
  isWarehouse1cListIncomplete,
  normalize1cRef,
  normalizeWarehouse1cListResponse,
  warehouse1cAPI,
} from '../api/warehouse1c';
import {
  sortBalancesByNomenclature,
  UNBOUNDED_MOVEMENT_PERIOD,
} from './database/warehouse1cShared';
const AUTOCOMPLETE_DEBOUNCE_MS = 300;
const AUTOCOMPLETE_MIN_CHARS = 2;
const NOMENCLATURE_AUTOCOMPLETE_LIMIT = 50;

function downloadBlobResponse(response, fallbackName = 'file.bin') {
  const blob = response?.data instanceof Blob
    ? response.data
    : new Blob([response?.data || response], {
      type: response?.headers?.['content-type'] || 'application/octet-stream',
    });
  const disposition = String(response?.headers?.['content-disposition'] || '');
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  let filename = fallbackName;
  if (utfMatch?.[1]) {
    try {
      filename = decodeURIComponent(utfMatch[1]);
    } catch {
      filename = utfMatch[1];
    }
  } else if (plainMatch?.[1]) {
    filename = plainMatch[1];
  }
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const createEmptyFilePreviewState = () => ({
  open: false,
  loading: false,
  error: '',
  title: '',
  subtitle: '',
  kind: 'pdf',
  objectUrl: '',
  previewBlob: null,
});

function canOpenMovementDetail(row) {
  if (!row) return false;
  if (row.can_open_detail === true) return true;
  if (row.can_open_detail === false) return false;
  return isMeaningful1cRef(row.registrar_ref);
}


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
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const debouncedInput = useDebouncedValue(inputValue);

  useEffect(() => {
    const text = String(debouncedInput || '').trim();
    if (text.length < AUTOCOMPLETE_MIN_CHARS) {
      setOptions([]);
      setError('');
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError('');
    let cancelled = false;
    searchFn(text, limit)
      .then((response) => {
        if (cancelled || requestRef.current !== requestId) return;
        setOptions(normalizeWarehouse1cListResponse(response).items);
      })
      .catch((err) => {
        if (cancelled || requestRef.current !== requestId) return;
        setOptions([]);
        setError(resolveErrorMessage(err, 'Не удалось выполнить поиск по каталогу 1С. Повторите запрос.'));
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
    setError('');
  }, []);

  // The backend caps results per page; when we get exactly `limit` items back
  // there may be more matches hidden past the cap (common for warehouses,
  // where many rows share a city/project name) — nudge the user to narrow it.
  const truncated = options.length >= limit;

  return { inputValue, setInputValue, options, loading, error, reset, truncated };
}

export const resolveErrorMessage = (err, fallback) => {
  if (err?.code === 'ECONNABORTED') {
    return '1С не ответила вовремя. Сузьте фильтр (номенклатура/склад) и повторите запрос.';
  }
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && typeof detail.message === 'string' && detail.message.trim()) {
    return detail.message;
  }
  return fallback;
};

const formatNumber = (value, digits = 2) => {
  const num = Number(value || 0);
  return num.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const sumNumericField = (rows, key) => (
  (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    const num = Number(row?.[key]);
    return acc + (Number.isFinite(num) ? num : 0);
  }, 0)
);

const buildBalancesTotals = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const qty = sumNumericField(list, 'qty_balance');
  const cost = sumNumericField(list, 'cost_balance');
  const costAccounting = sumNumericField(list, 'cost_accounting_balance');
  return {
    count: list.length,
    qty,
    cost,
    costAccounting,
    avgPrice: qty > 0 ? cost / qty : 0,
  };
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

function WarehouseListMetadataNotice({ meta, entityLabel }) {
  if (!isWarehouse1cListIncomplete(meta)) return null;

  const status = String(meta?.status || '').trim().toLowerCase();
  let message = `Данные ${entityLabel} из 1С неполные; не используйте эту выборку как итоговую сверку.`;
  if (status === 'error' || status === 'unknown') {
    message = `Не удалось подтвердить полноту данных ${entityLabel} из 1С. Это не означает нулевой результат.`;
  } else if (meta?.truncated || meta?.hasMore) {
    message = `Показана неполная выборка ${entityLabel} из 1С. Уточните фильтр или загрузите следующую страницу.`;
  }

  return <Alert severity="warning" sx={{ mb: 2 }}>{message}</Alert>;
}

function CatalogStatusCard({ status, loading, error, canSync, syncing, onSync }) {
  if (!loading && !status && !error) return null;

  const nomenclatureCount = Number(status?.nomenclature_count || 0);
  const warehousesCount = Number(status?.warehouses_count || 0);
  const updatedAt = status?.updated_at ? formatDateTime(status.updated_at) : 'ещё не обновлялся';
  const syncInProgress = Boolean(status?.sync_in_progress || syncing);
  const lastSyncFailed = Boolean(status?.last_error);

  return (
    <Paper variant="outlined" sx={{ p: 1.25, mb: 2 }}>
      <Stack spacing={0.75}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Кэш справочников 1С
          </Typography>
          {loading ? <CircularProgress size={16} /> : null}
          {status ? (
            <Typography variant="caption" color="text.secondary">
              Номенклатура: {nomenclatureCount.toLocaleString('ru-RU')} · Склады: {warehousesCount.toLocaleString('ru-RU')} · Обновлён: {updatedAt}
            </Typography>
          ) : null}
          {syncInProgress ? <Chip size="small" color="info" label="Обновление выполняется" /> : null}
          {canSync ? (
            <Button
              size="small"
              variant="outlined"
              disabled={syncInProgress}
              onClick={onSync}
              sx={{ textTransform: 'none', alignSelf: { xs: 'flex-start', sm: 'center' } }}
            >
              {syncing ? 'Обновляем…' : 'Обновить справочники'}
            </Button>
          ) : null}
        </Stack>
        {lastSyncFailed ? (
          <Alert severity="warning">
            Последнее обновление справочников завершилось с ошибкой. Используется последняя сохранённая версия кэша.
          </Alert>
        ) : null}
        {error ? <Alert severity="warning">Не удалось получить статус кэша 1С.</Alert> : null}
      </Stack>
    </Paper>
  );
}

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

function BalanceMobileRow({ row, onShowMovement, onOpenHubMatch }) {
  const [expanded, setExpanded] = useState(false);
  const seriesLabel = row.series_name || row.series_number || '';
  const characteristic = String(row.characteristic_name || '').trim();
  const canMatch = Boolean(onOpenHubMatch && (row?.nomenclature_code || row?.nomenclature_name || row?.nomenclature_ref));

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.9,
          minHeight: 56,
        }}
      >
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            cursor: canMatch ? 'pointer' : 'default',
          }}
          role={canMatch ? 'button' : undefined}
          tabIndex={canMatch ? 0 : undefined}
          onClick={canMatch ? () => onOpenHubMatch(row) : undefined}
          onKeyDown={canMatch ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenHubMatch(row);
            }
          } : undefined}
        >
          <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
            {row.warehouse_name || 'Склад не указан'}
            {seriesLabel ? ` · ${seriesLabel}` : ''}
          </Typography>
        </Box>
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={formatNumber(row.qty_balance, 3)}
          sx={{ flexShrink: 0, minWidth: 56 }}
        />
        <IconButton
          size="small"
          aria-label={expanded ? 'Скрыть детали' : 'Показать детали'}
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      {expanded ? (
        <Stack spacing={0.75} sx={{ px: 1, pb: 1.25 }}>
          {characteristic ? (
            <Typography variant="caption" color="text.secondary">
              Характеристика: {characteristic}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            Стоимость: {formatNumber(row.cost_balance)} · Бух: {formatNumber(row.cost_accounting_balance)} · Средняя: {formatNumber(row.avg_price)}
          </Typography>
          {(row.batch_status_name || row.cost_method_name) ? (
            <Typography variant="caption" color="text.secondary">
              {[row.batch_status_name, row.cost_method_name].filter(Boolean).join(' · ')}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            ТН: {formatDocRequisite(row.torg12_number, row.torg12_date)} · СчФ: {formatDocRequisite(row.invoice_number, row.invoice_date)}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {canMatch ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => onOpenHubMatch(row)}
                sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
              >
                В Хабе
              </Button>
            ) : null}
            <Button
              size="small"
              variant="outlined"
              startIcon={<TrendingFlatIcon />}
              onClick={() => onShowMovement?.(row)}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              Движение
            </Button>
          </Stack>
        </Stack>
      ) : null}
    </Box>
  );
}

function MovementMobileRow({ row, onOpenDetail }) {
  const [expanded, setExpanded] = useState(false);
  const canOpen = canOpenMovementDetail(row);
  const hasRoute = Boolean(row.transfer_from_warehouse_name || row.transfer_to_warehouse_name);

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : undefined}
        onClick={canOpen ? () => onOpenDetail?.(row) : undefined}
        onKeyDown={canOpen ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenDetail?.(row);
          }
        } : undefined}
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.75,
          px: 1,
          py: 0.9,
          minHeight: 56,
          cursor: canOpen ? 'pointer' : 'default',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: canOpen ? 'primary.main' : 'text.primary' }}
            noWrap
          >
            {row.registrar_name || '-'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {formatDate(row.period)}
          </Typography>
          {hasRoute ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
              {row.transfer_from_warehouse_name || '-'} → {row.transfer_to_warehouse_name || '-'}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
            <Chip size="small" variant="outlined" label={`Приход ${formatNumber(row.qty_in, 3)}`} />
            <Chip size="small" variant="outlined" label={`Расход ${formatNumber(row.qty_out, 3)}`} />
            <Chip size="small" color="primary" variant="outlined" label={`Конец ${formatNumber(row.qty_end, 3)}`} />
          </Stack>
        </Box>
        <IconButton
          size="small"
          aria-label={expanded ? 'Скрыть детали' : 'Показать детали'}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      {expanded ? (
        <Stack spacing={0.5} sx={{ px: 1, pb: 1.25 }}>
          <Typography variant="caption" color="text.secondary">
            Кол-во: начало {formatNumber(row.qty_start, 3)} · конец {formatNumber(row.qty_end, 3)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Стоимость: приход {formatNumber(row.cost_in)} · расход {formatNumber(row.cost_out)} · конец {formatNumber(row.cost_end)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Бух: приход {formatNumber(row.cost_accounting_in)} · расход {formatNumber(row.cost_accounting_out)} · конец {formatNumber(row.cost_accounting_end)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Средняя цена: {formatNumber(row.avg_price_start)} → {formatNumber(row.avg_price_end)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ТН: {formatDocRequisite(row.torg12_number, row.torg12_date)} · СчФ: {formatDocRequisite(row.invoice_number, row.invoice_date)}
          </Typography>
        </Stack>
      ) : null}
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
    <Box sx={{ minWidth: { xs: 0, sm: 260 }, width: { xs: '100%', sm: 'auto' }, flex: 1 }}>
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
          field.error
            ? field.error
            : String(field.inputValue || '').trim().length < AUTOCOMPLETE_MIN_CHARS
            ? 'Введите минимум 2 символа'
            : 'Ничего не найдено'
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={placeholder}
            error={Boolean(field.error)}
            helperText={field.error || undefined}
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
  downloadingFileRef,
  previewingFileRef,
  onPreviewFile,
  onDownloadFile,
  onClose,
  fullScreen = false,
}) {
  const fromName = detail?.transfer_from_warehouse_name || row?.transfer_from_warehouse_name;
  const toName = detail?.transfer_to_warehouse_name || row?.transfer_to_warehouse_name;
  const warehouseName = detail?.warehouse_name || row?.warehouse_name;
  const counterpartyName = detail?.counterparty_name;
  const registrarNumber = detail?.registrar_number || row?.registrar_number;
  const registrarDate = detail?.registrar_date || row?.registrar_date;
  const registrarName = detail?.registrar_name || row?.registrar_name;
  const registrarRef = detail?.registrar_ref || row?.registrar_ref;
  const isTransfer = detail?.is_transfer ?? row?.is_transfer;
  const documentTitle = detail?.document_title
    || (isTransfer ? 'Перемещение между складами' : 'Документ склада');
  const files = Array.isArray(detail?.files) ? detail.files : [];
  const filesStatus = detail?.files_status || 'pending';
  const hasRoute = Boolean(fromName || toName);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle
        sx={{
          pr: 6,
          pt: fullScreen ? 'calc(env(safe-area-inset-top) + 12px)' : undefined,
        }}
      >
        {documentTitle}
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: fullScreen ? 'calc(env(safe-area-inset-top) + 4px)' : 8 }}
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

          {hasRoute ? (
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
          ) : (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Склад
              </Typography>
              <Chip label={warehouseName || 'Не указан'} color="primary" variant="outlined" />
              {counterpartyName ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Контрагент: {counterpartyName}
                </Typography>
              ) : null}
            </Box>
          )}

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
            {!loading && !error && (filesStatus === 'unsupported' || filesStatus === 'empty') && files.length === 0 ? (
              <Alert severity="info">
                {detail?.files_message || 'Прикреплённые файлы недоступны.'}
              </Alert>
            ) : null}
            {!loading && !error && filesStatus === 'ok' && files.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                К этому документу файлы не прикреплены.
              </Typography>
            ) : null}
            {!loading && !error && files.length > 0 ? (
              <List dense disablePadding>
                {files.map((file) => {
                  const fileKey = file.ref || file.name;
                  const busy = downloadingFileRef === fileKey || previewingFileRef === fileKey;
                  return (
                    <ListItem
                      key={fileKey}
                      disableGutters
                      secondaryAction={(
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Открыть предпросмотр">
                            <span>
                              <IconButton
                                edge="end"
                                aria-label={`Открыть ${file.name}`}
                                disabled={!file.ref || !registrarRef || busy}
                                onClick={() => onPreviewFile?.(registrarRef, file)}
                              >
                                {previewingFileRef === fileKey
                                  ? <CircularProgress size={18} />
                                  : <VisibilityIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Скачать">
                            <span>
                              <IconButton
                                edge="end"
                                aria-label={`Скачать ${file.name}`}
                                disabled={!file.ref || !registrarRef || busy}
                                onClick={() => onDownloadFile?.(registrarRef, file)}
                              >
                                {downloadingFileRef === fileKey
                                  ? <CircularProgress size={18} />
                                  : <DownloadIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    >
                      <AttachFileIcon fontSize="small" color="action" sx={{ mr: 1 }} />
                      <ListItemText
                        primary={(
                          <Typography
                            variant="body2"
                            component="button"
                            type="button"
                            onClick={() => onPreviewFile?.(registrarRef, file)}
                            disabled={!file.ref || !registrarRef || busy}
                            sx={{
                              border: 0,
                              background: 'none',
                              p: 0,
                              m: 0,
                              cursor: (!file.ref || !registrarRef || busy) ? 'default' : 'pointer',
                              color: 'primary.main',
                              textAlign: 'left',
                              textDecoration: 'underline',
                              textUnderlineOffset: 2,
                              font: 'inherit',
                            }}
                          >
                            {file.name}
                          </Typography>
                        )}
                        secondary={formatFileSize(file.size) || null}
                      />
                    </ListItem>
                  );
                })}
              </List>
            ) : null}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ pb: fullScreen ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined }}>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

function Warehouse1C() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const theme = useTheme();
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: false });
  const isMobile = isNarrowMobile || isTouchMobile;
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('balances');
  const [deepLinkRequest, setDeepLinkRequest] = useState(null);
  const deepLinkHandledRef = useRef(false);

  const balNomenclatureField = useEntityAutocomplete(
    warehouse1cAPI.searchNomenclature,
    NOMENCLATURE_AUTOCOMPLETE_LIMIT,
  );
  const [balNomenclatureValue, setBalNomenclatureValue] = useState(null);
  const balWarehouseField = useEntityAutocomplete(warehouse1cAPI.searchWarehouses, 50);
  const [balWarehouseValue, setBalWarehouseValue] = useState(null);
  const [balTextQuery, setBalTextQuery] = useState('');

  const [balances, setBalances] = useState([]);
  const [balancesMeta, setBalancesMeta] = useState({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState('');
  const [balancesSearched, setBalancesSearched] = useState(false);

  const movNomenclatureField = useEntityAutocomplete(
    warehouse1cAPI.searchNomenclature,
    NOMENCLATURE_AUTOCOMPLETE_LIMIT,
  );
  const [movNomenclatureValue, setMovNomenclatureValue] = useState(null);
  const movWarehouseField = useEntityAutocomplete(warehouse1cAPI.searchWarehouses, 50);
  const [movWarehouseValue, setMovWarehouseValue] = useState(null);
  const [movSeriesFilter, setMovSeriesFilter] = useState(null);
  const [dateFrom, setDateFrom] = useState(UNBOUNDED_MOVEMENT_PERIOD.dateFrom);
  const [dateTo, setDateTo] = useState(UNBOUNDED_MOVEMENT_PERIOD.dateTo);

  const [movements, setMovements] = useState([]);
  const [movementsMeta, setMovementsMeta] = useState({});
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState('');
  const [movementsSearched, setMovementsSearched] = useState(false);

  const [movementDetailOpen, setMovementDetailOpen] = useState(false);
  const [movementDetailRow, setMovementDetailRow] = useState(null);
  const [movementDetailData, setMovementDetailData] = useState(null);
  const [movementDetailLoading, setMovementDetailLoading] = useState(false);
  const [movementDetailError, setMovementDetailError] = useState('');
  const [downloadingFileRef, setDownloadingFileRef] = useState('');
  const [previewingFileRef, setPreviewingFileRef] = useState('');
  const [filePreview, setFilePreview] = useState(createEmptyFilePreviewState);
  const filePreviewUrlRef = useRef('');
  const [cameFromBalances, setCameFromBalances] = useState(false);
  const [hubMatchOpen, setHubMatchOpen] = useState(false);
  const [hubMatchRow, setHubMatchRow] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState(null);
  const [catalogStatusLoading, setCatalogStatusLoading] = useState(false);
  const [catalogStatusError, setCatalogStatusError] = useState('');
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const canSyncCatalog = String(user?.role || '').trim().toLowerCase() === 'admin';

  const refreshCatalogStatus = useCallback(async () => {
    setCatalogStatusLoading(true);
    try {
      const status = await warehouse1cAPI.getCatalogStatus();
      setCatalogStatus(status && typeof status === 'object' ? status : null);
      setCatalogStatusError('');
    } catch (err) {
      console.warn('Failed to load Warehouse 1C catalog status:', err);
      setCatalogStatusError('status_unavailable');
    } finally {
      setCatalogStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCatalogStatus();
  }, [refreshCatalogStatus]);

  const handleCatalogSync = useCallback(async () => {
    if (!canSyncCatalog || catalogSyncing) return;
    setCatalogSyncing(true);
    setCatalogStatusError('');
    try {
      const status = await warehouse1cAPI.syncCatalog();
      setCatalogStatus(status && typeof status === 'object' ? status : null);
    } catch (err) {
      console.error('Failed to sync Warehouse 1C catalog:', err);
      setCatalogStatusError('sync_failed');
    } finally {
      setCatalogSyncing(false);
      void refreshCatalogStatus();
    }
  }, [canSyncCatalog, catalogSyncing, refreshCatalogStatus]);

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
    setBalancesMeta({});
    try {
      const data = await warehouse1cAPI.getBalances({
        nomenclatureRef: balNomenclatureValue?.ref || '',
        warehouseRef: balWarehouseValue?.ref || '',
        q: balTextQuery.trim(),
      });
      const response = normalizeWarehouse1cListResponse(data);
      setBalances(sortBalancesByNomenclature(response.items));
      setBalancesMeta(response.meta);
    } catch (err) {
      console.error('Failed to load 1C balances:', err);
      setBalancesError(resolveErrorMessage(err, 'Не удалось получить остатки из 1С.'));
      setBalances([]);
      setBalancesMeta({});
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
    setMovementsMeta({});
    try {
      const data = await warehouse1cAPI.getMovements({
        nomenclatureRef: nomenclature.ref,
        warehouseRef: warehouse?.ref || '',
        seriesRef: series?.ref || '',
        dateFrom: from || '',
        dateTo: to || '',
      });
      const response = normalizeWarehouse1cListResponse(data);
      setMovements(response.items);
      setMovementsMeta(response.meta);
    } catch (err) {
      console.error('Failed to load 1C movements:', err);
      setMovementsError(resolveErrorMessage(err, 'Не удалось получить ведомость движений из 1С.'));
      setMovements([]);
      setMovementsMeta({});
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

    const targetTab = tabParam === 'movements'
      ? 'movements'
      : (tabParam === 'reconcile' ? 'reconcile' : 'balances');
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
      setBalancesMeta({});
      warehouse1cAPI.getBalances({
        nomenclatureRef: request.nomenclature?.ref || '',
        warehouseRef: request.warehouse?.ref || '',
      })
        .then((data) => {
          const response = normalizeWarehouse1cListResponse(data);
          setBalances(sortBalancesByNomenclature(response.items));
          setBalancesMeta(response.meta);
        })
        .catch((err) => {
          console.error('Failed to load 1C balances from deep link:', err);
          setBalancesError(resolveErrorMessage(err, 'Не удалось получить остатки из 1С.'));
          setBalances([]);
          setBalancesMeta({});
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
    setDateFrom(UNBOUNDED_MOVEMENT_PERIOD.dateFrom);
    setDateTo(UNBOUNDED_MOVEMENT_PERIOD.dateTo);
    setCameFromBalances(true);
    setTab('movements');
    void runMovementsSearch({
      nomenclature,
      warehouse,
      series,
      dateFrom: UNBOUNDED_MOVEMENT_PERIOD.dateFrom,
      dateTo: UNBOUNDED_MOVEMENT_PERIOD.dateTo,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movNomenclatureField, movWarehouseField, runMovementsSearch]);

  const handleOpenHubMatch = useCallback((row) => {
    if (!row) return;
    if (!row.nomenclature_code && !row.nomenclature_name && !row.nomenclature_ref) return;
    setHubMatchRow(row);
    setHubMatchOpen(true);
  }, []);

  const handleCloseHubMatch = useCallback(() => {
    setHubMatchOpen(false);
    setHubMatchRow(null);
  }, []);

  const handleOpenInvFromHubMatch = useCallback((invNo, meta = {}) => {
    const value = String(invNo || '').trim();
    if (!value || value === '-') return;
    const returnPath = `${location.pathname}${location.search || ''}`;
    const databaseId = String(meta?.databaseId || '').trim();
    navigate('/database', {
      state: {
        returnTo: returnPath || '/warehouse-1c',
        returnLabel: 'Назад в Склад 1С',
        reopenDetail: {
          kind: 'equipment',
          invNo: value,
          detailTab: 'main',
          ...(databaseId ? { databaseId } : {}),
        },
      },
    });
  }, [location.pathname, location.search, navigate]);

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

  const revokeFilePreviewUrl = useCallback(() => {
    if (filePreviewUrlRef.current && typeof window !== 'undefined' && window.URL?.revokeObjectURL) {
      window.URL.revokeObjectURL(filePreviewUrlRef.current);
    }
    filePreviewUrlRef.current = '';
  }, []);

  const handleCloseFilePreview = useCallback(() => {
    revokeFilePreviewUrl();
    setFilePreview(createEmptyFilePreviewState());
    setPreviewingFileRef('');
  }, [revokeFilePreviewUrl]);

  useEffect(() => () => {
    revokeFilePreviewUrl();
  }, [revokeFilePreviewUrl]);

  const handleOpenMovementDetail = useCallback((row) => {
    if (!canOpenMovementDetail(row)) return;

    setMovementDetailRow(row);
    setMovementDetailData(null);
    setMovementDetailError('');
    setDownloadingFileRef('');
    setPreviewingFileRef('');
    setMovementDetailLoading(true);
    setMovementDetailOpen(true);

    warehouse1cAPI.getMovementDetail(row.registrar_ref)
      .then((data) => {
        setMovementDetailData(data);
      })
      .catch((err) => {
        console.error('Failed to load movement detail:', err);
        setMovementDetailError(resolveErrorMessage(err, 'Не удалось загрузить карточку документа.'));
      })
      .finally(() => {
        setMovementDetailLoading(false);
      });
  }, []);

  const handleDownloadMovementFile = useCallback(async (registrarRef, file) => {
    const fileRef = String(file?.ref || '').trim();
    const fileKey = fileRef || String(file?.name || '').trim();
    if (!registrarRef || !fileRef) return;
    setDownloadingFileRef(fileKey);
    try {
      const response = await warehouse1cAPI.downloadMovementFile(registrarRef, fileRef);
      downloadBlobResponse(response, file?.name || 'file.bin');
    } catch (err) {
      console.error('Failed to download movement file:', err);
      setMovementDetailError(resolveErrorMessage(err, 'Не удалось скачать файл из 1С.'));
    } finally {
      setDownloadingFileRef('');
    }
  }, []);

  const handlePreviewMovementFile = useCallback(async (registrarRef, file) => {
    const fileRef = String(file?.ref || '').trim();
    const fileKey = fileRef || String(file?.name || '').trim();
    if (!registrarRef || !fileRef) return;

    setPreviewingFileRef(fileKey);
    revokeFilePreviewUrl();
    setFilePreview({
      open: true,
      loading: true,
      error: '',
      title: file?.name || 'Файл',
      subtitle: movementDetailData?.document_title
        || movementDetailRow?.registrar_name
        || 'Склад 1С',
      kind: 'pdf',
      objectUrl: '',
      previewBlob: null,
    });

    try {
      const response = await warehouse1cAPI.downloadMovementFile(registrarRef, fileRef);
      const contentType = String(response?.headers?.['content-type'] || 'application/octet-stream');
      const fileName = fileNameFromContentDisposition(
        response?.headers?.['content-disposition'],
        file?.name || 'file.bin',
      );
      const blob = response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data], { type: contentType });
      const sniff = await sniffBlobKind(blob);
      const resolved = resolveDocumentPreviewKind({ contentType, fileName, sniff });
      const objectUrl = typeof window !== 'undefined' && window.URL?.createObjectURL
        ? window.URL.createObjectURL(blob)
        : '';
      filePreviewUrlRef.current = objectUrl;
      setFilePreview({
        open: true,
        loading: false,
        error: resolved.kind === 'pdf' ? '' : (resolved.error || 'Формат не поддерживается в предпросмотре.'),
        title: fileName,
        subtitle: movementDetailData?.document_title
          || movementDetailRow?.registrar_name
          || 'Склад 1С',
        kind: resolved.kind === 'pdf' ? 'pdf' : 'unsupported',
        objectUrl,
        previewBlob: blob,
      });
    } catch (err) {
      console.error('Failed to preview movement file:', err);
      setFilePreview((prev) => ({
        ...prev,
        open: true,
        loading: false,
        error: resolveErrorMessage(err, 'Не удалось открыть файл из 1С.'),
        objectUrl: '',
        previewBlob: null,
      }));
    } finally {
      setPreviewingFileRef('');
    }
  }, [movementDetailData?.document_title, movementDetailRow?.registrar_name, revokeFilePreviewUrl]);

  const balancesResultLabel = useMemo(() => {
    if (!balancesSearched) return '';
    const total = Number(balancesMeta?.total);
    const totalLabel = Number.isFinite(total) && total >= balances.length
      ? ` из ${total}`
      : '';
    const asOf = balancesMeta?.asOf ? ` · данные на ${formatDateTime(balancesMeta.asOf)}` : '';
    return `Найдено позиций: ${balances.length}${totalLabel}${asOf}`;
  }, [balancesSearched, balances.length, balancesMeta]);

  const balancesTotals = useMemo(
    () => (isWarehouse1cListIncomplete(balancesMeta) ? null : buildBalancesTotals(balances)),
    [balances, balancesMeta],
  );

  const movementsResultLabel = useMemo(() => {
    if (!movementsSearched) return '';
    const total = Number(movementsMeta?.total);
    const totalLabel = Number.isFinite(total) && total >= movements.length
      ? ` из ${total}`
      : '';
    const asOf = movementsMeta?.asOf ? ` · данные на ${formatDateTime(movementsMeta.asOf)}` : '';
    return `Найдено движений: ${movements.length}${totalLabel}${asOf}`;
  }, [movementsSearched, movements.length, movementsMeta]);

  return (
    <MainLayout showDatabaseSelector>
      {isMobile ? <MobileShellPageHeader title="Склад 1С" showDatabaseSelector /> : null}
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

        <CatalogStatusCard
          status={catalogStatus}
          loading={catalogStatusLoading}
          error={catalogStatusError}
          canSync={canSyncCatalog}
          syncing={catalogSyncing}
          onSync={handleCatalogSync}
        />

        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
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
          <Button
            variant={tab === 'reconcile' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => {
              setCameFromBalances(false);
              setTab('reconcile');
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('tab', 'reconcile');
                return next;
              }, { replace: true });
            }}
          >
            Сверка Hub ↔ 1С
          </Button>
        </Stack>

        {tab === 'reconcile' ? (
          <Warehouse1CReconcilePanel
            onOpenInvNo={handleOpenInvFromHubMatch}
            onOpenNomenclature={(row) => handleOpenHubMatch(row)}
          />
        ) : null}

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
                  sx={{ minWidth: { xs: 0, sm: 220 }, width: { xs: '100%', sm: 'auto' } }}
                />
                <Button
                  variant="contained"
                  startIcon={balancesLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                  onClick={handleSearchBalances}
                  disabled={!canSearchBalances || balancesLoading}
                  sx={{ flexShrink: 0, height: 40, width: { xs: '100%', sm: 'auto' } }}
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
            {balancesSearched ? (
              <WarehouseListMetadataNotice meta={balancesMeta} entityLabel="остатков" />
            ) : null}

            {balancesSearched && !balancesLoading ? (
              balances.length === 0 && !isWarehouse1cListIncomplete(balancesMeta) ? (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary" align="center">
                    По заданному фильтру остатков не найдено
                  </Typography>
                </Paper>
              ) : balances.length === 0 ? null : isMobile ? (
                <Stack spacing={1}>
                  <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                    {balances.map((row, index) => (
                      <BalanceMobileRow
                        key={`${row.nomenclature_ref}|${row.series_ref}|${row.warehouse_ref}|${index}`}
                        row={row}
                        onShowMovement={handleShowMovement}
                        onOpenHubMatch={handleOpenHubMatch}
                      />
                    ))}
                  </Paper>
                  {balancesTotals ? (
                    <Paper variant="outlined" sx={{ px: 1.25, py: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                        Итого ({balancesTotals.count})
                      </Typography>
                      <Typography variant="body2">
                        Кол-во: {formatNumber(balancesTotals.qty, 3)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Стоимость: {formatNumber(balancesTotals.cost)}
                        {' · '}
                        Бух: {formatNumber(balancesTotals.costAccounting)}
                        {' · '}
                        Средняя: {formatNumber(balancesTotals.avgPrice)}
                      </Typography>
                    </Paper>
                  ) : null}
                </Stack>
              ) : (
              <TableContainer component={Paper} sx={{ maxHeight: '70vh' }}>
                <Table size="small" stickyHeader>
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
                    {balances.map((row, index) => (
                      <TableRow
                        key={`${row.nomenclature_ref}|${row.series_ref}|${row.warehouse_ref}|${index}`}
                        hover
                      >
                        <TableCell
                          onClick={() => handleOpenHubMatch(row)}
                          sx={{
                            cursor: 'pointer',
                            '&:hover .wh-nomenclature-name': { textDecoration: 'underline' },
                          }}
                        >
                          <Box className="wh-nomenclature-name">
                            <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
                          </Box>
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
                  {balancesTotals ? (
                    <TableFooter>
                      <TableRow
                        sx={{
                          '& td': {
                            fontWeight: 700,
                            bgcolor: 'action.hover',
                            borderTop: '2px solid',
                            borderColor: 'divider',
                            position: 'sticky',
                            bottom: 0,
                            zIndex: 2,
                          },
                        }}
                      >
                        <TableCell colSpan={4}>
                          Итого ({balancesTotals.count})
                        </TableCell>
                        <TableCell align="right">{formatNumber(balancesTotals.qty, 3)}</TableCell>
                        <TableCell align="right">{formatNumber(balancesTotals.cost)}</TableCell>
                        <TableCell align="right">{formatNumber(balancesTotals.costAccounting)}</TableCell>
                        <TableCell align="right">{formatNumber(balancesTotals.avgPrice)}</TableCell>
                        <TableCell colSpan={5} />
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </TableContainer>
              )
            ) : null}
          </>
        ) : tab === 'movements' ? (
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
                  sx={{ minWidth: { xs: 0, sm: 170 }, width: { xs: '100%', sm: 'auto' } }}
                />
                <TextField
                  size="small"
                  type="date"
                  label="Период по"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: { xs: 0, sm: 170 }, width: { xs: '100%', sm: 'auto' } }}
                />
                <Button
                  variant="contained"
                  startIcon={movementsLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                  onClick={handleSearchMovementsClick}
                  disabled={!movNomenclatureValue || movementsLoading}
                  sx={{ flexShrink: 0, height: 40, width: { xs: '100%', sm: 'auto' } }}
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
            {movementsSearched ? (
              <WarehouseListMetadataNotice meta={movementsMeta} entityLabel="движений" />
            ) : null}

            {movementsSearched && !movementsLoading ? (
              movements.length === 0 && !isWarehouse1cListIncomplete(movementsMeta) ? (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary" align="center">
                    По заданному фильтру движений не найдено
                  </Typography>
                </Paper>
              ) : movements.length === 0 ? null : isMobile ? (
                <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                  {movements.map((row, index) => (
                    <MovementMobileRow
                      key={`${row.registrar_ref || row.registrar_name}|${row.period}|${index}`}
                      row={row}
                      onOpenDetail={handleOpenMovementDetail}
                    />
                  ))}
                </Paper>
              ) : (
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
                    {movements.map((row, index) => (
                      <TableRow
                        key={`${row.registrar_ref || row.registrar_name}|${row.period}|${index}`}
                        hover
                        onClick={canOpenMovementDetail(row) ? () => handleOpenMovementDetail(row) : undefined}
                        sx={canOpenMovementDetail(row) ? { cursor: 'pointer' } : undefined}
                      >
                        <TableCell>
                          {canOpenMovementDetail(row) ? (
                            <Tooltip title="Открыть карточку документа">
                              <Typography variant="body2" component="span" color="primary.main">
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
              )
            ) : null}
          </>
        ) : null}

        <MovementDetailDialog
          open={movementDetailOpen}
          row={movementDetailRow}
          detail={movementDetailData}
          loading={movementDetailLoading}
          error={movementDetailError}
          downloadingFileRef={downloadingFileRef}
          previewingFileRef={previewingFileRef}
          onPreviewFile={handlePreviewMovementFile}
          onDownloadFile={handleDownloadMovementFile}
          onClose={handleCloseMovementDetail}
          fullScreen={isMobile}
        />

        <DocumentPreviewDialog
          open={Boolean(filePreview?.open)}
          title={filePreview?.title || 'Файл'}
          subtitle={filePreview?.subtitle || ''}
          kind={filePreview?.kind || 'pdf'}
          objectUrl={filePreview?.objectUrl || ''}
          loading={Boolean(filePreview?.loading)}
          error={filePreview?.error || ''}
          onClose={handleCloseFilePreview}
          onDownloadOriginal={filePreview?.previewBlob && filePreview?.objectUrl ? () => {
            const link = document.createElement('a');
            link.href = filePreview.objectUrl;
            link.download = filePreview.title || 'file.bin';
            link.click();
          } : undefined}
          canDownloadOriginal={Boolean(filePreview?.previewBlob)}
        />

        <HubNomenclatureMatchDialog
          open={hubMatchOpen}
          row={hubMatchRow}
          warehouse={
            hubMatchRow?.warehouse_ref
              ? { ref: hubMatchRow.warehouse_ref, name: hubMatchRow.warehouse_name || '' }
              : (balWarehouseValue || null)
          }
          ownerNo={returnContext?.ownerNo || null}
          warehouseName={
            hubMatchRow?.warehouse_name
            || balWarehouseValue?.name
            || returnContext?.employeeName
            || ''
          }
          employeeName={returnContext?.employeeName || hubMatchRow?.warehouse_name || ''}
          onClose={handleCloseHubMatch}
          onOpenInvNo={handleOpenInvFromHubMatch}
        />
      </PageShell>
    </MainLayout>
  );
}

export default Warehouse1C;
