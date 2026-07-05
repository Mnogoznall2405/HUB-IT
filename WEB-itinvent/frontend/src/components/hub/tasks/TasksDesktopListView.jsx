import { useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import TaskListSectionHeader from '../TaskListSectionHeader';
import { getOfficeEmptyStateSx, getOfficePanelSx } from '../../../theme/officeUiTokens';
import TasksListTableRow from './TasksListTableRow';

function TaskListRow({
  task,
  ui,
  alpha,
  taskDiscussionChatEnabled,
  projectLabel,
  onOpenTask,
}) {
  const handleOpen = useCallback(() => {
    onOpenTask?.(task);
  }, [onOpenTask, task]);

  return (
    <TasksListTableRow
      task={task}
      ui={ui}
      alpha={alpha}
      taskDiscussionChatEnabled={taskDiscussionChatEnabled}
      projectLabel={projectLabel}
      onOpen={handleOpen}
    />
  );
}

export default function TasksDesktopListView({
  ui,
  alpha,
  loading = false,
  visibleTaskItems = [],
  taskListSections,
  completedTasksOpen = false,
  onToggleCompletedTasks,
  taskDiscussionChatEnabled = false,
  activeTaskProjects = [],
  onOpenTask,
  hasMoreTasks = false,
  onLoadMore,
  tasksTotal = 0,
}) {
  const { active, completed } = taskListSections || { active: { items: [] }, completed: { items: [] } };
  const hasAnyTasks = active.items.length > 0 || completed.items.length > 0;

  const resolveProjectLabel = (task) => (
    task?.project_name
    || activeTaskProjects.find((project) => String(project?.id || '') === String(task?.project_id || ''))?.name
    || '-'
  );

  return (
    <Card
      data-testid="tasks-list-view"
      sx={{
        ...getOfficePanelSx(ui),
        height: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table stickyHeader size="small" aria-label="Список задач">
          <TableHead>
            <TableRow>
              {['Название', 'Активность', 'Крайний срок', 'Постановщик', 'Исполнитель', 'Проект', 'Теги'].map((label) => (
                <TableCell
                  key={label}
                  sx={{
                    bgcolor: ui.panelSolid,
                    color: ui.subtleText,
                    fontWeight: 900,
                    fontSize: '0.75rem',
                    borderColor: ui.borderSoft,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && visibleTaskItems.length === 0 ? (
              [0, 1, 2, 3].map((item) => (
                <TableRow key={item}>
                  <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft }}>
                    <Skeleton variant="rounded" height={34} sx={{ borderRadius: '10px' }} />
                  </TableCell>
                </TableRow>
              ))
            ) : !hasAnyTasks ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft }}>
                  <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2 }) }}>
                    <Typography sx={{ fontWeight: 850 }}>Задачи по текущим фильтрам не найдены.</Typography>
                    <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                      Смените роль, статус, срок или поисковый запрос.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              <>
                <TableRow>
                  <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft, p: 0 }}>
                    <TaskListSectionHeader label="Активные" count={active.items.length} ui={ui} />
                  </TableCell>
                </TableRow>
                {active.items.length > 0 ? (
                  active.items.map((task) => (
                    <TaskListRow
                      key={task.id}
                      task={task}
                      ui={ui}
                      alpha={alpha}
                      taskDiscussionChatEnabled={taskDiscussionChatEnabled}
                      projectLabel={resolveProjectLabel(task)}
                      onOpenTask={onOpenTask}
                    />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft, color: ui.mutedText }}>
                      Нет активных задач.
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft, p: 0 }}>
                    <TaskListSectionHeader
                      label="Завершённые"
                      count={completed.items.length}
                      collapsible
                      expanded={completedTasksOpen}
                      onToggle={onToggleCompletedTasks}
                      ui={ui}
                    />
                  </TableCell>
                </TableRow>
                {completedTasksOpen ? (
                  completed.items.length > 0 ? (
                    completed.items.map((task) => (
                      <TaskListRow
                        key={task.id}
                        task={task}
                        ui={ui}
                        alpha={alpha}
                        taskDiscussionChatEnabled={taskDiscussionChatEnabled}
                        projectLabel={resolveProjectLabel(task)}
                        onOpenTask={onOpenTask}
                      />
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft, color: ui.mutedText }}>
                        Нет завершённых задач.
                      </TableCell>
                    </TableRow>
                  )
                ) : null}
              </>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {hasMoreTasks ? (
        <Box sx={{ px: 1.2, py: 1, borderTop: '1px solid', borderColor: ui.borderSoft, flexShrink: 0 }}>
          <Button
            fullWidth
            variant="outlined"
            size="small"
            disabled={loading}
            onClick={() => void onLoadMore?.()}
            sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
          >
            {loading ? 'Загрузка...' : `Показать ещё (${visibleTaskItems.length} из ${tasksTotal})`}
          </Button>
        </Box>
      ) : null}
    </Card>
  );
}
