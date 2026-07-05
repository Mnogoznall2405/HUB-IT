import {
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { statusMeta } from '../../../pages/tasks/taskFormatters';
import { getOfficeHeaderBandSx, getOfficePanelSx } from '../../../theme/officeUiTokens';

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function TasksCalendarView({
  ui,
  calendarPayload,
  onShiftMonth,
  onGoToToday,
  onOpenNoDueTasks,
  onOpenTask,
}) {
  const theme = useTheme();
  const monthLabel = calendarPayload.monthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return (
    <Card
      data-testid="tasks-calendar-view"
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
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
          <Stack direction="row" spacing={0.7} alignItems="center">
            <CalendarMonthOutlinedIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} />
            <Typography sx={{ fontWeight: 900, textTransform: 'capitalize' }}>{monthLabel}</Typography>
          </Stack>
          <Stack direction="row" spacing={0.6} alignItems="center" justifyContent={{ xs: 'space-between', md: 'flex-end' }}>
            <Button size="small" variant="outlined" onClick={() => onShiftMonth(-1)} sx={{ textTransform: 'none', fontWeight: 800 }}>Назад</Button>
            <Button size="small" variant="outlined" onClick={onGoToToday} sx={{ textTransform: 'none', fontWeight: 800 }}>Сегодня</Button>
            <Button size="small" variant="outlined" onClick={() => onShiftMonth(1)} sx={{ textTransform: 'none', fontWeight: 800 }}>Вперёд</Button>
            <Button
              size="small"
              variant="text"
              onClick={onOpenNoDueTasks}
              sx={{ textTransform: 'none', fontWeight: 850, whiteSpace: 'nowrap' }}
            >
              Без срока: {calendarPayload.noDueCount}
            </Button>
          </Stack>
        </Stack>
      </Box>
      <Box sx={{ px: 0.8, py: 0.65, borderBottom: '1px solid', borderColor: ui.borderSoft, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5 }}>
        {WEEK_DAYS.map((day) => (
          <Typography key={day} variant="caption" sx={{ color: ui.subtleText, fontWeight: 900, textAlign: 'center' }}>{day}</Typography>
        ))}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 0.8 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))', gridAutoRows: 'minmax(104px, 1fr)', gap: 0.55, minWidth: { xs: 840, md: 'auto' }, minHeight: '100%' }}>
          {calendarPayload.days.map((day) => (
            <Box
              key={day.dateKey}
              sx={{
                border: '1px solid',
                borderColor: day.isToday ? ui.selectedBorder : ui.borderSoft,
                bgcolor: day.inMonth ? ui.panelSolid : alpha(ui.panelSolid, 0.45),
                borderRadius: '10px',
                p: 0.65,
                minHeight: 104,
                overflow: 'hidden',
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.45 }}>
                <Typography variant="caption" sx={{ fontWeight: 900, color: day.inMonth ? 'text.primary' : ui.subtleText }}>
                  {day.date.getDate()}
                </Typography>
                {day.items.length > 0 ? (
                  <Chip size="small" label={day.items.length} sx={{ height: 18, minWidth: 24, fontSize: '0.62rem', fontWeight: 900 }} />
                ) : null}
              </Stack>
              <Stack spacing={0.35}>
                {day.items.slice(0, 3).map((task) => {
                  const meta = statusMeta(task?.status);
                  return (
                    <Box
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenTask(task)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onOpenTask(task);
                      }}
                      sx={{
                        borderLeft: '3px solid',
                        borderColor: meta.color,
                        bgcolor: meta.bg,
                        borderRadius: '7px',
                        px: 0.55,
                        py: 0.35,
                        cursor: 'pointer',
                      }}
                    >
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {task?.title || '-'}
                      </Typography>
                    </Box>
                  );
                })}
                {day.items.length > 3 ? (
                  <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>+{day.items.length - 3}</Typography>
                ) : null}
              </Stack>
            </Box>
          ))}
        </Box>
      </Box>
    </Card>
  );
}
