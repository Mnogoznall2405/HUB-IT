import {
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
  onClose,
  onChange,
  onSave,
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Настройки вида</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.3}>
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
                checked={Boolean(value?.mark_read_on_select)}
                onChange={(event) => onChange('mark_read_on_select', event.target.checked)}
              />
            )}
            label="Отмечать письмо прочитанным при выборе"
          />

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
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
        <Button variant="contained" onClick={onSave} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
