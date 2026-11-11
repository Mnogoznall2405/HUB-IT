import { Chip, Stack, Typography } from '@mui/material';
import { outageNotice, targetStatus } from './monitoringFormat';

export default function MonitoringConnectionState({ target, compact = false }) {
  const status = targetStatus(target);
  const notice = outageNotice(target);
  const duration = notice?.duration ? ` · ${notice.duration}${notice.exact ? '' : notice.observedOnly ? ' наблюдения' : ' с фиксации'}` : '';
  return <Stack spacing={0.65} sx={{ minWidth: 0 }}>
    <Chip size="small" variant="outlined" color={status.color} label={`${status.label}${duration}`}
      sx={{ alignSelf: 'flex-start', height: 'auto', minHeight: 24, '& .MuiChip-label': { py: 0.25, whiteSpace: 'normal', fontWeight: 650, fontVariantNumeric: 'tabular-nums' } }} />
    {notice && <Typography variant="caption" color={status.color === 'error' ? 'error.main' : 'text.secondary'}
      sx={{ lineHeight: 1.5, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', ...(compact ? { fontSize: 11 } : {}) }}>{notice.text}</Typography>}
  </Stack>;
}
