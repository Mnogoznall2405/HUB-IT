import { Chip, Stack } from '@mui/material';
import { buildTaskTagChips } from '../../../pages/tasks/taskTagModel';

export default function TaskTagsRow({
  task,
  ui,
  taskDiscussionChatEnabled = false,
  alpha,
}) {
  const chips = buildTaskTagChips(task, { ui, taskDiscussionChatEnabled, alpha });

  return (
    <Stack direction="row" spacing={0.45} sx={{ flexWrap: 'wrap', gap: 0.4 }}>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          size="small"
          label={chip.label}
          sx={{
            height: 22,
            fontSize: '0.67rem',
            fontWeight: 800,
            borderRadius: '8px',
            bgcolor: chip.bg,
            color: chip.color,
            border: 'none',
          }}
        />
      ))}
    </Stack>
  );
}
