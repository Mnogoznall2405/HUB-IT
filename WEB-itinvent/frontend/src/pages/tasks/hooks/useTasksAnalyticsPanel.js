import { useCallback, useMemo } from 'react';
import useTaskAnalytics from '../../../hooks/useTaskAnalytics';
import { buildAnalyticsTableColumns } from '../taskAnalyticsModel';

export default function useTasksAnalyticsPanel({
  enabled,
  activeTaskObjects,
  activeTaskProjects,
  getAssigneeById,
  setError,
  isAnalyticsMobile,
  mobileBoardFiltersOpen,
  setMobileBoardFiltersOpen,
  ui,
  analyticsAccentColor,
  handleSingleAssigneeAutocompleteChange,
  renderTaskUserOption,
  taskUserAutocompleteSlotProps,
  assigneeAutocompleteProps,
  getAssigneeAutocompleteInputValue,
  getAssigneePickerOptions,
}) {
  const {
    desktopFiltersVisible: analyticsDesktopFiltersVisible,
    setDesktopFiltersVisible: setAnalyticsDesktopFiltersVisible,
    loading: analyticsLoading,
    exporting: analyticsExporting,
    setExporting: setAnalyticsExporting,
    payload: analyticsPayload,
    filters: analyticsFilters,
    setFilters: setAnalyticsFilters,
    requestParams: analyticsRequestParams,
    loadAnalytics: loadTaskAnalytics,
    prefetchAnalytics: prefetchTaskAnalytics,
    objectOptions: analyticsObjectOptions,
    summary: analyticsSummary,
    selectedParticipantId: selectedAnalyticsParticipantId,
    selectedParticipantOption: selectedAnalyticsParticipantOption,
    selectedParticipant: selectedAnalyticsParticipant,
    selectedObjects: selectedAnalyticsObjects,
    selectedProjects: selectedAnalyticsProjects,
    participantSectionMeta: analyticsParticipantSectionMeta,
    projectSectionMeta: analyticsProjectSectionMeta,
    focusMeta: analyticsFocusMeta,
    statusChartData: analyticsStatusChartData,
    participantChartData: analyticsParticipantChartData,
    scopeChart: analyticsScopeChart,
    trendItems: analyticsTrendItems,
    kpis: analyticsKpis,
    selectParticipant: selectAnalyticsParticipant,
  } = useTaskAnalytics({
    enabled,
    activeTaskObjects,
    activeTaskProjects,
    getAssigneeById,
    onError: (message) => setError(message),
  });

  const analyticsTableColumns = useMemo(() => buildAnalyticsTableColumns(), []);

  const analyticsFiltersVisible = isAnalyticsMobile ? mobileBoardFiltersOpen : analyticsDesktopFiltersVisible;
  const analyticsFilterFieldSx = useMemo(() => ({
    '& .MuiInputLabel-root': {
      fontWeight: 700,
    },
    '& .MuiInputLabel-shrink': {
      fontWeight: 800,
    },
    '& .MuiOutlinedInput-root': {
      minHeight: 40,
      borderRadius: '11px',
      bgcolor: ui.panelSolid,
    },
    '& .MuiInputBase-input': {
      py: 1,
    },
    '& .MuiAutocomplete-tag': {
      height: 24,
      fontWeight: 700,
    },
  }), [ui.panelSolid]);

  const toggleAnalyticsFilters = useCallback(() => {
    if (isAnalyticsMobile) {
      setMobileBoardFiltersOpen((prev) => !prev);
      return;
    }
    setAnalyticsDesktopFiltersVisible((prev) => !prev);
  }, [isAnalyticsMobile, setAnalyticsDesktopFiltersVisible, setMobileBoardFiltersOpen]);

  const analyticsFiltersPanelProps = useMemo(() => ({
    ui,
    analyticsAccentColor,
    analyticsFilters,
    onFiltersChange: setAnalyticsFilters,
    analyticsFilterFieldSx,
    activeTaskProjects,
    analyticsObjectOptions,
    activeTaskObjects,
    analyticsFocusMeta,
    selectedAnalyticsParticipant,
    getAssigneePickerOptions,
    selectedAnalyticsParticipantOption,
    onParticipantChange: (participantId) => setAnalyticsFilters((prev) => ({ ...prev, participant_user_id: participantId })),
    handleSingleAssigneeAutocompleteChange,
    renderTaskUserOption,
    taskUserAutocompleteSlotProps,
    assigneeAutocompleteProps,
    getAssigneeAutocompleteInputValue,
  }), [
    activeTaskObjects,
    activeTaskProjects,
    analyticsAccentColor,
    analyticsFilterFieldSx,
    analyticsFilters,
    analyticsFocusMeta,
    analyticsObjectOptions,
    assigneeAutocompleteProps,
    getAssigneeAutocompleteInputValue,
    getAssigneePickerOptions,
    handleSingleAssigneeAutocompleteChange,
    renderTaskUserOption,
    selectedAnalyticsParticipant,
    selectedAnalyticsParticipantOption,
    setAnalyticsFilters,
    taskUserAutocompleteSlotProps,
    ui,
  ]);

  return {
    analyticsDesktopFiltersVisible,
    setAnalyticsDesktopFiltersVisible,
    analyticsLoading,
    analyticsExporting,
    setAnalyticsExporting,
    analyticsPayload,
    analyticsFilters,
    setAnalyticsFilters,
    analyticsRequestParams,
    loadTaskAnalytics,
    prefetchTaskAnalytics,
    analyticsObjectOptions,
    analyticsSummary,
    selectedAnalyticsParticipantId,
    selectedAnalyticsParticipantOption,
    selectedAnalyticsParticipant,
    selectedAnalyticsObjects,
    selectedAnalyticsProjects,
    analyticsParticipantSectionMeta,
    analyticsProjectSectionMeta,
    analyticsFocusMeta,
    analyticsStatusChartData,
    analyticsParticipantChartData,
    analyticsScopeChart,
    analyticsTrendItems,
    analyticsKpis,
    selectAnalyticsParticipant,
    analyticsTableColumns,
    analyticsFiltersVisible,
    toggleAnalyticsFilters,
    analyticsFiltersPanelProps,
  };
}
