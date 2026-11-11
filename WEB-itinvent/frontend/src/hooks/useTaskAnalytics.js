import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import hubTaskAnalyticsAPI from '../api/hubTaskAnalytics';
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
  activeTaskObjects = [],
  activeTaskProjects = [],
  getAssigneeById,
} = {}) {
  const [desktopFiltersVisible, setDesktopFiltersVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [payload, setPayload] = useState(EMPTY_ANALYTICS_PAYLOAD);
  const [loadedParamsKey, setLoadedParamsKey] = useState('');
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(() => ({
    preset: '30d',
    ...buildAnalyticsRangeFromPreset('30d'),
    date_basis: 'protocol_date',
    project_ids: [],
    object_ids: [],
    participant_user_id: '',
  }));

  const requestParams = useMemo(() => buildAnalyticsRequestParams(filters), [filters]);
  const requestParamsKey = useMemo(() => JSON.stringify(requestParams), [requestParams]);
  const lastLoadedParamsKeyRef = useRef('');
  const loadRequestIdRef = useRef(0);
  const inFlightParamsKeysRef = useRef(new Set());

  const loadAnalytics = useCallback(async ({ force = false } = {}) => {
    if (inFlightParamsKeysRef.current.has(requestParamsKey)) return;
    if (!force && lastLoadedParamsKeyRef.current === requestParamsKey) return;

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    inFlightParamsKeysRef.current.add(requestParamsKey);
    setError(null);
    setLoading(true);
    try {
      const response = await hubTaskAnalyticsAPI.getTaskAnalytics(requestParams);
      if (loadRequestIdRef.current !== requestId) return;
      setPayload(response || EMPTY_ANALYTICS_PAYLOAD);
      lastLoadedParamsKeyRef.current = requestParamsKey;
      setLoadedParamsKey(requestParamsKey);
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      const status = Number(err?.response?.status || 0) || null;
      const correlationId = String(
        err?.response?.headers?.['x-correlation-id']
        || err?.response?.headers?.['x-request-id']
        || '',
      ).trim();
      setError({
        paramsKey: requestParamsKey,
        status,
        correlationId,
        message: status === 403
          ? 'Недостаточно прав для просмотра аналитики задач.'
          : 'Не удалось загрузить аналитику задач. Повторите попытку.',
      });
    } finally {
      inFlightParamsKeysRef.current.delete(requestParamsKey);
      if (loadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [requestParams, requestParamsKey]);

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

  const hasCurrentPayload = loadedParamsKey === requestParamsKey;
  const currentPayload = hasCurrentPayload ? payload : EMPTY_ANALYTICS_PAYLOAD;
  const currentError = error?.paramsKey === requestParamsKey ? error : null;
  const summary = useMemo(() => currentPayload?.summary || {}, [currentPayload]);
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
      byParticipant: currentPayload?.by_participant,
      fallbackUser: selectedParticipantOption,
    }),
    [currentPayload?.by_participant, selectedParticipantId, selectedParticipantOption],
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
      statusBreakdown: currentPayload?.status_breakdown,
      summary,
    }),
    [currentPayload?.status_breakdown, summary],
  );
  const participantChartData = useMemo(
    () => buildAnalyticsParticipantChartData(currentPayload?.by_participant),
    [currentPayload?.by_participant],
  );
  const scopeChart = useMemo(
    () => buildAnalyticsScopeChart({
      objectIds: filters.object_ids,
      projectIds: filters.project_ids,
      byObject: currentPayload?.by_object,
      byProject: currentPayload?.by_project,
    }),
    [currentPayload?.by_object, currentPayload?.by_project, filters.object_ids, filters.project_ids],
  );
  const trendItems = useMemo(
    () => buildAnalyticsTrendItems(currentPayload?.trend),
    [currentPayload?.trend],
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
    payload: currentPayload,
    error: currentError,
    hasCurrentPayload,
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
