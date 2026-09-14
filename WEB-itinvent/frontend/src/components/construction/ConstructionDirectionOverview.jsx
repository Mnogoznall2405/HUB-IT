import {
  Box,
  ButtonBase,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { REQUEST_STAGES, formatConstructionDate } from './ConstructionRequestViews';
import { ConstructionChartState } from './ConstructionUiBits';


function StageBar({ stages, onSelectStage }) {
  const theme = useTheme();
  const colors = [theme.palette.text.secondary, theme.palette.info.main, theme.palette.primary.main, theme.palette.warning.main,
    theme.palette.info.dark, theme.palette.primary.light, theme.palette.success.main, theme.palette.error.main, theme.palette.warning.dark];
  const rows = stages.filter((stage) => Number(stage.count) > 0).map((stage) => {
    const index = REQUEST_STAGES.findIndex(([key]) => key === stage.key);
    return { ...stage, count: Number(stage.count), label: REQUEST_STAGES[index]?.[1] || stage.label || stage.key, color: colors[index] || theme.palette.text.secondary };
  });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(...rows.map((row) => row.count), 1);
  let offset = 0;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '150px minmax(0, 1fr)' }, gap: 1.5, alignItems: 'center', mt: 1 }}>
      <Box sx={{ width: 144, height: 144, position: 'relative', justifySelf: 'center' }}>
        <Box component="svg" viewBox="0 0 144 144" role="img" aria-label={`Распределение активных заявок по этапам: ${total}`} sx={{ width: '100%', height: '100%' }}>
          {rows.map((row) => {
            const share = row.count / total * 100;
            const start = offset; offset += share;
            return <circle key={row.key} cx="72" cy="72" r="57" fill="none" stroke={row.color} strokeWidth="16" pathLength="100"
              strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 72 72)">
              <title>{row.label}: {row.count}</title>
            </circle>;
          })}
        </Box>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', alignContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <Typography sx={{ fontSize: 30, fontWeight: 750, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{total}</Typography>
          <Typography variant="caption" color="text.secondary">активных</Typography>
        </Box>
      </Box>
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      {rows.map(({ key, label, count, color }) => {
        return (
          <ButtonBase
            key={key}
            onClick={() => onSelectStage?.(key)}
            aria-label={`Открыть заявки этапа ${label}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 62px',
              gap: 1,
              alignItems: 'center',
              width: '100%',
              textAlign: 'left',
              borderRadius: 1.5,
              px: 0.75,
              py: 0.5,
              minHeight: { xs: 44, sm: 36 },
              '&:hover': { bgcolor: 'action.hover' },
              '&:hover .bar': {
                bgcolor: 'primary.main',
              },
              '&:focus-visible': {
                outline: '3px solid',
                outlineColor: 'primary.main',
                outlineOffset: 1,
              },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere', lineHeight: 1.3, mb: 0.5 }}>{label}</Typography>
            <Box
              aria-hidden="true"
              sx={{
                  height: 5,
                borderRadius: 999,
                bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
                overflow: 'hidden',
              }}
            >
              <Box
                className="bar"
                sx={{
                  width: `${(count / max) * 100}%`,
                  height: '100%',
                  borderRadius: 999,
                  bgcolor: color,
                }}
              />
            </Box>
            </Box>
            <Box sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              <Typography variant="body2" fontWeight={750}>{count}</Typography>
              <Typography variant="caption" color="text.secondary">{Math.round(count / total * 100)}%</Typography>
            </Box>
          </ButtonBase>
        );
      })}
    </Stack>
    </Box>
  );
}


export function ConstructionDirectionOverviewCharts({
  overview,
  summary,
  asOf,
  windowFrom,
  loading,
  error,
  onSelectStage,
}) {
  const stages = Array.isArray(overview?.stages) ? overview.stages : [];
  const requestsState = loading
    ? 'loading'
    : error
      ? 'error'
      : stages.length
        ? 'ready'
        : 'empty';

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 0.75,
      }}
    >
      <Paper component="section" variant="outlined" aria-label="Заявки направления по этапам" sx={{ p: 1.5, borderRadius: 2 }}>
        <ConstructionChartState
          state={requestsState}
          title="Заявки"
          description={error || (requestsState === 'empty' ? 'Активных заявок в срезе нет.' : '')}
        >
          <Stack direction="row" justifyContent="space-between" gap={1} flexWrap="wrap" alignItems="baseline">
          <Typography id="direction-requests-chart" component="h3" variant="subtitle1" fontWeight={750}>Заявки по этапам</Typography>
          <Typography variant="caption" color={summary?.overdue ? 'warning.main' : 'text.secondary'}>
            Просрочено: {summary?.overdue ?? 0}
          </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">Нажмите на этап, чтобы открыть заявки.</Typography>
          <StageBar stages={stages} onSelectStage={onSelectStage} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {windowFrom ? `Срез с ${formatConstructionDate(windowFrom)}. ` : ''}{asOf ? `Обновлено ${formatConstructionDate(asOf, true)}.` : ''}
          </Typography>
        </ConstructionChartState>
      </Paper>

      <Box component="aside" aria-label="Исполнительная документация" sx={{ px: 0.5, py: 0.75 }}>
        <Typography variant="body2" color="text.secondary" fontWeight={600}>Ход формирования исполнительной документации</Typography>
        <Typography variant="caption" color="text.secondary">Учёт документации пока не подключён и не включён в процент выполнения строительных работ.</Typography>
      </Box>

    </Box>
  );
}
