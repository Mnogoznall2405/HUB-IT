import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

const ROLE_OPTIONS = [
  { value: 'assignee', label: 'Исполняю', testId: 'tasks-role-assignee' },
  { value: 'creator', label: 'Созданные', testId: 'tasks-role-creator' },
];

function formatCountLabel(label, value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return label;
  return `${label} (${num})`;
}

export default function TaskRoleScopeSwitch({
  value = '',
  onChange,
  compact = false,
  fullWidth = false,
  counts = {},
}) {
  const theme = useTheme();
  const personalValue = value === 'assignee' || value === 'creator' ? value : '';

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={personalValue}
      onChange={(_event, next) => {
        if (next) onChange(next);
      }}
      data-testid="tasks-role-scope-switch"
      sx={{
        width: fullWidth ? '100%' : 'auto',
        flexShrink: 0,
        bgcolor: alpha(theme.palette.primary.main, 0.06),
        borderRadius: '999px',
        p: 0.25,
        '& .MuiToggleButtonGroup-grouped': {
          border: 0,
          borderRadius: '999px !important',
          mx: 0,
        },
        '& .MuiToggleButton-root': {
          px: compact ? 1 : 1.35,
          py: compact ? 0.55 : 0.45,
          minHeight: compact ? 44 : 36,
          fontWeight: 800,
          textTransform: 'none',
          flex: fullWidth ? 1 : 'initial',
          fontSize: compact ? '0.78rem' : '0.8rem',
          color: theme.palette.text.secondary,
          lineHeight: 1.2,
          '&.Mui-selected': {
            bgcolor: theme.palette.background.paper,
            color: theme.palette.primary.main,
            boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, 0.12)}`,
            '&:hover': {
              bgcolor: theme.palette.background.paper,
            },
          },
        },
      }}
    >
      {ROLE_OPTIONS.map((option) => (
        <ToggleButton
          key={option.value}
          value={option.value}
          data-testid={option.testId}
          aria-label={option.label}
        >
          {formatCountLabel(option.label, counts[option.value])}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
