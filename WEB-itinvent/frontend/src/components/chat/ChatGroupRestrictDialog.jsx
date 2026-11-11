import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
} from '@mui/material';

// Durations accepted by the server (chat_group_restrictions.RESTRICTION_DURATIONS); '' means until lifted.
export const RESTRICTION_STEPS = [
  { value: '3600', label: '1 час' },
  { value: '86400', label: '1 день' },
  { value: '604800', label: '7 дней' },
  { value: '', label: 'Пока не сниму' },
];

export default function ChatGroupRestrictDialog({ open, memberName = '', busy = false, onClose, onSubmit }) {
  const [value, setValue] = useState('86400');

  useEffect(() => {
    if (open) setValue('86400');
  }, [open]);

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="xs" data-testid="chat-group-restrict">
      <DialogTitle>Ограничить отправку</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          {memberName ? `${memberName} продолжит читать группу, но не сможет писать.` : 'Участник продолжит читать группу, но не сможет писать.'}
        </DialogContentText>
        <RadioGroup value={value} onChange={(event) => setValue(event.target.value)}>
          {RESTRICTION_STEPS.map((step) => (
            <FormControlLabel
              key={step.value || 'forever'}
              value={step.value}
              control={<Radio size="small" />}
              label={step.label}
            />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">Отмена</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={busy}
          onClick={() => onSubmit?.(value ? Number(value) : null)}
        >
          Ограничить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
