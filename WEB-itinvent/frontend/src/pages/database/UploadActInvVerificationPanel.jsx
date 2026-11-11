import { memo } from 'react';
import { Alert, Box, Checkbox, FormControlLabel, Typography } from '@mui/material';

import UploadActInvNoChips from './UploadActInvNoChips';

const EMPTY_LIST = [];

const UploadActInvVerificationPanel = memo(function UploadActInvVerificationPanel({
  verification,
  verified = false,
  onVerifiedChange,
}) {
  const recognizedInvNos = verification?.recognizedInvNos || EMPTY_LIST;
  const finalInvNos = verification?.finalInvNos || EMPTY_LIST;
  const onlyRecognizedInvNos = verification?.onlyRecognizedInvNos || EMPTY_LIST;
  const onlyFinalInvNos = verification?.onlyFinalInvNos || EMPTY_LIST;

  return (
    <Alert severity={verification?.severity || 'info'} variant="outlined" sx={{ alignItems: 'flex-start' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
        Проверка инвентарных номеров
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {verification?.headline || 'Проверьте инвентарные номера перед записью акта.'}
      </Typography>
      <Box sx={{ display: 'grid', gap: 1.25 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Найдено API
          </Typography>
          <UploadActInvNoChips values={recognizedInvNos} />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Будет записано в акт
          </Typography>
          <UploadActInvNoChips values={finalInvNos} />
        </Box>
        {onlyRecognizedInvNos.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Не попадут в запись
            </Typography>
            <UploadActInvNoChips values={onlyRecognizedInvNos} />
          </Box>
        )}
        {onlyFinalInvNos.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Добавлены или изменены вручную
            </Typography>
            <UploadActInvNoChips values={onlyFinalInvNos} />
          </Box>
        )}
        <FormControlLabel
          sx={{ mt: 0.25 }}
          control={(
            <Checkbox
              checked={verified}
              onChange={(event) => onVerifiedChange?.(Boolean(event.target.checked))}
            />
          )}
          label="Я проверил инвентарные номера по PDF перед записью акта"
        />
      </Box>
    </Alert>
  );
});

export default UploadActInvVerificationPanel;
