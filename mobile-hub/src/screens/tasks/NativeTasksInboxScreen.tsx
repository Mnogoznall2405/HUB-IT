import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItemInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatApiError } from '../../api/formatError';
import { listDepartments, type DepartmentRecord } from '../../api/departmentsApi';
import {
  getTasksPage,
  searchTaskAssignees,
  searchTaskControllers,
  type HubTask,
  type TaskAssignee,
  type TaskListPage,
} from '../../api/taskApi';
import { useAuth } from '../../auth/AuthContext';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import {
  readNativeCollectionSnapshot,
  writeNativeCollectionSnapshot,
} from '../../cache/nativeSnapshotCache';
import { NativeTaskRow } from '../../components/tasks/NativeTaskRow';
import { usePreferences } from '../../preferences/PreferencesContext';
import { hubRealtimeSocket } from '../../realtime/hubRealtimeSocket';
import { TASK_STATUS_OPTIONS } from '../../tasks/taskFormat';
import { buildNativeTaskListSections } from '../../tasks/nativeTaskViews';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
} from '../account/AccountChrome';

const PAGE_SIZE = 40;
const SEARCH_DEBOUNCE_MS = 300;

type TaskViewMode = 'assignee' | 'creator' | 'controller' | 'department' | 'all';
type TaskDueState = '' | 'overdue' | 'today' | 'upcoming' | 'none';
type DirectoryKind = 'department' | 'controller' | 'assignee';

type TaskFilterState = {
  viewMode: TaskViewMode;
  status: string;
  dueState: TaskDueState;
  hasAttachments: boolean;
  unreadCommentsOnly: boolean;
  departmentId: string;
  controllerUserId?: number;
  assigneeUserId?: number;
};

type DirectoryOption = {
  value: string;
  label: string;
};

type TaskFeedRow =
  | { key: string; kind: 'section'; label: string; count: number }
  | { key: string; kind: 'task'; task: HubTask }
  | { key: string; kind: 'completed-toggle'; count: number };

const VIEW_OPTIONS: Array<{ value: TaskViewMode; label: string; permission?: 'manage' | 'review' }> = [
  { value: 'assignee', label: 'Исполняю' },
  { value: 'creator', label: 'Поставил' },
  { value: 'department', label: 'Задачи отдела' },
  { value: 'controller', label: 'Контролирую', permission: 'review' },
  { value: 'all', label: 'Все задачи', permission: 'manage' },
];

const DUE_OPTIONS: Array<{ value: TaskDueState; label: string }> = [
  { value: '', label: 'Любой срок' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'today', label: 'Сегодня' },
  { value: 'upcoming', label: 'Предстоящие' },
  { value: 'none', label: 'Без срока' },
];

function baseFilters(viewMode: TaskViewMode): TaskFilterState {
  return {
    viewMode,
    status: '',
    dueState: '',
    hasAttachments: false,
    unreadCommentsOnly: false,
    departmentId: '',
    controllerUserId: undefined,
    assigneeUserId: undefined,
  };
}

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function uniqueTasks(items: HubTask[]): HubTask[] {
  const byId = new Map<string, HubTask>();
  items.forEach((item) => {
    const id = String(item.id || '').trim();
    if (id) byId.set(id, item);
  });
  return Array.from(byId.values());
}

function firstParam(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function personOption(person: TaskAssignee): DirectoryOption {
  return {
    value: String(person.id),
    label: person.full_name || person.username || String(person.id),
  };
}

function taskCountLabel(value: number): string {
  const count = Math.max(0, Number(value) || 0);
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} задач`;
  if (mod10 === 1) return `${count} задача`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} задачи`;
  return `${count} задач`;
}

