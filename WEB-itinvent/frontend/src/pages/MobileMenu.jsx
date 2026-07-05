import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  ButtonBase,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { getVisibleNavigationItems } from '../components/layout/navigationConfig';
import { AccountIdentity } from '../components/account/AccountIdentity';
import { canAccessAdminArea } from '../components/account/accountNavigationConfig';
import { useAuth } from '../contexts/AuthContext';
import { buildOfficeUiTokens } from '../theme/officeUiTokens';
import { prefetchRouteByPath } from '../lib/routeLoaders';

function AccountAction({ icon, label, onClick, danger = false, testId }) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  return (
    <ButtonBase
      data-testid={testId}
      onClick={onClick}
      sx={{
        width: '100%',
        minHeight: 48,
        px: 0.9,
        borderRadius: '10px',
        justifyContent: 'flex-start',
        color: danger ? theme.palette.error.main : ui.iconMuted,
        '&:hover': { bgcolor: ui.actionHover },
      }}
    >
      <Stack direction="row" spacing={1.1} alignItems="center" sx={{ width: '100%' }}>
        <Box sx={{ lineHeight: 0 }}>{icon}</Box>
        <Typography sx={{ flex: 1, color: danger ? 'error.main' : 'text.primary', fontWeight: 750, textAlign: 'left' }}>
          {label}
        </Typography>
        {danger ? null : <ChevronRightRoundedIcon sx={{ color: ui.iconMuted }} />}
      </Stack>
    </ButtonBase>
  );
}

export default function MobileMenu() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const navigate = useNavigate();
  const { user, hasPermission, logout } = useAuth();
  const visibleItems = useMemo(
    () => getVisibleNavigationItems({ user, hasPermission }),
    [hasPermission, user],
  );
  const showAdminArea = canAccessAdminArea({ user, hasPermission });

  const openItem = (item) => {
    if (!item?.path) return;
    void prefetchRouteByPath(item.path).catch(() => {});
    navigate(item.path);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <MainLayout contentMode="default">
      <PageShell sx={{ pb: 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 10px)' }}>
        <Stack spacing={1} sx={{ maxWidth: 720, mx: 'auto', width: '100%' }}>
          <ButtonBase
            data-testid="mobile-menu-profile-card"
            aria-label={`Открыть профиль: ${user?.full_name || user?.username || 'пользователь'}`}
            onClick={() => navigate('/profile')}
            sx={{
              width: '100%',
              p: 1.1,
              borderRadius: '17px',
              justifyContent: 'flex-start',
              textAlign: 'left',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.6),
              bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.72 : 0.8),
              backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)}, transparent 72%)`,
              backdropFilter: 'blur(20px) saturate(145%)',
              WebkitBackdropFilter: 'blur(20px) saturate(145%)',
              boxShadow: theme.palette.mode === 'dark'
                ? '0 10px 24px rgba(0,0,0,0.2)'
                : '0 10px 24px rgba(15,23,42,0.08)',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <AccountIdentity user={user} />
            </Box>
            <ChevronRightRoundedIcon sx={{ ml: 1, color: ui.iconMuted }} />
          </ButtonBase>

          <Box
            data-testid="mobile-menu-app-grid"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              columnGap: 0.35,
              rowGap: 0.55,
            }}
          >
            {visibleItems.map((item) => (
              <ButtonBase
                key={item.path}
                data-testid={`mobile-menu-item-${item.path.replace(/^\//, '')}`}
                onClick={() => openItem(item)}
                onTouchStart={() => { void prefetchRouteByPath(item.path).catch(() => {}); }}
                sx={{
                  minWidth: 0,
                  minHeight: 82,
                  p: 0.55,
                  borderRadius: '14px',
                  border: '1px solid transparent',
                  bgcolor: 'transparent',
                  '&:hover': {
                    bgcolor: ui.actionHover,
                    borderColor: ui.borderSoft,
                  },
                }}
              >
                <Stack spacing={0.55} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '12px',
                      display: 'grid',
                      placeItems: 'center',
                      color: theme.palette.primary.main,
                      bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1),
                      '& .MuiSvgIcon-root': { fontSize: 24 },
                    }}
                  >
                    {item.icon}
                  </Box>
                  <Typography
                    sx={{
                      width: '100%',
                      fontSize: '0.7rem',
                      lineHeight: 1.12,
                      fontWeight: 800,
                      textAlign: 'center',
                    }}
                    noWrap
                  >
                    {item.shortLabel || item.label}
                  </Typography>
                </Stack>
              </ButtonBase>
            ))}
          </Box>

          <Box
            sx={{
              p: 0.45,
              borderRadius: '14px',
              border: '1px solid',
              borderColor: ui.borderSoft,
              bgcolor: ui.panelSolid,
            }}
          >
            <Stack divider={<Divider sx={{ borderColor: ui.borderSoft }} />}>
              <AccountAction
                testId="mobile-menu-action-profile"
                icon={<PersonOutlineRoundedIcon />}
                label="Профиль"
                onClick={() => navigate('/profile')}
              />
              <AccountAction
                testId="mobile-menu-action-settings"
                icon={<SettingsOutlinedIcon />}
                label="Настройки"
                onClick={() => navigate('/settings')}
              />
              {showAdminArea ? (
                <AccountAction
                  testId="mobile-menu-action-admin"
                  icon={<AdminPanelSettingsOutlinedIcon />}
                  label="Администрирование"
                  onClick={() => navigate('/admin')}
                />
              ) : null}
              <AccountAction
                testId="mobile-menu-action-logout"
                icon={<LogoutRoundedIcon />}
                label="Выход"
                onClick={() => { void handleLogout(); }}
                danger
              />
            </Stack>
          </Box>
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
