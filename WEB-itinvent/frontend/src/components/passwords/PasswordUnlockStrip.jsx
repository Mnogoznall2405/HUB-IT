import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import { formatUnlockRemainingLabel } from './passwordVaultUtils';

export default function PasswordUnlockStrip({
  isUnlocked,
  isUnlockExpiringSoon,
  unlockedRemainingMs,
  onUnlockClick,
}) {
  const theme = useTheme();
  const remainingLabel = formatUnlockRemainingLabel(unlockedRemainingMs);
  const progress = isUnlocked
    ? Math.max(0, Math.min(100, (unlockedRemainingMs / (5 * 60 * 1000)) * 100))
    : 0;

  const statusColor = !isUnlocked
    ? theme.palette.info.main
    : isUnlockExpiringSoon
      ? theme.palette.warning.main
      : theme.palette.success.main;

  const statusText = !isUnlocked
    ? 'Заблокировано'
    : remainingLabel
      ? `Открыто ${remainingLabel}`
      : 'Открыто';

  return (
    <Box
      component="button"
      type="button"
      onClick={onUnlockClick}
      data-testid="password-unlock-banner"
      sx={{
        flexShrink: 0,
        width: '100%',
        border: `1px solid ${alpha(statusColor, 0.35)}`,
        borderRadius: 0.5,
        bgcolor: alpha(statusColor, theme.palette.mode === 'dark' ? 0.14 : 0.08),
        px: 1.25,
        py: 0.75,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: statusColor,
              flexShrink: 0,
            }}
          />
          <LockOpenOutlinedIcon sx={{ fontSize: 16, color: statusColor }} />
          <Typography variant="caption" fontWeight={700} sx={{ color: 'text.primary' }}>
            {statusText}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            2FA
          </Typography>
        </Stack>
        {isUnlocked ? (
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 3,
              borderRadius: 999,
              bgcolor: alpha(theme.palette.common.black, 0.08),
              '& .MuiLinearProgress-bar': { bgcolor: statusColor },
            }}
          />
        ) : null}
      </Stack>
    </Box>
  );
}
