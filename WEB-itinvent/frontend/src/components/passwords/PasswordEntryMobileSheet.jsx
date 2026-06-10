import React from 'react';
import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { hideScrollbarSx } from '../../lib/hideScrollbarSx';
import PasswordEntryDetail from './PasswordEntryDetail';

export default function PasswordEntryMobileSheet({
  open = false,
  entry,
  revealed = '',
  revealBusy = false,
  canWrite = false,
  onClose,
  onCopyPassword,
  onCopyLogin,
  onShow,
  onHide,
  onEdit,
  onArchive,
}) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          maxHeight: '88vh',
          overflowY: 'auto',
          ...hideScrollbarSx,
        },
      }}
      data-testid="password-entry-mobile-sheet"
    >
      <Box sx={{ px: 2, pt: 1.5, pb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={800}>
            Запись
          </Typography>
          <IconButton aria-label="Закрыть" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>
        <PasswordEntryDetail
          entry={entry}
          revealed={revealed}
          revealBusy={revealBusy}
          canWrite={canWrite}
          compact
          onCopyPassword={onCopyPassword}
          onCopyLogin={onCopyLogin}
          onShow={onShow}
          onHide={onHide}
          onEdit={onEdit}
          onArchive={onArchive}
        />
      </Box>
    </Drawer>
  );
}
