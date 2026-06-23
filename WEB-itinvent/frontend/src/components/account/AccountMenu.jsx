import {
  Divider,
  Menu,
  MenuItem,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

export default function AccountMenu({
  anchorEl,
  onClose,
  onNavigate,
  onLogout,
  showAdministration,
  reducedMotion = false,
}) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);

  const openRoute = (path) => {
    onClose();
    onNavigate(path);
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      transitionDuration={reducedMotion ? 0 : 'auto'}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      MenuListProps={{ 'aria-label': 'Профиль и настройки' }}
      slotProps={{
        paper: {
          sx: {
            minWidth: 220,
            mb: 1,
            borderRadius: '16px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.9 : 0.94),
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: ui.dialogShadow,
          },
        },
      }}
    >
      <MenuItem onClick={() => openRoute('/profile')}>
        <PersonOutlineRoundedIcon sx={{ mr: 1.2, color: ui.iconMuted }} />
        Профиль
      </MenuItem>
      <MenuItem onClick={() => openRoute('/settings')}>
        <SettingsOutlinedIcon sx={{ mr: 1.2, color: ui.iconMuted }} />
        Настройки
      </MenuItem>
      {showAdministration ? (
        <MenuItem onClick={() => openRoute('/admin')}>
          <AdminPanelSettingsOutlinedIcon sx={{ mr: 1.2, color: ui.iconMuted }} />
          Администрирование
        </MenuItem>
      ) : null}
      <Divider />
      <MenuItem onClick={onLogout} sx={{ color: 'error.main' }}>
        <LogoutRoundedIcon sx={{ mr: 1.2 }} />
        Выход
      </MenuItem>
    </Menu>
  );
}
