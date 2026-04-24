import {
  Box,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { keyframes } from '@mui/system';

const progressSweep = keyframes`
  0% { transform: translateX(-100%); opacity: 0.35; }
  45% { opacity: 0.85; }
  100% { transform: translateX(240%); opacity: 0.2; }
`;

function LoadingRailBlock({ ui, animation = 'wave' }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: ui.panelBg,
        borderColor: ui.borderSoft,
      }}
    >
      <Box sx={{ px: 1.25, py: 1, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        <Skeleton animation={animation} variant="text" width="58%" height={24} />
        <Skeleton animation={animation} variant="text" width="82%" height={18} />
      </Box>
      <Stack spacing={0.65} sx={{ p: 1 }}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton
            key={index}
            animation={animation}
            variant="rounded"
            height={compactHeights[index] || 34}
            sx={{ borderRadius: '10px', bgcolor: index % 2 === 0 ? alpha(ui.panelSolid, 0.92) : alpha(ui.actionBg, 0.88) }}
          />
        ))}
      </Stack>
    </Paper>
  );
}

const compactHeights = [34, 34, 34, 30, 30, 30];

function LoadingListBlock({ ui, mobile = false, animation = 'wave' }) {
  const rows = mobile ? 5 : 6;
  return (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: ui.panelBg,
        borderColor: ui.borderSoft,
      }}
    >
      <Box sx={{ px: { xs: 1.1, md: 1.45 }, py: { xs: 0.95, md: 1.05 }, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        <Stack direction="row" spacing={0.8} alignItems="center">
          <Skeleton animation={animation} variant="text" width={mobile ? '48%' : '36%'} height={26} />
          <Skeleton animation={animation} variant="rounded" width={38} height={24} sx={{ borderRadius: '999px' }} />
        </Stack>
        <Stack direction="row" spacing={0.6} sx={{ mt: 0.45 }}>
          <Skeleton animation={animation} variant="rounded" width={84} height={22} sx={{ borderRadius: '999px' }} />
          {!mobile ? <Skeleton animation={animation} variant="rounded" width={118} height={22} sx={{ borderRadius: '999px' }} /> : null}
        </Stack>
      </Box>
      <Stack spacing={0} sx={{ flex: 1, minHeight: 0 }}>
        {Array.from({ length: rows }).map((_, index) => (
          <Box
            key={index}
            sx={{
              px: { xs: 1.05, md: 1.35 },
              py: mobile ? 1 : 1.15,
              borderBottom: '1px solid',
              borderColor: ui.borderSoft,
              bgcolor: index % 2 === 0 ? 'transparent' : alpha(ui.actionBg, 0.46),
            }}
          >
            <Stack direction="row" spacing={1.1} alignItems="flex-start">
              <Skeleton
                animation={animation}
                variant="circular"
                width={mobile ? 34 : 38}
                height={mobile ? 34 : 38}
                sx={{ flexShrink: 0 }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Skeleton animation={animation} variant="text" width="34%" height={20} />
                  <Skeleton animation={animation} variant="text" width={52} height={18} />
                </Stack>
                <Skeleton animation={animation} variant="text" width={index % 2 === 0 ? '74%' : '62%'} height={24} />
                <Skeleton animation={animation} variant="text" width={index % 2 === 0 ? '88%' : '78%'} height={18} />
                {index % 2 === 0 ? (
                  <Skeleton animation={animation} variant="rounded" width={78} height={20} sx={{ mt: 0.65, borderRadius: '999px' }} />
                ) : null}
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

function LoadingPreviewBlock({ ui, animation = 'wave' }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: ui.panelBg,
        borderColor: ui.borderSoft,
      }}
    >
      <Box sx={{ px: 1.5, py: 1.2, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        <Skeleton animation={animation} variant="text" width="52%" height={28} />
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <Skeleton animation={animation} variant="text" width={110} height={18} />
          <Skeleton animation={animation} variant="text" width={84} height={18} />
        </Stack>
      </Box>
      <Box sx={{ p: { xs: 1.5, md: 2 }, flex: 1, minHeight: 0 }}>
        <Skeleton animation={animation} variant="rounded" height={120} sx={{ borderRadius: '16px', mb: 1.2 }} />
        <Skeleton animation={animation} variant="text" width="86%" height={22} />
        <Skeleton animation={animation} variant="text" width="92%" height={22} />
        <Skeleton animation={animation} variant="text" width="72%" height={22} />
        <Skeleton animation={animation} variant="rounded" height={180} sx={{ mt: 1.1, borderRadius: '14px' }} />
      </Box>
    </Paper>
  );
}

export default function MailInitialLoadingState({ ui }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isMobile = useMediaQuery('(max-width:599.95px)');
  const animation = prefersReducedMotion ? false : 'wave';

  return (
    <Box
      data-testid="mail-initial-loading"
      aria-busy="true"
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        overflow: 'hidden',
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelBg,
          px: { xs: 1.4, md: 1.8 },
          py: { xs: 1.2, md: 1.45 },
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            '&::after': prefersReducedMotion ? undefined : {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '36%',
              height: 3,
              borderRadius: '0 0 999px 999px',
              background: `linear-gradient(90deg, ${alpha('#ffffff', 0)}, ${alpha(ui.selectedBorder || '#1976d2', 0.92)}, ${alpha('#ffffff', 0)})`,
              animation: `${progressSweep} 1.9s ease-in-out infinite`,
            },
          }}
        />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
          <Stack spacing={0.6} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.85} alignItems="center">
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '11px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(ui.selectedBorder || '#1976d2', 0.12),
                  color: ui.selectedBorder || 'primary.main',
                }}
              >
                <MailOutlineIcon fontSize="small" />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Загружаем письма
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Подключаем ящик и получаем первые сообщения.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label="Подключаем ящик" />
            <Chip size="small" variant="outlined" label="Загружаем папки" />
            <Chip size="small" variant="outlined" label="Получаем письма" />
          </Stack>
        </Stack>
      </Paper>

      {isMobile ? (
        <LoadingListBlock ui={ui} mobile animation={animation} />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 1.2,
            gridTemplateColumns: { xs: '1fr', md: '220px minmax(300px, 360px) 1fr' },
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <LoadingRailBlock ui={ui} animation={animation} />
          <LoadingListBlock ui={ui} animation={animation} />
          <LoadingPreviewBlock ui={ui} animation={animation} />
        </Box>
      )}
    </Box>
  );
}
