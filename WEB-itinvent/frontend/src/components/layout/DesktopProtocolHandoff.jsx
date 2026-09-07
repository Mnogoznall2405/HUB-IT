import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import {
  buildHubitProtocolHref,
  canOfferDesktopHandoff,
  launchHubitProtocol,
  resolveHandoffRoute,
  setDesktopHandoffPreference,
  skipDesktopHandoffThisSession,
} from '../../lib/desktopProtocolHandoff';

export default function DesktopProtocolHandoff() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const location = useLocation();
  const autoLaunchedRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [protocolHref, setProtocolHref] = useState('');

  useEffect(() => {
    if (!canOfferDesktopHandoff()) {
      setVisible(false);
      setProtocolHref('');
      return;
    }

    const route = resolveHandoffRoute(location.pathname, location.search);
    const href = buildHubitProtocolHref(route);
    if (!href) {
      setVisible(false);
      setProtocolHref('');
      return;
    }

    setProtocolHref(href);
    setVisible(true);
    if (!autoLaunchedRef.current) {
      autoLaunchedRef.current = true;
      launchHubitProtocol(href);
    }
  }, [location.pathname, location.search]);

  if (!visible || !protocolHref) return null;

  const stayInBrowser = (persistNever) => {
    skipDesktopHandoffThisSession();
    if (persistNever) setDesktopHandoffPreference('never');
    setVisible(false);
  };

  return (
    <Paper
      elevation={0}
      data-testid="desktop-protocol-handoff"
      sx={{
        position: 'sticky',
        top: 'var(--hubit-global-banner-offset, 0px)',
        zIndex: 20,
        mx: { xs: 1, sm: 2 },
        mt: { xs: 1, sm: 1.5 },
        px: 1.5,
        py: 1.25,
        borderRadius: '12px',
        bgcolor: ui.panelSolid,
        border: '1px solid',
        borderColor: ui.borderSoft,
        boxShadow: ui.shellShadow,
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <ComputerOutlinedIcon sx={{ color: ui.iconMuted, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, color: ui.textPrimary }}>
              Открыть в HUB Desktop
            </Typography>
            <Typography sx={{ fontSize: 13, color: ui.textSecondary, lineHeight: 1.45 }}>
              Ссылка может открыться в приложении, а не в браузере. Если Windows спросит — разрешите HUB Desktop.
            </Typography>
          </Box>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            variant="contained"
            onClick={() => launchHubitProtocol(protocolHref)}
            sx={{ minHeight: 44, textTransform: 'none' }}
          >
            Открыть приложение
          </Button>
          <Button
            variant="text"
            onClick={() => stayInBrowser(false)}
            sx={{ minHeight: 44, textTransform: 'none' }}
          >
            Остаться в браузере
          </Button>
          <Button
            variant="text"
            onClick={() => stayInBrowser(true)}
            sx={{ minHeight: 44, textTransform: 'none', color: ui.textSecondary }}
          >
            Больше не предлагать
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
