import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';
import ShellNotificationsButton from '../layout/ShellNotificationsButton';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { formatDateTime } from './addressBookUtils';

export default function AddressBookDesktopToolbar({
  tab,
  onTabChange,
  canViewDismissed = false,
  countLabel = '',
  statusUpdatedAt = '',
  statusLoading = false,
  syncInProgress = false,
  syncFailed = false,
  syncError = '',
  isAdmin = false,
  onSync,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const shell = useMainLayoutShell();
  const updatedLabel = `Обновлено: ${formatDateTime(statusUpdatedAt)}`;
  const focusRingSx = {
    '&:focus-visible, &.Mui-focusVisible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
      '@media (forced-colors: active)': {
        outlineColor: 'Highlight',
      },
    },
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      sx={{ flexShrink: 0, minWidth: 0, minHeight: 44 }}
      data-testid="address-book-header-row1"
    >
      {shell.sidebarPinned ? null : (
        <Tooltip title="Открыть главное меню">
          <IconButton
            aria-label="Открыть главное меню"
            aria-expanded={shell.drawerOpen}
            onClick={shell.openDrawer}
            size="small"
            sx={{ width: 36, height: 36, color: ui.iconPrimary, ...focusRingSx }}
          >
            <MenuIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Typography variant="h6" component="h1" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
        Адресная книга
      </Typography>
      {canViewDismissed ? (
        <Tabs
          value={tab}
          onChange={onTabChange}
          sx={{ flexShrink: 0, minHeight: 36 }}
          data-testid="address-book-tabs"
        >
          <Tab value="active" label="Сотрудники" data-testid="address-book-tab-active" sx={{ minHeight: 36, py: 0.5 }} />
          <Tab value="dismissed" label="Уволенные" data-testid="address-book-tab-dismissed" sx={{ minHeight: 36, py: 0.5 }} />
        </Tabs>
      ) : null}
      <Typography
        component="span"
        role="status"
        aria-live="polite"
        variant="caption"
        color="text.secondary"
      >
        {countLabel}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center" sx={{ minWidth: 0 }}>
        <Tooltip title={updatedLabel}>
          <Typography variant="caption" color="text.secondary">
            {updatedLabel}
          </Typography>
        </Tooltip>
        {statusLoading ? <Chip label="Проверяем статус…" size="small" variant="outlined" /> : null}
        {syncInProgress ? (
          <Chip label="Идёт обновление" size="small" color="info" variant="outlined" />
        ) : null}
        {syncFailed ? (
          <Tooltip title={isAdmin ? syncError || 'Последняя синхронизация завершилась ошибкой' : ''}>
            <Chip
              label={isAdmin ? 'Ошибка синхронизации' : 'Данные могут быть неактуальны'}
              aria-label={isAdmin && syncError
                ? `Ошибка синхронизации: ${syncError}`
                : undefined}
              size="small"
              color="warning"
              variant="outlined"
              data-testid="address-book-sync-status"
            />
          </Tooltip>
        ) : null}
      </Stack>
      <ShellNotificationsButton
        size="small"
        sx={{ width: 36, height: 36, ...focusRingSx }}
        iconSx={{ fontSize: 20 }}
      />
      {isAdmin ? (
        <Button
          variant="contained"
          size="small"
          startIcon={syncInProgress ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
          onClick={onSync}
          disabled={syncInProgress}
        >
          Обновить
        </Button>
      ) : null}
    </Stack>
  );
}
