import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import { getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import { formatShortDate, statusMeta as defaultStatusMeta } from '../../../pages/tasks/taskFormatters';
import { formatTaskAssigneesSummary } from '../../../pages/tasks/taskUserUtils';

const toCount = (value) => Math.max(0, Number(value) || 0);

export const getSubtaskProgress = (task) => {
  const total = toCount(task?.subtasks_total);
  const done = Math.min(toCount(task?.subtasks_done), total);
  return { total, done, open: total - done };
};

/** Родитель, у которого есть невыполненные подзадачи, при закрытии/сдаче получает только предупреждение. */
export const getOpenSubtasksWarning = (task) => {
  const { open } = getSubtaskProgress(task);
  if (open <= 0) return '';
  return `Есть невыполненные подзадачи: ${open}. Закрытие задачи их не блокирует.`;
};

export function TaskParentLink({ parent, onOpenParent, ui, dense = false }) {
  if (!parent) return null;
  const canOpen = parent.can_view !== false && Boolean(onOpenParent);
  const title = parent.can_view === false ? 'Родительская задача недоступна' : (parent.title || 'Родительская задача');
  return (
    <Stack
      direction="row"
      spacing={0.6}
      alignItems="center"
      data-testid="task-parent-link"
      sx={{ minWidth: 0, color: ui?.mutedText }}
    >
      <AccountTreeOutlinedIcon sx={{ fontSize: dense ? 15 : 17, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ fontWeight: 700, flexShrink: 0 }}>Подзадача · родитель:</Typography>
      {canOpen ? (
        <Button
          size="small"
          variant="text"
          onClick={() => onOpenParent(parent.id)}
          sx={{ minWidth: 0, p: 0, textTransform: 'none', fontWeight: 800, justifyContent: 'flex-start', minHeight: 24 }}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Box>
        </Button>
      ) : (
        <Typography variant="caption" noWrap sx={{ fontWeight: 700 }}>{title}</Typography>
      )}
    </Stack>
  );
}

export default function TaskSubtasksSection({
  task,
  ui,
  statusMeta = defaultStatusMeta,
  onOpenTask,
  onCreateSubtask,
}) {
  if (!task) return null;
  const { total, done, open } = getSubtaskProgress(task);
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const canCreate = task.capabilities?.can_create_subtask === true && Boolean(onCreateSubtask);
  const hiddenCount = Math.max(0, total - subtasks.length);
  if (!total && !canCreate) return null;
  const parentDone = String(task.status || '').toLowerCase() === 'done';

  return (
    <Box data-testid="task-subtasks-section" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.3, borderRadius: '14px' }) }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: total ? 0.8 : 0 }}>
        <Typography sx={{ fontWeight: 800 }}>
          {total ? `Подзадачи · ${done}/${total}` : 'Подзадачи'}
        </Typography>
        {canCreate ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => onCreateSubtask(task)}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', minHeight: 36 }}
          >
            Подзадача
          </Button>
        ) : null}
      </Stack>

      {total > 0 ? (
        <LinearProgress
          variant="determinate"
          value={Math.round((done / total) * 100)}
          aria-label="Выполнено подзадач"
          sx={{ height: 6, borderRadius: 999, mb: 1 }}
        />
      ) : (
        <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.6 }}>
          Разбейте задачу на части и назначьте их исполнителям.
        </Typography>
      )}

      {open > 0 && !parentDone ? (
        <Typography variant="caption" data-testid="task-subtasks-open-note" sx={{ display: 'block', color: ui.mutedText, mb: 0.8 }}>
          {`Не выполнено: ${open}`}
        </Typography>
      ) : null}

      <Stack spacing={0.6}>
        {subtasks.map((subtask) => {
          const status = statusMeta(subtask.status);
          const due = subtask.due_at ? formatShortDate(subtask.due_at) : '';
          return (
            <Box
              key={subtask.id}
              role="button"
              tabIndex={0}
              data-testid={`task-subtask-row-${subtask.id}`}
              onClick={() => onOpenTask?.(subtask.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onOpenTask?.(subtask.id);
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.8,
                minHeight: 44,
                borderRadius: '10px',
                border: '1px solid',
                borderColor: ui.borderSoft,
                cursor: 'pointer',
                '&:hover': { bgcolor: ui.actionBg },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{subtask.title}</Typography>
                <Typography variant="caption" noWrap sx={{ display: 'block', color: ui.subtleText }}>
                  {formatTaskAssigneesSummary(subtask, { compact: true })}
                </Typography>
              </Box>
              {due ? (
                <Typography variant="caption" sx={{ flexShrink: 0, fontWeight: 700, color: subtask.is_overdue ? '#dc2626' : ui.subtleText }}>
                  {due}
                </Typography>
              ) : null}
              <Chip
                size="small"
                label={status.label}
                sx={{ flexShrink: 0, fontWeight: 800, bgcolor: status.bg, color: status.color }}
              />
            </Box>
          );
        })}
      </Stack>

      {hiddenCount > 0 ? (
        <Typography variant="caption" data-testid="task-subtasks-hidden-note" sx={{ display: 'block', mt: 0.8, color: ui.subtleText }}>
          {`и ещё ${hiddenCount} недоступных вам`}
        </Typography>
      ) : null}
    </Box>
  );
}
