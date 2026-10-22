import { useState } from 'react';
import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { useNavigate } from 'react-router-dom';
import { dismissAboutPromo, isAboutPromoDismissed } from '../../lib/aboutPromo';

export default function AboutHubPromoCard({ userId }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => isAboutPromoDismissed(userId));

  if (dismissed) return null;

  const close = () => {
    dismissAboutPromo(userId);
    setDismissed(true);
  };

  const open = () => {
    dismissAboutPromo(userId);
    navigate('/settings/about');
  };

  return (
    <Paper
      data-testid="about-hub-promo"
      sx={{
        p: { xs: 1.1, sm: 1.3 },
        borderRadius: { xs: '16px', sm: '19px' },
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.35),
        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
        boxShadow: 'none',
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <AutoAwesomeOutlinedIcon color="primary" sx={{ flexShrink: 0 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 800, lineHeight: 1.25 }}>Что умеет HUB</Typography>
          <Typography variant="body2" color="text.secondary">
            Чаты, задачи, почта, файлы, приложения для Windows и Android — за пару минут.
          </Typography>
        </Box>
        <Button variant="contained" size="small" onClick={open} sx={{ flexShrink: 0 }}>
          Посмотреть
        </Button>
        <IconButton size="small" onClick={close} aria-label="Скрыть подсказку «Что умеет HUB»">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  );
}
