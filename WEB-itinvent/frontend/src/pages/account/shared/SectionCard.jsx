import { useMemo } from 'react';
import { Box, Divider, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficeHeaderBandSx, getOfficePanelSx } from '../../../theme/officeUiTokens';

export default function SectionCard({ title, description, action, children, sx, headerSx, contentSx }) {

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <Paper
      variant="outlined"
      sx={getOfficePanelSx(ui, {
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxShadow: 'none',
        ...sx,
      })}
    >
      {(title || description || action) ? (
        <>
          <Box
            sx={getOfficeHeaderBandSx(ui, {
              px: 1.35,
              py: 0.95,
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: 'none',
              ...headerSx,
            })}
          >
            <Box sx={{ minWidth: 0 }}>
              {title ? (
                <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
                  {title}
                </Typography>
              ) : null}
              {description ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.2, display: 'block', lineHeight: 1.3 }}>
                  {description}
                </Typography>
              ) : null}
            </Box>
            {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
          </Box>
          <Divider sx={{ borderColor: ui.borderSoft }} />
        </>
      ) : null}
      <Box sx={{ p: 1.25, minHeight: 0, flex: 1, ...contentSx }}>{children}</Box>
    </Paper>
  );
}
