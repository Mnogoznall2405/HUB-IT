import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { FixedSizeGrid as VirtualGrid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as VirtualList } from 'react-window';
import {
  buildSparseAccessMap,
  getAccessLevelMeta,
  getSparseAccessLevel,
} from '../../lib/groupsAccessUtils';
import { getOfficePanelSx } from '../../theme/officeUiTokens';

const ROW_HEIGHT = 46;
const COL_WIDTH = 68;
const USER_COL_WIDTH = 220;
const HEADER_HEIGHT = 58;

const AccessCell = memo(({ level }) => {
  const theme = useTheme();
  if (!level) {
    return (
      <Box
        title="Нет доступа"
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            width: 24,
            height: 20,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.divider, 0.35),
          }}
        />
      </Box>
    );
  }

  const meta = getAccessLevelMeta(level);
  const paletteColor = theme.palette[meta.color]?.main || theme.palette.text.secondary;

  return (
    <Box
      title={meta.label}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        sx={{
          minWidth: 26,
          height: 22,
          px: 0.5,
          borderRadius: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.72rem',
          fontWeight: 700,
          color: paletteColor,
          bgcolor: alpha(paletteColor, 0.14),
          border: `1px solid ${alpha(paletteColor, 0.28)}`,
        }}
      >
        {meta.short}
      </Box>
    </Box>
  );
});

AccessCell.displayName = 'AccessCell';

const GroupsAccessMatrixTable = ({
  groups = [],
  users = [],
  cells = [],
  selectedGroupDn = '',
  onSelectGroup,
  ui,
  maxHeight = 'calc(100vh - 320px)',
}) => {
  const theme = useTheme();
  const headerScrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const sparseMap = useMemo(() => buildSparseAccessMap(cells), [cells]);

  const renderGridCell = useCallback(({ columnIndex, rowIndex, style }) => {
    const group = groups[columnIndex];
    const user = users[rowIndex];
    const groupDn = String(group?.dn || '');
    const login = String(user?.login || '');
    const selected = groupDn && groupDn === selectedGroupDn;
    const level = getSparseAccessLevel(sparseMap, login, groupDn);

    return (
      <Box
        style={style}
        sx={{
          boxSizing: 'border-box',
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
          borderRight: `1px solid ${alpha(theme.palette.divider, 0.45)}`,
          bgcolor: selected ? alpha(theme.palette.primary.main, 0.06) : 'background.paper',
          borderLeft: selected ? `2px solid ${alpha(theme.palette.primary.main, 0.35)}` : undefined,
        }}
      >
        <AccessCell level={level} />
      </Box>
    );
  }, [groups, users, sparseMap, selectedGroupDn, theme.palette.divider, theme.palette.primary.main]);

  const renderUserRow = useCallback(({ index, style }) => {
    const user = users[index];
    return (
      <Box
        style={style}
        sx={{
          boxSizing: 'border-box',
          px: 1,
          py: 0.75,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
          borderRight: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
          {user?.display_name || user?.login}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {user?.login}
        </Typography>
      </Box>
    );
  }, [users, theme.palette.divider]);

  const handleGridScroll = useCallback(({ scrollLeft, scrollTop: nextScrollTop }) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollLeft;
    }
    setScrollTop(nextScrollTop);
  }, []);

  if (!groups.length) {
    return (
      <Paper variant="outlined" sx={{ p: 2, ...getOfficePanelSx(ui) }}>
        <Typography variant="body2" color="text.secondary">
          Нет папок для отображения матрицы. Измените фильтр или обновите снимок.
        </Typography>
      </Paper>
    );
  }

  const gridWidth = groups.length * COL_WIDTH;

  return (
    <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui), overflow: 'hidden' }}>
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.85)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="subtitle2">Матрица доступа</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`${users.length} учёток × ${groups.length} папок · ${cells.length} доступов`}
        />
      </Box>

      <Box sx={{ display: 'flex', height: maxHeight, minHeight: 280 }}>
        <Box
          sx={{
            width: USER_COL_WIDTH,
            flexShrink: 0,
            borderRight: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              height: HEADER_HEIGHT,
              px: 1,
              display: 'flex',
              alignItems: 'flex-end',
              pb: 0.75,
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.85)}`,
              flexShrink: 0,
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Учётная запись
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {users.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                Нет учёток в выборке
              </Typography>
            ) : (
              <AutoSizer>
                {({ height }) => (
                  <VirtualList
                    height={height}
                    width={USER_COL_WIDTH}
                    itemCount={users.length}
                    itemSize={ROW_HEIGHT}
                    scrollTop={scrollTop}
                    style={{ overflow: 'hidden' }}
                  >
                    {renderUserRow}
                  </VirtualList>
                )}
              </AutoSizer>
            )}
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box
            ref={headerScrollRef}
            sx={{
              height: HEADER_HEIGHT,
              overflow: 'hidden',
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.85)}`,
              flexShrink: 0,
            }}
          >
            <Box sx={{ width: gridWidth, display: 'flex' }}>
              {groups.map((group) => {
                const groupDn = String(group?.dn || '');
                const selected = groupDn && groupDn === selectedGroupDn;
                const title = group.folder_path || group.folder_label || group.cn;
                return (
                  <Box
                    key={groupDn || group.cn}
                    onClick={() => onSelectGroup?.(group)}
                    title={title}
                    sx={{
                      width: COL_WIDTH,
                      flexShrink: 0,
                      px: 0.5,
                      py: 0.5,
                      cursor: onSelectGroup ? 'pointer' : 'default',
                      bgcolor: selected ? alpha(theme.palette.primary.main, 0.14) : 'background.paper',
                      borderBottom: selected ? `3px solid ${theme.palette.primary.main}` : undefined,
                      borderRight: `1px solid ${alpha(theme.palette.divider, 0.45)}`,
                      boxSizing: 'border-box',
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {group.folder_label || group.cn}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: 'block',
                        fontSize: '0.65rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {getAccessLevelMeta(group.access_level).short}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0 }}>
            {users.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                Добавьте фильтр по учётке или выберите другую ветку.
              </Typography>
            ) : (
              <AutoSizer>
                {({ height, width }) => (
                  <VirtualGrid
                    columnCount={groups.length}
                    columnWidth={COL_WIDTH}
                    height={height}
                    rowCount={users.length}
                    rowHeight={ROW_HEIGHT}
                    width={width}
                    onScroll={handleGridScroll}
                  >
                    {renderGridCell}
                  </VirtualGrid>
                )}
              </AutoSizer>
            )}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

export default GroupsAccessMatrixTable;
