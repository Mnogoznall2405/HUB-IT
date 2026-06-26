import { memo } from 'react';
import { TableCell, TableRow, Typography } from '@mui/material';
import { formatDateTime, formatShortDate } from '../../../pages/tasks/taskFormatters';
import TaskTagsRow from './TaskTagsRow';

function TasksListTableRow({
  task,
  ui,
  alpha,
  taskDiscussionChatEnabled = false,
  projectLabel = '-',
  onOpen,
}) {
  return (
    <TableRow
      key={task.id}
      hover
      data-testid={`tasks-list-row-${task.id}`}
      onClick={onOpen}
      sx={{
        cursor: 'pointer',
        '&:hover td': { bgcolor: ui.actionHover },
      }}
    >
      <TableCell sx={{ minWidth: 260, borderColor: ui.borderSoft }}>
        <Typography sx={{ fontWeight: 850, lineHeight: 1.25 }}>{task?.title || '-'}</Typography>
        {task?.description ? (
          <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2, maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.description}
          </Typography>
        ) : null}
      </TableCell>
      <TableCell sx={{ minWidth: 150, borderColor: ui.borderSoft }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatShortDate(task?.updated_at || task?.created_at) || '-'}</Typography>
        <Typography variant="caption" sx={{ color: ui.subtleText }}>
          {Number(task?.comments_count || 0)} комм. · {Number(task?.attachments_count || 0)} файл.
        </Typography>
      </TableCell>
      <TableCell sx={{ minWidth: 140, borderColor: ui.borderSoft }}>
        <Typography variant="body2" sx={{ fontWeight: 800, color: task?.is_overdue ? '#dc2626' : 'text.primary' }}>
          {task?.due_at ? formatDateTime(task.due_at) : 'Без срока'}
        </Typography>
      </TableCell>
      <TableCell sx={{ minWidth: 160, borderColor: ui.borderSoft }}>{task?.created_by_full_name || task?.created_by_username || '-'}</TableCell>
      <TableCell sx={{ minWidth: 160, borderColor: ui.borderSoft }}>{task?.assignee_full_name || task?.assignee_username || '-'}</TableCell>
      <TableCell sx={{ minWidth: 150, borderColor: ui.borderSoft }}>{projectLabel}</TableCell>
      <TableCell sx={{ minWidth: 260, borderColor: ui.borderSoft }}>
        <TaskTagsRow task={task} ui={ui} taskDiscussionChatEnabled={taskDiscussionChatEnabled} alpha={alpha} />
      </TableCell>
    </TableRow>
  );
}

export default memo(TasksListTableRow);
