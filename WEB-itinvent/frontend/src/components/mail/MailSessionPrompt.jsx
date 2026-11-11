import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import {
  getMailSessionChoice,
  isMailSessionChoiceRequired,
  MAIL_SESSION_CHANGED_EVENT,
  setMailSessionChoice,
} from '../../lib/mailSession';

export default function MailSessionPrompt() {
  const [choice, setChoice] = useState(() => getMailSessionChoice());

  useEffect(() => {
    const syncChoice = () => setChoice(getMailSessionChoice());
    window.addEventListener(MAIL_SESSION_CHANGED_EVENT, syncChoice);
    return () => window.removeEventListener(MAIL_SESSION_CHANGED_EVENT, syncChoice);
  }, []);

  const open = isMailSessionChoiceRequired() && choice === null;

  const choose = (value) => () => setMailSessionChoice(value);

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      disableEscapeKeyDown
      onClose={() => {}}
      aria-labelledby="mail-session-prompt-title"
    >
      <DialogTitle
        id="mail-session-prompt-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <MailOutlineRoundedIcon color="primary" aria-hidden="true" />
        Включить почту?
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          HUB может показывать корпоративную почту и уведомления о новых письмах в этом окне.
          Выбор запомнится на этом устройстве — изменить его можно в «Настройки → Приложение».
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={choose('disabled')}>Не включать</Button>
        <Button variant="contained" onClick={choose('enabled')} autoFocus>
          Включить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
