import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';

const READING_PANE_OPTIONS = [
  { value: 'right', label: 'Область чтения справа' },
  { value: 'bottom', label: 'Область чтения снизу' },
  { value: 'off', label: 'Область чтения отключена' },
];

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Комфортная плотность' },
  { value: 'compact', label: 'Компактная плотность' },
];

export default function MailViewSettingsDialog({
  open,
  value,
  saving,
  mobileHint = false,
  onClose,
  onChange,
  onSave,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: getMailDialogPaperSx(tokens) }}>
      <DialogTitle sx={getMailDialogTitleSx(tokens)}>Настройки вида</DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(tokens)}>
        <Stack spacing={1.3}>
          <Alert severity="info" sx={{ borderRadius: '10px' }}>
            {mobileHint
              ? 'На телефоне почта всегда работает в одноколоночном режиме. Настройка области чтения применяется только на больших экранах.'
              : 'На мобильных устройствах почта всегда открывается в одноколоночном режиме. Настройка области чтения влияет только на desktop.'}
          </Alert>

          <TextField
            select
            fullWidth
            size="small"
            label="Область чтения"
            value={value?.reading_pane || 'right'}
            onChange={(event) => onChange('reading_pane', event.target.value)}
          >
            {READING_PANE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            fullWidth
            size="small"
            label="Плотность"
            value={value?.density || 'comfortable'}
            onChange={(event) => onChange('density', event.target.value)}
          >
            {DENSITY_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <FormControlLabel
            control={(
              <Switch
                checked={Boolean(value?.show_preview_snippets)}
                onChange={(event) => onChange('show_preview_snippets', event.target.checked)}
              />
            )}
            label="Показывать сниппеты в списке"
          />

          <FormControlLabel
            control={(
              <Switch
                checked={Boolean(value?.show_favorites_first)}
                onChange={(event) => onChange('show_favorites_first', event.target.checked)}
              />
            )}
            label="Показывать избранные папки выше"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={getMailDialogActionsSx(tokens)}>
        <Button onClick={onClose}>Закрыть</Button>
        <Button variant="contained" onClick={onSave} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
