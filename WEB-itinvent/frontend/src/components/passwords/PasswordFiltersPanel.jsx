import {
  Box,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';

export default function PasswordFiltersPanel({
  groups = [],
  tags = [],
  groupCounts = new Map(),
  selectedGroup = '',
  selectedTag = '',
  objects = [],
  selectedObject = '',
  onSelectObject,
  onSelectGroup,
  onSelectTag,
  totalCount = 0,
  canManageGroups = false,
  onAddGroup,
}) {
  const theme = useTheme();

  return (
    <Box data-testid="password-filters-panel">
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pl: 2, pr: 1, py: 2 }}>
        <Typography variant="subtitle2" fontWeight={800}>Группы</Typography>
        {canManageGroups ? (
          <Tooltip title="Добавить группу">
            <IconButton size="small" onClick={onAddGroup} data-testid="password-add-group-button">
              <AddOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
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
      {objects.length ? (
        <>
          <Box sx={{ p: 2 }} data-testid="password-object-filter">
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Объекты</Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                label="Все"
                color={!selectedObject ? 'primary' : 'default'}
                variant={!selectedObject ? 'filled' : 'outlined'}
                onClick={() => onSelectObject?.('')}
              />
              {objects.map((item) => (
                <Chip
                  key={item.object_ref}
                  size="small"
                  label={item.name || item.object_ref}
                  color={selectedObject === item.object_ref ? 'primary' : 'default'}
                  variant={selectedObject === item.object_ref ? 'filled' : 'outlined'}
                  onClick={() => onSelectObject?.(item.object_ref)}
                  data-testid={`password-object-${item.object_ref}`}
                  sx={{ borderColor: theme.palette.divider }}
                />
              ))}
            </Stack>
          </Box>
          <Divider />
        </>
      ) : null}
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
