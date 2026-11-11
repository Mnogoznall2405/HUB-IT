import { useMemo } from 'react';
import { Box, Chip } from '@mui/material';

import {
  PHOTO_REJECT_REASON_PRESETS,
  appendRejectReason,
  loadRecentRejectReasons,
} from './photoRejectReasons';

// Быстрые причины отказа: клик добавляет текст в поле, дальше его можно править.
export default function RejectReasonChips({ value, onChange, disabled = false }) {
  const recent = useMemo(() => loadRecentRejectReasons(), []);
  const reasons = [...PHOTO_REJECT_REASON_PRESETS, ...recent];
  return (
    <Box
      data-testid="photo-reject-reason-chips"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}
    >
      {reasons.map((reason) => (
        <Chip
          key={reason}
          size="small"
          variant="outlined"
          label={reason}
          disabled={disabled}
          onClick={() => onChange(appendRejectReason(value, reason))}
        />
      ))}
    </Box>
  );
}
