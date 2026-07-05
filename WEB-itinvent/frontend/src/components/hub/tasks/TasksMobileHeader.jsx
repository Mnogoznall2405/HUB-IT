import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import {
  Badge,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ShellNotificationsButton from '../../layout/ShellNotificationsButton';
import TaskRoleScopeSwitch from '../TaskRoleScopeSwitch';
import { hideMobileScrollbarSx } from '../../../pages/tasks/taskFormatters';
import { TASKS_MOBILE_COPY } from '../../../pages/tasks/tasksMobileCopy';

export const buildTasksMobilePrimaryModeOptions = (feedTitle = TASKS_MOBILE_COPY.feedTitle) => [
  { value: 'list', label: feedTitle, icon: AssignmentIcon },
  { value: 'deadlines', label: 'Сроки', icon: CalendarMonthOutlinedIcon },
  { value: 'board', label: 'Доска', icon: ChecklistOutlinedIcon },
];

export default function TasksMobileHeader({
  ui,
  mobileTasksCopy = TASKS_MOBILE_COPY,
  modeLabel = '',
  itemCount = 0,
  subtitle = '',
  isTaskDataMode = true,
  searchOpen = false,
  onSearchOpenChange,
  q = '',
  onQChange,
  searchInputRef,
  activeFilterCount = 0,
  onOpenNavigation,
  bottomMode = 'list',
  primaryModeOptions = buildTasksMobilePrimaryModeOptions(),
  onPageModeChange,
  viewMode = 'my',
  onPersonalRoleChange,
  personalRoleCounts = {},
}) {
  const theme = useTheme();
  const headerLabel = `${modeLabel} · ${itemCount}`;

  return (
    <Stack
      data-testid="tasks-mobile-header-inline"
      spacing={0.65}
      sx={{
        width: '100%',
        minWidth: 0,
        py: 0.45,
      }}
    >
      <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
        {searchOpen && isTaskDataMode ? (
          <TextField
            fullWidth
            size="small"
            value={q}
            inputRef={searchInputRef}
            onChange={(event) => onQChange?.(event.target.value)}
            placeholder={mobileTasksCopy.searchPlaceholder}
            inputProps={{ 'data-testid': 'tasks-mobile-search-input', 'aria-label': mobileTasksCopy.search }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ fontSize: 16, color: ui.subtleText, mr: 0.55, flexShrink: 0 }} />,
              endAdornment: (
                <IconButton
                  size="small"
                  data-testid="tasks-mobile-close-search"
                  aria-label="Закрыть поиск"
                  onClick={() => onSearchOpenChange?.(false)}
                  sx={{ width: 26, height: 26, flexShrink: 0 }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ),
            }}
            sx={{
              minWidth: 0,
              '& .MuiOutlinedInput-root': {
                minHeight: 34,
                borderRadius: '11px',
                bgcolor: ui.actionBg,
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent',
                  borderWidth: 1,
                },
              },
              '& .MuiOutlinedInput-input': {
                py: 0.55,
                fontSize: '0.82rem',
              },
            }}
          />
        ) : (
          <>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                data-testid="tasks-mobile-header-mode"
                sx={{ fontWeight: 900, fontSize: '0.82rem', lineHeight: 1.08, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {headerLabel}
              </Typography>
              {!isTaskDataMode ? (
                <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {subtitle}
                </Typography>
              ) : null}
            </Box>
            {isTaskDataMode ? (
              <IconButton
                size="small"
                data-testid="tasks-mobile-open-search"
                aria-label={mobileTasksCopy.search}
                onClick={() => onSearchOpenChange?.(true)}
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '999px',
                  color: q ? theme.palette.primary.main : ui.mutedText,
                  bgcolor: q ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                  flexShrink: 0,
                }}
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            ) : null}
          </>
        )}

        <Badge
          color="primary"
          badgeContent={activeFilterCount}
          invisible={!isTaskDataMode || activeFilterCount <= 0}
          overlap="circular"
        >
          <IconButton
            size="small"
            data-testid="tasks-mobile-open-navigation"
            aria-label={mobileTasksCopy.openMenu}
            onClick={onOpenNavigation}
            sx={{
              width: 34,
              height: 34,
              borderRadius: '999px',
              color: ui.mutedText,
              bgcolor: activeFilterCount > 0 ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
              flexShrink: 0,
            }}
          >
            <FilterListIcon fontSize="small" />
          </IconButton>
        </Badge>
        <ShellNotificationsButton size="small" />
      </Stack>

      <Stack
        direction="row"
        spacing={0.45}
        data-testid="tasks-mobile-mode-segmented"
        sx={{
          minWidth: 0,
          overflowX: 'auto',
          pb: 0.1,
          ...hideMobileScrollbarSx,
        }}
      >
        {primaryModeOptions.map((option) => {
          const IconComponent = option.icon;
          const selected = bottomMode === option.value;
          return (
            <Button
              key={option.value}
              size="small"
              variant={selected ? 'contained' : 'outlined'}
              startIcon={<IconComponent sx={{ fontSize: 15 }} />}
              data-testid={`tasks-mobile-mode-${option.value}`}
              onClick={() => onPageModeChange?.(option.value)}
              sx={{
                flexShrink: 0,
                minWidth: 0,
                height: 30,
                px: 0.85,
                borderRadius: '999px',
                textTransform: 'none',
                fontWeight: 850,
                fontSize: '0.72rem',
                boxShadow: 'none',
              }}
            >
              {option.label}
            </Button>
          );
        })}
        <Badge
          color="primary"
          badgeContent={activeFilterCount}
          invisible={!isTaskDataMode || activeFilterCount <= 0}
          overlap="circular"
        >
          <Button
            size="small"
            variant={bottomMode === 'more' ? 'contained' : 'outlined'}
            startIcon={<TuneOutlinedIcon sx={{ fontSize: 15 }} />}
            data-testid="tasks-mobile-open-navigation-segment"
            onClick={onOpenNavigation}
            sx={{
              flexShrink: 0,
              minWidth: 0,
              height: 30,
              px: 0.85,
              borderRadius: '999px',
              textTransform: 'none',
              fontWeight: 850,
              fontSize: '0.72rem',
              boxShadow: 'none',
            }}
          >
            Ещё
          </Button>
        </Badge>
      </Stack>

      {isTaskDataMode ? (
        <TaskRoleScopeSwitch
          value={viewMode}
          onChange={onPersonalRoleChange}
          compact
          fullWidth
          counts={personalRoleCounts}
        />
      ) : null}
    </Stack>
  );
}
