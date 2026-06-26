import { Fragment } from 'react';
import { Box, Skeleton, Stack, Typography } from '@mui/material';
import TaskListSectionHeader from '../TaskListSectionHeader';
import { getOfficeEmptyStateSx } from '../../../theme/officeUiTokens';
import { buildMobileTaskScrollSx } from '../../../pages/tasks/taskMobileLayout';

export default function TasksMobileFeedView({
  ui,
  loading = false,
  taskItems = [],
  taskListSections,
  completedTasksOpen = true,
  onToggleCompletedTasks,
  renderTaskCard,
}) {
  const { active, completed } = taskListSections || { active: { items: [] }, completed: { items: [] } };
  const hasAnyTasks = active.items.length > 0 || completed.items.length > 0;

  return (
    <Box data-testid="tasks-mobile-feed-view" sx={buildMobileTaskScrollSx()}>
      {loading && taskItems.length === 0 ? (
        <Stack spacing={0.8}>
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} variant="rounded" height={118} sx={{ borderRadius: '14px' }} />
          ))}
        </Stack>
      ) : !hasAnyTasks ? (
        <Box sx={{ mx: 1.35, mt: 1, ...getOfficeEmptyStateSx(ui, { p: 1.4 }) }}>
          <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Задачи по текущим фильтрам не найдены.</Typography>
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Смените роль, фокус, срок или поисковый запрос.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0}>
          <TaskListSectionHeader label="Активные" count={active.items.length} ui={ui} />
          {active.items.length > 0 ? (
            <Stack spacing={0}>
              {active.items.map((task) => (
                <Fragment key={task.id}>{renderTaskCard(task)}</Fragment>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ color: ui.mutedText, px: 1.35, pb: 0.8 }}>
              Нет активных задач.
            </Typography>
          )}
          <TaskListSectionHeader
            label="Завершённые"
            count={completed.items.length}
            collapsible
            expanded={completedTasksOpen}
            onToggle={onToggleCompletedTasks}
            ui={ui}
          />
          {completedTasksOpen ? (
            completed.items.length > 0 ? (
              <Stack spacing={0}>
              {completed.items.map((task) => (
                <Fragment key={task.id}>{renderTaskCard(task)}</Fragment>
              ))}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: ui.mutedText, px: 1.35, pb: 0.8 }}>
                Нет завершённых задач.
              </Typography>
            )
          ) : null}
        </Stack>
      )}
    </Box>
  );
}
