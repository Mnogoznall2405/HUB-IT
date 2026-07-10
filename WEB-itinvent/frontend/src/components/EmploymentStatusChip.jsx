import { Chip } from '@mui/material';

export function employmentStatusLabel(status, label = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (label) return label;
  if (normalized === 'active') return 'Сотрудник работает';
  if (normalized === 'dismissed') return 'Сотрудник уволен';
  return '';
}

export default function EmploymentStatusChip({
  status = '',
  label = '',
  size = 'small',
  sx = undefined,
}) {
  const text = employmentStatusLabel(status, label);
  if (!text) return null;

  const normalized = String(status || '').trim().toLowerCase();
  const color = normalized === 'dismissed'
    ? 'error'
    : normalized === 'active'
      ? 'success'
      : 'default';

  return (
    <Chip
      size={size}
      color={color}
      variant={normalized === 'dismissed' ? 'filled' : 'outlined'}
      label={text}
      sx={sx}
    />
  );
}
