import { useState } from 'react';
import MyDevices from './MyDevices';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import GetAppOutlinedIcon from '@mui/icons-material/GetAppOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { formatDateTime } from '../accountUserModel';
import ProfileField from '../shared/ProfileField';
import SectionCard from '../shared/SectionCard';

export default function SecurityTab({
  user,
  trustedDevices,
  loading,
  resettingTwoFactor,
  linkingTrustedDevice,
  linkTrustedDeviceOpen,
  linkTrustedDeviceLabel,
  linkTrustedDeviceError,
  passkeyLinkAvailable,
  onLinkTrustedDeviceLabelChange,
  onOpenLinkTrustedDevice,
  onCloseLinkTrustedDevice,
  onConfirmLinkTrustedDevice,
  onReload,
  onRegenerateBackupCodes,
  onRevokeTrustedDevice,
  onResetTwoFactor,
}) {
  const [revokeDevice, setRevokeDevice] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const twofaPolicyLabel = user?.twofa_policy === 'external_only'
    ? 'Только для внешней сети'
    : user?.twofa_policy === 'all'
      ? 'Для всех входов'
      : 'Отключен';
  const networkZoneLabel = user?.network_zone === 'internal' ? 'Внутренняя сеть' : 'Внешняя сеть';
  const twofaRequestLabel = user?.twofa_required_for_current_request ? 'Да' : 'Нет';
  const activeKeys = trustedDevices.filter(device => device.is_active && !device.is_expired);
  const passkeyUnavailableReason = user?.network_zone === 'internal'
    ? 'Для этого входа определена внутренняя сеть. Действующая политика разрешает привязку passkey только из внешней сети.'
    : 'Этот браузер или приложение не поддерживает привязку passkey. Откройте портал по HTTPS в браузере с поддержкой WebAuthn.';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0 }}>
      <SectionCard
        title="Безопасность входа"
        description="Состояние 2FA, backup-коды и доверенные устройства текущей учётной записи."
        action={(
          <Button size="small" startIcon={<RefreshOutlinedIcon />} onClick={onReload} disabled={loading}>
            Обновить
          </Button>
        )}
        contentSx={{ p: 1.5 }}
      >
        <Grid container spacing={1.25}>
          <Grid item xs={12} sm={6} xl={3}><ProfileField label="2FA" value={user?.is_2fa_enabled ? 'Включен' : 'Не включен'} /></Grid>
          <Grid item xs={12} sm={6} xl={3}><ProfileField label="Политика 2FA" value={twofaPolicyLabel} /></Grid>
          <Grid item xs={12} sm={6} xl={3}><ProfileField label="Текущий вход" value={networkZoneLabel} /></Grid>
          <Grid item xs={12} sm={6} xl={3}><ProfileField label="2FA нужен сейчас" value={twofaRequestLabel} /></Grid>
        </Grid>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>
          <Button variant="contained" startIcon={<GetAppOutlinedIcon />} onClick={onRegenerateBackupCodes}>
            Сгенерировать новые backup-коды
          </Button>
          <Button
            color="error"
            variant="outlined"
            startIcon={resettingTwoFactor ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineOutlinedIcon />}
            onClick={onResetTwoFactor}
            disabled={loading || resettingTwoFactor}
          >
            Сбросить 2FA и доверенные устройства
          </Button>
        </Stack>
      </SectionCard>

      <MyDevices />
      <SectionCard
        title="Ключи входа (passkey)"
        description="Ключ может синхронизироваться между устройствами. Его отзыв отключает вход с этим ключом. Привязка доступна только из внешней сети."
        action={<Chip size="small" label={`Активных ключей: ${activeKeys.length}`} />}
      >
        <Stack spacing={1}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} alignItems={{ lg: 'center' }}>
              <Button
                variant="contained"
                startIcon={linkingTrustedDevice ? <CircularProgress size={16} color="inherit" /> : <AddOutlinedIcon />}
                onClick={onOpenLinkTrustedDevice}
                disabled={loading || linkingTrustedDevice || !passkeyLinkAvailable}
                aria-describedby={!passkeyLinkAvailable ? 'passkey-unavailable-reason' : undefined}
                sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', lg: 'center' } }}
              >
                Привязать это устройство
              </Button>
              <Typography id="passkey-unavailable-reason" variant="body2" color="text.secondary">
                {passkeyLinkAvailable ? 'Добавьте passkey на этом телефоне или ПК для входа без TOTP.' : passkeyUnavailableReason}
              </Typography>
            </Stack>
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Загружаю список устройств...</Typography>
            </Stack>
          ) : activeKeys.length === 0 ? (
            <Alert severity="info">Активных ключей входа нет.</Alert>
          ) : activeKeys.map((device) => (
            <Paper
              key={device.id}
              variant="outlined"
              sx={{ p: 1.25, borderRadius: '6px', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack spacing={0.35}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                  <Typography sx={{ fontWeight: 700 }}>{device.label || 'Доверенное устройство'}</Typography>
                  {device.is_current_device ? <Chip size="small" color="primary" label="Текущее" /> : null}
                  {!device.is_active ? <Chip size="small" label="Отозвано" /> : null}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Создано: {formatDateTime(device.created_at)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Последнее использование: {formatDateTime(device.last_used_at)}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteOutlineOutlinedIcon />}
                  disabled={!device.is_active}
                  onClick={() => setRevokeDevice(device)}
                >
                  Отозвать ключ
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </SectionCard>

      <Dialog open={Boolean(revokeDevice)} onClose={() => { if (!revoking) setRevokeDevice(null); }} fullWidth maxWidth="sm">
        <DialogTitle>Отозвать ключ входа?</DialogTitle>
        <DialogContent><DialogContentText>
          Ключ «{revokeDevice?.label || 'Passkey'}» перестанет работать на всех устройствах, где он используется.
          Запись в менеджере паролей телефона или компьютера нужно удалить вручную.
        </DialogContentText></DialogContent>
        <DialogActions>
          <Button disabled={revoking} onClick={() => setRevokeDevice(null)}>Отмена</Button>
          <Button color="error" disabled={revoking} onClick={async () => {
            setRevoking(true);
            try { await onRevokeTrustedDevice(revokeDevice.id); setRevokeDevice(null); }
            finally { setRevoking(false); }
          }}>Отозвать ключ</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={linkTrustedDeviceOpen} onClose={onCloseLinkTrustedDevice} fullWidth maxWidth="sm">
        <DialogTitle>Привязать это устройство</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <DialogContentText>
              После привязки вход снаружи можно подтверждать отпечатком или системным passkey без ручного ввода TOTP.
            </DialogContentText>
            {linkTrustedDeviceError ? <Alert severity="error">{linkTrustedDeviceError}</Alert> : null}
            <TextField
              label="Название устройства"
              value={linkTrustedDeviceLabel}
              onChange={(event) => onLinkTrustedDeviceLabelChange(event.target.value)}
              fullWidth
              disabled={linkingTrustedDevice}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseLinkTrustedDevice} disabled={linkingTrustedDevice}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={onConfirmLinkTrustedDevice}
            disabled={linkingTrustedDevice}
            startIcon={linkingTrustedDevice ? <CircularProgress size={16} color="inherit" /> : null}
          >
            Привязать
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
