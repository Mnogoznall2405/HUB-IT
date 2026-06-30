import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import { normalizeIpListForSettings } from './appSettingsModel';
import SectionCard from '../shared/SectionCard';

export function AdminLoginAllowlistSettingsCard({ appSettings, loading, saving, onSave }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [draftIps, setDraftIps] = useState('');
  const [localError, setLocalError] = useState('');

  const currentIps = useMemo(
    () => normalizeIpListForSettings(appSettings?.admin_login_allowed_ips),
    [appSettings?.admin_login_allowed_ips],
  );

  useEffect(() => {
    setDraftIps(currentIps.join('\n'));
    setLocalError('');
  }, [currentIps]);

  const parsedIps = useMemo(() => {
    const seen = new Set();
    return String(draftIps || '')
      .split(/\r?\n/)
      .map((item) => String(item || '').trim())
      .filter((item) => {
        if (!item || seen.has(item)) {
          return false;
        }
        seen.add(item);
        return true;
      });
  }, [draftIps]);

  const dirty = parsedIps.join('\n') !== currentIps.join('\n');

  const handleSave = () => {
    if (parsedIps.length === 0) {
      setLocalError('Укажите хотя бы один IP-адрес для входа admin.');
      return;
    }
    setLocalError('');
    onSave({ admin_login_allowed_ips: parsedIps });
  };

  return (
    <SectionCard
      title="IP allowlist для admin"
      action={<Chip size="small" label={`${currentIps.length} IP`} color={currentIps.length > 0 ? 'success' : 'default'} />}
      sx={{ flexShrink: 0 }}
      contentSx={{ p: 1.1 }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          Разрешите вход admin-учёток только с доверенных адресов. Указывайте один точный IP на строку, например <strong>10.105.0.42</strong>.
        </Typography>

        <TextField
          label="Разрешённые IP"
          multiline
          minRows={4}
          fullWidth
          size="small"
          value={draftIps}
          onChange={(event) => {
            setDraftIps(event.target.value);
            if (localError) {
              setLocalError('');
            }
          }}
          disabled={loading || saving}
          placeholder={'10.105.0.42\n10.105.0.43'}
          helperText="Один IP на строку. Невалидные адреса backend не сохранит."
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
            onClick={handleSave}
            disabled={loading || saving || !dirty}
          >
            {saving ? 'Сохранение...' : 'Сохранить allowlist'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            Ограничение применяется и к новым логинам, и к уже активным admin-сессиям.
          </Typography>
        </Stack>

        {localError ? <Alert severity="error">{localError}</Alert> : null}

        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
        >
          <Stack spacing={0.75}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
              Сейчас разрешены
            </Typography>
            {currentIps.length > 0 ? (
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                {currentIps.map((ip) => (
                  <Chip key={ip} size="small" label={ip} color="success" variant="outlined" />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Список пока пуст.
              </Typography>
            )}
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}
