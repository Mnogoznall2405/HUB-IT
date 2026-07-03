import { useCallback } from 'react';
import { Box, Chip, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { FixedSizeList as VirtualList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import FolderPathBreadcrumb from './FolderPathBreadcrumb';

const ROW_HEIGHT = 92;

const GroupsAccessFolderList = ({
  groups = [],
  selectedGroupDn = '',
  branchTab = 'all',
  onSelectGroup,
  renderAccessLevelChip,
  getGroupKey,
}) => {
  const theme = useTheme();

  const renderRow = useCallback(({ index, style }) => {
    const group = groups[index];
    const groupDn = getGroupKey(group);
    const selected = groupDn === selectedGroupDn;

    return (
      <ListItemButton
        key={groupDn}
        selected={selected}
        onClick={() => onSelectGroup(group)}
        style={style}
        sx={{
          alignItems: 'flex-start',
          py: 1.25,
          px: 1.5,
          boxSizing: 'border-box',
          borderLeft: selected
            ? `4px solid ${theme.palette.primary.main}`
            : '4px solid transparent',
          bgcolor: selected ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
          '&.Mui-selected': {
            bgcolor: alpha(theme.palette.primary.main, 0.12),
          },
          '&.Mui-selected:hover': {
            bgcolor: alpha(theme.palette.primary.main, 0.16),
          },
        }}
      >
        <ListItemText
          primary={(
            <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="body2" sx={{ fontWeight: selected ? 700 : 600 }}>
                {group.folder_label || group.cn}
              </Typography>
              {branchTab === 'all' ? (
                <Chip size="small" label={group.branch} variant="outlined" />
              ) : null}
              {renderAccessLevelChip(group.access_level)}
            </Stack>
          )}
          secondary={(
            <Box sx={{ mt: 0.75 }}>
              <FolderPathBreadcrumb
                path={group.folder_path || group.folder_label || group.cn}
                branch={branchTab === 'all' ? '' : group.branch}
                compact
                emphasize={selected}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {group.member_count != null ? `${group.member_count} пользователей` : '—'}
                {group.cn ? ` · ${group.cn}` : ''}
              </Typography>
            </Box>
          )}
          secondaryTypographyProps={{ component: 'div' }}
        />
      </ListItemButton>
    );
  }, [
    branchTab,
    getGroupKey,
    groups,
    onSelectGroup,
    renderAccessLevelChip,
    selectedGroupDn,
    theme.palette.primary.main,
  ]);

  return (
    <AutoSizer>
      {({ height, width }) => (
        <VirtualList
          height={height}
          width={width}
          itemCount={groups.length}
          itemSize={ROW_HEIGHT}
        >
          {renderRow}
        </VirtualList>
      )}
    </AutoSizer>
  );
};

export default GroupsAccessFolderList;
