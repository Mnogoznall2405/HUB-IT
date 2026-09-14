import {
  Box,
  Button,
  Chip,
  IconButton,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { executeToastAction } from './toastActions';

const severityConfig = {
  success: {
    icon: CheckCircleOutlineRoundedIcon,
    accent: '#22c55e',
    label: 'Успех',
  },
  error: {
    icon: ErrorOutlineRoundedIcon,
    accent: '#ef4444',
    label: 'Ошибка',
  },
  warning: {
    icon: WarningAmberRoundedIcon,
    accent: '#f59e0b',
    label: 'Предупреждение',
  },
  info: {
    icon: InfoOutlinedIcon,
    accent: '#3b82f6',
    label: 'Информация',
  },
};

function ToastViewport({
  toast,
  open,
  onClose,
  onPause,
  onResume,
  inline = false,
  hideClose = false,
  footer = null,
  sx = null,
}) {
  const theme = useTheme();

  if (!toast || !open) {
    return null;
  }

  const severity = severityConfig[toast.severity] || severityConfig.info;
  const Icon = severity.icon;
  const isDark = theme.palette.mode === 'dark';
  const ui = buildOfficeUiTokens(theme);
  const isPersistent = Boolean(toast.persist);
  const repeatCount = Math.max(1, Number(toast.repeatCount || 1));
  const title = String(toast.title || '').trim() || severity.label;
  const message = String(toast.message || '').trim();
  const role = toast.severity === 'warning' || toast.severity === 'error' ? 'alert' : 'status';
  const actionLabel = String(toast.actionLabel || toast.action?.label || '').trim();
  const hasAction = Boolean(actionLabel) && (typeof toast.onAction === 'function' || toast.action);

  const handleActionClick = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (typeof toast.onAction === 'function') {
      toast.onAction();
    } else if (toast.action) {
      executeToastAction(toast.action);
    }
    if (typeof onClose === 'function') {
      onClose(null, 'action');
    }
  };

  const content = (
    <Box
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      data-testid="toast-viewport"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
      sx={{
        width: { xs: 'calc(100vw - 24px)', sm: 'fit-content' },
        minWidth: { sm: 220 },
        maxWidth: { xs: 'calc(100vw - 24px)', sm: 340 },
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: alpha(severity.accent, isDark ? 0.42 : 0.24),
        backgroundColor: ui.panelSolid,
        boxShadow: ui.dialogShadow,
        backdropFilter: 'blur(18px)',
        ...sx,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: hideClose ? 'auto 1fr' : 'auto 1fr auto',
          gap: 0.75,
          alignItems: 'start',
          px: 1.15,
          py: 0.85,
        }}
      >
        <Icon sx={{ fontSize: 17, color: severity.accent, mt: '2px' }} />

        <Stack spacing={0.3} sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              color: alpha(theme.palette.text.primary, isDark ? 0.92 : 0.88),
              fontSize: '12.5px',
              lineHeight: 1.35,
              wordBreak: 'break-word',
            }}
          >
            <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {title}
            </Box>
            {message && message !== title ? (
              <Box component="span" sx={{ '&::before': { content: '" — "' } }}>
                {message}
              </Box>
            ) : null}
            {repeatCount > 1 ? (
              <Chip
                label={`x${repeatCount}`}
                size="small"
                sx={{
                  ml: 0.75,
                  height: 16,
                  borderRadius: '999px',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  bgcolor: alpha(severity.accent, isDark ? 0.2 : 0.12),
                  color: severity.accent,
                  verticalAlign: '1px',
                  '& .MuiChip-label': { px: 0.6 },
                }}
              />
            ) : null}
          </Typography>

          {hasAction ? (
            <Box>
              <Button
                size="small"
                onClick={handleActionClick}
                sx={{
                  px: 0,
                  py: 0,
                  minWidth: 0,
                  minHeight: 0,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: severity.accent,
                  '&:hover': {
                    bgcolor: 'transparent',
                    color: alpha(severity.accent, 0.82),
                  },
                }}
              >
                {actionLabel}
              </Button>
            </Box>
          ) : null}
        </Stack>

        {!hideClose ? (
          <IconButton
            size="small"
            onClick={(event) => onClose?.(event, 'closeButton')}
            aria-label="Закрыть уведомление"
            sx={{
              p: 0.25,
              color: alpha(theme.palette.text.secondary, isDark ? 0.88 : 0.72),
              mt: -0.1,
              mr: -0.3,
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 15 }} />
          </IconButton>
        ) : null}
      </Box>

      {footer ? (
        <Box sx={{ px: 1.5, pb: 1.15, pt: 0.1 }}>
          {footer}
        </Box>
      ) : null}

      {!isPersistent ? (
        <Box
          aria-hidden="true"
          data-testid="toast-progress"
          sx={{
            height: 2,
            bgcolor: alpha(severity.accent, isDark ? 0.14 : 0.08),
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              'height': '100%',
              'bgcolor': severity.accent,
              'transformOrigin': 'left',
              '@keyframes toast-countdown': {
                from: { transform: 'scaleX(1)' },
                to: { transform: 'scaleX(0)' },
              },
              'animation': `toast-countdown ${Math.max(1, Number(toast.durationMs || 5000))}ms linear forwards`,
              'animationPlayState': toast.paused ? 'paused' : 'running',
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
              },
            }}
          />
        </Box>
      ) : null}
    </Box>
  );

  if (inline) {
    return content;
  }

  return (
    <Snackbar
      key={toast.id}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      sx={{
        '&.MuiSnackbar-root': {
          left: { xs: 12, sm: 'auto' },
          right: { xs: 12, sm: 24 },
          bottom: {
            xs: 'calc(var(--app-shell-mobile-bottom-nav-height, 0px) + 12px)',
            sm: 24,
          },
        },
      }}
    >
      {content}
    </Snackbar>
  );
}

export default ToastViewport;
