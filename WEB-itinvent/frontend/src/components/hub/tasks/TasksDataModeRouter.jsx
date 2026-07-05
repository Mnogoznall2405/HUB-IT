import { Suspense, lazy, memo } from 'react';

import { Box } from '@mui/material';

import { alpha } from '@mui/material/styles';

import TasksDesktopListView from './TasksDesktopListView';

import TasksMobileFeedView from './TasksMobileFeedView';

import TasksAnalyticsLoadingSkeleton from './TasksAnalyticsLoadingSkeleton';

import TasksViewModeSkeleton from './TasksViewModeSkeleton';



const TasksAnalyticsView = lazy(() => import('./TasksAnalyticsView'));

const TasksBoardView = lazy(() => import('./TasksBoardView'));

const TasksBucketColumnsView = lazy(() => import('./TasksBucketColumnsView'));

const TasksCalendarView = lazy(() => import('./TasksCalendarView'));

const TasksGanttView = lazy(() => import('./TasksGanttView'));



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



function ViewModeFallback({ pageMode }) {

  const cards = pageMode === 'gantt' ? 6 : 4;

  const cardHeight = pageMode === 'calendar' ? 280 : 118;

  return (

    <Box sx={{ height: '100%', minHeight: 200 }}>

      <TasksViewModeSkeleton cards={cards} cardHeight={cardHeight} />

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

  completedTasksOpen = false,

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

  hasMoreTasks = false,

  onLoadMoreTasks,

  tasksTotal = 0,

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

        hasMoreTasks={hasMoreTasks}

        onLoadMore={onLoadMoreTasks}

        tasksTotal={tasksTotal}

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

      <Suspense fallback={<ViewModeFallback pageMode="deadlines" />}>

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

      </Suspense>

    );

  } else if (pageMode === 'calendar') {

    content = (

      <Suspense fallback={<ViewModeFallback pageMode="calendar" />}>

        <TasksCalendarView

          ui={ui}

          calendarPayload={calendarPayload}

          onShiftMonth={onShiftMonth}

          onGoToToday={onCalendarGoToToday}

          onOpenNoDueTasks={onOpenNoDueTasks}

          onOpenTask={onOpenTask}

        />

      </Suspense>

    );

  } else if (pageMode === 'gantt') {

    content = (

      <Suspense fallback={<ViewModeFallback pageMode="gantt" />}>

        <TasksGanttView

          ui={ui}

          loading={loading}

          taskItems={taskItems}

          ganttPayload={ganttPayload}

          onOpenTask={onOpenTask}

        />

      </Suspense>

    );

  } else if (pageMode === 'board') {

    content = (

      <Suspense fallback={<ViewModeFallback pageMode="board" />}>

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

      </Suspense>

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

