import AddIcon from '@mui/icons-material/Add';
import AssignmentIcon from '@mui/icons-material/Assignment';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import TaskRoleScopeSwitch from '../TaskRoleScopeSwitch';
import { getTaskUnreadFocusLabel } from '../../../lib/taskNavigation';
import { focusOptions } from '../../../pages/tasks/taskConstants';
import { TASK_MODE_OPTIONS } from '../../../pages/tasksViewModel';
import { getOfficePanelSx, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

export default function TasksDesktopToolbar({
  ui,
  pageMode = 'list',
  onPageModeChange,
  isTaskDataMode = true,
  boardSummaryItems = [],
  canWriteTasks = false,
  canCreateTasks = false,
  onRefresh,
  onOpenTaxonomy,
  onOpenCreate,
  onPrefetchCreateMeta,
  onPrefetchAnalytics,
  viewMode = 'my',
  onPersonalRoleChange,
  personalRoleCounts = {},
  secondaryViewMode = '',
  onSecondaryViewModeChange,
  canManageAllTasks = false,
  canUseControllerTab = false,
  focusMode = '',
  focusCounts = {},
  taskDiscussionChatEnabled = false,
  onFocusModeChange,
  showFilters = false,
  onToggleFilters,
  activeFilterCount = 0,
  filtersPanel = null,
}) {
  const theme = useTheme();

  return (
    <Card
      data-testid="tasks-desktop-toolbar"
      sx={{ ...getOfficePanelSx(ui, { mb: 0.75, p: 0.65, borderRadius: '14px', flexShrink: 0 }) }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8} sx={{ minHeight: 34 }}>
          <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.65} alignItems="center" sx={{ flexShrink: 0 }}>
              <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                <AssignmentIcon sx={{ fontSize: 17 }} />
              </Avatar>
              <Typography sx={{ fontWeight: 900, fontSize: '0.94rem', lineHeight: 1 }}>Задачи</Typography>
            </Stack>

            <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '10px', px: 0.35 }), flexShrink: 0 }}>
              <Tabs
                value={pageMode}
                onChange={(_, value) => onPageModeChange?.(value)}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{
                  minHeight: 32,
                  '& .MuiTab-root': { textTransform: 'none', fontWeight: 800, minHeight: 32, px: 1.15, fontSize: '0.8rem' },
                  '& .MuiTabs-indicator': { borderRadius: '2px', height: 2 },
                }}
              >
                {TASK_MODE_OPTIONS.map((option) => (
                  <Tab
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    onMouseEnter={option.value === 'analytics' ? () => onPrefetchAnalytics?.() : undefined}
                  />
                ))}
              </Tabs>
            </Box>

            {isTaskDataMode ? (
              <Stack direction="row" spacing={0.45} sx={{ minWidth: 0, overflowX: 'auto', flex: 1 }}>
                {boardSummaryItems.map((item) => (
                  <Chip
                    key={item.key}
                    size="small"
                    label={`${item.label}: ${item.value}`}
                    sx={{
                      flexShrink: 0,
                      height: 24,
                      fontWeight: 850,
                      fontSize: '0.7rem',
                      borderRadius: '8px',
                      bgcolor: alpha(item.color, 0.12),
                      color: item.color,
                    }}
                  />
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" sx={{ color: ui.subtleText, lineHeight: 1.1, minWidth: 0 }} noWrap>
                Аналитика по постановке, срокам и выполнению задач.
              </Typography>
            )}
          </Stack>

          <Stack direction="row" spacing={0.45} alignItems="center" sx={{ flexShrink: 0 }}>
            <Tooltip title="Обновить">
              <span>
                <IconButton
                  size="small"
                  aria-label="Обновить"
                  onClick={() => void onRefresh?.()}
                  sx={{ width: 32, height: 32, borderRadius: '10px', border: '1px solid', borderColor: ui.actionBorder, bgcolor: ui.actionBg }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {canWriteTasks ? (
              <Tooltip title="Справочники">
                <span>
                  <IconButton
                    size="small"
                    aria-label="Справочники"
                    onClick={onOpenTaxonomy}
                    sx={{ width: 32, height: 32, borderRadius: '10px', border: '1px solid', borderColor: ui.actionBorder, bgcolor: ui.actionBg }}
                  >
                    <AssignmentIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            {canCreateTasks ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon />}
                onClick={onOpenCreate}
                onMouseEnter={() => onPrefetchCreateMeta?.()}
                sx={{ minHeight: 32, textTransform: 'none', fontWeight: 850, borderRadius: '10px', boxShadow: 'none', px: 1.25 }}
              >
                Новая задача
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {isTaskDataMode ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8} sx={{ minHeight: 32 }}>
            <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0, flex: '1 1 auto' }}>
              <TaskRoleScopeSwitch
                value={viewMode}
                onChange={onPersonalRoleChange}
                counts={personalRoleCounts}
              />
              <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '10px', px: 0.35 }), minWidth: 0 }}>
                <Tabs
                  value={secondaryViewMode || false}
                  onChange={(_, value) => {
                    if (value) onSecondaryViewModeChange?.(value);
                  }}
                  variant="scrollable"
                  allowScrollButtonsMobile
                  sx={{
                    minHeight: 32,
                    '& .MuiTab-root': { textTransform: 'none', fontWeight: 750, minHeight: 32, px: 1.15, fontSize: '0.79rem' },
                    '& .MuiTabs-indicator': { borderRadius: '2px', height: 2 },
                  }}
                >
                  {canManageAllTasks && <Tab value="all" label="Все" />}
                  <Tab value="department" label="Отдел" />
                  {canUseControllerTab && <Tab value="controller" label="На контроле" />}
                </Tabs>
              </Box>
            </Stack>

            <Stack direction="row" spacing={0.45} alignItems="center" sx={{ flexShrink: 0, minWidth: 0 }}>
              <Stack direction="row" spacing={0.45} sx={{ maxWidth: { md: 520, lg: 640 }, overflowX: 'auto' }}>
                {focusOptions.map((option) => (
                  <Chip
                    key={option.value}
                    clickable
                    label={`${option.value === 'comments' ? getTaskUnreadFocusLabel(taskDiscussionChatEnabled) : option.label}: ${focusCounts[option.value] || 0}`}
                    onClick={() => onFocusModeChange?.(option.value)}
                    sx={{
                      flexShrink: 0,
                      height: 24,
                      fontSize: '0.7rem',
                      fontWeight: 850,
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: focusMode === option.value ? ui.selectedBorder : ui.actionBorder,
                      bgcolor: focusMode === option.value ? ui.selectedBg : ui.actionBg,
                      color: focusMode === option.value ? theme.palette.primary.main : 'text.primary',
                    }}
                  />
                ))}
              </Stack>
              <Button
                size="small"
                variant={showFilters ? 'contained' : 'text'}
                startIcon={<FilterListIcon />}
                onClick={onToggleFilters}
                sx={{ minHeight: 30, textTransform: 'none', fontWeight: 850, borderRadius: '9px', px: 1, py: 0.25, whiteSpace: 'nowrap', boxShadow: 'none' }}
              >
                {showFilters ? 'Свернуть фильтры' : `Развернуть фильтры${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        {isTaskDataMode && showFilters ? filtersPanel : null}
      </Stack>
    </Card>
  );
}