export function NativeTasksInboxScreen() {
  const params = useLocalSearchParams<{
    q?: string | string[];
    status?: string | string[];
    focusMode?: string | string[];
    taskView?: string | string[];
    taskDue?: string | string[];
    taskFiles?: string | string[];
    taskUnread?: string | string[];
    taskAssignee?: string | string[];
    taskController?: string | string[];
    taskDepartment?: string | string[];
    taskSort?: string | string[];
  }>();
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('tasks.read');
  const canCreate = hasPermission('tasks.create') || hasPermission('tasks.write');
  const canManageAll = String(user?.role || '').trim().toLowerCase() === 'admin' || hasPermission('tasks.manage_all');
  const canReview = hasPermission('tasks.review');
  const defaultView: TaskViewMode = canManageAll ? 'all' : 'assignee';
  const requestedView = firstParam(params.taskView);
  const initialView: TaskViewMode = requestedView === 'all' && canManageAll
    ? 'all'
    : requestedView === 'controller' && canReview
      ? 'controller'
      : ['assignee', 'creator', 'department'].includes(requestedView)
        ? requestedView as TaskViewMode
        : defaultView;
  const requestedFocus = firstParam(params.focusMode);
  const requestedStatus = firstParam(params.status);
  const requestedDue = firstParam(params.taskDue);
  const requestedController = Number(firstParam(params.taskController));
  const requestedAssignee = Number(firstParam(params.taskAssignee));
  const initialFilters: TaskFilterState = {
    viewMode: initialView,
    status: requestedStatus || (requestedFocus === 'review' ? 'review' : ''),
    dueState: DUE_OPTIONS.some((item) => item.value === requestedDue)
      ? requestedDue as TaskDueState
      : requestedFocus === 'overdue' ? 'overdue' : '',
    hasAttachments: firstParam(params.taskFiles) === '1',
    unreadCommentsOnly: firstParam(params.taskUnread) === '1' || requestedFocus === 'comments',
    departmentId: firstParam(params.taskDepartment),
    controllerUserId: requestedController > 0 ? requestedController : undefined,
    assigneeUserId: requestedAssignee > 0 && initialView === 'all' ? requestedAssignee : undefined,
  };

  const [query, setQuery] = useState(firstParam(params.q));
  const [filters, setFilters] = useState<TaskFilterState>(() => initialFilters);
  const [filterDraft, setFilterDraft] = useState<TaskFilterState>(() => initialFilters);
  const [sortByDue, setSortByDue] = useState(firstParam(params.taskSort) === 'asc');
  const [completedTasksOpen, setCompletedTasksOpen] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  const [expandedDirectory, setExpandedDirectory] = useState<DirectoryKind | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [controllers, setControllers] = useState<TaskAssignee[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [directoriesLoading, setDirectoriesLoading] = useState(false);
  const [directoriesLoaded, setDirectoriesLoaded] = useState(false);
  const [items, setItems] = useState<HubTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const debouncedQuery = useDebouncedValue(query);

  const availableViews = VIEW_OPTIONS.filter((option) => (
    (option.permission !== 'manage' || canManageAll)
    && (option.permission !== 'review' || canReview)
  ));
  const additionalViews = availableViews.filter((option) => !['assignee', 'creator'].includes(option.value));

  const loadPage = useCallback(async ({ reset, refresh = false }: { reset: boolean; refresh?: boolean }) => {
    const requestId = ++requestRef.current;
    if (refresh) setRefreshing(true);
    else if (reset) setLoading(true);
    else setLoadingMore(true);
    setError('');
    const request = {
      q: debouncedQuery.trim(),
      status: filters.status,
      focus_mode: '',
      scope: filters.viewMode === 'all' ? 'all' : filters.viewMode === 'department' ? 'department' : 'my',
      role_scope: filters.viewMode === 'all' || filters.viewMode === 'department' ? 'both' : filters.viewMode,
      due_state: filters.dueState,
      department_id: filters.departmentId,
      controller_user_id: filters.controllerUserId,
      assignee_user_id: filters.viewMode === 'all' ? filters.assigneeUserId : undefined,
      has_attachments: filters.hasAttachments,
      unread_comments_only: filters.unreadCommentsOnly,
      sort_by: sortByDue ? 'due_at' : 'updated_at',
      sort_dir: sortByDue ? 'asc' : 'desc',
      limit: PAGE_SIZE,
      offset: reset ? 0 : items.length,
    } as const;
    const signature = JSON.stringify({ ...request, offset: 0 });
    const userId = Number(user?.id || 0);
    let cached = false;
    if (reset && !refresh && userId) {
      const snapshot = await readNativeCollectionSnapshot<{ signature: string; page: TaskListPage }>(
        'tasks-inbox',
        userId,
        signature,
      );
      if (requestId !== requestRef.current) return;
      if (snapshot?.data.signature === signature) {
        cached = true;
        setItems(snapshot.data.page.items);
        setTotal(snapshot.data.page.total);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (requestId === requestRef.current) {
        if (!cached) setError('Нет подключения и сохранённых задач.');
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
      return;
    }
    try {
      const page = await getTasksPage(request);
      if (requestId !== requestRef.current) return;
      const cachedItems = uniqueTasks(reset ? page.items : [...items, ...page.items]);
      setItems(cachedItems);
      setTotal(page.total);
      if (userId) {
        void writeNativeCollectionSnapshot('tasks-inbox', userId, signature, {
          signature,
          page: {
            ...page,
            items: cachedItems,
            offset: 0,
            limit: Math.max(Number(page.limit || 0), cachedItems.length),
          },
        });
      }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setError(cached
        ? 'Нет подключения. Показаны сохранённые задачи.'
        : formatApiError(cause, 'Не удалось загрузить задачи. Проверьте подключение и повторите попытку.'));
      if (reset && !cached) setItems([]);
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [debouncedQuery, filters, items.length, offlineMode, sortByDue, user?.id]);

  useEffect(() => {
    if (allowed) void loadPage({ reset: true });
  }, [allowed, debouncedQuery, filters, sortByDue]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!allowed || offlineMode) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadPage({ reset: true, refresh: true });
      }, 100);
    };
    const releases = [
      hubRealtimeSocket.onTaskChanged(refresh),
      hubRealtimeSocket.on('hub.realtime.connected', refresh),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      releases.forEach((release) => release());
    };
  }, [allowed, loadPage, offlineMode]);

  useEffect(() => {
    if (!filtersVisible || directoriesLoading || directoriesLoaded) return;
    setDirectoriesLoading(true);
    void Promise.all([
      listDepartments(),
      searchTaskControllers('', 100),
      canManageAll ? searchTaskAssignees('', 100) : Promise.resolve([]),
    ]).then(([nextDepartments, nextControllers, nextAssignees]) => {
      setDepartments(nextDepartments);
      setControllers(nextControllers);
      setAssignees(nextAssignees);
    }).catch((cause) => {
      setError(formatApiError(cause, 'Не удалось загрузить отделы и сотрудников. Закройте фильтры и повторите попытку.'));
    }).finally(() => {
      setDirectoriesLoaded(true);
      setDirectoriesLoading(false);
    });
  }, [canManageAll, directoriesLoaded, directoriesLoading, filtersVisible]);

  const activeFilterCount = Number(Boolean(filters.status))
    + Number(Boolean(filters.dueState))
    + Number(filters.hasAttachments)
    + Number(filters.unreadCommentsOnly)
    + Number(Boolean(filters.departmentId))
    + Number(Boolean(filters.controllerUserId))
    + Number(Boolean(filters.assigneeUserId));
  const hasSearchOrFilters = Boolean(query.trim()) || activeFilterCount > 0;
  const scopeLabel = availableViews.find((option) => option.value === filters.viewMode)?.label || 'Область';
  const departmentOptions = departments.map((department) => ({
    value: String(department.id),
    label: String(department.name || department.id),
  }));
  const controllerOptions = controllers.map(personOption);
  const assigneeOptions = assignees.map(personOption);
  const departmentLabel = departmentOptions.find((option) => option.value === filters.departmentId)?.label || filters.departmentId;
  const controllerLabel = controllerOptions.find((option) => option.value === String(filters.controllerUserId))?.label || String(filters.controllerUserId || '');
  const assigneeLabel = assigneeOptions.find((option) => option.value === String(filters.assigneeUserId))?.label || String(filters.assigneeUserId || '');
  const taskListSections = useMemo(() => buildNativeTaskListSections(items), [items]);
  const taskFeedRows = useMemo<TaskFeedRow[]>(() => {
    if (!items.length) return [];
    const rows: TaskFeedRow[] = [{
      key: 'section-active',
      kind: 'section',
      label: 'В работе',
      count: taskListSections.active.items.length,
    }];
    taskListSections.active.items.forEach((task) => rows.push({
      key: `active-${task.id}`,
      kind: 'task',
      task,
    }));
    rows.push({
      key: 'section-completed',
      kind: 'completed-toggle',
      count: taskListSections.completed.items.length,
    });
    if (completedTasksOpen) {
      taskListSections.completed.items.forEach((task) => rows.push({
        key: `completed-${task.id}`,
        kind: 'task',
        task,
      }));
    }
    return rows;
  }, [completedTasksOpen, items.length, taskListSections]);

  const openFilters = () => {
    setFilterDraft(filters);
    setExpandedDirectory(null);
    setDirectoryQuery('');
    setFiltersVisible(true);
  };

  const applyFilters = () => {
    setFilters({
      ...filterDraft,
      assigneeUserId: filterDraft.viewMode === 'all' ? filterDraft.assigneeUserId : undefined,
    });
    setFiltersVisible(false);
    setExpandedDirectory(null);
  };

  const resetAll = () => {
    setQuery('');
    setFilters((current) => baseFilters(current.viewMode));
    setSortByDue(false);
  };

  const selectPrimaryView = (viewMode: 'assignee' | 'creator') => {
    setFilters((current) => ({ ...current, viewMode, assigneeUserId: undefined }));
  };

  const openTask = useCallback((task: HubTask) => {
    router.push({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: String(task.id) },
    } as never);
  }, []);

  const renderTaskFeedRow = useCallback(({ item }: ListRenderItemInfo<TaskFeedRow>) => {
    if (item.kind === 'section') {
      return (
        <View testID="native-task-active-section" style={styles.taskSectionHeader}>
          <Text accessibilityRole="header" style={[styles.taskSectionTitle, { color: tokens.textPrimary }]}>{item.label}</Text>
          <Text style={[styles.taskSectionCount, { color: tokens.textSecondary }]}>{item.count}</Text>
        </View>
      );
    }
    if (item.kind === 'completed-toggle') {
      return (
        <Pressable
          testID="native-task-completed-toggle"
          accessibilityRole="button"
          accessibilityLabel={`${completedTasksOpen ? 'Скрыть' : 'Показать'} завершённые задачи. ${item.count}`}
          accessibilityState={{ expanded: completedTasksOpen }}
          onPress={() => setCompletedTasksOpen((value) => !value)}
          style={({ pressed }) => [styles.completedToggle, { backgroundColor: tokens.panelInset }, pressed && styles.pressed]}
        >
          <View style={styles.completedToggleText}>
            <Text style={[styles.taskSectionTitle, { color: tokens.textPrimary }]}>Завершённые</Text>
            <Text style={[styles.taskSectionCount, { color: tokens.textSecondary }]}>{item.count}</Text>
          </View>
          <MaterialCommunityIcons name={completedTasksOpen ? 'chevron-up' : 'chevron-down'} size={22} color={tokens.iconMuted} />
        </Pressable>
      );
    }
    return (
      <NativeTaskRow
        task={item.task}
        tokens={tokens}
        personRole={filters.viewMode === 'assignee' ? 'created_by' : 'assignee'}
        onPress={openTask}
      />
    );
  }, [completedTasksOpen, filters.viewMode, openTask, tokens]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Задачи" tokens={tokens}>
        <AccountSectionCard
          tokens={tokens}
          title="Нет доступа к задачам"
          description="Обратитесь к администратору, чтобы получить доступ."
        >
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Задачи"
      tokens={tokens}
      scroll={false}
      rightAction={(
        <View style={styles.headerActions}>
          {canCreate ? (
            <Pressable
              testID="native-task-create"
              onPress={() => router.push('/(shell)/tasks/create' as never)}
              accessibilityRole="button"
              accessibilityLabel="Создать задачу"
              style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="plus" size={25} color={tokens.primary} />
            </Pressable>
          ) : null}
          <Pressable
            testID="native-task-list-more"
            onPress={() => setMoreVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Другие действия с задачами"
            accessibilityState={{ expanded: moreVisible }}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="dots-vertical" size={23} color={tokens.iconMuted} />
          </Pressable>
        </View>
      )}
    >
      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
        <TextInput
          testID="native-tasks-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск по названию и описанию"
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Поиск по названию и описанию задачи"
          returnKeyType="search"
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Очистить поиск"
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.scopeRow}>
        <View style={[styles.scopeSegment, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
          <ScopeButton testID="native-task-primary-view-assignee" label="Исполняю" selected={filters.viewMode === 'assignee'} tokens={tokens} onPress={() => selectPrimaryView('assignee')} />
          <ScopeButton testID="native-task-primary-view-creator" label="Созданные" selected={filters.viewMode === 'creator'} tokens={tokens} onPress={() => selectPrimaryView('creator')} />
        </View>
      </View>

      <View style={styles.toolbarRow}>
        <Pressable
          testID="native-task-list-filters-toggle"
          onPress={openFilters}
          accessibilityRole="button"
          accessibilityLabel={activeFilterCount
            ? `Открыть фильтры и области. Сейчас: ${scopeLabel}. Применено фильтров: ${activeFilterCount}`
            : `Открыть фильтры и области. Сейчас: ${scopeLabel}`}
          accessibilityState={{ expanded: filtersVisible }}
          style={({ pressed }) => [styles.toolbarButton, { backgroundColor: tokens.panelSolid, borderColor: activeFilterCount ? tokens.selectedBorder : tokens.borderSoft }, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name={activeFilterCount ? 'filter-check' : 'filter-variant'} size={19} color={activeFilterCount ? tokens.primary : tokens.iconMuted} />
          <Text numberOfLines={1} style={[styles.toolbarText, { color: activeFilterCount ? tokens.primary : tokens.textPrimary }]}>
            {!['assignee', 'creator'].includes(filters.viewMode) ? scopeLabel : 'Фильтры'}{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </Text>
        </Pressable>
        <Pressable
          testID="native-task-sort-due"
          onPress={() => setSortByDue((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={sortByDue ? 'Сортировка: ближайший срок. Выбрать сначала обновлённые' : 'Сортировка: сначала обновлённые. Выбрать ближайший срок'}
          style={({ pressed }) => [styles.toolbarButton, styles.sortButton, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name={sortByDue ? 'calendar-arrow-right' : 'sort-clock-descending-outline'} size={19} color={tokens.iconMuted} />
          <Text numberOfLines={1} style={[styles.toolbarText, { color: tokens.textPrimary }]}>{sortByDue ? 'Ближайший срок' : 'Обновлённые'}</Text>
        </Pressable>
      </View>

      {activeFilterCount ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.appliedFiltersRow}>
          {filters.status ? <AppliedFilterChip label={TASK_STATUS_OPTIONS.find((item) => item.value === filters.status)?.label || filters.status} tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, status: '' }))} /> : null}
          {filters.dueState ? <AppliedFilterChip label={DUE_OPTIONS.find((item) => item.value === filters.dueState)?.label || filters.dueState} tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, dueState: '' }))} /> : null}
          {filters.hasAttachments ? <AppliedFilterChip label="С файлами" tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, hasAttachments: false }))} /> : null}
          {filters.unreadCommentsOnly ? <AppliedFilterChip label="Новые комментарии" tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, unreadCommentsOnly: false }))} /> : null}
          {filters.departmentId ? <AppliedFilterChip label={`Отдел: ${departmentLabel}`} tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, departmentId: '' }))} /> : null}
          {filters.controllerUserId ? <AppliedFilterChip label={`Контролёр: ${controllerLabel}`} tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, controllerUserId: undefined }))} /> : null}
          {filters.assigneeUserId ? <AppliedFilterChip label={`Исполнитель: ${assigneeLabel}`} tokens={tokens} onRemove={() => setFilters((current) => ({ ...current, assigneeUserId: undefined }))} /> : null}
        </ScrollView>
      ) : null}

      <View style={styles.resultRow}>
        <Text accessibilityRole="header" style={[styles.count, { color: tokens.textSecondary }]}>
          {loading && items.length === 0 ? 'Загружаем задачи…' : taskCountLabel(total)}
        </Text>
        {loading && items.length > 0 ? <ActivityIndicator size="small" color={tokens.primary} /> : null}
      </View>

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorCard, { backgroundColor: `${tokens.error}12`, borderColor: `${tokens.error}40` }]}>
          <Text style={[styles.error, { color: tokens.error }]}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void loadPage({ reset: true }); }} style={styles.retryButton}>
            <Text style={[styles.retryText, { color: tokens.error }]}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <AccountLoading tokens={tokens} />
      ) : (
        <FlatList
          testID="native-tasks-list"
          data={taskFeedRows}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadPage({ reset: true, refresh: true }); }}
          onEndReached={() => {
            if (!loadingMore && items.length < total) void loadPage({ reset: false });
          }}
          onEndReachedThreshold={0.35}
          contentContainerStyle={taskFeedRows.length === 0 ? styles.emptyList : styles.listContent}
          ListEmptyComponent={error ? null : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: tokens.panelInset }]}>
                <MaterialCommunityIcons name={hasSearchOrFilters ? 'filter-off-outline' : 'clipboard-text-outline'} size={27} color={tokens.iconMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>{hasSearchOrFilters ? 'Задачи не найдены' : 'Задач пока нет'}</Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>
                {hasSearchOrFilters ? 'Измените условия поиска или сбросьте фильтры.' : 'Новые задачи появятся здесь.'}
              </Text>
              {hasSearchOrFilters ? (
                <Pressable testID="native-task-empty-reset" accessibilityRole="button" onPress={resetAll} style={({ pressed }) => [styles.emptyAction, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}>
                  <Text style={[styles.emptyActionText, { color: tokens.primary }]}>Сбросить поиск и фильтры</Text>
                </Pressable>
              ) : canCreate ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/(shell)/tasks/create' as never)} style={({ pressed }) => [styles.emptyAction, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}>
                  <Text style={[styles.emptyActionText, { color: tokens.primary }]}>Создать задачу</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={tokens.primary} style={styles.footerLoader} /> : null}
          renderItem={renderTaskFeedRow}
        />
      )}

      <Modal visible={filtersVisible} transparent animationType="slide" onRequestClose={() => setFiltersVisible(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} {...chatKeyboardAvoidingProps()}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть фильтры" onPress={() => setFiltersVisible(false)} />
          <View testID="native-task-filter-sheet" accessibilityViewIsModal style={[styles.filterSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <SheetHeader title="Фильтры задач" subtitle="Выберите условия и примените их к списку" tokens={tokens} onClose={() => setFiltersVisible(false)} />
            <ScrollView style={styles.filterList} contentContainerStyle={styles.filterContent} keyboardShouldPersistTaps="handled">
              <FilterSection title="Дополнительные области" tokens={tokens}>
                <View style={styles.wrapRow}>
                  {additionalViews.map((option) => (
                    <FilterChip
                      key={option.value}
                      testID={`native-task-view-${option.value}`}
                      label={option.label}
                      selected={filterDraft.viewMode === option.value}
                      tokens={tokens}
                      onPress={() => setFilterDraft((current) => ({
                        ...current,
                        viewMode: option.value,
                        assigneeUserId: option.value === 'all' ? current.assigneeUserId : undefined,
                      }))}
                    />
                  ))}
                </View>
              </FilterSection>

              <FilterSection title="Статус" tokens={tokens}>
                <View style={styles.wrapRow}>
                  {TASK_STATUS_OPTIONS.map((option) => (
                    <FilterChip key={option.value || 'all'} testID={`native-task-status-${option.value || 'all'}`} label={option.label} selected={filterDraft.status === option.value} tokens={tokens} onPress={() => setFilterDraft((current) => ({ ...current, status: option.value }))} />
                  ))}
                </View>
              </FilterSection>

              <FilterSection title="Срок" tokens={tokens}>
                <View style={styles.wrapRow}>
                  {DUE_OPTIONS.map((option) => (
                    <FilterChip key={option.value || 'any'} testID={`native-task-due-${option.value || 'any'}`} label={option.label} selected={filterDraft.dueState === option.value} tokens={tokens} onPress={() => setFilterDraft((current) => ({ ...current, dueState: option.value }))} />
                  ))}
                </View>
              </FilterSection>

              <FilterSection title="Содержимое" tokens={tokens}>
                <ToggleRow testID="native-task-files-only" label="Есть файлы" selected={filterDraft.hasAttachments} tokens={tokens} onPress={() => setFilterDraft((current) => ({ ...current, hasAttachments: !current.hasAttachments }))} />
                <ToggleRow testID="native-task-unread-only" label="Есть новые комментарии" selected={filterDraft.unreadCommentsOnly} tokens={tokens} onPress={() => setFilterDraft((current) => ({ ...current, unreadCommentsOnly: !current.unreadCommentsOnly }))} />
              </FilterSection>

              <FilterSection title="Участники и отдел" tokens={tokens}>
                {directoriesLoading ? <ActivityIndicator color={tokens.primary} style={styles.directoryLoader} /> : null}
                <DirectorySelector
                  kind="department"
                  label="Конкретный отдел"
                  selectedValue={filterDraft.departmentId}
                  options={departmentOptions}
                  expanded={expandedDirectory === 'department'}
                  query={expandedDirectory === 'department' ? directoryQuery : ''}
                  tokens={tokens}
                  onToggle={() => { setExpandedDirectory((current) => current === 'department' ? null : 'department'); setDirectoryQuery(''); }}
                  onQueryChange={setDirectoryQuery}
                  onSelect={(value) => { setFilterDraft((current) => ({ ...current, departmentId: value })); setExpandedDirectory(null); }}
                />
                <DirectorySelector
                  kind="controller"
                  label="Контролёр"
                  selectedValue={String(filterDraft.controllerUserId || '')}
                  options={controllerOptions}
                  expanded={expandedDirectory === 'controller'}
                  query={expandedDirectory === 'controller' ? directoryQuery : ''}
                  tokens={tokens}
                  onToggle={() => { setExpandedDirectory((current) => current === 'controller' ? null : 'controller'); setDirectoryQuery(''); }}
                  onQueryChange={setDirectoryQuery}
                  onSelect={(value) => { setFilterDraft((current) => ({ ...current, controllerUserId: value ? Number(value) : undefined })); setExpandedDirectory(null); }}
                />
                {filterDraft.viewMode === 'all' ? (
                  <DirectorySelector
                    kind="assignee"
                    label="Исполнитель"
                    selectedValue={String(filterDraft.assigneeUserId || '')}
                    options={assigneeOptions}
                    expanded={expandedDirectory === 'assignee'}
                    query={expandedDirectory === 'assignee' ? directoryQuery : ''}
                    tokens={tokens}
                    onToggle={() => { setExpandedDirectory((current) => current === 'assignee' ? null : 'assignee'); setDirectoryQuery(''); }}
                    onQueryChange={setDirectoryQuery}
                    onSelect={(value) => { setFilterDraft((current) => ({ ...current, assigneeUserId: value ? Number(value) : undefined })); setExpandedDirectory(null); }}
                  />
                ) : null}
              </FilterSection>
            </ScrollView>
            <View style={[styles.filterActions, { borderColor: tokens.borderSoft }]}>
              <Pressable
                testID="native-task-clear-advanced-filters"
                accessibilityRole="button"
                accessibilityLabel="Сбросить фильтры"
                onPress={() => setFilterDraft((current) => baseFilters(current.viewMode))}
                style={({ pressed }) => [styles.secondaryAction, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}
              >
                <Text style={[styles.actionText, { color: tokens.textSecondary }]}>Сбросить</Text>
              </Pressable>
              <Pressable
                testID="native-task-apply-filters"
                accessibilityRole="button"
                accessibilityLabel="Применить фильтры"
                onPress={applyFilters}
                style={({ pressed }) => [styles.primaryAction, { backgroundColor: tokens.primary }, pressed && styles.pressed]}
              >
                <Text style={[styles.actionText, { color: '#fff' }]}>Показать задачи</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={moreVisible} transparent animationType="slide" onRequestClose={() => setMoreVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть меню действий" onPress={() => setMoreVisible(false)} />
          <View accessibilityViewIsModal style={[styles.moreSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <SheetHeader title="Задачи" subtitle="Дополнительные разделы и действия" tokens={tokens} onClose={() => setMoreVisible(false)} />
            <MoreAction testID="native-task-analytics" icon="chart-box-outline" label="Открыть аналитику" tokens={tokens} onPress={() => { setMoreVisible(false); router.push('/(shell)/tasks/analytics' as never); }} />
            {hasPermission('tasks.write') ? <MoreAction testID="native-task-open-taxonomy" icon="folder-cog-outline" label="Управлять проектами и объектами" tokens={tokens} onPress={() => { setMoreVisible(false); router.push('/(shell)/tasks/taxonomy' as never); }} /> : null}
          </View>
        </View>
      </Modal>
    </AccountScreenScaffold>
  );
}

function ScopeButton({ label, selected, tokens, onPress, testID }: {
  label: string;
  selected: boolean;
  tokens: FluentTokens;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.scopeButton, { backgroundColor: selected ? tokens.panelSolid : 'transparent' }, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.scopeButtonText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function FilterSection({ title, tokens, children }: { title: string; tokens: FluentTokens; children: React.ReactNode }) {
  return <View style={styles.filterSection}><Text accessibilityRole="header" style={[styles.filterSectionTitle, { color: tokens.textPrimary }]}>{title}</Text>{children}</View>;
}

function FilterChip({ label, selected, tokens, onPress, testID }: { label: string; selected: boolean; tokens: FluentTokens; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.filterChip, { backgroundColor: selected ? tokens.selected : tokens.panelSolid, borderColor: selected ? tokens.selectedBorder : tokens.borderSoft }, pressed && styles.pressed]}>
      <Text style={[styles.filterChipText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({ label, selected, tokens, onPress, testID }: { label: string; selected: boolean; tokens: FluentTokens; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.toggleRow, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={23} color={selected ? tokens.primary : tokens.iconMuted} />
      <Text style={[styles.toggleLabel, { color: tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function AppliedFilterChip({ label, tokens, onRemove }: { label: string; tokens: FluentTokens; onRemove: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Убрать фильтр: ${label}`} onPress={onRemove} style={({ pressed }) => [styles.appliedFilterChip, { backgroundColor: tokens.selected, borderColor: tokens.selectedBorder }, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.appliedFilterText, { color: tokens.primary }]}>{label}</Text>
      <MaterialCommunityIcons name="close" size={16} color={tokens.primary} />
    </Pressable>
  );
}

function DirectorySelector({ kind, label, selectedValue, options, expanded, query, tokens, onToggle, onQueryChange, onSelect }: {
  kind: DirectoryKind;
  label: string;
  selectedValue: string;
  options: DirectoryOption[];
  expanded: boolean;
  query: string;
  tokens: FluentTokens;
  onToggle: () => void;
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const selectedLabel = options.find((option) => option.value === selectedValue)?.label || (selectedValue || 'Любой');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = options.filter((option) => !normalizedQuery || option.label.toLowerCase().includes(normalizedQuery)).slice(0, 12);
  const testPrefix = `native-task-${kind}`;
  return (
    <View style={styles.directoryBlock}>
      <Pressable testID={`${testPrefix}-selector`} accessibilityRole="button" accessibilityLabel={`${label}. Выбрано: ${selectedLabel}`} accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => [styles.directorySelector, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }, pressed && styles.pressed]}>
        <View style={styles.directorySelectorText}><Text style={[styles.directoryLabel, { color: tokens.textSecondary }]}>{label}</Text><Text numberOfLines={1} style={[styles.directoryValue, { color: tokens.textPrimary }]}>{selectedLabel}</Text></View>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={21} color={tokens.iconMuted} />
      </Pressable>
      {expanded ? (
        <View style={[styles.directoryOptions, { borderColor: tokens.borderSoft }]}>
          <View style={[styles.directorySearch, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}><MaterialCommunityIcons name="magnify" size={18} color={tokens.iconMuted} /><TextInput testID={`${testPrefix}-search`} value={query} onChangeText={onQueryChange} placeholder={`Найти: ${label.toLowerCase()}`} placeholderTextColor={tokens.textTertiary} accessibilityLabel={`Поиск: ${label}`} style={[styles.directorySearchInput, { color: tokens.textPrimary }]} /></View>
          <DirectoryOptionRow testID={`${testPrefix}-any`} label="Любой" selected={!selectedValue} tokens={tokens} onPress={() => onSelect('')} />
          {visibleOptions.map((option) => <DirectoryOptionRow key={option.value} testID={`${testPrefix}-${option.value}`} label={option.label} selected={selectedValue === option.value} tokens={tokens} onPress={() => onSelect(option.value)} />)}
          {!visibleOptions.length ? <Text style={[styles.directoryEmpty, { color: tokens.textSecondary }]}>Ничего не найдено</Text> : null}
          {options.length > visibleOptions.length && !normalizedQuery ? <Text style={[styles.directoryHint, { color: tokens.textSecondary }]}>Показаны первые 12. Используйте поиск.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function DirectoryOptionRow({ testID, label, selected, tokens, onPress }: { testID: string; label: string; selected: boolean; tokens: FluentTokens; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.directoryOption, { backgroundColor: selected ? tokens.selected : 'transparent' }, pressed && styles.pressed]}>
      <Text numberOfLines={2} style={[styles.directoryOptionText, { color: selected ? tokens.primary : tokens.textPrimary }]}>{label}</Text>{selected ? <MaterialCommunityIcons name="check" size={20} color={tokens.primary} /> : null}
    </Pressable>
  );
}

function SheetHeader({ title, subtitle, tokens, onClose }: { title: string; subtitle: string; tokens: FluentTokens; onClose: () => void }) {
  return (
    <View style={styles.sheetHeader}><View style={styles.sheetHeaderText}><Text accessibilityRole="header" style={[styles.sheetTitle, { color: tokens.textPrimary }]}>{title}</Text><Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>{subtitle}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}><MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} /></Pressable></View>
  );
}

function MoreAction({ testID, icon, label, tokens, onPress }: { testID: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; tokens: FluentTokens; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.moreAction, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}><MaterialCommunityIcons name={icon} size={22} color={tokens.primary} /><Text style={[styles.moreActionText, { color: tokens.textPrimary }]}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} /></Pressable>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.96 }] },
  offline: { minHeight: 42, borderRadius: 12, paddingHorizontal: 11, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  searchBox: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scopeRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 12 },
  scopeSegment: { flex: 1, minWidth: 0, minHeight: 46, borderWidth: 1, borderRadius: 14, padding: 3, flexDirection: 'row', alignItems: 'stretch' },
  scopeButton: { flex: 1, minWidth: 0, minHeight: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  scopeButtonText: { fontSize: 13, fontWeight: '800' },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  toolbarButton: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  sortButton: { flex: 1, minWidth: 0 },
  toolbarText: { flexShrink: 1, fontSize: 13, fontWeight: '800' },
  appliedFiltersRow: { gap: 8, paddingTop: 10, paddingRight: 28 },
  appliedFilterChip: { maxWidth: 240, minHeight: 36, borderWidth: 1, borderRadius: 18, paddingLeft: 11, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  appliedFilterText: { flexShrink: 1, fontSize: 12, fontWeight: '800' },
  resultRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  count: { fontSize: 13, fontWeight: '700' },
  errorCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  retryButton: { minHeight: 40, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 13, fontWeight: '900' },
  listContent: { gap: 10, paddingBottom: 8 },
  taskSectionHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  taskSectionTitle: { flex: 1, fontSize: 14, fontWeight: '900' },
  taskSectionCount: { fontSize: 12, fontWeight: '900' },
  completedToggle: { minHeight: 46, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  completedToggleText: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  emptyState: { alignItems: 'center', paddingHorizontal: 22 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { textAlign: 'center', fontSize: 17, fontWeight: '900' },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 20, marginTop: 6 },
  emptyAction: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  emptyActionText: { fontSize: 14, fontWeight: '900' },
  footerLoader: { marginVertical: 12 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  backdropDismissLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  filterSheet: { maxHeight: '90%', minHeight: '68%', borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  moreSheet: { borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 18, overflow: 'hidden' },
  sheetHeader: { minHeight: 76, paddingLeft: 16, paddingRight: 8, paddingVertical: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sheetHeaderText: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  sheetSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filterList: { flex: 1 },
  filterContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 24 },
  filterSection: { gap: 10 },
  filterSectionTitle: { fontSize: 15, fontWeight: '900' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: 13, fontWeight: '800' },
  toggleRow: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleLabel: { flex: 1, fontSize: 14, fontWeight: '700' },
  directoryLoader: { marginVertical: 8 },
  directoryBlock: { gap: 6 },
  directorySelector: { minHeight: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  directorySelectorText: { flex: 1, minWidth: 0 },
  directoryLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  directoryValue: { fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 1 },
  directoryOptions: { borderWidth: 1, borderRadius: 14, padding: 8, gap: 2 },
  directorySearch: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingLeft: 10, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 7 },
  directorySearchInput: { flex: 1, minHeight: 42, fontSize: 14 },
  directoryOption: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  directoryOptionText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  directoryEmpty: { textAlign: 'center', fontSize: 13, paddingVertical: 14 },
  directoryHint: { fontSize: 12, lineHeight: 17, paddingHorizontal: 10, paddingVertical: 6 },
  filterActions: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, flexDirection: 'row', gap: 10 },
  secondaryAction: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  primaryAction: { flex: 1, minHeight: 48, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '900' },
  moreAction: { minHeight: 56, borderTopWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreActionText: { flex: 1, fontSize: 15, fontWeight: '800' },
});
