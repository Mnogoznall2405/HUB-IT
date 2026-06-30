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

  const twofaPolicyLabel = user?.twofa_policy === 'external_only'
    ? 'Только для внешней сети'
    : user?.twofa_policy === 'all'
      ? 'Для всех входов'
      : 'Отключен';
  const networkZoneLabel = user?.network_zone === 'internal' ? 'Внутренняя сеть' : 'Внешняя сеть';
  const twofaRequestLabel = user?.twofa_required_for_current_request ? 'Да' : 'Нет';

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
          <Grid item xs={12} md={3}><ProfileField label="2FA" value={user?.is_2fa_enabled ? 'Включен' : 'Не включен'} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="Политика 2FA" value={twofaPolicyLabel} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="Текущий вход" value={networkZoneLabel} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="2FA нужен сейчас" value={twofaRequestLabel} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="Доверенные устройства" value={String(user?.trusted_devices_count || 0)} /></Grid>
        </Grid>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
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

      <SectionCard
        title="Доверенные устройства"
        description="Эти устройства могут подтверждать вход через WebAuthn без ручного ввода TOTP-кода. Привязка доступна только при входе из внешней сети."
      >
        <Stack spacing={1}>
          {passkeyLinkAvailable ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Button
                variant="contained"
                startIcon={linkingTrustedDevice ? <CircularProgress size={16} color="inherit" /> : <AddOutlinedIcon />}
                onClick={onOpenLinkTrustedDevice}
                disabled={loading || linkingTrustedDevice}
              >
                Привязать это устройство
              </Button>
              <Typography variant="body2" color="text.secondary">
                Добавьте passkey на этом телефоне или ПК для входа без TOTP.
              </Typography>
            </Stack>
          ) : null}
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Загружаю список устройств...</Typography>
            </Stack>
          ) : trustedDevices.length === 0 ? (
            <Alert severity="info">Доверенные устройства пока не зарегистрированы.</Alert>
          ) : trustedDevices.map((device) => (
            <Paper
              key={device.id}
              variant="outlined"
              sx={{ p: 1.25, borderRadius: 2, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}
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
                  onClick={() => onRevokeTrustedDevice(device.id)}
                >
                  Отозвать
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </SectionCard>

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
