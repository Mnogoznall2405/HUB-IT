import { memo, useCallback, useMemo, useState } from 'react';
import { Box, Button, Collapse, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ShowChartOutlinedIcon from '@mui/icons-material/ShowChartOutlined';
import { formatBps, formatNumber, formatTime, isNumber } from './monitoringFormat';
import MonitoringQuality, { packetLabel, qualityLabel, qualityReason } from './MonitoringQuality';

export default memo(function MonitoringChart({ title, subtitle, points = [], series, unit = '', loading = false, threshold, stepped = false, tall = false, quality = false }) {
  const theme = useTheme();
  const [showTable, setShowTable] = useState(false);
  const colors = [theme.palette.primary.main, theme.palette.mode === 'dark' ? '#fbbf24' : '#b45309', theme.palette.secondary.main];
  const withDate = points.length > 300;
  const axisTime = useMemo(() => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', ...(withDate ? { day: '2-digit', month: '2-digit' } : {}) }), [withDate]);
  const formatAxisTime = useCallback((value) => axisTime.format(new Date(value)), [axisTime]);
  const axisTicks = useMemo(() => {
    const stride = Math.max(1, Math.ceil((points.length - 1) / 8));
    return points.filter((_, index) => index % stride === 0 || index === points.length - 1).map((point) => point.at);
  }, [points]);
  const rangedSeries = useMemo(() => new Set(series.filter((s) => points.some((p) => isNumber(p[`${s.key}_min`])
    && isNumber(p[`${s.key}_max`]) && p[`${s.key}_min`] < p[`${s.key}_max`])).map((s) => s.key)), [points, series]);
  const formatter = (value) => unit === 'bps' ? formatBps(value) : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
  const valid = points.some((p) => series.some((s) => isNumber(p[s.key])));
  const data = useMemo(() => points.map((p) => {
    const ranges = {};
    for (const s of series) {
      if (isNumber(p[`${s.key}_min`]) && isNumber(p[`${s.key}_max`])) ranges[`${s.key}_range`] = [p[`${s.key}_min`], p[`${s.key}_max`]];
    }
    return { ...p, ...ranges };
  }), [points, series]);
  const latest = [...points].reverse().find((p) => series.some((s) => isNumber(p[s.key])));
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 1.5, md: 2.5 }, borderRadius: '16px', minWidth: 0, height: '100%' }} aria-label={title}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h3" variant="subtitle1" fontWeight={700}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
        </Box>
        <ShowChartOutlinedIcon aria-hidden="true" sx={{ color: 'text.secondary', fontSize: 20, mt: 0.5 }} />
      </Stack>
      {quality && points.length > 0 && <MonitoringQuality points={points} />}
      {loading && !points.length ? <Skeleton variant="rounded" height={tall ? 260 : 200} /> : valid || (quality && points.length > 0) ? (
        <>
          {valid ? <Box sx={{ height: tall ? 270 : 210, minWidth: 0 }} data-testid="monitoring-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke={alpha(theme.palette.text.primary, 0.08)} vertical={false} />
                <XAxis dataKey="at" ticks={axisTicks} minTickGap={50} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} tickFormatter={formatAxisTime} axisLine={false} tickLine={false} />
                <YAxis width={64} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} tickFormatter={(v) => unit === 'bps' ? formatNumber(v / 1e6) : formatNumber(v, 0)} domain={unit === '%' ? [0, 100] : [0, 'auto']} axisLine={false} tickLine={false} />
                <Tooltip filterNull={!quality} labelFormatter={(at, payload) => quality ? <Box>
                  <Typography variant="caption" display="block">Окно: {formatTime(at)}</Typography>
                  {payload?.[0]?.payload?.scheduled_at && <Typography variant="caption" display="block">Плановый срок: {formatTime(payload[0].payload.scheduled_at)}</Typography>}
                  {(payload?.[0]?.payload?.started_at || payload?.[0]?.payload?.observed_at) && <Typography variant="caption" display="block">Измерение: {formatTime(payload[0].payload.started_at || payload[0].payload.observed_at)}</Typography>}
                  <Typography variant="caption" display="block">{qualityLabel(payload?.[0]?.payload)}</Typography>
                  <Typography variant="caption" display="block">{packetLabel(payload?.[0]?.payload)}</Typography>
                  {qualityReason(payload?.[0]?.payload)}
                </Box> : formatTime(payload?.[0]?.payload?.observed_at || at)} formatter={(value, name) => [formatter(value), name]} contentStyle={{ background: theme.palette.background.paper, borderColor: theme.palette.divider, borderRadius: 12, color: theme.palette.text.primary }} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                {isNumber(threshold) && <ReferenceLine y={threshold} stroke={theme.palette.warning.main} strokeDasharray="4 4" />}
                {series.map((s, index) => rangedSeries.has(s.key) && (
                  <Area key={`${s.key}-range`} dataKey={`${s.key}_range`} type="linear" fill={colors[index % colors.length]} fillOpacity={0.1} stroke="none" connectNulls={false} legendType="none" tooltipType="none" isAnimationActive={false} />
                ))}
                {series.map((s, index) => (
                  <Line key={s.key} name={s.label} dataKey={s.key} type={stepped ? 'stepAfter' : 'linear'} stroke={colors[index % colors.length]} strokeWidth={2} connectNulls={false} dot={points.filter((p) => isNumber(p[s.key])).length < 3 ? { r: 3 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </Box> : <Box sx={{ py: 3 }}><Typography variant="body2">Нет достоверных измерений задержки за этот период.</Typography><Typography variant="caption" color="text.secondary">Результаты и причины отсутствия данных доступны в таблице.</Typography></Box>}
          <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center" sx={{ mt: 1 }}>
            {series.map((s) => <Typography key={s.key} variant="caption" color="text.secondary">{quality ? 'Последний измеренный ответ' : s.label}: <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatter(latest?.[s.key])}</Box></Typography>)}
            <Button size="small" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} sx={{ marginInlineStart: 'auto', minHeight: 44 }}>{showTable ? 'Скрыть значения' : 'Таблица значений'}</Button>
          </Stack>
          <Collapse in={showTable} unmountOnExit>
            <TableContainer sx={{ maxHeight: 260, mt: 1 }}><Table size="small" aria-label={`${title}: последние значения`}><TableHead><TableRow><TableCell>{quality ? 'Окно проверки' : 'Время'}</TableCell>{series.map((s) => <TableCell key={s.key}>{s.label}</TableCell>)}{quality && <><TableCell>Результат проверки</TableCell><TableCell>Пакеты</TableCell><TableCell>Фактическое время</TableCell></>}</TableRow></TableHead><TableBody>{points.slice(-30).map((p) => <TableRow key={p.at}><TableCell>{formatTime(quality ? p.at : p.observed_at || p.at)}</TableCell>{series.map((s) => <TableCell key={s.key}>{formatter(p[s.key])}</TableCell>)}{quality && <><TableCell>{qualityLabel(p)}{qualityReason(p) && ` · ${qualityReason(p)}`}{p.source === 'manual' && ' · вручную'}</TableCell><TableCell>{packetLabel(p)}</TableCell><TableCell>{p.started_at || p.observed_at ? formatTime(p.started_at || p.observed_at) : 'Нет измерения'}</TableCell></>}</TableRow>)}</TableBody></Table></TableContainer>
          </Collapse>
        </>
      ) : (
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: tall ? 290 : 230, textAlign: 'center', px: 2, bgcolor: alpha(theme.palette.text.primary, 0.025), borderRadius: 2 }}>
          <ShowChartOutlinedIcon sx={{ color: 'text.disabled', mb: 1 }} aria-hidden="true" />
          <Typography variant="body2" fontWeight={600}>Пока нет измерений</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 300, mt: 0.5 }}>Скорость трафика появится после двух успешных опросов. Неподдерживаемые показатели остаются без данных.</Typography>
        </Stack>
      )}
    </Paper>
  );
});
