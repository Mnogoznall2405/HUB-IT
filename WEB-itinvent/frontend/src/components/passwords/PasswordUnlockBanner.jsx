import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import { formatDateTime, formatUnlockRemainingLabel } from './passwordVaultUtils';

export default function PasswordUnlockBanner({
  isUnlocked,
  isUnlockExpiringSoon,
  unlockedRemainingMs,
  unlockedUntil,
  onUnlockClick,
  requiresSetup = false,
  compact = false,
}) {
  const theme = useTheme();
  const remainingLabel = formatUnlockRemainingLabel(unlockedRemainingMs);
  const progress = isUnlocked
    ? Math.max(0, Math.min(100, (unlockedRemainingMs / (5 * 60 * 1000)) * 100))
    : 0;

  const alertSx = compact
    ? { flexShrink: 0, borderRadius: 0.5, py: 0, '& .MuiAlert-message': { py: 0.5 } }
    : { flexShrink: 0, borderRadius: 0.5 };

  if (isUnlocked) {
    return (
      <Alert
        severity={isUnlockExpiringSoon ? 'warning' : 'success'}
        icon={<LockOpenOutlinedIcon fontSize="inherit" />}
        sx={alertSx}
        data-testid="password-unlock-banner"
      >
        <Stack spacing={compact ? 0.5 : 0.75}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant={compact ? 'body2' : 'subtitle2'} fontWeight={800}>
                {isUnlockExpiringSoon ? 'Сессия разблокировки скоро истечёт' : 'Раскрытие паролей разблокировано'}
                {compact && remainingLabel ? (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    · осталось {remainingLabel}
                  </Typography>
                ) : null}
              </Typography>
              {!compact ? (
                <Typography variant="body2">
                  {remainingLabel
                    ? `Осталось ${remainingLabel}`
                    : `До ${formatDateTime(unlockedUntil)}`}
                </Typography>
              ) : null}
            </Box>
            <Button size="small" variant="outlined" onClick={onUnlockClick} sx={{ flexShrink: 0 }}>
              Продлить 2FA
            </Button>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: compact ? 4 : 6,
              borderRadius: 999,
              bgcolor: alpha(theme.palette.common.black, 0.08),
            }}
          />
        </Stack>
      </Alert>
    );
  }

  return (
    <Alert
      severity="info"
      icon={<LockOpenOutlinedIcon fontSize="inherit" />}
      sx={alertSx}
      data-testid="password-unlock-banner"
      action={(
        <Button
          color="inherit"
          size="small"
          variant="outlined"
          onClick={onUnlockClick}
          data-testid="password-unlock-open"
          sx={{ flexShrink: 0 }}
        >
          Разблокировать
        </Button>
      )}
    >
      <Typography variant={compact ? 'body2' : 'subtitle2'} fontWeight={800} component="span">
        Раскрытие и копирование паролей заблокированы
      </Typography>
      <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: compact ? 0.75 : 0, display: compact ? 'inline' : 'block', mt: compact ? 0 : 0.25 }}>
        {compact ? '· ' : ''}
        {requiresSetup
          ? 'Сначала подключите 2FA по QR-коду — затем можно копировать пароли 5 минут.'
          : 'Подтвердите 2FA — дальше можно копировать пароли 5 минут.'}
      </Typography>
    </Alert>
  );
}
