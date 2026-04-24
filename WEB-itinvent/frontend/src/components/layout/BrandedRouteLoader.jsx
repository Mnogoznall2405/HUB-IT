import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

export default function BrandedRouteLoader({
  overlay = false,
  label = 'Загружаем...',
  sublabel = '',
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: overlay ? 'absolute' : 'relative',
        inset: overlay ? 0 : 'auto',
        minHeight: overlay ? 0 : '100vh',
        display: 'grid',
        placeItems: 'center',
        px: 3,
        zIndex: overlay ? 18 : 1,
        pointerEvents: overlay ? 'none' : 'auto',
        bgcolor: overlay
          ? alpha(theme.palette.background.default, theme.palette.mode === 'dark' ? 0.72 : 0.64)
          : ui.pageBg,
        backdropFilter: overlay ? 'blur(10px)' : 'none',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.15,
          px: 2,
          py: 1.5,
        }}
      >
        <Box
          sx={{
            width: overlay ? 70 : 82,
            height: overlay ? 70 : 82,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '999px',
            bgcolor: '#ffffff',
            animation: prefersReducedMotion ? 'none' : 'hubitRouteLoaderPulse 1.35s ease-in-out infinite',
            '@keyframes hubitRouteLoaderPulse': {
              '0%': {
                transform: 'scale(0.98)',
                opacity: 0.78,
              },
              '50%': {
                transform: 'scale(1)',
                opacity: 1,
              },
              '100%': {
                transform: 'scale(0.98)',
                opacity: 0.78,
              },
            },
            filter: theme.palette.mode === 'dark'
              ? 'drop-shadow(0 8px 20px rgba(0,0,0,0.24))'
              : 'drop-shadow(0 6px 16px rgba(0,0,0,0.14))',
          }}
        >
          <Box
            component="img"
            src="/pwa-192.png"
            alt="HUB-IT"
            sx={{
              width: overlay ? 52 : 60,
              height: overlay ? 52 : 60,
              objectFit: 'contain',
            }}
          />
        </Box>

        <Box sx={{ textAlign: 'center' }}>
          <Typography
            sx={{
              fontSize: overlay ? '0.98rem' : '1.02rem',
              fontWeight: 800,
              letterSpacing: '-0.01em',
              color: theme.palette.text.primary,
            }}
          >
            {label}
          </Typography>
          {String(sublabel || '').trim() ? (
            <Typography
              sx={{
                mt: 0.45,
                fontSize: '0.82rem',
                color: ui.textSecondary,
              }}
            >
              {sublabel}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
