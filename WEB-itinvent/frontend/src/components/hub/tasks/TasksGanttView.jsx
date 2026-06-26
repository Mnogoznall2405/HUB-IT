import {
  Box,
  Button,
  Card,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { formatShortDate, statusMeta } from '../../../pages/tasks/taskFormatters';
import { getOfficeEmptyStateSx, getOfficeHeaderBandSx, getOfficePanelSx, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

export default function TasksGanttView({
  ui,
  loading = false,
  taskItems = [],
  ganttPayload,
  onOpenTask,
}) {
  return (
    <Card
      data-testid="tasks-gantt-view"
      sx={{
        ...getOfficePanelSx(ui),
        height: '100%',
        minHeight: 0,
        borderRadius: '16px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.1, py: 0.9 }) }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
          <Box>
            <Typography sx={{ fontWeight: 900 }}>Гант</Typography>
            <Typography variant="caption" sx={{ color: ui.subtleText }}>
              {formatShortDate(ganttPayload.rangeStart)} - {formatShortDate(ganttPayload.rangeEnd)}
            </Typography>
          </Box>
          <Chip size="small" label={`Без срока: ${ganttPayload.noDueItems.length}`} sx={{ alignSelf: { xs: 'flex-start', md: 'center' }, fontWeight: 850 }} />
        </Stack>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}>
        {loading && taskItems.length === 0 ? (
          <Stack spacing={0.8}>
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} variant="rounded" height={50} sx={{ borderRadius: '12px' }} />
            ))}
          </Stack>
        ) : ganttPayload.rows.length === 0 ? (
          <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2 }) }}>
            <Typography sx={{ fontWeight: 850 }}>Нет задач со сроком для диаграммы.</Typography>
          </Box>
        ) : (
          <Stack spacing={0.65} sx={{ minWidth: { xs: 760, md: 0 } }}>
            {ganttPayload.rows.map((row) => {
              const meta = statusMeta(row.task?.status);
              return (
                <Box
                  key={row.task.id}
                  data-testid={`tasks-gantt-row-${row.task.id}`}
                  onClick={() => onOpenTask(row.task)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(180px, 260px) minmax(360px, 1fr)',
                    gap: 0.8,
                    alignItems: 'center',
                    cursor: 'pointer',
                    p: 0.55,
                    borderRadius: '10px',
                    '&:hover': { bgcolor: ui.actionHover },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 850, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.task?.title || '-'}</Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>{row.startKey} - {row.endKey}</Typography>
                  </Box>
                  <Box sx={{ position: 'relative', height: 32, borderRadius: '9px', bgcolor: ui.actionBg, overflow: 'hidden', border: '1px solid', borderColor: ui.borderSoft }}>
                    <Box
                      sx={{
                        position: 'absolute',
                        left: `${row.leftPercent}%`,
                        width: `${row.widthPercent}%`,
                        top: 5,
                        bottom: 5,
                        borderRadius: '7px',
                        bgcolor: alpha(meta.color, 0.22),
                        border: '1px solid',
                        borderColor: alpha(meta.color, 0.42),
                        color: meta.color,
                        display: 'flex',
                        alignItems: 'center',
                        px: 0.8,
                        minWidth: 42,
                      }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</Typography>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}

        {ganttPayload.noDueItems.length > 0 ? (
          <Box sx={{ mt: 1, ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '13px' }) }}>
            <Typography sx={{ fontWeight: 900, mb: 0.65 }}>Без срока</Typography>
            <Stack spacing={0.45}>
              {ganttPayload.noDueItems.map((task) => (
                <Button
                  key={task.id}
                  variant="text"
                  onClick={() => onOpenTask(task)}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 800, px: 0.7 }}
                >
                  {task?.title || '-'}
                </Button>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Box>
    </Card>
  );
}
