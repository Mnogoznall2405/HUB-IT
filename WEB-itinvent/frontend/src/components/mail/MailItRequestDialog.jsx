import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import {
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';

export default function MailItRequestDialog({
  open,
  ui,
  templates = [],
  templateId = '',
  fieldValues = {},
  activeTemplate = null,
  sending = false,
  onClose,
  onClear,
  onTemplateChange,
  onFieldValueChange,
  onSubmit,
}) {
  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: getMailDialogPaperSx(ui) }}
    >
      <DialogTitle sx={getMailDialogTitleSx(ui, { fontWeight: 700 })}>Заявка в IT</DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(ui)} data-testid="mail-it-request-dialog">
        <Stack spacing={1.1} sx={{ mt: 0.5 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="mail-it-template-label">Шаблон</InputLabel>
            <Select
              labelId="mail-it-template-label"
              label="Шаблон"
              value={String(templateId || '')}
              onChange={(event) => onTemplateChange?.(event.target.value)}
              data-testid="mail-it-template-select"
            >
              <MenuItem value="">Выберите шаблон</MenuItem>
              {(Array.isArray(templates) ? templates : []).map((item) => (
                <MenuItem key={item.id} value={String(item.id)}>
                  {item.title || item.code}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {Array.isArray(activeTemplate?.fields) ? activeTemplate.fields.map((field) => {
            const key = String(field?.key || '');
            return (
              <TextField
                key={key}
                size="small"
                label={String(field?.label || key || 'Поле')}
                value={String(fieldValues?.[key] || '')}
                onChange={(event) => onFieldValueChange?.(key, event.target.value)}
                inputProps={{ 'data-testid': `mail-it-field-${key}` }}
                fullWidth
              />
            );
          }) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={getMailDialogActionsSx(ui)}>
        <Button onClick={onClear} disabled={sending} data-testid="mail-it-clear" sx={{ textTransform: 'none' }}>
          Очистить
        </Button>
        <Button onClick={onClose} disabled={sending} sx={{ textTransform: 'none' }}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={sending}
          data-testid="mail-it-submit"
          sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
        >
          {sending ? 'Отправка...' : 'Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
