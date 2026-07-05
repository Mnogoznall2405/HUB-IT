import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FingerprintOutlinedIcon from '@mui/icons-material/FingerprintOutlined';
import { alignOtpAuthAccountName } from '../../lib/totpProvisioning';

function UnlockVerifyForm({
  unlockCode,
  unlocking,
  passkeyAvailable = false,
  onCodeChange,
  onSubmit,
  onPasskeyUnlock,
  onClose,
  compact = false,
}) {
  return (
    <Stack spacing={compact ? 1.25 : 1.5}>
      <Typography variant="body2" color="text.secondary">
        TOTP или резервный код · доступ на 5 мин
      </Typography>
      {passkeyAvailable ? (
        <>
          <Button
            variant="outlined"
            fullWidth
            startIcon={<FingerprintOutlinedIcon />}
            onClick={onPasskeyUnlock}
            disabled={unlocking}
            data-testid="password-unlock-passkey"
          >
            {unlocking ? 'Проверка…' : 'Подтвердить passkey'}
          </Button>
          <Divider>
            <Typography variant="caption" color="text.secondary">
              или код 2FA
            </Typography>
          </Divider>
        </>
      ) : null}
      <TextField
        size="small"
        autoFocus={!passkeyAvailable}
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

function UnlockSetupForm({
  accountName = '',
  setupData,
  setupLoading = false,
  setupCode = '',
  unlocking = false,
  onSetupCodeChange,
  onSubmit,
  onReloadSetup,
  onClose,
  compact = false,
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    const otpauthUri = String(setupData?.otpauth_uri || '').trim();
    if (!otpauthUri) {
      setQrDataUrl('');
      return () => {
        cancelled = true;
      };
    }

    const alignedUri = alignOtpAuthAccountName(otpauthUri, accountName);
    QRCode.toDataURL(alignedUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(String(dataUrl || ''));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountName, setupData?.otpauth_uri]);

  const manualKey = String(setupData?.manual_entry_key || '').trim();

  if (setupLoading) {
    return (
      <Stack spacing={1.5} alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          Готовим QR-код для настройки 2FA…
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={compact ? 1.25 : 1.5}>
      <Alert severity="info" sx={{ py: 0.5 }}>
        Для доступа к паролям сначала подключите 2FA. Отсканируйте QR-код в приложении кодов и введите 6-значный код.
      </Alert>
      {qrDataUrl ? (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Box
            component="img"
            src={qrDataUrl}
            alt="QR-код для настройки 2FA"
            data-testid="password-unlock-setup-qr"
            sx={{
              width: '100%',
              maxWidth: 220,
              borderRadius: 1,
              bgcolor: 'common.white',
              p: 1,
            }}
          />
        </Box>
      ) : (
        <Alert severity="warning">QR-код недоступен. Используйте ручной ключ ниже.</Alert>
      )}
      {manualKey ? (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Ручной ключ
          </Typography>
          <Typography
            variant="body2"
            component="code"
            data-testid="password-unlock-setup-manual-key"
            sx={{
              display: 'block',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
              bgcolor: 'action.hover',
              borderRadius: 1,
              px: 1,
              py: 0.75,
            }}
          >
            {manualKey}
          </Typography>
        </Box>
      ) : null}
      <TextField
        size="small"
        autoFocus
        fullWidth
        label="Код из приложения"
        placeholder="6 цифр"
        value={setupCode}
        onChange={onSetupCodeChange}
        inputProps={{
          'data-testid': 'password-unlock-setup-code',
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
      <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
        <Button size="small" onClick={onClose}>
          Отмена
        </Button>
        {onReloadSetup ? (
          <Button size="small" onClick={onReloadSetup} disabled={unlocking}>
            Обновить QR
          </Button>
        ) : null}
        <Button
          size="small"
          variant="contained"
          onClick={onSubmit}
          disabled={setupCode.trim().length < 6 || unlocking || !setupData?.setup_challenge_id}
          data-testid="password-unlock-setup-submit"
        >
          {unlocking ? 'Проверка…' : 'Подключить 2FA и разблокировать'}
        </Button>
      </Stack>
    </Stack>
  );
}

export default function PasswordUnlockDialog({
  open = false,
  isMobile = false,
  mode = 'verify',
  unlockCode = '',
  setupCode = '',
  setupData = null,
  setupLoading = false,
  accountName = '',
  unlocking = false,
  passkeyAvailable = false,
  onClose,
  onCodeChange,
  onSetupCodeChange,
  onSubmit,
  onSetupSubmit,
  onReloadSetup,
  onPasskeyUnlock,
}) {
  const isSetupMode = mode === 'setup';
  const title = isSetupMode ? 'Подключение 2FA' : 'Разблокировка 2FA';

  const form = isSetupMode ? (
    <UnlockSetupForm
      accountName={accountName}
      setupData={setupData}
      setupLoading={setupLoading}
      setupCode={setupCode}
      unlocking={unlocking}
      onSetupCodeChange={onSetupCodeChange}
      onSubmit={onSetupSubmit}
      onReloadSetup={onReloadSetup}
      onClose={onClose}
      compact={isMobile}
    />
  ) : (
    <UnlockVerifyForm
      unlockCode={unlockCode}
      unlocking={unlocking}
      passkeyAvailable={passkeyAvailable}
      onCodeChange={onCodeChange}
      onSubmit={onSubmit}
      onPasskeyUnlock={onPasskeyUnlock}
      onClose={onClose}
      compact={isMobile}
    />
  );

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
            {title}
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Закрыть">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        {form}
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
        {title}
      </DialogTitle>
      <DialogContent sx={{ px: 2.5, pt: 0, pb: 2 }}>
        {form}
      </DialogContent>
    </Dialog>
  );
}
