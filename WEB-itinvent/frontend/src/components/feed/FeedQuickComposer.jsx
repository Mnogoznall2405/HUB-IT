import { Avatar, Box, Button, ButtonBase, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { getFeedInitials } from './feedUtils';

export default function FeedQuickComposer({ user, onCreate }) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  const authorName = user?.full_name || user?.username || 'Пользователь';

  return (
    <Paper
      component="section"
      aria-label="Создание публикации"
      elevation={0}
      sx={{
        px: { xs: 1.5, sm: 2 },
        py: 1.5,
        borderRadius: { xs: 0, sm: '14px' },
        bgcolor: ui.panelSolid,
        boxShadow: 'none',
        border: 0,
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Avatar
          aria-hidden="true"
          sx={{
            width: 40,
            height: 40,
            bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.24 : 0.12),
            color: 'primary.main',
            fontSize: 13,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {getFeedInitials(authorName)}
        </Avatar>
        <ButtonBase
          onClick={onCreate}
          aria-label="Что происходит в компании? Создать публикацию"
          focusRipple
          sx={{
            minWidth: 0,
            minHeight: 44,
            flex: 1,
            justifyContent: 'flex-start',
            px: 1.4,
            borderRadius: '10px',
            bgcolor: ui.panelBg,
            color: 'text.secondary',
            textAlign: 'start',
            transition: 'background-color 120ms ease-out',
            '&:hover': { bgcolor: ui.actionHover },
            '&:focus-visible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          }}
        >
          <Typography sx={{ fontSize: { xs: '1rem', sm: '1.08rem' }, fontWeight: 400, color: 'text.secondary' }}>
            Что у вас нового?
          </Typography>
        </ButtonBase>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon sx={{ display: { xs: 'block', sm: 'none' } }} />}
          onClick={onCreate}
          aria-label="Создать публикацию"
          sx={{
            minHeight: 40,
            minWidth: { xs: 40, sm: 0 },
            px: { xs: 1.25, sm: 2 },
            borderRadius: '10px',
            boxShadow: 'none',
            textTransform: 'none',
            fontWeight: 800,
            '& .MuiButton-startIcon': { m: 0 },
            '@media (prefers-reduced-motion: no-preference)': {
              transition: 'transform 120ms ease-out, background-color 120ms ease-out',
              '&:active': { transform: 'scale(0.96)' },
            },
            '&:hover': { boxShadow: 'none' },
          }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Создать запись</Box>
        </Button>
      </Stack>
    </Paper>
  );
}
