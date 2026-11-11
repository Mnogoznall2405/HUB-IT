import { Box, Typography } from '@mui/material';

export default function ProfileField({ label, value }) {

  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ mt: 0.35, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}
