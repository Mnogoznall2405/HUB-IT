import { Box, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ConstructionPersonLink from './ConstructionPersonLink';


export function ConstructionMetric({ value, label, tone = 'primary' }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        p: 1.5,
        borderRadius: 3,
        bgcolor: (theme) => alpha(theme.palette[tone].main, theme.palette.mode === 'dark' ? 0.1 : 0.04),
      }}
    >
      <Typography variant="h5" component="p" fontWeight={900}>{Number(value) || 0}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.25 }}>{label}</Typography>
    </Paper>
  );
}


export function ConstructionContactCard({ title, member, description, icon, compact = false }) {
  return (
    <Paper variant="outlined" sx={{ minWidth: 0, p: compact ? 1 : 1.5, borderRadius: compact ? 2 : 3 }}>
      <Stack direction="row" spacing={compact ? 1 : 1.25} alignItems="flex-start">
        <Box
          aria-hidden="true"
          sx={{
            width: compact ? 30 : 38,
            height: compact ? 30 : 38,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 2.5,
            bgcolor: (currentTheme) => alpha(currentTheme.palette.primary.main, currentTheme.palette.mode === 'dark' ? 0.16 : 0.08),
            color: 'primary.main',
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5, lineHeight: 1.4 }}>{title}</Typography>
          <Typography variant="subtitle1" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
            <ConstructionPersonLink member={member} />
          </Typography>
          {!compact && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {member
              ? [member.position, member.department].filter(Boolean).join(' · ') || description
              : description}
          </Typography>}
        </Box>
      </Stack>
    </Paper>
  );
}


export function ConstructionChartState({ state = 'empty', title, description, children }) {
  if (state === 'loading') {
    return (
      <Stack spacing={1} aria-busy="true" aria-label={`${title}: загрузка`}>
        <Skeleton variant="rounded" height={28} width="55%" />
        <Skeleton variant="rounded" height={120} />
      </Stack>
    );
  }
  if (state === 'error') {
    return (
      <Box role="alert">
        <Typography variant="subtitle1" fontWeight={850}>{title}</Typography>
        <Typography variant="body2" color="error.main" sx={{ mt: 0.75 }}>
          {description || 'Не удалось загрузить данные.'}
        </Typography>
      </Box>
    );
  }
  if (state === 'source_unavailable') {
    return (
      <Box>
        <Typography variant="subtitle1" fontWeight={850}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {description || 'Excel-данные пока не подключены'}
        </Typography>
      </Box>
    );
  }
  if (state === 'empty') {
    return (
      <Box>
        <Typography variant="subtitle1" fontWeight={850}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {description || 'Нет данных для отображения.'}
        </Typography>
      </Box>
    );
  }
  return children;
}
