import { memo } from 'react';
import { Box, Chip, Typography } from '@mui/material';

const UploadActInvNoChips = memo(function UploadActInvNoChips({ values, sx = {} }) {
  if (!Array.isArray(values) || values.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Не указано
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', ...sx }}>
      {values.map((invNo) => (
        <Chip
          key={String(invNo)}
          size="small"
          label={String(invNo)}
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      ))}
    </Box>
  );
});

export default UploadActInvNoChips;
