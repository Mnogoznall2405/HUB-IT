import { Avatar, Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

export function getAccountDisplayName(user) {
  return String(user?.full_name || user?.display_name || user?.username || 'Пользователь').trim();
}

export function getAccountSubtitle(user) {
  const jobTitle = String(user?.job_title || '').trim();
  const department = String(user?.department || '').trim();
  const workContext = [jobTitle, department].filter(Boolean).join(' · ');
  return workContext || String(user?.username || '').trim() || 'HUB-IT';
}

export function getAccountInitials(user) {
  const parts = getAccountDisplayName(user).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'H';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function AccountAvatar({ user, size = 42 }) {
  const theme = useTheme();
  return (
    <Avatar
      src={String(user?.avatar_url || '').trim() || undefined}
      alt={getAccountDisplayName(user)}
      sx={{
        width: size,
        height: size,
        bgcolor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        fontSize: size * 0.34,
        fontWeight: 900,
        boxShadow: `0 8px 22px ${alpha(theme.palette.primary.main, 0.22)}`,
      }}
    >
      {getAccountInitials(user)}
    </Avatar>
  );
}

export function AccountIdentity({ user }) {
  return (
    <Stack direction="row" spacing={1.1} alignItems="center" sx={{ minWidth: 0 }}>
      <AccountAvatar user={user} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 850, lineHeight: 1.15 }} noWrap>
          {getAccountDisplayName(user)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }} noWrap>
          {getAccountSubtitle(user)}
        </Typography>
      </Box>
    </Stack>
  );
}
