import { useCallback, useMemo } from 'react';
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
  TableSortLabel,
  Typography,
} from '@mui/material';
import TaskListSectionHeader from '../TaskListSectionHeader';
import { getOfficeEmptyStateSx, getOfficePanelSx } from '../../../theme/officeUiTokens';
import TasksListTableRow from './TasksListTableRow';

const getActivityTimestamp = (task) => {
  const timestamp = new Date(task?.updated_at || task?.created_at || '').getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const sortTasksByActivity = (items, direction) => [...items].sort((left, right) => {
  const leftTimestamp = getActivityTimestamp(left);
  const rightTimestamp = getActivityTimestamp(right);
  if (leftTimestamp === null && rightTimestamp === null) return 0;
  if (leftTimestamp === null) return 1;
  if (rightTimestamp === null) return -1;
  return direction === 'asc'
    ? leftTimestamp - rightTimestamp
    : rightTimestamp - leftTimestamp;
});

function TaskListRow({
  task,
  ui,
  alpha,
  taskDiscussionChatEnabled,
  projectLabel,
  canDeleteTask,
  menuItems,
  onOpenTask,
  onDeleteTask,
  onMenuSelect,
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
      canDelete={canDeleteTask?.(task) === true}
      menuItems={menuItems}
      onOpen={handleOpen}
      onDelete={onDeleteTask}
      onMenuSelect={onMenuSelect}
    />
  );
}

export default function TasksDesktopListView({
  ui,
  alpha,
  loading = false,
  visibleTaskItems = [],
  taskListSections,
  dateSortDirection = 'desc',
  onDateSortDirectionChange,
  completedTasksOpen = false,
  onToggleCompletedTasks,
  taskDiscussionChatEnabled = false,
  activeTaskProjects = [],
  canDeleteTask,
  getTaskActionMenuItems,
  onOpenTask,
  onDeleteTask,
  onTaskMenuSelect,
  hasMoreTasks = false,
  onLoadMore,
  tasksTotal = 0,
}) {
  const { active, completed } = taskListSections || { active: { items: [] }, completed: { items: [] } };
  const activeSourceItems = Array.isArray(active?.items) ? active.items : [];
  const completedSourceItems = Array.isArray(completed?.items) ? completed.items : [];
  const activeItems = useMemo(
    () => sortTasksByActivity(activeSourceItems, dateSortDirection),
    [activeSourceItems, dateSortDirection],
  );
  const completedItems = useMemo(
    () => sortTasksByActivity(completedSourceItems, dateSortDirection),
    [completedSourceItems, dateSortDirection],
  );
  const hasAnyTasks = activeItems.length > 0 || completedItems.length > 0;
  const activitySortLabel = dateSortDirection === 'asc'
    ? 'Дата изменения, сначала старые'
    : 'Дата изменения, сначала новые';

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
              {['Название', 'Дата изменения', 'Крайний срок', 'Постановщик', 'Исполнители', 'Проект', 'Теги'].map((label) => (
                <TableCell
                  key={label}
                  sortDirection={label === 'Дата изменения' ? dateSortDirection : false}
                  sx={{
                    bgcolor: ui.panelSolid,
                    color: ui.subtleText,
                    fontWeight: 900,
                    fontSize: '0.75rem',
                    borderColor: ui.borderSoft,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label === 'Дата изменения' ? (
                    <TableSortLabel
                      active
                      direction={dateSortDirection}
                      aria-label={activitySortLabel}
                      onClick={() => onDateSortDirectionChange?.(dateSortDirection === 'desc' ? 'asc' : 'desc')}
                      sx={{
                        color: 'inherit',
                        '&.Mui-active': { color: ui.textPrimary },
                        '& .MuiTableSortLabel-icon': { color: `${ui.textPrimary} !important` },
                      }}
                    >
                      {label}
                    </TableSortLabel>
                  ) : label}
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
                    <TaskListSectionHeader label="Активные" count={activeItems.length} ui={ui} />
                  </TableCell>
                </TableRow>
                {activeItems.length > 0 ? (
                  activeItems.map((task) => (
                    <TaskListRow
                      key={task.id}
                      task={task}
                      ui={ui}
                      alpha={alpha}
                      taskDiscussionChatEnabled={taskDiscussionChatEnabled}
                      projectLabel={resolveProjectLabel(task)}
                      canDeleteTask={canDeleteTask}
                      menuItems={getTaskActionMenuItems?.(task) || []}
                      onOpenTask={onOpenTask}
                      onDeleteTask={onDeleteTask}
                      onMenuSelect={onTaskMenuSelect}
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
                      count={completedItems.length}
                      collapsible
                      expanded={completedTasksOpen}
                      onToggle={onToggleCompletedTasks}
                      ui={ui}
                    />
                  </TableCell>
                </TableRow>
                {completedTasksOpen ? (
                  completedItems.length > 0 ? (
                    completedItems.map((task) => (
                      <TaskListRow
                        key={task.id}
                        task={task}
                        ui={ui}
                        alpha={alpha}
                        taskDiscussionChatEnabled={taskDiscussionChatEnabled}
                        projectLabel={resolveProjectLabel(task)}
                        canDeleteTask={canDeleteTask}
                        menuItems={getTaskActionMenuItems?.(task) || []}
                        onOpenTask={onOpenTask}
                        onDeleteTask={onDeleteTask}
                        onMenuSelect={onTaskMenuSelect}
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
