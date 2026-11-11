import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { formatDuration, formatTime } from './monitoringFormat';

export default function MonitoringEvents({ events = [], names = {} }) {
  return <Paper component="section" variant="outlined" sx={{ borderRadius: '16px', p: { xs: 1.5, md: 2.5 } }}>
    <Typography component="h2" variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>История событий</Typography>
    {!events.length ? <Stack alignItems="center" sx={{ py: 6, gap: 1 }}><CheckCircleOutlineIcon color="disabled" aria-hidden="true" /><Typography variant="body2" color="text.secondary">Событий пока нет</Typography><Typography variant="caption" color="text.secondary">Здесь появятся изменения состояния и подтверждённые предупреждения.</Typography></Stack> : <Stack spacing={1.5}>
      {events.map((event) => <Stack key={event.id} direction="row" alignItems="flex-start" gap={1.5} sx={{ py: 1, minWidth: 0 }}>
        {event.closed_at ? <CheckCircleOutlineIcon color="success" aria-hidden="true" sx={{ mt: 0.3 }} /> : <WarningAmberRoundedIcon color={event.severity === 'critical' ? 'error' : 'warning'} aria-hidden="true" sx={{ mt: 0.3 }} />}
        <Box sx={{ minWidth: 0, flex: 1 }}><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{event.title}</Typography><Typography variant="caption" color="text.secondary">{names[event.target_id] ? `${names[event.target_id]} · ` : ''}{formatTime(event.opened_at)}{event.closed_at ? ` → ${formatTime(event.closed_at)}` : ''}</Typography></Box>
        <Chip size="small" variant="outlined" label={`${event.closed_at ? 'Завершено' : 'Открыто'} · ${formatDuration(event.opened_at, event.closed_at || Date.now())}`} color={event.closed_at ? 'default' : event.severity === 'critical' ? 'error' : 'warning'} sx={{ height: 'auto', minHeight: 24, maxWidth: '45%', '& .MuiChip-label': { whiteSpace: 'normal' } }} />
      </Stack>)}
    </Stack>}
  </Paper>;
}
