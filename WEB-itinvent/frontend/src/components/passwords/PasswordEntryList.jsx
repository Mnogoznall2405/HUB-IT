import {
  Box,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { formatDateTime } from './passwordVaultUtils';

export default function PasswordEntryList({
  entries = [],
  selectedEntryId = '',
  loading = false,
  compact = false,
  onSelect,
}) {
  const theme = useTheme();

  if (loading && entries.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!entries.length) {
    return (
      <Box
        sx={{
          py: 6,
          px: 2,
          textAlign: 'center',
          border: `1px dashed ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.6),
        }}
        data-testid="password-entry-list-empty"
      >
        <Typography variant="body2" color="text.secondary">
          Записи не найдены. Измените фильтры или создайте новую запись.
        </Typography>
      </Box>
    );
  }

  return (
    <List
      dense
      disablePadding
      data-testid="password-entry-list"
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        overflow: 'hidden',
        bgcolor: alpha(theme.palette.background.paper, 0.72),
      }}
    >
      {entries.map((entry) => {
        const selected = entry.id === selectedEntryId;
        return (
          <ListItemButton
            key={entry.id}
            selected={selected}
            onClick={() => onSelect?.(entry)}
            data-testid={`password-entry-row-${entry.id}`}
            sx={{
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
              '&:last-child': { borderBottom: 'none' },
              alignItems: 'flex-start',
              py: compact ? 0.75 : 1.25,
              minHeight: compact ? 44 : 56,
            }}
          >
            <ListItemText
              primary={(
                <Typography variant={compact ? 'body2' : 'subtitle2'} fontWeight={800} noWrap>
                  {entry.login || '—'}
                </Typography>
              )}
              secondary={compact ? (
                <Typography component="span" variant="caption" color="text.secondary" noWrap display="block">
                  {[entry.group || 'Без группы', formatDateTime(entry.updated_at)].join(' · ')}
                </Typography>
              ) : (
                <Box component="span" sx={{ display: 'block' }}>
                  <Typography component="span" variant="caption" color="text.secondary" display="block" noWrap>
                    {entry.group || 'Без группы'}
                  </Typography>
                  <Typography component="span" variant="caption" color="text.disabled" display="block">
                    {formatDateTime(entry.updated_at)}
                  </Typography>
                </Box>
              )}
            />
          </ListItemButton>
        );
      })}
    </List>
  );
}
