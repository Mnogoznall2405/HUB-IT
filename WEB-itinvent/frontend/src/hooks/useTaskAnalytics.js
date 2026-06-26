import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hubAPI } from '../api/client';
import {
  buildAnalyticsRangeFromPreset,
  EMPTY_ANALYTICS_PAYLOAD,
} from '../pages/tasks/taskAnalyticsModel';
import {
  buildAnalyticsFocusMeta,
  buildAnalyticsKpis,
  buildAnalyticsParticipantChartData,
  buildAnalyticsParticipantSectionMeta,
  buildAnalyticsProjectSectionMeta,
  buildAnalyticsScopeChart,
  buildAnalyticsStatusChartData,
  buildAnalyticsTrendItems,
  buildProjectObjectCounts,
  buildSelectedAnalyticsParticipant,
  pruneAnalyticsObjectIds,
  resolveAnalyticsObjectOptions,
} from '../pages/tasks/taskAnalyticsViewModel';
import { buildAnalyticsRequestParams } from '../pages/tasks/taskUrlSync';

export default function useTaskAnalytics({
  enabled = false,
  onError,
  activeTaskObjects = [],
  activeTaskProjects = [],
  getAssigneeById,
} = {}) {
  const [desktopFiltersVisible, setDesktopFiltersVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [payload, setPayload] = useState(EMPTY_ANALYTICS_PAYLOAD);
  const [filters, setFilters] = useState(() => ({
    preset: '30d',
    ...buildAnalyticsRangeFromPreset('30d'),
    date_basis: 'protocol_date',
    project_ids: [],
    object_ids: [],
    participant_user_id: '',
  }));

  const requestParams = useMemo(() => buildAnalyticsRequestParams(filters), [filters]);
  const lastLoadedParamsKeyRef = useRef('');
  const loadRequestIdRef = useRef(0);

  const loadAnalytics = useCallback(async ({ force = false } = {}) => {
    const paramsKey = JSON.stringify(requestParams);
    if (!force && lastLoadedParamsKeyRef.current === paramsKey) return;

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const response = await hubAPI.getTaskAnalytics(requestParams);
      if (loadRequestIdRef.current !== requestId) return;
      setPayload(response || EMPTY_ANALYTICS_PAYLOAD);
      lastLoadedParamsKeyRef.current = paramsKey;
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      onError?.(err?.response?.data?.detail || err?.message || 'Ошибка загрузки аналитики задач');
    } finally {
      if (loadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [onError, requestParams]);

  const prefetchAnalytics = useCallback(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    if (!enabled) return;
    void loadAnalytics();
  }, [enabled, loadAnalytics]);

  const objectOptions = useMemo(
    () => resolveAnalyticsObjectOptions({
      activeTaskObjects,
      projectIds: filters.project_ids,
    }),
    [activeTaskObjects, filters.project_ids],
  );

  useEffect(() => {
    const nextObjectIds = pruneAnalyticsObjectIds(filters.object_ids, objectOptions);
    if (!nextObjectIds) return;
    setFilters((prev) => ({ ...prev, object_ids: nextObjectIds }));
  }, [filters.object_ids, objectOptions]);

  const summary = useMemo(() => payload?.summary || {}, [payload]);
  const selectedParticipantId = useMemo(
    () => String(filters.participant_user_id || '').trim(),
    [filters.participant_user_id],
  );
  const selectedParticipantOption = useMemo(
    () => (typeof getAssigneeById === 'function' ? getAssigneeById(selectedParticipantId) : null),
    [getAssigneeById, selectedParticipantId],
  );
  const selectedParticipant = useMemo(
    () => buildSelectedAnalyticsParticipant({
      participantId: selectedParticipantId,
      byParticipant: payload?.by_participant,
      fallbackUser: selectedParticipantOption,
    }),
    [payload?.by_participant, selectedParticipantId, selectedParticipantOption],
  );

  const selectedObjects = useMemo(() => {
    const selectedIds = Array.isArray(filters.object_ids) ? filters.object_ids : [];
    if (!selectedIds.length) return [];
    return selectedIds
      .map((id) => objectOptions.find((item) => String(item?.id || '') === String(id)))
      .filter(Boolean);
  }, [filters.object_ids, objectOptions]);

  const selectedProjects = useMemo(() => {
    const selectedIds = Array.isArray(filters.project_ids) ? filters.project_ids : [];
    if (!selectedIds.length) return [];
    return selectedIds
      .map((id) => activeTaskProjects.find((item) => String(item?.id || '') === String(id)))
      .filter(Boolean);
  }, [activeTaskProjects, filters.project_ids]);

  const participantSectionMeta = useMemo(
    () => buildAnalyticsParticipantSectionMeta({ selectedObjects, selectedProjects }),
    [selectedObjects, selectedProjects],
  );
  const projectSectionMeta = useMemo(
    () => buildAnalyticsProjectSectionMeta({ selectedProjects }),
    [selectedProjects],
  );
  const focusMeta = useMemo(
    () => buildAnalyticsFocusMeta({ selectedObjects, selectedProjects }),
    [selectedObjects, selectedProjects],
  );
  const statusChartData = useMemo(
    () => buildAnalyticsStatusChartData({
      statusBreakdown: payload?.status_breakdown,
      summary,
    }),
    [payload?.status_breakdown, summary],
  );
  const participantChartData = useMemo(
    () => buildAnalyticsParticipantChartData(payload?.by_participant),
    [payload?.by_participant],
  );
  const scopeChart = useMemo(
    () => buildAnalyticsScopeChart({
      objectIds: filters.object_ids,
      projectIds: filters.project_ids,
      byObject: payload?.by_object,
      byProject: payload?.by_project,
    }),
    [filters.object_ids, filters.project_ids, payload?.by_object, payload?.by_project],
  );
  const trendItems = useMemo(
    () => buildAnalyticsTrendItems(payload?.trend),
    [payload?.trend],
  );
  const kpis = useMemo(() => buildAnalyticsKpis(summary), [summary]);
  const projectObjectCounts = useMemo(
    () => buildProjectObjectCounts(activeTaskObjects),
    [activeTaskObjects],
  );

  const selectParticipant = useCallback((participantId) => {
    const nextId = String(participantId || '').trim();
    setFilters((prev) => ({
      ...prev,
      participant_user_id: nextId,
    }));
  }, []);

  const toggleDesktopFilters = useCallback(() => {
    setDesktopFiltersVisible((prev) => !prev);
  }, []);

  return {
    desktopFiltersVisible,
    setDesktopFiltersVisible,
    loading,
    exporting,
    setExporting,
    payload,
    filters,
    setFilters,
    requestParams,
    loadAnalytics,
    prefetchAnalytics,
    objectOptions,
    summary,
    selectedParticipantId,
    selectedParticipantOption,
    selectedParticipant,
    selectedObjects,
    selectedProjects,
    participantSectionMeta,
    projectSectionMeta,
    focusMeta,
    statusChartData,
    participantChartData,
    scopeChart,
    trendItems,
    kpis,
    projectObjectCounts,
    selectParticipant,
    toggleDesktopFilters,
  };
}
