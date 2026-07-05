import { Button } from '@mui/material';

export default function MailMobileBottomActionButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  tokens,
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      sx={{
        minWidth: 0,
        width: tokens.bulkActionSize,
        height: 56,
        px: 0.25,
        py: 0.5,
        borderRadius: tokens.radiusMd,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        color: danger
          ? (tokens.isDark ? '#fecaca' : '#b91c1c')
          : tokens.textPrimary,
        bgcolor: 'transparent',
        textTransform: 'none',
        fontWeight: 800,
        fontSize: '0.68rem',
        lineHeight: 1.1,
        transition: tokens.transition,
        '& .MuiButton-startIcon': {
          m: 0,
          '& svg': { fontSize: 22 },
        },
        '&:hover': {
          bgcolor: danger
            ? 'rgba(239, 68, 68, 0.10)'
            : tokens.actionHover,
        },
        '&:active': {
          transform: 'scale(0.98)',
        },
        '&.Mui-disabled': {
          opacity: 0.42,
        },
      }}
      startIcon={icon}
    >
      {label}
    </Button>
  );
}
