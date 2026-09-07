import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import { ticketsAPI } from '../../api/tickets';
import useRequestGuard from '../../lib/useRequestGuard';
import {
  STATUS_ROW_COLORS,
  TICKET_STATUS_OPTIONS,
  downloadBlob,
  formatArrivalRoute,
  formatDate,
  getErrorMessage,
  isMaskedPersonalValue,
} from './ticketUi';

const normalizeMulti = (value) => (Array.isArray(value) ? value : []);

const formatPassportCell = (series, number) => {
  const left = series || '';
  const right = number || '';
  if (left && right) return `${left} / ${right}`;
  return left || right || '-';
};

export default function TicketRequestList({ objects = [], onSelectRequest, canWrite = false }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [objectIds, setObjectIds] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const beginExport = useRequestGuard();

  const params = useMemo(() => ({
    page,
    page_size: pageSize,
    object_ids: objectIds,
    statuses,
    search: search.trim().length >= 2 ? search.trim() : '',
    sort_field: 'submitted_at',
    sort_dir: 'desc',
  }), [objectIds, page, pageSize, search, statuses]);

  const beginLoad = useRequestGuard(JSON.stringify(params));
  const load = useCallback(async () => {
    const isCurrent = beginLoad();
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.listRequests(params);
      if (!isCurrent()) return;
      setRows(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      if (!isCurrent()) return;
      setError(getErrorMessage(err));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginLoad, params]);

  useEffect(() => {
    const timer = window.setTimeout(load, search.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const exportRows = async () => {
    if (exportingRef.current) return;
    const isCurrent = beginExport();
    exportingRef.current = true;
    setExporting(true);
    setError('');
    try {
      const blob = await ticketsAPI.exportRequests(params);
      if (isCurrent()) downloadBlob(blob, 'ticket-requests.xlsx');
    } catch (err) {
      if (isCurrent()) setError(getErrorMessage(err));
    } finally {
      exportingRef.current = false;
      if (isCurrent()) setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
        <TextField
          label="Поиск"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          size="small"
          sx={{ minWidth: { md: 260 } }}
        />
        <FormControl size="small" sx={{ minWidth: 210 }}>
          <InputLabel>Объекты</InputLabel>
          <Select
            multiple
            value={objectIds}
            label="Объекты"
            onChange={(event) => {
              setObjectIds(normalizeMulti(event.target.value));
              setPage(1);
            }}
            renderValue={(selected) => `${selected.length} выбрано`}
          >
            {objects.map((item) => (
              <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 210 }}>
          <InputLabel>Статусы</InputLabel>
          <Select
            multiple
            value={statuses}
            label="Статусы"
            onChange={(event) => {
              setStatuses(normalizeMulti(event.target.value));
              setPage(1);
            }}
            renderValue={(selected) => `${selected.length} выбрано`}
          >
            {TICKET_STATUS_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Обновить</Button>
        {canWrite ? <Button startIcon={<DownloadIcon />} onClick={exportRows} disabled={exporting}>{exporting ? 'Экспортируем…' : 'Экспорт'}</Button> : null}
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? <LinearProgress /> : null}

      <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>№ п/п</TableCell>
              <TableCell>Дата подачи</TableCell>
              <TableCell>ФИО</TableCell>
              <TableCell>Подразделение</TableCell>
              <TableCell>Должность</TableCell>
              <TableCell>Серия / Номер</TableCell>
              <TableCell>Дата выдачи</TableCell>
              <TableCell>Кем выдан</TableCell>
              <TableCell>Код подр.</TableCell>
              <TableCell>Дата рождения</TableCell>
              <TableCell>Место рождения</TableCell>
              <TableCell>Прописка</TableCell>
              <TableCell>Телефон</TableCell>
              <TableCell>Прибытие / город</TableCell>
              <TableCell>№ заявки</TableCell>
              <TableCell>Шифр объекта</TableCell>
              <TableCell>Примечание</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={row.id}
                hover
                onClick={() => onSelectRequest?.(row.id)}
                sx={{
                  cursor: 'pointer',
                  backgroundColor: STATUS_ROW_COLORS[row.status] || 'transparent',
                }}
              >
                <TableCell>{(page - 1) * pageSize + index + 1}</TableCell>
                <TableCell>{formatDate(row.submitted_at)}</TableCell>
                <TableCell>
                  <Button onClick={(event) => { event.stopPropagation(); onSelectRequest?.(row.id); }}
                    aria-label={`Открыть заявку ${row.id}: ${row.employee_name || ''}`}>
                    {row.employee_name || `Заявка ${row.id}`}
                  </Button>
                </TableCell>
                <TableCell>{row.department || '-'}</TableCell>
                <TableCell>{row.position || '-'}</TableCell>
                <TableCell>{formatPassportCell(row.passport_series, row.passport_number)}</TableCell>
                <TableCell>{formatDate(row.issue_date)}</TableCell>
                <TableCell>{row.issued_by || '-'}</TableCell>
                <TableCell>{row.issuer_code || '-'}</TableCell>
                <TableCell>
                  {isMaskedPersonalValue(row.date_of_birth) ? row.date_of_birth : formatDate(row.date_of_birth)}
                </TableCell>
                <TableCell>{row.birth_place || '-'}</TableCell>
                <TableCell>{row.registration_address || '-'}</TableCell>
                <TableCell>{row.phone || '-'}</TableCell>
                <TableCell>{formatArrivalRoute(row.arrival_date, row.route)}</TableCell>
                <TableCell>{row.id}</TableCell>
                <TableCell>{row.object_code || '-'}</TableCell>
                <TableCell sx={{ maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.note || '-'}
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={17}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    Заявки не найдены
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">Всего: {total}</Typography>
        <Pagination page={page} count={totalPages} onChange={(_, value) => setPage(value)} />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>На странице</InputLabel>
          <Select value={pageSize} label="На странице" onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}>
            {[25, 50, 100].map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
    </Stack>
  );
}
