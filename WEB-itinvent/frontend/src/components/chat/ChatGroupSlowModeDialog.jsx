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

// Steps accepted by the server (chat_group_limits.SLOW_MODE_STEPS); 0 turns the mode off.
export const SLOW_MODE_STEPS = [
  { value: 0, label: 'Выключен' },
  { value: 10, label: '10 секунд' },
  { value: 30, label: '30 секунд' },
  { value: 60, label: '1 минута' },
  { value: 300, label: '5 минут' },
  { value: 900, label: '15 минут' },
  { value: 3600, label: '1 час' },
];

export const describeSlowMode = (seconds) => {
  const value = Number(seconds || 0);
  const step = SLOW_MODE_STEPS.find((item) => item.value === value);
  return step ? step.label : `${value} с`;
};

export default function ChatGroupSlowModeDialog({ open, currentSeconds = 0, busy = false, onClose, onSubmit }) {
  const [value, setValue] = useState(String(Number(currentSeconds || 0)));

  useEffect(() => {
    if (open) setValue(String(Number(currentSeconds || 0)));
  }, [open, currentSeconds]);

  const unchanged = Number(value) === Number(currentSeconds || 0);

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="xs" data-testid="chat-group-slow-mode">
      <DialogTitle>Медленный режим</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          Участник сможет отправлять одно сообщение за выбранный интервал. Владельца и модераторов это не касается.
        </DialogContentText>
        <RadioGroup value={value} onChange={(event) => setValue(event.target.value)}>
          {SLOW_MODE_STEPS.map((step) => (
            <FormControlLabel
              key={step.value}
              value={String(step.value)}
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
          disabled={busy || unchanged}
          onClick={() => onSubmit?.(Number(value))}
        >
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
