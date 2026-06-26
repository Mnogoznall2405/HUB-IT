import { useCallback } from 'react';
import { Box } from '@mui/material';
import TasksDataModeRouter from '../../components/hub/tasks/TasksDataModeRouter';
import TasksMobileHeader from '../../components/hub/tasks/TasksMobileHeader';
import TasksDesktopToolbar from '../../components/hub/tasks/TasksDesktopToolbar';
import TasksBoardFiltersContainer from '../../components/hub/tasks/containers/TasksBoardFiltersContainer';
import {
  useTasksAnalyticsSlice,
  useTasksCreateSlice,
  useTasksDetailSlice,
  useTasksFiltersSlice,
  useTasksListSlice,
  useTasksUiSlice,
} from './TasksPageContext';
import { useTasksAnalyticsViewProps } from './TasksAnalyticsPanel';

export default function TasksListLayout() {
  const ui = useTasksUiSlice();
  const list = useTasksListSlice();
  const filters = useTasksFiltersSlice();
  const create = useTasksCreateSlice();
  const detail = useTasksDetailSlice();
  const analytics = useTasksAnalyticsSlice();
  const analyticsViewProps = useTasksAnalyticsViewProps();

  const handleToggleCompletedTasks = useCallback(
    () => filters.setCompletedTasksOpen((current) => !current),
    [filters.setCompletedTasksOpen],
  );

  const handleRefresh = useCallback(() => {
    if (filters.pageMode === 'analytics') {
      void analytics.loadTaskAnalytics({ force: true });
    } else {
      void list.loadTasks();
    }
  }, [analytics.loadTaskAnalytics, filters.pageMode, list.loadTasks]);

  const handleOpenNoDueTasks = useCallback(() => {
    filters.setPageMode('deadlines');
    filters.setDueState('none');
  }, [filters.setDueState, filters.setPageMode]);

  const handleCalendarGoToToday = useCallback(() => {
    list.setCalendarMonth(new Date());
  }, [list.setCalendarMonth]);

  return (
    <>
      {ui.isMobile ? (
        <Box sx={{ px: 1, pt: 0.75, pb: 0.35, flexShrink: 0 }}>
          <TasksMobileHeader
            ui={ui.ui}
            mobileTasksCopy={filters.mobileTasksCopy}
            modeLabel={filters.mobileModeLabel}
            itemCount={list.visibleTaskItems.length}
            subtitle={filters.mobileHeaderSubtitle}
            isTaskDataMode={list.isTaskDataMode}
            searchOpen={filters.mobileSearchOpen}
            onSearchOpenChange={filters.setMobileSearchOpen}
            q={filters.q}
            onQChange={filters.setQ}
            searchInputRef={filters.searchInputRef}
            activeFilterCount={filters.activeFilterCount}
            onOpenNavigation={() => filters.setMobileBoardFiltersOpen(true)}
            bottomMode={filters.mobileBottomMode}
            primaryModeOptions={filters.mobilePrimaryModeOptions}
            onPageModeChange={filters.setPageMode}
            viewMode={filters.viewMode}
            onPersonalRoleChange={filters.handlePersonalRoleChange}
            personalRoleCounts={filters.personalRoleCounts}
          />
        </Box>
      ) : null}

      {!ui.isMobile ? (
        <TasksDesktopToolbar
          ui={ui.ui}
          pageMode={filters.pageMode}
          onPageModeChange={filters.setPageMode}
          isTaskDataMode={list.isTaskDataMode}
          boardSummaryItems={filters.boardSummaryItems}
          canWriteTasks={filters.canWriteTasks}
          canCreateTasks={filters.canCreateTasks}
          onRefresh={handleRefresh}
          onOpenTaxonomy={() => create.setTaxonomyOpen(true)}
          onOpenCreate={() => create.setCreateOpen(true)}
          onPrefetchCreateMeta={create.prefetchCreateMeta}
          onPrefetchAnalytics={analytics.prefetchAnalytics}
          viewMode={filters.viewMode}
          onPersonalRoleChange={filters.handlePersonalRoleChange}
          personalRoleCounts={filters.personalRoleCounts}
          secondaryViewMode={filters.secondaryViewMode}
          onSecondaryViewModeChange={filters.setViewMode}
          canManageAllTasks={filters.canManageAllTasks}
          canUseControllerTab={filters.canUseControllerTab}
          focusMode={filters.focusMode}
          focusCounts={list.focusCounts}
          taskDiscussionChatEnabled={filters.taskDiscussionChatEnabled}
          onFocusModeChange={filters.setFocusMode}
          showFilters={filters.showFilters}
          onToggleFilters={() => filters.setShowFilters((prev) => !prev)}
          activeFilterCount={filters.activeFilterCount}
          filtersPanel={<TasksBoardFiltersContainer {...filters.boardFiltersPanelProps} />}
        />
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <TasksDataModeRouter
          pageMode={filters.pageMode}
          isMobile={ui.isMobile}
          ui={ui.ui}
          theme={ui.theme}
          loading={list.loading}
          visibleTaskItems={list.visibleTaskItems}
          taskItems={list.taskItems}
          taskListSections={list.taskListSections}
          completedTasksOpen={filters.completedTasksOpen}
          onToggleCompletedTasks={handleToggleCompletedTasks}
          taskDiscussionChatEnabled={filters.taskDiscussionChatEnabled}
          activeTaskProjects={list.activeTaskProjects}
          onOpenTask={detail.openTaskDetails}
          deadlineBuckets={list.deadlineBuckets}
          canCreateTasks={filters.canCreateTasks}
          onCreateWithPreset={create.openCreateTaskWithPreset}
          renderTaskCard={list.renderTaskCard}
          calendarPayload={list.calendarPayload}
          onShiftMonth={list.shiftCalendarMonth}
          onCalendarGoToToday={handleCalendarGoToToday}
          onOpenNoDueTasks={handleOpenNoDueTasks}
          ganttPayload={list.ganttPayload}
          columnData={list.columnData}
          mobileBoardItems={list.mobileBoardItems}
          focusMode={filters.focusMode}
          analyticsViewProps={analyticsViewProps}
        />
      </Box>
    </>
  );
}
