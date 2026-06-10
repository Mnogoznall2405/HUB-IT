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
}) {
  const theme = useTheme();
  const remainingLabel = formatUnlockRemainingLabel(unlockedRemainingMs);
  const progress = isUnlocked
    ? Math.max(0, Math.min(100, (unlockedRemainingMs / (5 * 60 * 1000)) * 100))
    : 0;

  if (isUnlocked) {
    return (
      <Alert
        severity={isUnlockExpiringSoon ? 'warning' : 'success'}
        icon={<LockOpenOutlinedIcon fontSize="inherit" />}
        sx={{ flexShrink: 0, borderRadius: 0.5 }}
        data-testid="password-unlock-banner"
      >
        <Stack spacing={0.75}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle2" fontWeight={800}>
                {isUnlockExpiringSoon ? 'Сессия разблокировки скоро истечёт' : 'Раскрытие паролей разблокировано'}
              </Typography>
              <Typography variant="body2">
                {remainingLabel
                  ? `Осталось ${remainingLabel}`
                  : `До ${formatDateTime(unlockedUntil)}`}
              </Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={onUnlockClick}>
              Продлить 2FA
            </Button>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 6,
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
      sx={{ flexShrink: 0, borderRadius: 0.5 }}
      data-testid="password-unlock-banner"
      action={(
        <Button
          color="inherit"
          size="small"
          variant="outlined"
          onClick={onUnlockClick}
          data-testid="password-unlock-open"
        >
          Разблокировать
        </Button>
      )}
    >
      <Typography variant="subtitle2" fontWeight={800}>
        Раскрытие и копирование паролей заблокированы
      </Typography>
      <Typography variant="body2">
        Подтвердите 2FA один раз — дальше можно копировать пароли в течение 5 минут.
      </Typography>
    </Alert>
  );
}
