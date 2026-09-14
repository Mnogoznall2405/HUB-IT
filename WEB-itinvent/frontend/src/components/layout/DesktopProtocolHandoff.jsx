import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Box, Button, Collapse, Paper, Stack, Typography } from '@mui/material';
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

let handoffHost = null;
const hostListeners = new Set();
const subscribeHost = (listener) => { hostListeners.add(listener); return () => hostListeners.delete(listener); };
const getHost = () => handoffHost;

// Keep the protocol launcher mounted once in App, but render inside the shell.
export function DesktopHandoffSlot() {
  const bindHost = useCallback((node) => {
    handoffHost = node;
    hostListeners.forEach((listener) => listener());
  }, []);
  return <Box ref={bindHost} data-testid="desktop-handoff-slot" sx={{ flexShrink: 0, minWidth: 0 }} />;
}

export default function DesktopProtocolHandoff() {
  const host = useSyncExternalStore(subscribeHost, getHost, () => null);
  const [expanded, setExpanded] = useState(false);
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

  const content = (
    <Paper
      elevation={0}
      data-testid="desktop-protocol-handoff"
      sx={{
        mx: host ? 0 : { xs: 1, sm: 2 },
        my: 1,
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
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <ComputerOutlinedIcon sx={{ color: ui.iconMuted, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, color: ui.textPrimary }}>
              Открыть в HUB Desktop
            </Typography>
          </Box>
        </Stack>
        <Button aria-expanded={expanded} aria-controls="desktop-handoff-actions" onClick={() => setExpanded((value) => !value)} sx={{ flexShrink: 0, minHeight: 44 }}>
          {expanded ? 'Свернуть' : 'Подробнее'}
        </Button>
      </Stack>
      <Collapse in={expanded} id="desktop-handoff-actions">
        <Typography sx={{ fontSize: 13, color: ui.textSecondary, lineHeight: 1.45, my: 1 }}>
          Ссылка может открыться в приложении, а не в браузере. Если Windows спросит — разрешите HUB Desktop.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
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
      </Collapse>
    </Paper>
  );
  return host ? createPortal(content, host) : content;
}
