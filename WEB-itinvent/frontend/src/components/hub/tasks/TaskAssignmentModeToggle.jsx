import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

const MODE_OPTIONS = [
  { value: 'shared', label: 'Одна задача на всех', testId: 'shared' },
  { value: 'separate', label: 'Отдельная задача каждому', testId: 'separate' },
];

export function getAssignmentModeHint(mode, assigneeCount) {
  if (mode === 'separate') {
    return `Каждый получит свою задачу: ${assigneeCount} задач, статусы независимы`;
  }
  return 'Все исполнители работают над одной задачей';
}

export default function TaskAssignmentModeToggle({
  value = 'shared',
  onChange,
  assigneeCount = 0,
  ui,
  compact = false,
  testIdPrefix = 'assignment-mode',
}) {
  const theme = useTheme();
  if (assigneeCount < 2) return null;

  const mutedText = ui?.mutedText || theme.palette.text.secondary;
  const brand = theme.palette.primary.main;

  return (
    <div data-testid={`${testIdPrefix}-root`} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value}
        aria-label="Режим назначения исполнителей"
        onChange={(_event, next) => {
          if (next && next !== value && typeof onChange === 'function') onChange(next);
        }}
        data-testid={`${testIdPrefix}-group`}
        fullWidth
        sx={{
          bgcolor: alpha(brand, 0.06),
          borderRadius: '10px',
          p: 0.25,
          '& .MuiToggleButtonGroup-grouped': { border: 0, borderRadius: '8px !important', mx: 0 },
          '& .MuiToggleButton-root': {
            flex: 1,
            px: compact ? 1 : 1.25,
            minHeight: { xs: 44, sm: compact ? 32 : 36 },
            fontWeight: 700,
            fontSize: compact ? '0.78rem' : '0.82rem',
            textTransform: 'none',
            lineHeight: 1.2,
            color: mutedText,
            '&.Mui-selected': {
              bgcolor: theme.palette.background.paper,
              color: brand,
              boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, 0.12)}`,
              '&:hover': { bgcolor: theme.palette.background.paper },
            },
          },
        }}
      >
        {MODE_OPTIONS.map((option) => (
          <ToggleButton
            key={option.value}
            value={option.value}
            data-testid={`${testIdPrefix}-${option.testId}`}
          >
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography
        data-testid={`${testIdPrefix}-hint`}
        variant="caption"
        sx={{ color: mutedText, fontSize: compact ? '0.74rem' : '0.78rem', lineHeight: 1.35, px: 0.25 }}
      >
        {getAssignmentModeHint(value, assigneeCount)}
      </Typography>
    </div>
  );
}
