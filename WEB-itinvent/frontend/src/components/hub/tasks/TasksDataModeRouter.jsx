import { Suspense, lazy, memo } from 'react';
import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TasksBoardView from './TasksBoardView';
import TasksBucketColumnsView from './TasksBucketColumnsView';
import TasksCalendarView from './TasksCalendarView';
import TasksDesktopListView from './TasksDesktopListView';
import TasksGanttView from './TasksGanttView';
import TasksMobileFeedView from './TasksMobileFeedView';
import TasksAnalyticsLoadingSkeleton from './TasksAnalyticsLoadingSkeleton';

const TasksAnalyticsView = lazy(() => import('./TasksAnalyticsView'));

export function preloadTasksAnalyticsBundle() {
  return Promise.all([
    import('./TasksAnalyticsView'),
    import('./TasksAnalyticsCharts'),
  ]);
}

export function preloadTasksAnalyticsView() {
  return preloadTasksAnalyticsBundle();
}

function AnalyticsFallback() {
  return (
    <Box sx={{ height: '100%', minHeight: 200 }}>
      <TasksAnalyticsLoadingSkeleton />
    </Box>
  );
}

function TasksDataModeRouter({
  pageMode = 'list',
  isMobile = false,
  ui,
  theme,
  loading = false,
  visibleTaskItems = [],
  taskItems = [],
  taskListSections,
  completedTasksOpen = true,
  onToggleCompletedTasks,
  taskDiscussionChatEnabled = false,
  activeTaskProjects = [],
  onOpenTask,
  deadlineBuckets = [],
  canCreateTasks = false,
  onCreateWithPreset,
  renderTaskCard,
  calendarPayload,
  onShiftMonth,
  onCalendarGoToToday,
  onOpenNoDueTasks,
  ganttPayload,
  columnData,
  mobileBoardItems = [],
  focusMode = '',
  analyticsViewProps = null,
}) {
  const renderListView = () => {
    if (isMobile) {
      return (
        <TasksMobileFeedView
          ui={ui}
          loading={loading}
          taskItems={taskItems}
          taskListSections={taskListSections}
          completedTasksOpen={completedTasksOpen}
          onToggleCompletedTasks={onToggleCompletedTasks}
          renderTaskCard={renderTaskCard}
        />
      );
    }

    return (
      <TasksDesktopListView
        ui={ui}
        alpha={alpha}
        loading={loading}
        visibleTaskItems={visibleTaskItems}
        taskListSections={taskListSections}
        completedTasksOpen={completedTasksOpen}
        onToggleCompletedTasks={onToggleCompletedTasks}
        taskDiscussionChatEnabled={taskDiscussionChatEnabled}
        activeTaskProjects={activeTaskProjects}
        onOpenTask={onOpenTask}
      />
    );
  };

  let content = null;
  if (pageMode === 'analytics') {
    content = analyticsViewProps ? (
      <Suspense fallback={<AnalyticsFallback />}>
        <TasksAnalyticsView {...analyticsViewProps} />
      </Suspense>
    ) : null;
  } else if (pageMode === 'deadlines') {
    content = (
      <TasksBucketColumnsView
        isMobile={isMobile}
        ui={ui}
        loading={loading}
        taskItems={taskItems}
        canCreateTasks={canCreateTasks}
        onCreateWithPreset={onCreateWithPreset}
        renderTaskCard={renderTaskCard}
        buckets={deadlineBuckets}
        testId="tasks-deadlines-view"
        showCreateButtons
      />
    );
  } else if (pageMode === 'calendar') {
    content = (
      <TasksCalendarView
        ui={ui}
        calendarPayload={calendarPayload}
        onShiftMonth={onShiftMonth}
        onGoToToday={onCalendarGoToToday}
        onOpenNoDueTasks={onOpenNoDueTasks}
        onOpenTask={onOpenTask}
      />
    );
  } else if (pageMode === 'gantt') {
    content = (
      <TasksGanttView
        ui={ui}
        loading={loading}
        taskItems={taskItems}
        ganttPayload={ganttPayload}
        onOpenTask={onOpenTask}
      />
    );
  } else if (pageMode === 'board') {
    content = (
      <TasksBoardView
        isMobile={isMobile}
        ui={ui}
        theme={theme}
        loading={loading}
        taskItems={taskItems}
        columnData={columnData}
        mobileBoardItems={mobileBoardItems}
        focusMode={focusMode}
        renderTaskCard={renderTaskCard}
      />
    );
  } else {
    content = renderListView();
  }

  return (
    <Box data-testid="tasks-data-mode-router" sx={{ height: '100%', minHeight: 0 }}>
      {content}
    </Box>
  );
}

export default memo(TasksDataModeRouter);
