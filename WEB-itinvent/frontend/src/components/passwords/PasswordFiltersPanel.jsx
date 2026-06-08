import {
  Box,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function PasswordFiltersPanel({
  groups = [],
  tags = [],
  groupCounts = new Map(),
  selectedGroup = '',
  selectedTag = '',
  onSelectGroup,
  onSelectTag,
  totalCount = 0,
}) {
  const theme = useTheme();

  return (
    <Box data-testid="password-filters-panel">
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={800}>Группы</Typography>
      </Box>
      <Divider />
      <List dense disablePadding>
        <ListItemButton
          selected={!selectedGroup}
          onClick={() => onSelectGroup?.('')}
          data-testid="password-group-all"
        >
          <ListItemText primary={`Все группы (${totalCount})`} />
        </ListItemButton>
        {groups.map((group) => (
          <ListItemButton
            key={group}
            selected={selectedGroup === group}
            onClick={() => onSelectGroup?.(group)}
            data-testid={`password-group-${group}`}
          >
            <ListItemText primary={`${group} (${groupCounts.get(group) || 0})`} />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Теги</Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip
            size="small"
            label="Все"
            color={!selectedTag ? 'primary' : 'default'}
            variant={!selectedTag ? 'filled' : 'outlined'}
            onClick={() => onSelectTag?.('')}
          />
          {tags.map((tag) => (
            <Chip
              key={tag}
              size="small"
              label={tag}
              color={selectedTag === tag ? 'primary' : 'default'}
              variant={selectedTag === tag ? 'filled' : 'outlined'}
              onClick={() => onSelectTag?.(tag)}
              data-testid={`password-tag-${tag}`}
              sx={{ borderColor: theme.palette.divider }}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
