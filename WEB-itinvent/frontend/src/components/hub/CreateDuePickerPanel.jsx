import { useMemo } from 'react';
import {
  Box,
  Button,
  Collapse,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckIcon from '@mui/icons-material/Check';
import {
  CREATE_DUE_HOUR_OPTIONS,
  CREATE_DUE_MINUTE_OPTIONS,
  joinLocalDateTimeInput,
  splitLocalDateTimeInput,
  toLocalDateKey,
} from '../../pages/tasksViewModel';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

export default function CreateDuePickerPanel({
  presets = [],
  dueAt = '',
  customOpen = false,
  onCustomOpenChange,
  onSelectPreset,
  onDueAtChange,
  onClose,
  emailRemindSlot = null,
  testIdPrefix = 'create-due',
  title = 'Крайний срок',
  showTitle = true,
}) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  const selectMenuProps = useMemo(() => ({
    disableScrollLock: true,
    sx: { zIndex: theme.zIndex.modal + 5 },
    PaperProps: {
      sx: { maxHeight: 280 },
    },
  }), [theme.zIndex.modal]);
  const { date: customDate, time: customTime } = splitLocalDateTimeInput(dueAt);
  const [customHour, customMinute] = String(customTime || '19:00').split(':');

  const handleCustomDateChange = (nextDate) => {
    onDueAtChange(joinLocalDateTimeInput(nextDate, customTime));
  };

  const handleCustomTimeChange = (nextHour, nextMinute) => {
    onDueAtChange(joinLocalDateTimeInput(customDate, `${nextHour}:${nextMinute}`));
  };

  const handleOpenCustom = () => {
    if (!customDate) {
      onDueAtChange(joinLocalDateTimeInput(toLocalDateKey(new Date()), customTime));
    }
    onCustomOpenChange(true);
  };

  return (
    <Box data-testid={`${testIdPrefix}-panel`} sx={{ px: showTitle ? 2 : 0, pt: showTitle ? 1.1 : 0, pb: showTitle ? 1.4 : 0 }}>
      {showTitle ? (
        <Typography sx={{ textAlign: 'center', fontWeight: 950, fontSize: '1.05rem', mb: 1.1 }}>
          {title}
        </Typography>
      ) : null}

      <Stack spacing={0.15}>
        {presets.map((preset) => {
          const selected = String(dueAt || '') === String(preset.value || '');
          return (
            <Button
              key={preset.key}
              data-testid={`${testIdPrefix}-preset-${preset.key}`}
              onClick={() => onSelectPreset(preset.value)}
              sx={{
                minHeight: 58,
                px: 1.2,
                py: 0.85,
                justifyContent: 'space-between',
                textAlign: 'left',
                textTransform: 'none',
                borderRadius: '14px',
                color: ui.text,
                bgcolor: selected ? alpha(theme.palette.primary.main, 0.16) : 'transparent',
                '&:hover': {
                  bgcolor: selected ? alpha(theme.palette.primary.main, 0.2) : ui.actionHover,
                },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, fontSize: '0.98rem', lineHeight: 1.15 }}>
                  {preset.label}
                </Typography>
                {preset.description ? (
                  <Typography variant="body2" sx={{ color: ui.subtleText, mt: 0.35 }}>
                    {preset.description}
                  </Typography>
                ) : null}
              </Box>
              {selected ? <CheckIcon sx={{ color: theme.palette.primary.main, flexShrink: 0 }} /> : null}
            </Button>
          );
        })}

        <Button
          data-testid={`${testIdPrefix}-custom-open`}
          onClick={handleOpenCustom}
          endIcon={<CalendarMonthOutlinedIcon />}
          sx={{
            minHeight: 56,
            px: 1.2,
            py: 0.85,
            justifyContent: 'space-between',
            textAlign: 'left',
            textTransform: 'none',
            borderRadius: '14px',
            color: ui.text,
            '&:hover': { bgcolor: ui.actionHover },
          }}
        >
          <Typography sx={{ fontWeight: 900, fontSize: '0.98rem' }}>
            Указать свою дату
          </Typography>
        </Button>
      </Stack>

      <Collapse in={customOpen} unmountOnExit>
        <Stack spacing={1} sx={{ mt: 1.1 }}>
          <TextField
            data-testid={`${testIdPrefix}-custom-date`}
            label="Дата"
            type="date"
            value={customDate}
            onChange={(event) => handleCustomDateChange(event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
            size="small"
          />
          <Stack direction="row" spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id={`${testIdPrefix}-hour-label`}>Часы</InputLabel>
              <Select
                labelId={`${testIdPrefix}-hour-label`}
                label="Часы"
                value={customHour}
                onChange={(event) => handleCustomTimeChange(event.target.value, customMinute)}
                data-testid={`${testIdPrefix}-custom-hour`}
                MenuProps={selectMenuProps}
              >
                {CREATE_DUE_HOUR_OPTIONS.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id={`${testIdPrefix}-minute-label`}>Минуты</InputLabel>
              <Select
                labelId={`${testIdPrefix}-minute-label`}
                label="Минуты"
                value={customMinute}
                onChange={(event) => handleCustomTimeChange(customHour, event.target.value)}
                data-testid={`${testIdPrefix}-custom-minute`}
                MenuProps={selectMenuProps}
              >
                {CREATE_DUE_MINUTE_OPTIONS.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Typography variant="caption" sx={{ color: ui.subtleText }}>
            Время в 24-часовом формате
          </Typography>
          {onClose ? (
            <Button
              variant="contained"
              onClick={onClose}
              sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}
            >
              Готово
            </Button>
          ) : null}
        </Stack>
      </Collapse>

      {emailRemindSlot}
    </Box>
  );
}
