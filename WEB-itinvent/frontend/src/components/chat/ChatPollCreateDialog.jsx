import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { CHAT_POLL_MAX_OPTIONS, CHAT_POLL_MIN_OPTIONS } from './chatHelpers';

const QUESTION_MAX_LENGTH = 300;
const OPTION_MAX_LENGTH = 100;

/** C9: create-poll dialog — question plus 2..10 options, sent as kind='poll'. */
export default function ChatPollCreateDialog({
  open,
  onClose,
  onSend,
  dialogPaperSx,
  dialogTitleSx,
  dialogContentSx,
  dialogActionsSx,
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(true);
  const [sending, setSending] = useState(false);

  const filledOptions = useMemo(
    () => options.map((item) => item.trim()).filter(Boolean),
    [options],
  );
  const canSend = question.trim().length > 0
    && filledOptions.length >= CHAT_POLL_MIN_OPTIONS
    && !sending;

  const reset = useCallback(() => {
    setQuestion('');
    setOptions(['', '']);
    setAnonymous(true);
    setSending(false);
  }, []);

  const handleClose = useCallback(() => {
    if (sending) return;
    reset();
    onClose?.();
  }, [onClose, reset, sending]);

  const updateOption = useCallback((index, value) => {
    setOptions((items) => items.map((item, i) => (i === index ? value : item)));
  }, []);

  const addOption = useCallback(() => {
    setOptions((items) => (items.length < CHAT_POLL_MAX_OPTIONS ? [...items, ''] : items));
  }, []);

  const removeOption = useCallback((index) => {
    setOptions((items) => (items.length > CHAT_POLL_MIN_OPTIONS ? items.filter((_, i) => i !== index) : items));
  }, []);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const sent = await onSend?.({
        question: question.trim(),
        options: filledOptions,
        anonymous,
      });
      if (sent) reset();
    } finally {
      setSending(false);
    }
  }, [anonymous, canSend, filledOptions, onSend, question, reset]);

  return (
    <Dialog
      open={Boolean(open)}
      onClose={handleClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{ sx: dialogPaperSx }}
      aria-labelledby="chat-poll-create-title"
    >
      <DialogTitle id="chat-poll-create-title" sx={dialogTitleSx}>Новый опрос</DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField
            label="Вопрос"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            inputProps={{ maxLength: QUESTION_MAX_LENGTH, 'aria-label': 'Вопрос опроса' }}
            fullWidth
            size="small"
            autoFocus
          />
          {options.map((option, index) => (
            <Stack key={index} direction="row" spacing={0.5} alignItems="center">
              <TextField
                label={`Вариант ${index + 1}`}
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
                inputProps={{ maxLength: OPTION_MAX_LENGTH, 'aria-label': `Вариант ${index + 1}` }}
                fullWidth
                size="small"
              />
              {options.length > CHAT_POLL_MIN_OPTIONS ? (
                <IconButton
                  aria-label={`Удалить вариант ${index + 1}`}
                  onClick={() => removeOption(index)}
                  size="small"
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              ) : (
                <Box sx={{ width: 40 }} />
              )}
            </Stack>
          ))}
          {options.length < CHAT_POLL_MAX_OPTIONS ? (
            <Button
              startIcon={<AddRoundedIcon />}
              onClick={addOption}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              Вариант
            </Button>
          ) : null}
          <FormControlLabel
            control={(
              <Checkbox
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
                inputProps={{ 'aria-label': 'Анонимный опрос' }}
              />
            )}
            label="Анонимный опрос"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={dialogActionsSx}>
        <Button onClick={handleClose} disabled={sending}>Отмена</Button>
        <Button
          variant="contained"
          onClick={() => void handleSend()}
          disabled={!canSend}
          data-testid="chat-poll-create-send"
        >
          {sending ? 'Отправка…' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
