import { Alert, Box, ButtonBase, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import { displayTargetName, formatBps, isCentralTarget, isNumber, isStale, targetStatus } from './monitoringFormat';
import MonitoringConnectionState from './MonitoringConnectionState';

function Sparkline({ points, color, secondary }) {
  const values = points.flatMap((point) => [point.rx_bps, point.tx_bps]).filter(isNumber);
  const maximum = Math.max(1, ...values) * 1.1;
  const path = (key) => {
    let active = false;
    return points.map((point, index) => {
      if (!isNumber(point[key])) { active = false; return ''; }
      const next = `${active ? 'L' : 'M'}${(index * 220 / Math.max(1, points.length - 1)).toFixed(1)},${(43 - point[key] / maximum * 39).toFixed(1)}`;
      active = true;
      return next;
    }).join(' ');
  };
  return <Box sx={{ height: 42, width: '100%', display: 'grid', alignItems: 'center', mt: 1.5 }}>
    {values.length ? <Box component="svg" viewBox="0 0 220 48" preserveAspectRatio="none" aria-hidden="true" focusable="false" sx={{ width: '100%', height: 40, overflow: 'visible' }}><path d="M0 44 H220" stroke={alpha(color, 0.15)} fill="none" /><path d={path('rx_bps')} stroke={color} strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" /><path d={path('tx_bps')} stroke={secondary} strokeWidth="1" opacity="0.65" fill="none" vectorEffect="non-scaling-stroke" /></Box> : <Typography variant="caption" color="text.secondary" sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>Пока нет измерений</Typography>}
  </Box>;
}

export default function MonitoringDeviceGrid({ visible, onSelect }) {
  const theme = useTheme();
  return <Stack spacing={1.5}>
    <Box component="section" aria-label="Оборудование сети" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))', md: 'repeat(3,minmax(0,1fr))', lg: 'repeat(4,minmax(0,1fr))', xl: 'repeat(5,minmax(0,1fr))' }, gap: 1.5 }}>
      {visible.map((target) => {
        const status = targetStatus(target);
        const issue = !['online', 'paused'].includes(status.key);
        const color = status.color === 'default' ? theme.palette.text.secondary : theme.palette[status.color].main;
        const summary = target.summary;
        const stale = isStale(summary?.checked_at);
        const model = target.current?.device?.description?.replace(/^RouterOS\s*/i, '') || target.name.split(/_MikroTik-/i)[1]?.replace(/\s*\(резерв\)$/, '');
        const card = <Paper component={ButtonBase} className="monitoring-device-card" key={target.id} aria-label={`Открыть ${displayTargetName(target)}`} onClick={() => onSelect(target.id)} variant="outlined" sx={{ p: 1.5, boxShadow: 'none', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch', textAlign: 'left', minWidth: 0, minHeight: 215, color: 'text.primary', borderColor: alpha(color, issue ? 0.45 : 0.2), bgcolor: issue ? alpha(color, theme.palette.mode === 'dark' ? 0.07 : 0.025) : 'background.paper', transition: theme.transitions.create(['border-color', 'background-color'], { duration: 120 }), '&:hover': { borderColor: color, bgcolor: alpha(color, 0.055) }, '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 3 } }}>
          <Stack direction="row" gap={1.25} alignItems="center"><Box sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: '10px', bgcolor: alpha(color, 0.09), color, display: 'grid', placeItems: 'center' }}><RouterOutlinedIcon aria-hidden="true" fontSize="small" /></Box><Box sx={{ minWidth: 0 }}><Typography component="h2" variant="body2" fontWeight={700} title={target.name} sx={{ lineHeight: 1.4, overflowWrap: 'anywhere' }}>{displayTargetName(target)}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{target.address}</Typography></Box></Stack>
          {model && <Typography variant="caption" color="text.secondary" noWrap title={model} sx={{ mt: 0.75, fontSize: 10 }}>{model}</Typography>}
          <Box sx={{ mt: 1 }}><MonitoringConnectionState target={target} compact /></Box>
          <Box sx={{ mt: 'auto' }}><Sparkline points={summary?.points || []} color={issue ? color : theme.palette.mode === 'dark' ? '#8aa4c7' : '#849ab8'} secondary={color} /><Stack direction="row" justifyContent="space-between" gap={0.75} sx={{ fontVariantNumeric: 'tabular-nums' }}><Typography variant="caption" color="text.secondary">↓ {formatBps(stale ? undefined : summary?.rx_bps)}</Typography><Typography variant="caption" color="text.secondary">↑ {formatBps(stale ? undefined : summary?.tx_bps)}</Typography></Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, fontSize: 10 }}>Трафик · 6 ч{summary?.name ? ` · ${summary.name}` : ''}{summary?.pinned ? ' · закреплён' : ''}</Typography></Box>

        </Paper>;
        return isCentralTarget(target)
          ? <Box key={target.id} sx={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'minmax(0,360px)', justifyContent: 'center', mb: 1.5 }}>{card}</Box>
          : card;
      })}
    </Box>
    {!visible.length && <Alert severity="info">По этому запросу устройств нет. Измените название, IP или фильтр состояния.</Alert>}
  </Stack>;
}
