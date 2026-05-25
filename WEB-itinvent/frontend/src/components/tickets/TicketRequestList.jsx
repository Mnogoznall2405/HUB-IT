import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { STATUS_COLORS, STATUS_LABELS, TICKET_STATUS_OPTIONS, downloadBlob, formatDate, formatMoney, getErrorMessage } from './ticketUi';

const normalizeMulti = (value) => (Array.isArray(value) ? value : []);

export default function TicketRequestList({ objects = [], onSelectRequest, canWrite = false }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [objectIds, setObjectIds] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => ({
    page,
    page_size: pageSize,
    object_ids: objectIds,
    statuses,
    assignee_ids: assigneeIds,
    search: search.trim().length >= 2 ? search.trim() : '',
    sort_field: sortField,
    sort_dir: sortDir,
  }), [assigneeIds, objectIds, page, pageSize, search, sortDir, sortField, statuses]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.listRequests(params);
      setRows(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    const timer = window.setTimeout(load, search.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    rows.forEach((row) => {
      if (row.assignee_id != null && row.assignee_name) {
        seen.set(String(row.assignee_id), row.assignee_name);
      }
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const setSort = (field) => {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir('asc');
  };

  const exportRows = async () => {
    const blob = await ticketsAPI.exportRequests(params);
    downloadBlob(blob, 'ticket-requests.xlsx');
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
        <FormControl size="small" sx={{ minWidth: 210 }}>
          <InputLabel>Ответственный</InputLabel>
          <Select
            multiple
            value={assigneeIds}
            label="Ответственный"
            onChange={(event) => {
              setAssigneeIds(normalizeMulti(event.target.value));
              setPage(1);
            }}
            renderValue={(selected) => `${selected.length} выбрано`}
          >
            <MenuItem value="none">Без ответственного</MenuItem>
            {assigneeOptions.map((item) => (
              <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Обновить</Button>
        {canWrite ? <Button startIcon={<DownloadIcon />} onClick={exportRows}>Экспорт</Button> : null}
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? <LinearProgress /> : null}

      <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {[
                ['id', '№'],
                ['created_at', 'Создана'],
                ['departure_date', 'Вылет'],
                ['arrival_date', 'Прибытие'],
              ].map(([field, label]) => (
                <TableCell key={field}>
                  <Button size="small" onClick={() => setSort(field)}>{label}</Button>
                </TableCell>
              ))}
              <TableCell>ФИО</TableCell>
              <TableCell>Объект</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Ответственный</TableCell>
              <TableCell align="right">Сумма</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                hover
                onClick={() => onSelectRequest?.(row.id)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{row.id}</TableCell>
                <TableCell>{formatDate(row.created_at)}</TableCell>
                <TableCell>{formatDate(row.departure_date)}</TableCell>
                <TableCell>{formatDate(row.arrival_date)}</TableCell>
                <TableCell>{row.employee_name || '-'}</TableCell>
                <TableCell>{row.object_name || row.object_code || '-'}</TableCell>
                <TableCell>
                  <Chip size="small" color={STATUS_COLORS[row.status] || 'default'} label={STATUS_LABELS[row.status] || row.status} />
                </TableCell>
                <TableCell>{row.assignee_name || 'Без ответственного'}</TableCell>
                <TableCell align="right">{formatMoney(row.total_cost)}</TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
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
