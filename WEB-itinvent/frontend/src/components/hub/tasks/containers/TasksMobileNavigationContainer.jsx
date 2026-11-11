import TasksMobileNavigationDrawer from '../TasksMobileNavigationDrawer';
import TasksBoardFiltersContainer from './TasksBoardFiltersContainer';
import TasksAnalyticsFiltersContainer from './TasksAnalyticsFiltersContainer';

export default function TasksMobileNavigationContainer({
  boardFiltersPanelProps,
  analyticsFiltersPanelProps,
  ...drawerProps
}) {
  return (
    <TasksMobileNavigationDrawer
      {...drawerProps}
      boardFiltersPanel={<TasksBoardFiltersContainer {...boardFiltersPanelProps} />}
      analyticsFiltersPanel={<TasksAnalyticsFiltersContainer {...analyticsFiltersPanelProps} />}
    />
  );
}
