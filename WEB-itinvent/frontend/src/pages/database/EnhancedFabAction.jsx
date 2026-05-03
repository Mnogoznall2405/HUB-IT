import { memo } from 'react';
import { Box, Typography, useTheme } from '@mui/material';

const EnhancedFabAction = memo(function EnhancedFabAction({
  icon,
  label,
  description,
  onClick,
  variant = 'outlined',
  color = 'default',
  loading = false,
  disabled = false,
}) {
  const theme = useTheme();

  const getVariantStyles = () => {
    switch (variant) {
      case 'contained':
        return {
          bgcolor: theme.palette.primary.main,
          color: '#fff',
          '&:hover': {
            bgcolor: theme.palette.primary.dark,
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          },
        };
      case 'gradient':
        return {
          background: `linear-gradient(135deg, ${theme.palette.info.main}, ${theme.palette.info.dark})`,
          color: '#fff',
          '&:hover': {
            background: `linear-gradient(135deg, ${theme.palette.info.dark}, ${theme.palette.info.main})`,
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          },
        };
      default:
        return {
          bgcolor: 'transparent',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          '&:hover': {
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderColor: theme.palette.primary.main,
            transform: 'translateY(-1px)',
          },
        };
    }
  };

  return (
    <Box
      onClick={!disabled && !loading ? onClick : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: 2,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        transition: 'all 0.2s ease-in-out',
        ...getVariantStyles(),
        '&:active': {
          transform: 'scale(0.98)',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          bgcolor: variant === 'outlined'
            ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
            : 'rgba(255,255,255,0.15)',
          color: variant === 'outlined' ? (color === 'primary' ? 'primary.main' : 'inherit') : 'inherit',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          {loading && variant === 'outlined' ? 'Загрузка...' : label}
        </Typography>
        {description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              lineHeight: 1.3,
              mt: 0.2,
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
    </Box>
  );
});

export default EnhancedFabAction;
