import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PhoneIcon from '@mui/icons-material/Phone';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { addressBookAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 50;

const normalizeText = (value) => String(value || '').trim();
const normalizePhoneDigits = (value) => {
  const digits = normalizeText(value).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};

const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HighlightText = ({ value, query }) => {
  const text = normalizeText(value);
  const terms = normalizeText(query)
    .split(/\s+/)
    .map(escapeRegExp)
    .filter(Boolean);
  if (!text || terms.length === 0) return text;

  const expression = new RegExp(`(${terms.join('|')})`, 'ig');
  const parts = text.split(expression).filter((part) => part !== '');
  return (
    <>
      {parts.map((part, index) => (
        terms.some((term) => new RegExp(`^${term}$`, 'i').test(part)) ? (
          <Box
            key={`${part}-${index}`}
            component="mark"
            sx={{
              px: 0.25,
              borderRadius: 0.5,
              bgcolor: 'warning.light',
              color: 'warning.contrastText',
            }}
          >
            {part}
          </Box>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        )
      ))}
    </>
  );
};

const formatDateTime = (value) => {
  const text = normalizeText(value);
  if (!text) return 'нет данных';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const useDebouncedValue = (value, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const PhoneActions = ({ phones = [], label, onCopy, enableTelLinks = false, query = '' }) => {
  const items = Array.isArray(phones) ? phones : [];
  if (items.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Stack spacing={0.6}>
        {items.map((phone, index) => {
          const value = normalizeText(phone?.value);
          const kind = normalizeText(phone?.kind);
          const normalized = normalizeText(phone?.normalized);
          const phoneDigits = normalized || normalizePhoneDigits(value);
          const telValue = phoneDigits ? `+${phoneDigits}` : value;
          const canCall = enableTelLinks && Boolean(telValue);
          return (
            <Box
              key={`${kind}-${value}-${index}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {kind ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.15 }}>
                    <HighlightText value={kind} query={query} />
                  </Typography>
                ) : null}
                <Typography variant="body2" sx={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                  <HighlightText value={value} query={query} />
                </Typography>
              </Box>
              {canCall ? (
                <Tooltip title="Позвонить">
                  <IconButton
                    component="a"
                    href={`tel:${telValue}`}
                    size="small"
                    aria-label={`Позвонить ${value}`}
                  >
                    <PhoneIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip title="Скопировать">
                <IconButton
                  size="small"
                  aria-label={`Скопировать ${value}`}
                  onClick={() => onCopy(value)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
};

const EmployeeCard = ({ item, onCopy, enableTelLinks = false, query = '' }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.25 }}>
          <HighlightText value={item.full_name} query={query} />
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {item.position ? <HighlightText value={item.position} query={query} /> : 'Должность не указана'}
        </Typography>
      </Box>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        {item.department ? <Chip label={<HighlightText value={item.department} query={query} />} size="small" /> : null}
        {item.department_location ? <Chip label={<HighlightText value={item.department_location} query={query} />} size="small" variant="outlined" /> : null}
      </Stack>
      <PhoneActions phones={item.work_phones} label="Рабочие" onCopy={onCopy} enableTelLinks={enableTelLinks} query={query} />
      <PhoneActions phones={item.personal_phones} label="Личные" onCopy={onCopy} enableTelLinks={enableTelLinks} query={query} />
    </Stack>
  </Paper>
);

const AddressBook = () => {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { user } = useAuth();
  const { notifySuccess, notifyWarning } = useNotification();
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';

  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const debouncedQuery = useDebouncedValue(query);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await addressBookAPI.getStatus());
    } catch (err) {
      console.error('Failed to load address book status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadItems = useCallback(async (nextQuery) => {
    setLoading(true);
    setError('');
    try {
      const data = await addressBookAPI.search({ q: nextQuery, limit: SEARCH_LIMIT });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
      setStatus((prev) => ({
        ...(prev || {}),
        updated_at: data?.updated_at || prev?.updated_at || '',
        last_error: data?.last_error || prev?.last_error || '',
      }));
    } catch (err) {
      console.error('Failed to search address book:', err);
      setError('Не удалось загрузить адресную книгу.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(debouncedQuery);
  }, [debouncedQuery, loadItems]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError('');
    try {
      const nextStatus = await addressBookAPI.sync();
      setStatus(nextStatus);
      await loadItems(debouncedQuery);
    } catch (err) {
      console.error('Failed to sync address book:', err);
      setError('Не удалось обновить адресную книгу из 1С.');
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }, [debouncedQuery, loadItems, loadStatus]);

  const handleCopy = useCallback(async (value) => {
    const text = normalizeText(value);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess('Номер скопирован', { source: 'address-book-copy', dedupeMode: 'none', durationMs: 1800 });
    } catch {
      notifyWarning('Не удалось скопировать номер', { source: 'address-book-copy', dedupeMode: 'none' });
    }
  }, [notifySuccess, notifyWarning]);

  const panelSx = useMemo(() => getOfficePanelSx(ui), [ui]);

  return (
    <MainLayout>
      <PageShell>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            alignItems={{ xs: 'stretch', md: 'center' }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 600 }}>
                Адресная книга
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {total > SEARCH_LIMIT ? `Найдено ${total}, показано ${SEARCH_LIMIT}` : `Найдено ${total}`}
              </Typography>
            </Box>
            {isAdmin ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={`Обновлено: ${formatDateTime(status?.updated_at)}`}
                  size="small"
                  variant="outlined"
                />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                  onClick={handleSync}
                  disabled={syncing}
                >
                  Обновить
                </Button>
              </Stack>
            ) : null}
          </Stack>

          <Paper
            sx={{
              ...panelSx,
              p: 1.5,
              position: { xs: 'sticky', sm: 'static' },
              top: { xs: 8, sm: 'auto' },
              zIndex: { xs: (nextTheme) => nextTheme.zIndex.appBar - 1, sm: 'auto' },
            }}
          >
            <TextField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              fullWidth
              placeholder="ФИО, должность, подразделение, город или телефон"
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <Tooltip title="Очистить поиск">
                      <IconButton
                        aria-label="Очистить поиск"
                        edge="end"
                        size="small"
                        onClick={() => setQuery('')}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : null,
              }}
            />
          </Paper>

          {error ? <Alert severity="error">{error}</Alert> : null}
          {status?.last_error ? <Alert severity="warning">Последняя синхронизация завершилась ошибкой: {status.last_error}</Alert> : null}
          {statusLoading && isAdmin ? <Alert severity="info">Статус синхронизации обновляется...</Alert> : null}

          {loading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 220 }}>
              <CircularProgress />
            </Box>
          ) : items.length === 0 ? (
            <Paper sx={{ ...panelSx, p: 3, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 600 }}>Сотрудники не найдены</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Измените ФИО, подразделение, должность, город или номер телефона.
              </Typography>
            </Paper>
          ) : isMobile ? (
            <Stack spacing={1}>
              {items.map((item, index) => (
                <EmployeeCard key={`${item.full_name}-${index}`} item={item} onCopy={handleCopy} enableTelLinks={isMobile} query={query} />
              ))}
            </Stack>
          ) : (
            <TableContainer component={Paper} sx={panelSx}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ФИО</TableCell>
                    <TableCell>Подразделение</TableCell>
                    <TableCell>Должность</TableCell>
                    <TableCell>Телефоны</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={`${item.full_name}-${index}`} hover>
                      <TableCell sx={{ minWidth: 220 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          <HighlightText value={item.full_name} query={query} />
                        </Typography>
                        {item.department_location ? (
                          <Typography variant="caption" color="text.secondary">
                            <HighlightText value={item.department_location} query={query} />
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.department ? <HighlightText value={item.department} query={query} /> : '-'}</TableCell>
                      <TableCell>{item.position ? <HighlightText value={item.position} query={query} /> : '-'}</TableCell>
                      <TableCell sx={{ minWidth: 320 }}>
                        <Stack spacing={1}>
                          <PhoneActions phones={item.work_phones} label="Рабочие" onCopy={handleCopy} query={query} />
                          <PhoneActions phones={item.personal_phones} label="Личные" onCopy={handleCopy} query={query} />
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </PageShell>
    </MainLayout>
  );
};

export default AddressBook;
