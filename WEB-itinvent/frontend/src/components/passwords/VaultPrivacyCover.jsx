import { createPortal } from 'react-dom';
import { Box, Typography } from '@mui/material';

// Затемнение экрана, пока вкладка неактивна: пароли в это время скрыты.
export default function VaultPrivacyCover({ active }) {
  if (!active) return null;
  return createPortal(
    <Box
      className="vault-blur-overlay"
      data-testid="vault-blur-overlay"
      role="status"
    >
      <Typography variant="h6" fontWeight={800}>Скрыто</Typography>
      <Typography variant="body2">Вернитесь на вкладку, чтобы продолжить работу с паролями.</Typography>
    </Box>,
    document.body,
  );
}
