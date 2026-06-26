import { useMemo } from 'react';
import {
  useTasksAnalyticsSlice,
  useTasksFiltersSlice,
  useTasksUiSlice,
} from './TasksPageContext';

export function useTasksAnalyticsViewProps() {
  const ui = useTasksUiSlice();
  const filters = useTasksFiltersSlice();
  const analytics = useTasksAnalyticsSlice();

  return useMemo(() => {
    if (filters.pageMode !== 'analytics') return null;
    return {
      ui: ui.ui,
      isAnalyticsMobile: ui.isAnalyticsMobile,
      filtersVisible: analytics.analyticsFiltersVisible,
      onToggleFilters: analytics.toggleAnalyticsFilters,
      onExport: () => void analytics.handleExportTaskAnalytics(),
      analyticsLoading: analytics.analyticsLoading,
      analyticsExporting: analytics.analyticsExporting,
      analyticsAccentColor: ui.analyticsAccentColor,
      analyticsGridStroke: ui.analyticsGridStroke,
      analyticsFocusMeta: analytics.analyticsFocusMeta,
      filtersPanelProps: analytics.analyticsFiltersPanelProps,
      analyticsKpis: analytics.analyticsKpis,
      analyticsPayload: analytics.analyticsPayload,
      analyticsProjectSectionMeta: analytics.analyticsProjectSectionMeta,
      selectedAnalyticsProjects: analytics.selectedAnalyticsProjects,
      selectedAnalyticsObjects: analytics.selectedAnalyticsObjects,
      onSelectParticipant: analytics.selectAnalyticsParticipant,
      analyticsStatusChartData: analytics.analyticsStatusChartData,
      analyticsTrendItems: analytics.analyticsTrendItems,
      analyticsParticipantSectionMeta: analytics.analyticsParticipantSectionMeta,
      analyticsParticipantChartData: analytics.analyticsParticipantChartData,
      analyticsScopeChart: analytics.analyticsScopeChart,
      selectedAnalyticsParticipant: analytics.selectedAnalyticsParticipant,
      analyticsTableColumns: analytics.analyticsTableColumns,
    };
  }, [
    analytics.analyticsExporting,
    analytics.analyticsFiltersPanelProps,
    analytics.analyticsFiltersVisible,
    analytics.analyticsFocusMeta,
    analytics.analyticsKpis,
    analytics.analyticsLoading,
    analytics.analyticsParticipantChartData,
    analytics.analyticsParticipantSectionMeta,
    analytics.analyticsPayload,
    analytics.analyticsProjectSectionMeta,
    analytics.analyticsScopeChart,
    analytics.analyticsStatusChartData,
    analytics.analyticsTableColumns,
    analytics.analyticsTrendItems,
    analytics.handleExportTaskAnalytics,
    analytics.selectAnalyticsParticipant,
    analytics.selectedAnalyticsObjects,
    analytics.selectedAnalyticsParticipant,
    analytics.selectedAnalyticsProjects,
    analytics.toggleAnalyticsFilters,
    filters.pageMode,
    ui.analyticsAccentColor,
    ui.analyticsGridStroke,
    ui.isAnalyticsMobile,
    ui.ui,
  ]);
}

export default function TasksAnalyticsPanel() {
  return null;
}

TasksAnalyticsPanel.useProps = useTasksAnalyticsViewProps;
