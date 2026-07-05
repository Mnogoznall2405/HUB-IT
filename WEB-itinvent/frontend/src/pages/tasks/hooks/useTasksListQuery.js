import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import hubTasksAPI from '../../../api/hubTasks';
import hubTaskSupportAPI from '../../../api/hubTaskSupport';
import { departmentsAPI } from '../../../api/departments';
import {
  TASK_MODE_OPTIONS,
  buildCalendarDays,
  buildDeadlineBuckets,
  buildGanttRows,
  buildTaskListSections,
} from '../taskViewModes';
import { KANBAN_COLUMNS } from '../taskConstants';

const TASKS_PAGE_SIZE = 150;

export default function useTasksListQuery({
  setError,
  viewMode,
  debouncedQ,
  statusFilter,
  dueState,
  assigneeFilter,
  controllerFilter,
  departmentFilter,
  hasAttachments,
  unreadCommentsOnly,
  focusMode,
  pageMode,
  canManageAllTasks,
  createOpen = false,
  editOpen = false,
  showFilters = false,
  mobileBoardFiltersOpen = false,
}) {
  const [loading, setLoading] = useState(false);
  const [tasksPayload, setTasksPayload] = useState({ items: [], total: 0 });
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [taskProjects, setTaskProjects] = useState([]);
  const [taskObjects, setTaskObjects] = useState([]);
  const [controllers, setControllers] = useState([]);
  const [taskUsersLoading, setTaskUsersLoading] = useState(false);
  const [taskUsersLoadError, setTaskUsersLoadError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [taskEmailDeadlineDefaultHours, setTaskEmailDeadlineDefaultHours] = useState(24);
  const [listOffset, setListOffset] = useState(0);

  const loadTaskUserDirectoriesPromiseRef = useRef(null);
  const taskDepartmentsLoadedRef = useRef(false);
  const taskProjectMetaLoadedRef = useRef(false);
  const loadTasksRequestRef = useRef(0);

  const loadTaskUserDirectories = useCallback(async ({ force = false } = {}) => {
    if (!force && loadTaskUserDirectoriesPromiseRef.current) {
      return loadTaskUserDirectoriesPromiseRef.current;
    }

    setTaskUsersLoading(true);
    setTaskUsersLoadError('');

    const promise = (async () => {
      try {
        const controllersPayload = await hubTaskSupportAPI.getControllers();
        const controllerItems = Array.isArray(controllersPayload?.items) ? controllersPayload.items : [];
        setControllers(controllerItems);
        return { controllerItems };
      } catch (error) {
        const message = String(error?.response?.data?.detail || error?.message || 'Не удалось загрузить список пользователей');
        setTaskUsersLoadError(message);
        throw error;
      } finally {
        setTaskUsersLoading(false);
        loadTaskUserDirectoriesPromiseRef.current = null;
      }
    })();

    loadTaskUserDirectoriesPromiseRef.current = promise;
    return promise;
  }, []);

  const loadTaskDepartments = useCallback(async ({ force = false } = {}) => {
    if (!force && taskDepartmentsLoadedRef.current) return;
    taskDepartmentsLoadedRef.current = true;
    try {
      const departmentsPayload = await departmentsAPI.list();
      setDepartments(Array.isArray(departmentsPayload?.items) ? departmentsPayload.items : []);
    } catch {
      taskDepartmentsLoadedRef.current = false;
      setDepartments([]);
    }
  }, []);

  const loadTaskProjectMeta = useCallback(async ({ force = false } = {}) => {
    if (!force && taskProjectMetaLoadedRef.current) return;
    taskProjectMetaLoadedRef.current = true;
    try {
      const [projectsPayload, objectsPayload] = await Promise.all([
        hubTaskSupportAPI.getTaskProjects({ include_inactive: true }),
        hubTaskSupportAPI.getTaskObjects({ include_inactive: true }),
      ]);
      setTaskProjects(Array.isArray(projectsPayload?.items) ? projectsPayload.items : []);
      setTaskObjects(Array.isArray(objectsPayload?.items) ? objectsPayload.items : []);
    } catch {
      taskProjectMetaLoadedRef.current = false;
    }
  }, []);

  const loadTaskMeta = useCallback(({ force = false } = {}) => {
    void loadTaskDepartments({ force });
    void loadTaskProjectMeta({ force });
  }, [loadTaskDepartments, loadTaskProjectMeta]);

  const loadTaskUsers = useCallback(({ force = false } = {}) => {
    void loadTaskUserDirectories({ force });
    loadTaskMeta({ force });
  }, [loadTaskMeta, loadTaskUserDirectories]);

  const loadTasks = useCallback(async ({ offset = 0, append = false } = {}) => {
    const requestId = loadTasksRequestRef.current + 1;
    loadTasksRequestRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const scope = viewMode === 'all' ? 'all' : (viewMode === 'department' ? 'department' : 'my');
      const roleScope = viewMode === 'all' || viewMode === 'department' ? 'both' : viewMode;
      const deadlineMode = ['deadlines', 'calendar', 'gantt'].includes(pageMode);
      const response = await hubTasksAPI.getTasks({
        scope,
        role_scope: roleScope,
        status: statusFilter || undefined,
        q: debouncedQ || undefined,
        due_state: dueState || undefined,
        has_attachments: hasAttachments || undefined,
        assignee_user_id: canManageAllTasks && viewMode === 'all' && assigneeFilter ? Number(assigneeFilter) : undefined,
        controller_user_id: controllerFilter ? Number(controllerFilter) : undefined,
        department_id: departmentFilter || undefined,
        unread_comments_only: unreadCommentsOnly || undefined,
        focus_mode: focusMode && focusMode !== 'all' ? focusMode : undefined,
        sort_by: pageMode === 'board' ? 'status' : (deadlineMode ? 'due_at' : 'updated_at'),
        sort_dir: deadlineMode || pageMode === 'board' ? 'asc' : 'desc',
        limit: TASKS_PAGE_SIZE,
        offset,
      });
      if (loadTasksRequestRef.current !== requestId) return;
      const defaultHours = Number(response?.meta?.email_deadline_soon_hours_default);
      if (Number.isFinite(defaultHours) && defaultHours > 0) {
        setTaskEmailDeadlineDefaultHours(defaultHours);
      }
      setTasksPayload((prev) => {
        if (!append) return response || { items: [], total: 0 };
        const prevItems = Array.isArray(prev?.items) ? prev.items : [];
        const nextItems = Array.isArray(response?.items) ? response.items : [];
        return {
          ...(response || {}),
          items: [...prevItems, ...nextItems],
          total: Number(response?.total ?? prev?.total ?? 0),
        };
      });
    } catch (err) {
      if (loadTasksRequestRef.current !== requestId) return;
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки задач');
    } finally {
      if (loadTasksRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    assigneeFilter,
    canManageAllTasks,
    controllerFilter,
    debouncedQ,
    departmentFilter,
    dueState,
    focusMode,
    hasAttachments,
    pageMode,
    setError,
    statusFilter,
    unreadCommentsOnly,
    viewMode,
  ]);

  useEffect(() => {
    setListOffset(0);
  }, [
    assigneeFilter,
    controllerFilter,
    debouncedQ,
    departmentFilter,
    dueState,
    focusMode,
    hasAttachments,
    pageMode,
    statusFilter,
    unreadCommentsOnly,
    viewMode,
  ]);

  useEffect(() => {
    void loadTasks({ offset: listOffset, append: listOffset > 0 });
  }, [listOffset, loadTasks]);

  useEffect(() => {
    void loadTaskDepartments();
  }, [loadTaskDepartments]);

  const needsTaskProjectMeta = createOpen
    || editOpen
    || showFilters
    || mobileBoardFiltersOpen;
  const needsTaskDirectories = needsTaskProjectMeta || Boolean(controllerFilter);

  useEffect(() => {
    if (!needsTaskProjectMeta) return;
    void loadTaskProjectMeta();
  }, [loadTaskProjectMeta, needsTaskProjectMeta]);

  useEffect(() => {
    if (!needsTaskDirectories) return;
    void loadTaskUserDirectories();
  }, [loadTaskUserDirectories, needsTaskDirectories]);

  const patchTaskItem = useCallback((taskId, patch) => {
    const targetId = String(taskId || '').trim();
    if (!targetId) return;
    setTasksPayload((prev) => ({
      ...(prev || {}),
      items: Array.isArray(prev?.items)
        ? prev.items.map((item) => (String(item?.id || '') === targetId ? { ...item, ...(patch || {}) } : item))
        : [],
    }));
  }, []);

  const taskItems = useMemo(() => (
    Array.isArray(tasksPayload?.items) ? tasksPayload.items : []
  ), [tasksPayload]);

  // Backend handles assignee_user_id (admin scope), controller_user_id, unread_comments_only, focus_mode.
  const assigneeFilteredOnServer = canManageAllTasks && viewMode === 'all' && Boolean(assigneeFilter);

  const visibleTaskItems = useMemo(() => taskItems.filter((task) => {
    if (!assigneeFilteredOnServer && assigneeFilter && String(task?.assignee_user_id || '') !== String(assigneeFilter)) return false;
    return true;
  }), [assigneeFilter, assigneeFilteredOnServer, taskItems]);

  const columnData = useMemo(() => {
    const map = {};
    KANBAN_COLUMNS.forEach((column) => {
      map[column.key] = [];
    });
    visibleTaskItems.forEach((task) => {
      const status = String(task?.status || '').toLowerCase();
      if (map[status]) map[status].push(task);
      else map.new.push(task);
    });
    return map;
  }, [visibleTaskItems]);

  const mobileBoardItems = useMemo(
    () => KANBAN_COLUMNS.flatMap((column) => columnData[column.key] || []),
    [columnData],
  );

  const isTaskDataMode = pageMode !== 'analytics';
  const activeTaskModeMeta = useMemo(
    () => TASK_MODE_OPTIONS.find((item) => item.value === pageMode) || TASK_MODE_OPTIONS[0],
    [pageMode],
  );
  const taskGroupingNow = useMemo(() => new Date(), [tasksPayload]);
  const taskListSections = useMemo(
    () => buildTaskListSections(visibleTaskItems, taskGroupingNow),
    [taskGroupingNow, visibleTaskItems],
  );
  const deadlineBuckets = useMemo(
    () => buildDeadlineBuckets(visibleTaskItems, taskGroupingNow),
    [taskGroupingNow, visibleTaskItems],
  );
  const calendarPayload = useMemo(
    () => buildCalendarDays(visibleTaskItems, calendarMonth),
    [calendarMonth, visibleTaskItems],
  );
  const ganttPayload = useMemo(
    () => buildGanttRows(visibleTaskItems),
    [visibleTaskItems],
  );

  const openTasksCount = useMemo(
    () => visibleTaskItems.filter((item) => String(item?.status || '').toLowerCase() !== 'done').length,
    [visibleTaskItems],
  );

  const focusCounts = useMemo(() => ({
    all: visibleTaskItems.length,
    review: visibleTaskItems.filter((item) => String(item?.status || '').toLowerCase() === 'review').length,
    overdue: visibleTaskItems.filter((item) => item?.is_overdue).length,
    comments: visibleTaskItems.filter((item) => item?.has_unread_comments).length,
  }), [visibleTaskItems]);

  const tasksTotal = Number(tasksPayload?.total || 0);
  const hasMoreTasks = taskItems.length < tasksTotal;
  const listTruncated = Boolean(tasksPayload?.truncated);

  const loadMoreTasks = useCallback(() => {
    if (!hasMoreTasks || loading) return;
    setListOffset((prev) => prev + TASKS_PAGE_SIZE);
  }, [hasMoreTasks, loading]);

  const reloadTasks = useCallback(async () => {
    if (listOffset !== 0) {
      setListOffset(0);
      return;
    }
    await loadTasks({ offset: 0, append: false });
  }, [listOffset, loadTasks]);

  const shiftCalendarMonth = useCallback((delta) => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, []);

  const activeTaskProjects = useMemo(
    () => taskProjects.filter((item) => item?.is_active !== false),
    [taskProjects],
  );

  const activeTaskObjects = useMemo(
    () => taskObjects.filter((item) => item?.is_active !== false),
    [taskObjects],
  );

  return {
    loading,
    tasksPayload,
    calendarMonth,
    setCalendarMonth,
    taskProjects,
    taskObjects,
    controllers,
    taskUsersLoading,
    taskUsersLoadError,
    departments,
    taskEmailDeadlineDefaultHours,
    loadTaskUserDirectories,
    loadTaskMeta,
    loadTaskUsers,
    loadTasks: reloadTasks,
    reloadTasks,
    loadMoreTasks,
    hasMoreTasks,
    tasksTotal,
    listTruncated,
    patchTaskItem,
    taskItems,
    visibleTaskItems,
    columnData,
    mobileBoardItems,
    isTaskDataMode,
    activeTaskModeMeta,
    taskListSections,
    deadlineBuckets,
    calendarPayload,
    ganttPayload,
    openTasksCount,
    focusCounts,
    shiftCalendarMonth,
    activeTaskProjects,
    activeTaskObjects,
  };
}
