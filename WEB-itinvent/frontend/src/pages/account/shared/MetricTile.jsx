import { useMemo } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficeMetricBlockSx } from '../../../theme/officeUiTokens';

export default function MetricTile({ icon, label, value, caption, compact = false }) {

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <Paper
      variant="outlined"
      sx={getOfficeMetricBlockSx(ui, theme.palette.primary.main, {
        p: compact ? 0.78 : 1.1,
        borderRadius: '10px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0.16 : 0.3,
        justifyContent: 'space-between',
        borderColor: ui.borderSoft,
        boxShadow: 'none',
      })}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={0.75}>
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontSize: compact ? '0.64rem' : undefined,
            lineHeight: 1.15,
          }}
        >
          {label}
        </Typography>
        <Box sx={{ color: 'primary.main', display: 'flex', '& .MuiSvgIcon-root': { fontSize: compact ? 16 : 18 } }}>{icon}</Box>
      </Stack>
      <Typography
        variant={compact ? 'subtitle1' : 'h5'}
        sx={{
          fontWeight: 800,
          lineHeight: 1,
          mt: compact ? 0.04 : 0,
        }}
      >
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontSize: compact ? '0.64rem' : undefined,
          lineHeight: 1.1,
        }}
      >
        {caption}
      </Typography>
    </Paper>
  );
}
