import { useCallback } from 'react';
import { Box, Chip, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { FixedSizeList as VirtualList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import FolderPathBreadcrumb from './FolderPathBreadcrumb';

const ROW_HEIGHT = 92;
const MIN_LIST_HEIGHT = 220;
const FALLBACK_LIST_WIDTH = 360;

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
    const rowBg = selected
      ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1)
      : theme.palette.background.paper;

    return (
      <ListItemButton
        key={groupDn}
        selected={selected}
        onClick={() => onSelectGroup(group)}
        style={{ ...style, backgroundColor: rowBg }}
        sx={{
          alignItems: 'flex-start',
          py: 1,
          px: 1.5,
          boxSizing: 'border-box',
          color: 'text.primary',
          overflow: 'hidden',
          borderLeft: selected
            ? `4px solid ${theme.palette.primary.main}`
            : '4px solid transparent',
          borderBottom: `1px solid ${alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.72 : 0.58)}`,
          bgcolor: rowBg,
          '&.Mui-selected': {
            bgcolor: rowBg,
          },
          '&.Mui-selected:hover': {
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.14),
          },
          '&:hover': {
            bgcolor: selected
              ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.14)
              : alpha(theme.palette.action.hover, theme.palette.mode === 'dark' ? 0.7 : 1),
          },
        }}
      >
        <ListItemText
          primary={(
            <Stack spacing={0.6}>
              <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography
                  variant="body2"
                  noWrap
                  sx={{
                    minWidth: 0,
                    maxWidth: '100%',
                    color: 'text.primary',
                    fontWeight: selected ? 800 : 700,
                    lineHeight: 1.2,
                  }}
                >
                  {group.folder_label || group.cn}
                </Typography>
                {renderAccessLevelChip(group.access_level)}
                {branchTab === 'all' ? (
                  <Chip size="small" label={group.branch} variant="outlined" sx={{ height: 22 }} />
                ) : null}
                <Chip
                  size="small"
                  variant="outlined"
                  label={group.member_count != null ? `${group.member_count} пользователей` : 'нет счётчика'}
                  sx={{ height: 22 }}
                />
              </Stack>
            </Stack>
          )}
          secondary={(
            <Box sx={{ mt: 0.55 }}>
              <FolderPathBreadcrumb
                path={group.folder_path || group.folder_label || group.cn}
                branch={branchTab === 'all' ? '' : group.branch}
                compact
                emphasize={selected}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.25 }} noWrap>
                {group.cn || 'AD-группа не указана'}
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
      {({ height, width }) => {
        const listHeight = Math.max(Number(height) || 0, MIN_LIST_HEIGHT);
        const listWidth = Math.max(Number(width) || 0, FALLBACK_LIST_WIDTH);
        return (
        <VirtualList
          height={listHeight}
          width={listWidth}
          itemCount={groups.length}
          itemSize={ROW_HEIGHT}
          itemKey={(index) => getGroupKey(groups[index]) || index}
          overscanCount={6}
        >
          {renderRow}
        </VirtualList>
        );
      }}
    </AutoSizer>
  );
};

export default GroupsAccessFolderList;
