import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
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
  progressValue,
  onClose,
  onPause,
  onResume,
}) {
  const theme = useTheme();

  if (!toast) {
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

  const handleActionClick = () => {
    if (typeof toast.onAction === 'function') {
      toast.onAction();
    }
    if (typeof onClose === 'function') {
      onClose(null, 'action');
    }
  };

  return (
    <Snackbar
      key={toast.id}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      sx={{
        '&.MuiSnackbar-root': {
          left: { xs: 12, sm: 24 },
          bottom: { xs: 12, sm: 24 },
        },
      }}
    >
      <Box
        role={role}
        aria-live={role === 'alert' ? 'assertive' : 'polite'}
        onMouseEnter={onPause}
        onMouseLeave={onResume}
        sx={{
          width: { xs: 'calc(100vw - 24px)', sm: 420 },
          maxWidth: 'calc(100vw - 24px)',
          borderRadius: '14px',
          overflow: 'hidden',
          border: '1px solid',
          borderColor: alpha(severity.accent, isDark ? 0.42 : 0.24),
          backgroundColor: ui.panelSolid,
          boxShadow: ui.dialogShadow,
          backdropFilter: 'blur(18px)',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 1.25,
            alignItems: 'start',
            px: 1.5,
            py: 1.35,
          }}
        >
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(severity.accent, isDark ? 0.18 : 0.12),
              color: severity.accent,
              mt: 0.1,
            }}
          >
            <Icon fontSize="small" />
          </Box>

          <Stack spacing={0.45} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 800,
                  color: 'text.primary',
                  lineHeight: 1.2,
                }}
              >
                {title}
              </Typography>
              {repeatCount > 1 ? (
                <Chip
                  label={`x${repeatCount}`}
                  size="small"
                  sx={{
                    height: 20,
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    bgcolor: alpha(severity.accent, isDark ? 0.2 : 0.12),
                    color: severity.accent,
                  }}
                />
              ) : null}
            </Stack>

            <Typography
              variant="body2"
              sx={{
                color: alpha(theme.palette.text.primary, isDark ? 0.92 : 0.88),
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}
            >
              {message}
            </Typography>

            {toast.actionLabel && typeof toast.onAction === 'function' ? (
              <Box sx={{ pt: 0.35 }}>
                <Button
                  size="small"
                  onClick={handleActionClick}
                  sx={{
                    px: 0,
                    minWidth: 0,
                    fontWeight: 700,
                    color: severity.accent,
                    '&:hover': {
                      bgcolor: 'transparent',
                      color: alpha(severity.accent, 0.82),
                    },
                  }}
                >
                  {toast.actionLabel}
                </Button>
              </Box>
            ) : null}
          </Stack>

          <IconButton
            size="small"
            onClick={(event) => onClose?.(event, 'closeButton')}
            aria-label="Закрыть уведомление"
            sx={{
              color: alpha(theme.palette.text.secondary, isDark ? 0.88 : 0.72),
              mt: -0.2,
              mr: -0.4,
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>

        {!isPersistent ? (
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, Number(progressValue || 0)))}
            sx={{
              height: 3,
              bgcolor: alpha(severity.accent, isDark ? 0.14 : 0.08),
              '& .MuiLinearProgress-bar': {
                bgcolor: severity.accent,
              },
            }}
          />
        ) : null}
      </Box>
    </Snackbar>
  );
}

export default ToastViewport;
