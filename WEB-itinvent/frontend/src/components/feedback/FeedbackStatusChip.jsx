import { Chip } from '@mui/material';
import { FEEDBACK_STATUS_META } from '../../api/feedback';

export default function FeedbackStatusChip({ status, ...chipProps }) {
  const meta = FEEDBACK_STATUS_META[status] || { label: status || 'Неизвестно', color: 'default' };
  return (
    <Chip
      size="small"
      color={meta.color}
      variant="outlined"
      label={meta.label}
      data-testid="feedback-status-chip"
      data-status={status}
      {...chipProps}
    />
  );
}
