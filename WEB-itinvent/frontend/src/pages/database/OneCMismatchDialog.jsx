import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';

export const ONE_C_NOTE_MAX_LENGTH = 500;

/**
 * Отметка «не сходится с 1С»: без комментария не сохраняется — проверяющий должен написать,
 * что именно не сходится. `onSave(note)` возвращает true, когда отметка сохранена.
 */
export default function OneCMismatchDialog({ open, invNo, initialNote = '', onClose, onSave }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNote(initialNote || '');
      setSaving(false);
    }
  }, [open, initialNote]);

  const trimmed = note.trim();
  const submit = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    const saved = await onSave(trimmed);
    if (saved) onClose();
    else setSaving(false);
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" data-testid="one-c-mismatch-dialog">
      <DialogTitle>Не сходится с 1С</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1.5 }}>
          Оборудование {invNo}. Опишите, что не сходится: комментарий увидят все, кто смотрит список
          (красная отметка «1С ✕», текст — в подсказке).
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          label="Комментарий"
          placeholder="Например: в 1С остаток 2 шт., в хабе 1; парт-номер другой"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, ONE_C_NOTE_MAX_LENGTH))}
          helperText={`${note.length}/${ONE_C_NOTE_MAX_LENGTH}`}
          inputProps={{ 'aria-label': 'Комментарий к отметке «не сходится с 1С»' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button
          onClick={submit}
          color="error"
          variant="contained"
          disabled={!trimmed || saving}
          data-testid="one-c-mismatch-save"
        >
          Отметить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
