import { useMemo } from 'react';
import { Badge, IconButton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { buildOfficeUiTokens, getOfficeQuietActionSx } from '../../theme/officeUiTokens';
import { useMainLayoutShell } from './MainLayoutShellContext';

export default function ShellNotificationsButton({ sx = {}, iconSx = {}, size = 'medium' }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const {
    openNotifications,
    notificationsBadgeValue,
    showNotificationsButton,
  } = useMainLayoutShell();

  if (!showNotificationsButton) return null;

  const dimension = size === 'small' ? 34 : 40;

  return (
    <IconButton
      aria-label="Открыть уведомления"
      data-testid="shell-notifications-button"
      onClick={openNotifications}
      sx={{
        width: dimension,
        height: dimension,
        flexShrink: 0,
        ...getOfficeQuietActionSx(ui, theme, 'neutral', {
          borderColor: 'transparent',
          bgcolor: 'transparent',
        }),
        ...sx,
      }}
    >
      <Badge color="error" badgeContent={notificationsBadgeValue}>
        <NotificationsIcon sx={{ fontSize: size === 'small' ? 20 : 22, ...iconSx }} />
      </Badge>
    </IconButton>
  );
}
