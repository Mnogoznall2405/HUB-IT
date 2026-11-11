import { Box, Button, Chip, IconButton, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { formatBps, formatNumber, interfaceStatus } from './monitoringFormat';

export default function MonitoringInterfaces({ items, canManage, onConfigure, onSelect }) {
  return <Paper component="section" variant="outlined" sx={{ borderRadius: '16px', overflow: 'hidden' }}>
    <Box sx={{ p: 2.5 }}><Typography component="h2" variant="subtitle1" fontWeight={700}>Интерфейсы</Typography><Typography variant="caption" color="text.secondary">Физические и логические интерфейсы · отключённые порты остаются видимыми</Typography></Box>
    {!items.length ? <Typography color="text.secondary" sx={{ px: 2.5, pb: 4 }}>Интерфейсы появятся после успешного обнаружения SNMP.</Typography> : <>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}><Table size="small" aria-label="Состояние интерфейсов"><TableHead><TableRow>{['Интерфейс', 'Состояние', 'Линк', 'Приём', 'Передача', 'Загрузка RX / TX', 'Контроль', ''].map((label, index) => <TableCell key={index} sx={{ whiteSpace: 'nowrap', fontSize: 11, color: 'text.secondary', py: 1.5 }}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {items.map((item) => { const status = interfaceStatus(item); const value = item.current || {}; return <TableRow key={item.id} hover>
          <TableCell><Button variant="text" onClick={() => onSelect(item.id)} aria-label={`Графики ${item.name}`} sx={{ justifyContent: 'flex-start', px: 0, fontSize: 13, minHeight: 40 }}>{item.name}</Button>{value.alias && <Typography variant="caption" color="text.secondary" display="block" sx={{ maxWidth: 190, overflowWrap: 'anywhere' }}>{value.alias}</Typography>}</TableCell>
          <TableCell><Chip size="small" variant="outlined" label={status.label} color={status.color} /></TableCell>
          <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{value.oper === 1 ? formatBps(value.speed_bps) : '—'}</TableCell>
          <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatBps(value.rx_bps)}</TableCell><TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatBps(value.tx_bps)}</TableCell>
          <TableCell sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatNumber(value.rx_util_pct)} / {formatNumber(value.tx_util_pct)} %</TableCell>
          <TableCell>{item.settings?.critical ? <Chip label={item.settings.role?.toUpperCase() || 'Важный'} size="small" color="primary" variant="outlined" /> : <Typography variant="caption" color="text.secondary">Обычный</Typography>}</TableCell>
          <TableCell>{canManage && <Tooltip title={`Настроить ${item.name}`}><IconButton aria-label={`Настроить ${item.name}`} onClick={() => onConfigure(item)} sx={{ minWidth: 40, minHeight: 40 }}><TuneRoundedIcon fontSize="small" /></IconButton></Tooltip>}</TableCell>
        </TableRow>; })}
      </TableBody></Table></TableContainer>
      <Stack sx={{ display: { xs: 'flex', md: 'none' }, px: 1.5, pb: 1.5 }} spacing={1.5}>{items.map((item) => { const status = interfaceStatus(item); const value = item.current || {}; return <Box key={item.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}><Button onClick={() => onSelect(item.id)} aria-label={`Графики ${item.name}`} sx={{ px: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{item.name}</Button><Chip size="small" variant="outlined" label={status.label} color={status.color} />{canManage && <IconButton aria-label={`Настроить ${item.name}`} onClick={() => onConfigure(item)}><TuneRoundedIcon fontSize="small" /></IconButton>}</Stack><Typography variant="caption" color="text.secondary">Линк {value.oper === 1 ? formatBps(value.speed_bps) : '—'}</Typography><Stack direction="row" gap={3} sx={{ mt: 1 }}><Typography variant="body2">↓ {formatBps(value.rx_bps)}</Typography><Typography variant="body2">↑ {formatBps(value.tx_bps)}</Typography></Stack></Box>; })}</Stack>
    </>}
  </Paper>;
}
