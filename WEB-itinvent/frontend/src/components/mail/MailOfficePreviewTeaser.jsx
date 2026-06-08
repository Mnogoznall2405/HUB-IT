import { useState } from 'react';
import { Box, Button } from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';

export default function MailOfficePreviewTeaser({
  children,
  onOpenFull,
  compact = true,
  alwaysShowAction = false,
}) {
  const [hovered, setHovered] = useState(false);
  const actionVisible = alwaysShowAction || hovered;

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      sx={{
        position: 'relative',
        borderRadius: '8px',
        overflow: 'hidden',
        bgcolor: '#f8fafc',
      }}
    >
      <Box
        sx={{
          pointerEvents: actionVisible && !alwaysShowAction ? 'none' : 'auto',
          maxHeight: compact ? 280 : 'none',
          overflow: 'hidden',
        }}
      >
        {children}
      </Box>

      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: actionVisible
            ? (alwaysShowAction && !hovered ? 'rgba(15, 23, 42, 0.18)' : 'rgba(15, 23, 42, 0.42)')
            : 'transparent',
          opacity: actionVisible ? 1 : 0,
          transition: 'opacity 160ms ease, background-color 160ms ease',
          pointerEvents: actionVisible ? 'auto' : 'none',
        }}
      >
        <Button
          variant="contained"
          startIcon={<VisibilityOutlinedIcon />}
          onClick={onOpenFull}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: '999px',
            px: 2.2,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.24)',
          }}
        >
          Просмотреть
        </Button>
      </Box>
    </Box>
  );
}
