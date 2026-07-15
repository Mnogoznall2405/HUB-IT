import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function HostsSection({
  visible,
  rows,
  total,
  loading,
  page,
  rowsPerPage,
  rowsPerPageOptions,
  query,
  status,
  severity,
  sortBy,
  sortDir,
  formatTs,
  severityColor,
  onQueryChange,
  onStatusChange,
  onSeverityChange,
  onSort,
  onPageChange,
  onRowsPerPageChange,
  onOpenHost,
}) {
  const theme = useTheme();
  const mobileLayout = useMediaQuery(theme.breakpoints.down('md'));
  if (!visible) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Компьютеры с рисками</Typography>
            <Typography variant="body2" color="text.secondary">Здесь только устройства, на которых есть или были находки.</Typography>
          </Box>
          <Chip size="small" label={`Всего: ${total}`} />
        </Box>
        <Alert
          severity="info"
          action={<Button component="a" href="/computers" size="small" color="inherit">Все компьютеры</Button>}
        >
          Чистые и ещё не сканировавшиеся устройства смотрите в полном реестре компьютеров.
        </Alert>
        <Grid container spacing={1.2}>
          <Grid item xs={12} md={6}>
            <TextField size="small" fullWidth label="Поиск по хостам" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="ПК, пользователь, IP, филиал" />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel>Статус</InputLabel>
              <Select value={status} label="Статус" onChange={(event) => onStatusChange(event.target.value)}>
                <MenuItem value="all">Все</MenuItem>
                <MenuItem value="new">NEW</MenuItem>
                <MenuItem value="ack">ACK</MenuItem>
                <MenuItem value="resolved_deleted">Удалён</MenuItem>
                <MenuItem value="resolved_clean">Очищен</MenuItem>
                <MenuItem value="resolved_moved">Перемещён</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel>Severity</InputLabel>
              <Select value={severity} label="Severity" onChange={(event) => onSeverityChange(event.target.value)}>
                <MenuItem value="all">Все</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="none">None</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        {mobileLayout ? <Stack spacing={1}>
          {loading && rows.length === 0 ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box> : null}
          {!loading && rows.length === 0 ? <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Инцидентов по текущим фильтрам нет.</Typography> : null}
          {rows.map((row) => (
            <Paper key={row.hostname} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{row.hostname}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.branch || 'Без филиала'} · {row.user || 'Пользователь не указан'}</Typography>
                  </Box>
                  <Chip size="small" color={severityColor(row.top_severity)} label={String(row.top_severity || 'none')} />
                </Stack>
                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                  <Chip size="small" color={Number(row.incidents_new || 0) > 0 ? 'warning' : 'default'} label={`Новых: ${Number(row.incidents_new || 0)}`} />
                  <Chip size="small" variant="outlined" label={`Всего: ${Number(row.incidents_total || 0)}`} />
                  {(Array.isArray(row.top_exts) ? row.top_exts : []).slice(0, 3).map((ext) => <Chip key={ext} size="small" variant="outlined" label={ext} />)}
                </Stack>
                <Typography variant="caption" color="text.secondary">Последняя находка: {formatTs(row.last_incident_at)} · IP: {row.ip_address || '-'}</Typography>
                <Button type="button" size="small" variant="contained" onClick={() => onOpenHost(row.hostname)}>Открыть расследование</Button>
              </Stack>
            </Paper>
          ))}
        </Stack> : (

        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 540 }}>
          <Table stickyHeader size="small" sx={{ minWidth: 1240 }}>
            <TableHead>
              <TableRow>
                {[
                  ['hostname', 'Hostname'],
                  ['branch', 'Филиал'],
                  ['user', 'Пользователь'],
                  ['ip_address', 'IP'],
                  ['incidents_new', 'Непросмотренных'],
                  ['incidents_total', 'Находок за всё время'],
                  ['severity', 'Severity'],
                  ['last_incident_at', 'Последний инцидент'],
                ].map(([key, label]) => (
                  <TableCell key={key} sortDirection={sortBy === key ? sortDir : false}>
                    <TableSortLabel active={sortBy === key} direction={sortBy === key ? sortDir : 'desc'} onClick={() => onSort(key)}>
                      {label}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell>Типы</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center">Инцидентов пока нет.</TableCell></TableRow>
              ) : rows.map((row) => (
                <TableRow hover key={row.hostname}>
                  <TableCell>{row.hostname}</TableCell>
                  <TableCell>{row.branch || 'Без филиала'}</TableCell>
                  <TableCell>{row.user || '-'}</TableCell>
                  <TableCell>{row.ip_address || '-'}</TableCell>
                  <TableCell><Chip size="small" color={Number(row.incidents_new || 0) > 0 ? 'warning' : 'default'} label={Number(row.incidents_new || 0)} /></TableCell>
                  <TableCell>{Number(row.incidents_total || 0)}</TableCell>
                  <TableCell><Chip size="small" color={severityColor(row.top_severity)} label={String(row.top_severity || 'none')} /></TableCell>
                  <TableCell>{formatTs(row.last_incident_at)}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{(Array.isArray(row.top_exts) ? row.top_exts : []).join(', ') || '-'}</Typography>
                    <Typography variant="caption" color="text.secondary">{(Array.isArray(row.top_source_kinds) ? row.top_source_kinds : []).join(', ') || '-'}</Typography>
                  </TableCell>
                  <TableCell align="right"><Button type="button" size="small" variant="outlined" onClick={() => onOpenHost(row.hostname)}>Просмотреть</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, nextPage) => onPageChange(nextPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => onRowsPerPageChange(Number(event.target.value))}
          rowsPerPageOptions={rowsPerPageOptions}
          labelRowsPerPage="Строк на странице"
        />
      </Stack>
    </Paper>
  );
}
