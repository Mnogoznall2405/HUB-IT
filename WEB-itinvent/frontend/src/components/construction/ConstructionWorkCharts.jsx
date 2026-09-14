import { useEffect, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, LinearProgress, Paper, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import { constructionWorkAPI } from '../../api/constructionWork';
import { workError, workNumber } from './constructionWorkUtils';

const chartDate = (value) => value ? `${value.slice(8, 10)}.${value.slice(5, 7)}` : '—';
const displayDate = (value) => value ? value.split('-').reverse().join('.') : '—';

function ReadinessRing({ percent }) {
  return <Box sx={{ width: 80, height: 80, position: 'relative', flexShrink: 0, color: 'primary.main' }}>
    <Box component="svg" viewBox="0 0 104 104" aria-hidden="true" sx={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
      <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="8" opacity="0.12" />
      {percent != null ? <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
        pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, percent))} 100`} /> : null}
    </Box>
    <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center' }}><AssessmentOutlinedIcon sx={{ fontSize: 32 }} /></Box>
  </Box>;
}

function WorkTrend({ points }) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const plotRight = compact ? 326 : 536;
  const start = Date.parse(points[0].date);
  const duration = Date.parse(points[points.length - 1].date) - start || 1;
  const plotted = points.map((point) => ({ ...point,
    x: 42 + (Date.parse(point.date) - start) / duration * (plotRight - 42),
    y: 170 - Math.max(0, Math.min(100, point.percent)) * 1.46,
  }));
  const coordinates = plotted.map((point) => `${point.x},${point.y}`).join(' ');
  const dateTicks = [...new Set(compact ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])];
  return <>
    <Box component="svg" role="img" aria-label="График накопленного выполнения" viewBox={`0 0 ${compact ? 340 : 560} 208`}
      sx={{ display: 'block', width: '100%', overflow: 'visible', color: 'primary.main', mt: 1.5, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
      {[0, 25, 50, 75, 100].map((value) => <g key={value}>
        <Box component="line" x1="42" x2={plotRight} y1={170 - value * 1.46} y2={170 - value * 1.46} sx={(theme) => ({ stroke: theme.palette.divider })} strokeDasharray={value === 0 ? undefined : '3 5'} />
        <Box component="text" x="32" y={174 - value * 1.46} textAnchor="end" sx={(theme) => ({ fill: theme.palette.text.secondary, fontSize: compact ? 13 : 11 })}>{value}%</Box>
      </g>)}
      <polygon points={`42,170 ${coordinates} ${plotted[plotted.length - 1].x},170`} fill="currentColor" opacity="0.07" />
      <polyline fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={coordinates} />
      {plotted.map((point, index) => <circle key={point.date} cx={point.x} cy={point.y} r={index === plotted.length - 1 ? 4.5 : 2.5} fill="currentColor">
        <title>{displayDate(point.date)}: {workNumber(point.percent, 2)}%</title>
      </circle>)}
      {dateTicks.map((index) => <Box component="text" key={index} x={plotted[index].x} y="198"
        textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} sx={(theme) => ({ fill: theme.palette.text.secondary, fontSize: compact ? 14 : 12 })}>{chartDate(points[index].date)}</Box>)}
    </Box>
    <Box component="details" sx={{ mt: 1, color: 'text.secondary', '& summary:hover': { color: 'text.primary' } }}>
      <Typography component="summary" variant="body2" sx={{ cursor: 'pointer', width: 'fit-content', py: 0.5 }}>Значения по датам</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 1, mt: 1 }}>
        {points.map((point) => <Box key={point.date} sx={{ px: 1, py: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
          <Typography variant="caption" component="div">{displayDate(point.date)}</Typography>
          <Typography variant="body2" fontWeight={700} color="text.primary">{workNumber(point.percent, 2)}%</Typography>
        </Box>)}
      </Box>
    </Box>
  </>;
}

export default function ConstructionWorkCharts({ objectId, groupRef, onOpenWork }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    constructionWorkAPI.read(objectId, groupRef, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((err) => { if (!controller.signal.aborted) setError(workError(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [objectId, groupRef, reload]);
  const summary = data?.summary;
  const calculation = summary?.calculation;
  const sourceBars = Boolean(groupRef && calculation);
  const bars = sourceBars ? data?.calculation_sections : groupRef ? data?.sections : data?.directions;
  const Bar = sourceBars ? Box : ButtonBase;
  return (
    <Paper component="section" aria-label="Ход выполненных работ" variant="outlined"
      sx={{ borderRadius: 3, minWidth: 0, maxWidth: '100%', overflow: 'hidden', backgroundImage: 'none', '& .MuiButton-root': { textTransform: 'none', fontWeight: 600 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1.5} flexWrap="wrap"
        sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 750, letterSpacing: '-0.02em', lineHeight: 1.3 }}>Ход выполненных работ</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{calculation ? `Расчёт по первому листу «${calculation.source_sheet}»` : `Готовность ${groupRef ? 'направления' : 'объекта'} и динамика выполнения`}</Typography>
        </Box>
        <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => setReload((n) => n + 1)} disabled={loading}>Обновить показатели</Button>
      </Stack>
      {loading ? <><LinearProgress aria-label="Загрузка хода работ" /><Box sx={{ p: 3 }}><Skeleton variant="rounded" height={128} /></Box></> : null}
      {error ? <Alert severity="warning" sx={{ m: 2 }} action={<Button onClick={() => setReload((n) => n + 1)}>Повторить</Button>}>{error}</Alert> : null}
      {summary ? (
        <Stack spacing={1.5} sx={{ p: 1.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(250px, 1fr) minmax(0, 1.35fr)' }, gap: 1.5, alignItems: 'center' }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0 }}>
              <ReadinessRing percent={summary.percent} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" fontWeight={600}>{calculation ? 'Готовность по первому листу' : 'Общая готовность'}</Typography>
                <Typography sx={{ fontSize: summary.percent == null ? '1.25rem' : { xs: '2rem', sm: '2.25rem' }, fontWeight: 750, letterSpacing: '-0.04em', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', my: 0.25 }}>
                  {summary.percent == null ? 'Готовность не рассчитана' : `${workNumber(summary.percent, 2)}%`}
                </Typography>
                <Typography variant="caption" color="text.secondary">На {displayDate(data.as_of)}</Typography>
              </Box>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: { xs: 1, sm: 1.5 } }}>
              {[
                { label: 'Всего работ', value: summary.total, Icon: FormatListBulletedRoundedIcon, color: 'text.secondary' },
                { label: 'Завершено', value: summary.completed, Icon: CheckCircleOutlineRoundedIcon, color: 'success.main' },
                { label: 'Просрочено', value: summary.overdue, Icon: ScheduleRoundedIcon, color: summary.overdue ? 'warning.main' : 'text.secondary' },
              ].map(({ label, value, Icon, color }) => <Box key={label} sx={(theme) => ({ p: 1.25, borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.035), minWidth: 0 })}>
                <Icon sx={{ color, fontSize: 20, mb: 0.5 }} />
                <Typography sx={{ fontSize: { xs: '1.75rem', sm: '2rem' }, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>{label}</Typography>
              </Box>)}
            </Box>
          </Box>
          {calculation && summary.percent == null ? <Alert severity="info">{calculation.missing_works ? `В расчёте отсутствуют или архивированы ${calculation.missing_works} работ исходного листа.` : 'На выбранную дату нет полного исходного среза или плановый объём раздела равен нулю.'}</Alert> : null}
          {calculation?.notes?.length ? <Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer' }}>Особенности исходного расчёта</Typography>{calculation.notes.map((note) => <Typography key={note} variant="caption" component="p">{note}</Typography>)}</Box> : null}
          {!summary.total ? <Alert severity="info" variant="outlined">Добавьте план работ во вкладке «Ход работ» направления.</Alert> : null}
          {summary.total > 0 && summary.percent == null && !calculation ? <Alert severity="info" variant="outlined">Для общего процента заполните плановые объёмы и положительные веса всех работ. У каждого направления должен быть план.</Alert> : null}
          {summary.over_plan > 0 ? <Alert severity="warning" variant="outlined">Превышен план по {summary.over_plan} работам. Проверьте объёмы; {calculation ? 'перевыполнение учитывается в общем проценте, как в исходном листе.' : 'вклад одной работы в общую готовность ограничен 100%.'}</Alert> : null}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1.15fr)' }, gap: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={1.25} sx={{ minWidth: 0, maxHeight: sourceBars ? 480 : undefined, overflowY: sourceBars ? 'auto' : undefined }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography component="h3" variant="subtitle1" fontWeight={700}>{sourceBars ? 'Разделы первого листа' : groupRef ? 'Готовность разделов' : 'Готовность направлений'}</Typography>
                <Chip size="small" label={bars?.length || 0} sx={{ height: 22, fontWeight: 600 }} />
              </Stack>
              {bars?.map((bar, index) => (
                <Bar key={`${bar.group_ref}-${bar.name}`} onClick={sourceBars ? undefined : () => onOpenWork?.(bar.group_ref, groupRef ? bar.name : '')}
                  aria-label={sourceBars ? undefined : `Открыть ход работ: ${bar.name}`} sx={(theme) => ({ display: 'block', textAlign: 'left', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, width: '100%', transition: 'background-color 120ms, border-color 120ms', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04), borderColor: alpha(theme.palette.primary.main, 0.35) }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } })}>
                  <Stack direction="row" alignItems="center" gap={1.25}>
                    <Box sx={{ width: 26, height: 26, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{String(index + 1).padStart(2, '0')}</Box>
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1, overflowWrap: 'anywhere', minWidth: 0 }}>{bar.name}</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{bar.percent == null ? 'Нет расчёта' : `${workNumber(bar.percent, 2)}%`}</Typography>
                    {!sourceBars ? <ArrowForwardRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }} /> : null}
                  </Stack>
                  {bar.percent != null ? <LinearProgress variant="determinate" value={Math.min(100, bar.percent)} sx={(theme) => ({ mt: 1.25, height: 6, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.1), '& .MuiLinearProgress-bar': { borderRadius: 2 } })} aria-label={`Готовность ${bar.name}`} /> : null}
                </Bar>
              ))}
              {!bars?.length ? <Typography variant="body2" color="text.secondary">Разделы появятся после добавления работ.</Typography> : null}
            </Stack>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" gap={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
                <Typography component="h3" variant="subtitle1" fontWeight={700}>Динамика выполнения</Typography>
                <Chip size="small" variant="outlined" icon={<TrendingUpRoundedIcon />} label="90 дней" sx={{ borderColor: 'divider', fontSize: 12 }} />
              </Stack>
              {data.trend?.length ? <WorkTrend points={data.trend} /> : <Box sx={{ minHeight: 172, display: 'grid', placeContent: 'center', textAlign: 'center', p: 2, mt: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
                <TrendingUpRoundedIcon sx={{ fontSize: 30, color: 'text.secondary', mx: 'auto', mb: 1 }} />
                <Typography variant="body2" color="text.secondary">{calculation ? 'Динамика доступна с даты переноса исходного объёма.' : 'Динамика появится после настройки плана и весов.'}</Typography>
              </Box>}
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>{calculation ? `Среднее ${calculation.section_count} разделов первого листа. В области расчёта ${calculation.included_works} работ; остальные ${calculation.excluded_works} не включены. Изменение плана пересчитывает динамику.` : 'Расчёт по текущему плану и весам; изменение плана пересчитывает историческую кривую.'}</Typography>
        </Stack>
      ) : null}
    </Paper>
  );
}
