import { useEffect, useState } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import {
  getMailSessionChoice,
  isMailSessionChoiceRequired,
  MAIL_SESSION_CHANGED_EVENT,
  setMailSessionChoice,
} from '../../../lib/mailSession';
import SectionCard from '../shared/SectionCard';

export default function MailDeviceSettingsCard() {
  const [choice, setChoice] = useState(() => getMailSessionChoice());

  useEffect(() => {
    const syncChoice = () => setChoice(getMailSessionChoice());
    window.addEventListener(MAIL_SESSION_CHANGED_EVENT, syncChoice);
    return () => window.removeEventListener(MAIL_SESSION_CHANGED_EVENT, syncChoice);
  }, []);

  if (!isMailSessionChoiceRequired()) return null;

  const enabled = choice === 'enabled';
  const handleChange = (event) => {
    setMailSessionChoice(event?.target?.checked ? 'enabled' : 'disabled');
  };

  return (
    <SectionCard
      title="Почта на этом устройстве"
      description="Действует только в HUB Desktop на этом компьютере и только для вашей учётной записи."
    >
      <FormControlLabel
        control={(
          <Switch
            name="mail-device-enabled"
            checked={enabled}
            onChange={handleChange}
          />
        )}
        label={enabled ? 'Почта включена' : 'Почта выключена'}
        sx={{ m: 0, minHeight: 44 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.45 }}>
        Когда почта выключена, раздел «Почта» скрыт, а уведомления о письмах не приходят.
      </Typography>
    </SectionCard>
  );
}
