import {
  Box,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';

export default function MailDedicatedComposeLoadingState({ ui }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const animation = prefersReducedMotion ? false : 'wave';

  return (
    <Box
      data-testid="mail-dedicated-compose-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Открываем редактор письма"
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: ui.panelBg,
        color: 'text.primary',
        p: { xs: 1, sm: 1.5 },
        boxSizing: 'border-box',
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: ui.radiusLg || '12px',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid || ui.panelBg,
          backgroundImage: 'none',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 1.5, py: 1.2, borderBottom: '1px solid', borderColor: ui.borderSoft }}
        >
          <Box
            sx={{
              width: 36,
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              borderRadius: ui.radiusSm || '8px',
              bgcolor: ui.actionBg,
              color: ui.selectedBorder || 'primary.main',
            }}
          >
            <MailOutlineRoundedIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700 }}>
              Открываем редактор письма…
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Загружаем сохранённый черновик
            </Typography>
          </Box>
        </Stack>

        <Stack spacing={0} sx={{ borderBottom: '1px solid', borderColor: ui.borderSoft }}>
          {['32%', '46%', '58%'].map((width, index) => (
            <Stack
              key={width}
              direction="row"
              alignItems="center"
              spacing={1.2}
              sx={{
                minHeight: 44,
                px: 1.5,
                borderBottom: index < 2 ? '1px solid' : 'none',
                borderColor: ui.borderSoft,
              }}
            >
              <Skeleton animation={animation} variant="text" width={44} height={20} />
              <Skeleton animation={animation} variant="text" width={width} height={22} />
            </Stack>
          ))}
        </Stack>

        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: ui.borderSoft }}
        >
          {[34, 34, 34, 76, 92, 34, 34].map((width, index) => (
            <Skeleton
              key={`${width}-${index}`}
              animation={animation}
              variant="rounded"
              width={width}
              height={30}
              sx={{ flexShrink: 0, borderRadius: ui.radiusSm || '8px' }}
            />
          ))}
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, p: { xs: 1.5, sm: 2 } }}>
          <Skeleton animation={animation} variant="text" width="72%" height={24} />
          <Skeleton animation={animation} variant="text" width="88%" height={24} />
          <Skeleton animation={animation} variant="text" width="63%" height={24} />
        </Box>
      </Paper>
    </Box>
  );
}
