import { memo } from 'react';
import { Box, IconButton, TableCell, TableRow, Tooltip, Typography } from '@mui/material';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { formatDateTime, formatShortDate } from '../../../pages/tasks/taskFormatters';
import { stripMarkdownForPreview } from '../../../pages/tasks/taskRichText';
import { formatTaskAssigneesSummary } from '../../../pages/tasks/taskUserUtils';
import TaskTagsRow from './TaskTagsRow';
import OverflowMenu from '../../common/OverflowMenu';

function TasksListTableRow({
  task,
  ui,
  alpha,
  taskDiscussionChatEnabled = false,
  projectLabel = '-',
  canDelete = false,
  menuItems = [],
  onOpen,
  onDelete,
  onMenuSelect,
}) {
  const descriptionPreview = stripMarkdownForPreview(task?.description_preview || task?.description);

  return (
    <TableRow
      key={task.id}
      hover
      data-testid={`tasks-list-row-${task.id}`}
      data-task-open-trigger={String(task.id)}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen?.();
      }}
      sx={{
        cursor: 'pointer',
        '&:hover td': { bgcolor: ui.actionHover },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: '-2px',
        },
      }}
    >
      <TableCell sx={{ minWidth: 320, borderColor: ui.borderSoft }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 850, lineHeight: 1.25 }}>
              {task?.title || '-'}
            </Typography>
            {descriptionPreview ? (
              <Typography
                data-testid={`tasks-list-description-${task.id}`}
                variant="caption"
                sx={{
                  color: ui.subtleText,
                  display: '-webkit-box',
                  mt: 0.35,
                  overflow: 'hidden',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                  whiteSpace: 'pre-line',
                }}
              >
                {descriptionPreview}
              </Typography>
            ) : null}
          </Box>
          {menuItems.length > 0 ? (
            <OverflowMenu
              label={`Действия задачи «${task?.title || 'Без названия'}»`}
              items={menuItems}
              onSelect={(key) => onMenuSelect?.(task, key)}
            />
          ) : null}
          {canDelete ? (
            <Tooltip title="Удалить задачу">
              <IconButton
                size="small"
                color="error"
                aria-label={`Удалить задачу «${task?.title || 'Без названия'}»`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete?.(task);
                }}
                sx={{ flexShrink: 0 }}
              >
                <DeleteOutlineOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
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
      <TableCell sx={{ minWidth: 160, borderColor: ui.borderSoft }}>{formatTaskAssigneesSummary(task, { compact: true })}</TableCell>
      <TableCell sx={{ minWidth: 150, borderColor: ui.borderSoft }}>{projectLabel}</TableCell>
      <TableCell sx={{ minWidth: 260, borderColor: ui.borderSoft }}>
        <TaskTagsRow task={task} ui={ui} taskDiscussionChatEnabled={taskDiscussionChatEnabled} alpha={alpha} />
      </TableCell>
    </TableRow>
  );
}

export default memo(TasksListTableRow);
