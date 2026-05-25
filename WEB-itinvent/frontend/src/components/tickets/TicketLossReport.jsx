import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
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
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { ticketsAPI } from '../../api/tickets';
import { FIN_OP_TYPES, downloadBlob, formatDate, formatMoney, getErrorMessage } from './ticketUi';

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

export default function TicketLossReport({ objects = [], canWrite = false }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [dateFrom, setDateFrom] = useState(monthStartIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [objectId, setObjectId] = useState('');
  const [opType, setOpType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const params = { date_from: dateFrom, date_to: dateTo, object_id: objectId, op_type: opType, page_size: 50 };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.getLossesReport(params);
      setRows(Array.isArray(data?.items) ? data.items : []);
      setTotals(data?.totals || {});
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, objectId, opType]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportReport = async () => {
    const blob = await ticketsAPI.exportLosses(params);
    downloadBlob(blob, 'ticket-losses.xlsx');
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <TextField size="small" type="date" label="С" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="По" value={dateTo} onChange={(event) => setDateTo(event.target.value)} InputLabelProps={{ shrink: true }} />
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Объект</InputLabel>
          <Select value={objectId} label="Объект" onChange={(event) => setObjectId(event.target.value)}>
            <MenuItem value="">Все</MenuItem>
            {objects.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Тип</InputLabel>
          <Select value={opType} label="Тип" onChange={(event) => setOpType(event.target.value)}>
            <MenuItem value="">Все</MenuItem>
            {FIN_OP_TYPES.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
          </Select>
        </FormControl>
        <Button startIcon={<RefreshIcon />} onClick={load}>Обновить</Button>
        {canWrite ? <Button startIcon={<DownloadIcon />} onClick={exportReport}>Экспорт</Button> : null}
      </Stack>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Grid container spacing={1.5}>
        <Grid item xs={12} md={4}><Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}><Typography>Потери</Typography><Typography variant="h6">{formatMoney(totals.total_losses)}</Typography></Box></Grid>
        <Grid item xs={12} md={4}><Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}><Typography>Возвраты</Typography><Typography variant="h6">{formatMoney(totals.total_refunds)}</Typography></Box></Grid>
        <Grid item xs={12} md={4}><Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}><Typography>Баланс</Typography><Typography variant="h6">{formatMoney(totals.balance)}</Typography></Box></Grid>
      </Grid>
      <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Дата</TableCell>
              <TableCell>ФИО</TableCell>
              <TableCell>Объект</TableCell>
              <TableCell>Тип</TableCell>
              <TableCell align="right">Сумма</TableCell>
              <TableCell>Причина</TableCell>
              <TableCell>Статус</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.op_date)}</TableCell>
                <TableCell>{row.employee_name || '-'}</TableCell>
                <TableCell>{row.object_name || '-'}</TableCell>
                <TableCell>{row.op_type_label || row.op_type}</TableCell>
                <TableCell align="right">{formatMoney(row.amount)}</TableCell>
                <TableCell>{row.reason || '-'}</TableCell>
                <TableCell>{row.refund_status || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
