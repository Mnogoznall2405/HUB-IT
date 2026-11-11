import {
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from '@mui/material';
import { EMAIL_DEADLINE_REMIND_HOUR_OPTIONS } from '../../../pages/tasks/taskEmailRemindUtils';

export default function EmailDeadlineRemindFields({
  dueAt,
  mode,
  hours,
  defaultHours = 24,
  onModeChange,
  onHoursChange,
  testIdPrefix = 'task-email-remind',
  compact = false,
}) {
  if (!String(dueAt || '').trim()) return null;
  const defaultLabel = `По умолчанию (${defaultHours} ч до срока)`;
  return (
    <FormControl component="fieldset" fullWidth size="small" data-testid={`${testIdPrefix}-block`}>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {compact ? 'Когда напомнить по почте' : 'Email-напоминание о сроке'}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
        Письмо исполнителю за выбранное время до крайнего срока
      </Typography>
      <RadioGroup
        value={mode}
        onChange={(event) => onModeChange(event.target.value)}
      >
        <FormControlLabel
          value="default"
          control={<Radio size="small" data-testid={`${testIdPrefix}-mode-default`} />}
          label={defaultLabel}
        />
        <FormControlLabel
          value="custom"
          control={<Radio size="small" data-testid={`${testIdPrefix}-mode-custom`} />}
          label="Напомнить за"
        />
        {mode === 'custom' ? (
          <FormControl fullWidth size="small" sx={{ pl: 3.5, mt: 0.25, mb: 0.5 }}>
            <InputLabel id={`${testIdPrefix}-hours-label`}>За сколько часов до срока</InputLabel>
            <Select
              labelId={`${testIdPrefix}-hours-label`}
              label="За сколько часов до срока"
              data-testid={`${testIdPrefix}-hours`}
              value={hours}
              onChange={(event) => onHoursChange(Number(event.target.value) || 24)}
            >
              {EMAIL_DEADLINE_REMIND_HOUR_OPTIONS.map((item) => (
                <MenuItem key={item} value={item}>{item} ч</MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        <FormControlLabel
          value="off"
          control={<Radio size="small" data-testid={`${testIdPrefix}-mode-off`} />}
          label="Не отправлять email о сроке"
        />
      </RadioGroup>
      <FormHelperText>Колокольчик в приложении не меняется</FormHelperText>
    </FormControl>
  );
}
