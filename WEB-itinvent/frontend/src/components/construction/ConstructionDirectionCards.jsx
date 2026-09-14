import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Chip,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { constructionDirectionPath } from './constructionShared';


function CounterChip({ label, value, tone = 'default' }) {
  if (value == null) return null;
  return (
    <Chip
      size="small"
      color={tone === 'warning' && value > 0 ? 'warning' : 'default'}
      variant="outlined"
      label={`${label}: ${value}`}
      sx={{ height: 24 }}
    />
  );
}


export function ConstructionDirectionCards({
  objectId,
  groups = [],
  directionStats = null,
  loading = false,
  statsUnavailable = false,
}) {
  const statsByRef = new Map(
    (directionStats || []).map((item) => [String(item.group_ref || '').toLowerCase(), item]),
  );

  if (loading && !groups.length) {
    return (
      <Stack spacing={1.25}>
        {[0, 1].map((item) => <Skeleton key={item} variant="rounded" height={120} />)}
      </Stack>
    );
  }

  if (!groups.length) {
    return (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: 'center' }}>
        <Typography variant="h6" fontWeight={850}>Направления не привязаны</Typography>
        <Typography color="text.secondary">Добавьте номенклатурные группы 1С в настройках объекта.</Typography>
      </Paper>
    );
  }

  return (
    <Box
      component="ul"
      aria-label="Направления объекта"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
        gap: 1.25,
        m: 0,
        p: 0,
        listStyle: 'none',
      }}
    >
      {groups.map((group) => {
        const href = constructionDirectionPath(objectId, group.group_ref);
        const stats = statsByRef.get(String(group.group_ref || '').toLowerCase());
        const active = statsUnavailable ? null : (stats?.active ?? null);
        const overdue = statsUnavailable ? null : (stats?.overdue ?? null);
        return (
          <Paper
            component="li"
            key={group.group_ref}
            variant="outlined"
            sx={{
              minWidth: 0,
              borderRadius: 3,
              overflow: 'hidden',
              transition: 'border-color 120ms ease, box-shadow 120ms ease',
              '&:hover': {
                borderColor: 'primary.main',
                boxShadow: (theme) => `0 0 0 1px ${alpha(theme.palette.primary.main, 0.25)}`,
              },
              '&:focus-within': {
                borderColor: 'primary.main',
                boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.28)}`,
              },
            }}
          >
            <Link
              component={RouterLink}
              to={href}
              underline="none"
              color="inherit"
              aria-label={`Направление ${group.group_name || group.group_ref}`}
              sx={{
                display: 'block',
                p: 1.75,
                minHeight: 100,
                '&, &:hover, &:focus, &:active': { textDecoration: 'none' },
                '&:focus-visible': { outline: 'none' },
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="flex-start">
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2.5,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
                    color: 'primary.main',
                    flexShrink: 0,
                  }}
                >
                  <AccountTreeOutlinedIcon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography component="h3" variant="subtitle1" fontWeight={900} sx={{ overflowWrap: 'anywhere' }}>
                    {group.group_name || group.group_ref}
                  </Typography>
                  <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} sx={{ mt: 1 }}>
                    <CounterChip label="Активных" value={active} />
                    <CounterChip label="Просрочено" value={overdue} tone="warning" />
                    {statsUnavailable ? (
                      <Typography variant="caption" color="text.secondary">Счётчики заявок временно недоступны</Typography>
                    ) : null}
                  </Stack>
                </Box>
              </Stack>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 2, color: 'primary.main' }}><Typography variant="body2" fontWeight={600}>Открыть направление</Typography><ArrowForwardRoundedIcon sx={{ fontSize: 17 }} /></Stack>
            </Link>
          </Paper>
        );
      })}
    </Box>
  );
}
