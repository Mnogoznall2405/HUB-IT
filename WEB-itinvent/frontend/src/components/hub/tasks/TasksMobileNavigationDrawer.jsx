import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { getTaskUnreadFocusLabel } from '../../../lib/taskNavigation';
import { focusOptions, mobileStatusOptions } from '../../../pages/tasks/taskConstants';
import { TASKS_MOBILE_COPY } from '../../../pages/tasks/tasksMobileCopy';
import { getOfficeHeaderBandSx, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

export const TASKS_MOBILE_MORE_MODE_OPTIONS = [
  { value: 'calendar', label: 'Календарь', icon: CalendarMonthOutlinedIcon },
  { value: 'gantt', label: 'Гант', icon: AssignmentIcon },
  { value: 'analytics', label: 'Аналитика', icon: TuneOutlinedIcon },
];

export default function TasksMobileNavigationDrawer({
  open = false,
  onClose,
  ui,
  mobileTasksCopy = TASKS_MOBILE_COPY,
  isTaskDataMode = true,
  pageMode = 'list',
  onPageModeChange,
  canWriteTasks = false,
  onOpenTaxonomy,
  canManageAllTasks = false,
  canUseControllerTab = false,
  secondaryViewMode = '',
  onViewModeChange,
  boardSummaryItems = [],
  statusFilter = '',
  onStatusFilterChange,
  focusMode = '',
  focusCounts = {},
  taskDiscussionChatEnabled = false,
  boardFiltersPanel,
  onRefreshTasks,
  onRefreshAnalytics,
  analyticsLoading = false,
  analyticsExporting = false,
  onExportAnalytics,
  analyticsFocusMeta,
  analyticsFiltersPanel,
  onResetFilters,
  mobileMoreModeOptions = TASKS_MOBILE_MORE_MODE_OPTIONS,
}) {
  const theme = useTheme();

  const handleClose = () => onClose?.();

  const runAndClose = (action) => {
    action?.();
    handleClose();
  };

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          width: '100%',
          maxHeight: '88dvh',
          bgcolor: ui.pageBg,
          backgroundImage: 'none',
          borderTopLeftRadius: '18px',
          borderTopRightRadius: '18px',
          borderTop: '1px solid',
          borderColor: ui.borderSoft,
          overflow: 'hidden',
        },
      }}
    >
      <Box data-testid="tasks-mobile-navigation-drawer" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.15, py: 1.05 }), borderBottom: '1px solid', borderColor: ui.borderSoft }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, fontSize: '1rem', lineHeight: 1.1 }}>{mobileTasksCopy.drawerTitle}</Typography>
              <Typography variant="caption" sx={{ color: ui.mutedText, display: 'block', mt: 0.25 }}>
                {isTaskDataMode ? mobileTasksCopy.drawerBoardSubtitle : mobileTasksCopy.drawerAnalyticsSubtitle}
              </Typography>
            </Box>
            <IconButton
              data-testid="tasks-mobile-close-navigation"
              aria-label={mobileTasksCopy.closeDrawer}
              onClick={handleClose}
              sx={{
                width: 34,
                height: 34,
                borderRadius: '10px',
                border: '1px solid',
                borderColor: ui.actionBorder,
                bgcolor: ui.actionBg,
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, py: 1 }}>
          <Stack spacing={1}>
            <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
              <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Дополнительные режимы</Typography>
              <Stack direction="row" spacing={0.65} sx={{ overflowX: 'auto', pb: 0.1 }}>
                {mobileMoreModeOptions.map((option) => {
                  const IconComponent = option.icon;
                  const selected = pageMode === option.value;
                  return (
                    <Button
                      key={option.value}
                      variant={selected ? 'contained' : 'outlined'}
                      size="small"
                      startIcon={<IconComponent sx={{ fontSize: 17 }} />}
                      onClick={() => runAndClose(() => onPageModeChange?.(option.value))}
                      sx={{ flexShrink: 0, textTransform: 'none', fontWeight: 850, borderRadius: '10px', boxShadow: 'none' }}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </Stack>
            </Box>

            {isTaskDataMode ? (
              <>
                <Stack direction="row" spacing={0.75}>
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={() => runAndClose(onRefreshTasks)}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    {mobileTasksCopy.refresh}
                  </Button>
                </Stack>

                {canWriteTasks ? (
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    onClick={() => runAndClose(onOpenTaxonomy)}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    {mobileTasksCopy.taxonomy}
                  </Button>
                ) : null}

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.75, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Дополнительные роли</Typography>
                  <Tabs
                    value={secondaryViewMode || false}
                    onChange={(_, value) => {
                      if (!value) return;
                      runAndClose(() => onViewModeChange?.(value));
                    }}
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{
                      minHeight: 38,
                      '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 38, fontSize: '0.8rem' },
                      '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
                    }}
                  >
                    {canManageAllTasks && <Tab value="all" label={mobileTasksCopy.all} />}
                    <Tab value="department" label={mobileTasksCopy.department} />
                    {canUseControllerTab && <Tab value="controller" label={mobileTasksCopy.controller} />}
                  </Tabs>
                </Box>

                <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.1 }}>
                  {boardSummaryItems.map((item) => (
                    <Chip
                      key={item.key}
                      label={`${item.label}: ${item.value}`}
                      sx={{
                        flexShrink: 0,
                        height: 26,
                        fontWeight: 800,
                        bgcolor: alpha(item.color, 0.12),
                        color: item.color,
                      }}
                    />
                  ))}
                </Stack>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.75, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.65 }}>{mobileTasksCopy.status}</Typography>
                  <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.2 }}>
                    {mobileStatusOptions.map((option) => (
                      <Chip
                        key={option.value || 'all'}
                        data-testid={`tasks-mobile-status-${option.value || 'all'}`}
                        clickable
                        label={option.label}
                        onClick={() => runAndClose(() => onStatusFilterChange?.(option.value))}
                        sx={{
                          flexShrink: 0,
                          height: 28,
                          fontWeight: 800,
                          border: '1px solid',
                          borderColor: statusFilter === option.value ? ui.selectedBorder : ui.actionBorder,
                          bgcolor: statusFilter === option.value ? ui.selectedBg : ui.actionBg,
                          color: statusFilter === option.value ? theme.palette.primary.main : 'text.primary',
                        }}
                      />
                    ))}
                  </Stack>
                </Box>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.75, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.65 }}>{mobileTasksCopy.focus}</Typography>
                  <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto' }}>
                    {focusOptions.map((option) => (
                      <Chip
                        key={option.value}
                        clickable
                        label={`${option.value === 'comments' ? getTaskUnreadFocusLabel(taskDiscussionChatEnabled) : option.label}: ${focusCounts[option.value] || 0}`}
                        onClick={() => runAndClose(() => onFocusModeChange?.(option.value))}
                        sx={{
                          flexShrink: 0,
                          height: 26,
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          border: '1px solid',
                          borderColor: focusMode === option.value ? ui.selectedBorder : ui.actionBorder,
                          bgcolor: focusMode === option.value ? ui.selectedBg : ui.actionBg,
                          color: focusMode === option.value ? theme.palette.primary.main : 'text.primary',
                        }}
                      />
                    ))}
                  </Stack>
                </Box>

                <Box>
                  <Typography sx={{ fontWeight: 800, mb: 0.6 }}>{mobileTasksCopy.advancedFilters}</Typography>
                  {boardFiltersPanel}
                </Box>
              </>
            ) : (
              <>
                <Stack direction="row" spacing={0.75}>
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={() => runAndClose(onRefreshAnalytics)}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    {mobileTasksCopy.refresh}
                  </Button>
                  <Button
                    fullWidth
                    variant="contained"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={() => void onExportAnalytics?.()}
                    disabled={analyticsLoading || analyticsExporting}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                  >
                    {analyticsExporting ? 'Export...' : 'Excel'}
                  </Button>
                </Stack>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800 }}>{analyticsFocusMeta?.title}</Typography>
                  <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.25 }}>
                    {analyticsFocusMeta?.description}
                  </Typography>
                  {analyticsFocusMeta?.chips?.length ? (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, overflowX: 'auto' }}>
                      {analyticsFocusMeta.chips.map((chip) => (
                        <Chip
                          key={chip.key}
                          label={chip.label}
                          sx={{
                            flexShrink: 0,
                            height: 24,
                            fontWeight: 700,
                            bgcolor: chip.bg,
                            color: chip.color,
                          }}
                        />
                      ))}
                    </Stack>
                  ) : null}
                </Box>

                <Box>
                  <Typography sx={{ fontWeight: 800, mb: 0.6 }}>{mobileTasksCopy.analyticsFilters}</Typography>
                  {analyticsFiltersPanel}
                </Box>
              </>
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            px: 1,
            py: 1,
            borderTop: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.pageBg,
            pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <Stack spacing={0.75}>
            {isTaskDataMode ? (
              <Button
                fullWidth
                variant="outlined"
                onClick={() => runAndClose(onResetFilters)}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
              >
                {mobileTasksCopy.resetFilters}
              </Button>
            ) : null}
            <Button fullWidth onClick={handleClose} sx={{ textTransform: 'none', fontWeight: 700 }}>
              {mobileTasksCopy.closeMenu}
            </Button>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}
