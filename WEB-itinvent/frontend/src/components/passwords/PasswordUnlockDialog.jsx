import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

function UnlockForm({
  unlockCode,
  unlocking,
  onCodeChange,
  onSubmit,
  onClose,
  compact = false,
}) {
  return (
    <Stack spacing={compact ? 1.25 : 1.5}>
      <Typography variant="body2" color="text.secondary">
        TOTP или резервный код · доступ на 5 мин
      </Typography>
      <TextField
        size="small"
        autoFocus
        fullWidth
        placeholder="Код 2FA"
        value={unlockCode}
        onChange={onCodeChange}
        inputProps={{
          'data-testid': 'password-unlock-code',
          inputMode: 'numeric',
          autoComplete: 'one-time-code',
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button size="small" onClick={onClose}>
          Отмена
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={onSubmit}
          disabled={!unlockCode.trim() || unlocking}
          data-testid="password-unlock-submit"
        >
          {unlocking ? 'Проверка…' : 'Разблокировать'}
        </Button>
      </Stack>
    </Stack>
  );
}

export default function PasswordUnlockDialog({
  open = false,
  isMobile = false,
  unlockCode = '',
  unlocking = false,
  onClose,
  onCodeChange,
  onSubmit,
}) {
  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            px: 2,
            pt: 1.5,
            pb: 2.5,
          },
        }}
        data-testid="password-unlock-dialog"
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={800}>
            Разблокировка 2FA
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Закрыть">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <UnlockForm
          unlockCode={unlockCode}
          unlocking={unlocking}
          onCodeChange={onCodeChange}
          onSubmit={onSubmit}
          onClose={onClose}
          compact
        />
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      data-testid="password-unlock-dialog"
      PaperProps={{ sx: { borderRadius: 1 } }}
    >
      <DialogTitle sx={{ pb: 1, pt: 2, px: 2.5, fontSize: '1.05rem', fontWeight: 800 }}>
        Разблокировка 2FA
      </DialogTitle>
      <DialogContent sx={{ px: 2.5, pt: 0, pb: 2 }}>
        <UnlockForm
          unlockCode={unlockCode}
          unlocking={unlocking}
          onCodeChange={onCodeChange}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
