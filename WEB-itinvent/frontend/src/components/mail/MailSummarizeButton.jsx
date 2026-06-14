import { Button } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';

export default function MailSummarizeButton({
  tokens,
  loading = false,
  onClick,
  testId = 'mail-preview-summarize',
  size = 'small',
}) {
  return (
    <Button
      data-testid={testId}
      variant="outlined"
      size={size}
      startIcon={<AutoAwesomeOutlinedIcon sx={{ fontSize: size === 'small' ? 15 : 16 }} />}
      disabled={loading}
      onClick={onClick}
      sx={{
        flexShrink: 0,
        textTransform: 'none',
        borderRadius: tokens.radiusSm,
        fontWeight: 600,
        fontSize: size === 'small' ? '0.74rem' : '0.78rem',
        minHeight: size === 'small' ? 28 : 32,
        px: size === 'small' ? 0.85 : 1,
        py: 0.2,
        lineHeight: 1.2,
      }}
    >
      {loading ? '…' : 'Пересказать'}
    </Button>
  );
}
