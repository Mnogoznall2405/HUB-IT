import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Tasks from './Tasks';
import { hubAPI } from '../api/client';
import { departmentsAPI } from '../api/departments';

const authState = vi.hoisted(() => ({
  user: { id: 1, role: 'admin', username: 'admin', permissions: [] },
}));

const chatFeatureFlags = vi.hoisted(() => ({
  chat: false,
  taskDiscussion: false,
}));

function installMatchMedia({ mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile ? query.includes('max-width:599.95px') : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

vi.mock('../api/client', () => ({
  hubAPI: {
    getAssignees: vi.fn(),
    getControllers: vi.fn(),
    getTaskProjects: vi.fn(),
    getTaskObjects: vi.fn(),
    getTaskAnalytics: vi.fn(),
    exportTaskAnalyticsExcel: vi.fn(),
    getTasks: vi.fn(),
    getTask: vi.fn(),
    getTaskComments: vi.fn(),
    getTaskStatusLog: vi.fn(),
    markTaskCommentsSeen: vi.fn(),
    transformMarkdown: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    downloadTaskReport: vi.fn(),
    createTask: vi.fn(),
    createTaskProject: vi.fn(),
    createTaskObject: vi.fn(),
    reviewTask: vi.fn(),
    startTask: vi.fn(),
    submitTask: vi.fn(),
    deleteTask: vi.fn(),
    updateTask: vi.fn(),
    updateTaskProject: vi.fn(),
    updateTaskObject: vi.fn(),
    uploadTaskAttachment: vi.fn(),
    addTaskComment: vi.fn(),
    openTaskDiscussion: vi.fn(),
  },
}));

vi.mock('../lib/chatFeature', () => ({
  get CHAT_FEATURE_ENABLED() {
    return chatFeatureFlags.chat;
  },
  get TASK_DISCUSSION_CHAT_ENABLED() {
    return chatFeatureFlags.taskDiscussion;
  },
  get CHAT_WS_ENABLED() {
    return false;
  },
}));

vi.mock('../api/departments', () => ({
  departmentsAPI: {
    list: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => {
    const hasPermission = (permission) => {
      const target = String(permission || '').trim();
      if (!target) return false;
      if (String(authState.user?.role || '').trim().toLowerCase() === 'admin') return true;
      const permissions = Array.isArray(authState.user?.permissions) ? authState.user.permissions : [];
      return permissions.includes(target);
    };
    return {
      user: authState.user,
      hasPermission,
      hasAnyPermission: (permissions) => Array.isArray(permissions) && permissions.some((permission) => hasPermission(permission)),
    };
  },
}));

vi.mock('../components/layout/ShellNotificationsButton', () => ({
  default: () => <button type="button" data-testid="shell-notifications-button">Уведомления</button>,
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({
    children,
    contentMode = 'default',
    mobileBottomNavMode = 'auto',
  }) => (
    <div
      data-testid="main-layout"
      data-content-mode={contentMode}
      data-mobile-bottom-nav-mode={mobileBottomNavMode}
    >
      {children}
    </div>
  ),
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../components/hub/MarkdownRenderer', () => ({
  default: ({ value }) => <div>{value}</div>,
}));

vi.mock('../components/hub/MarkdownEditor', () => ({
  default: ({ value, onChange }) => (
    <textarea
      aria-label="markdown-editor"
      value={value || ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock('recharts', () => {
  const Wrap = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: ({ children }) => <div data-testid="recharts-responsive">{children}</div>,
    PieChart: Wrap,
    Pie: Wrap,
    Cell: () => null,
    Tooltip: Wrap,
    Legend: Wrap,
    BarChart: Wrap,
    Bar: Wrap,
    CartesianGrid: () => null,
    LineChart: Wrap,
    Line: Wrap,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

async function selectAutocompleteOption(label, query, optionText, scope = screen) {
  const queries = typeof scope?.getByRole === 'function' ? scope : within(scope);
  const input = queries.getByRole('combobox', { name: label });
  fireEvent.change(input, { target: { value: query } });
  await waitFor(() => {
    expect(input.getAttribute('aria-controls')).toBeTruthy();
  });
  const listboxId = input.getAttribute('aria-controls');
  const listbox = await waitFor(() => {
    const nextListbox = document.getElementById(listboxId);
    expect(nextListbox).toBeTruthy();
    return nextListbox;
  });
  fireEvent.click(within(listbox).getByText(optionText));
  return input;
}

function toLocalDateTimeInput(value) {
  const parsed = new Date(value);
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function setRichEditorHtml(editor, html) {
  editor.innerHTML = html;
  fireEvent.input(editor);
}

const taskSummary = {
  id: 'task-1',
  title: 'Проверить акт перемещения',
  status: 'in_progress',
  priority: 'high',
  checklist_items: [
    { id: 'check-1', text: 'Проверить доступ', done: false },
    { id: 'check-2', text: 'Сообщить пользователю', done: true },
  ],
  checklist_total: 2,
  checklist_done: 1,
  assignee_user_id: 1,
  assignee_full_name: 'Исполнитель И.И.',
  controller_user_id: 2,
  controller_full_name: 'Контролер К.К.',
  created_by_user_id: 3,
  created_by_full_name: 'Постановщик П.П.',
  reviewer_full_name: '',
  description: 'Нужно загрузить и проверить подписанный акт.',
  comments_count: 1,
  attachments_count: 1,
  has_unread_comments: false,
  is_overdue: false,
  due_at: '2026-03-21T10:00:00Z',
  updated_at: '2026-03-21T09:30:00Z',
  created_at: '2026-03-21T09:00:00Z',
  submitted_at: null,
  reviewed_at: null,
  review_comment: 'Проверьте номера и PDF.',
  latest_report: {
    id: 'report-1',
    file_name: 'report.pdf',
    uploaded_at: '2026-03-21T09:15:00Z',
    uploaded_by_username: 'operator',
    comment: 'Черновик акта приложен.',
  },
  attachments: [
    {
      id: 'att-1',
      file_name: 'акт-перемещения.pdf',
      file_size: 2048,
      uploaded_at: '2026-03-21T09:10:00Z',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  installMatchMedia();
  authState.user = { id: 1, role: 'admin', username: 'admin', permissions: [] };
  Object.defineProperty(window.URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'blob:task-analytics'),
  });
  Object.defineProperty(window.URL, 'revokeObjectURL', {
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    writable: true,
    value: vi.fn(),
  });

  hubAPI.getAssignees.mockResolvedValue({
    items: [
      { id: 1, username: 'assignee', full_name: 'Исполнитель И.И.' },
      { id: 4, username: 'ivanov', full_name: 'Иванов И.И.' },
    ],
  });
  hubAPI.getControllers.mockResolvedValue({
    items: [{ id: 2, username: 'controller', full_name: 'Контролер К.К.' }],
  });
  hubAPI.getTaskProjects.mockResolvedValue({
    items: [{ id: 'project-1', name: 'Проект Север', is_active: true }],
  });
  hubAPI.getTaskObjects.mockResolvedValue({
    items: [{ id: 'object-1', project_id: 'project-1', name: 'Объект 17', is_active: true }],
  });
  departmentsAPI.list.mockResolvedValue({ items: [] });
  hubAPI.getTaskAnalytics.mockResolvedValue({
    summary: {
      total: 5,
      open: 3,
      new: 1,
      in_progress: 1,
      review: 1,
      done: 2,
      done_on_time: 1,
      done_without_due: 1,
      overdue: 1,
      with_due_total: 4,
      completion_percent: 40,
      completion_on_time_percent: 25,
    },
    by_participant: [{
      participant_user_id: 1,
      participant_name: 'Исполнитель И.И.',
      total: 5,
      open: 3,
      new: 1,
      in_progress: 1,
      review: 1,
      done: 2,
      done_on_time: 1,
      done_without_due: 1,
      overdue: 1,
      completion_percent: 40,
      completion_on_time_percent: 25,
    }],
    by_project: [{
      project_id: 'project-1',
      project_name: 'Проект Север',
      total: 5,
      open: 3,
      in_progress: 1,
      review: 1,
      done: 2,
      done_on_time: 1,
      done_without_due: 1,
      overdue: 1,
      completion_percent: 40,
      completion_on_time_percent: 25,
    }],
    by_object: [{
      object_id: 'object-1',
      object_name: 'Объект 17',
      total: 4,
      open: 2,
      in_progress: 1,
      review: 1,
      done: 2,
      done_on_time: 1,
      done_without_due: 1,
      overdue: 1,
      completion_percent: 50,
      completion_on_time_percent: 25,
    }],
    status_breakdown: [
      { status: 'new', label: 'Новые', value: 1 },
      { status: 'in_progress', label: 'В работе', value: 1 },
      { status: 'review', label: 'На проверке', value: 1 },
      { status: 'done', label: 'Выполнено', value: 2 },
    ],
    trend: {
      granularity: 'day',
      items: [
        { bucket_key: '2026-03-01', bucket_label: '01.03', created: 2, completed: 1, completed_on_time: 1 },
        { bucket_key: '2026-03-02', bucket_label: '02.03', created: 3, completed: 1, completed_on_time: 0 },
      ],
    },
  });
  hubAPI.exportTaskAnalyticsExcel.mockResolvedValue({
    data: new Blob(['xlsx-bytes'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    headers: {
      'content-disposition': 'attachment; filename="task_analytics_test.xlsx"',
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
  hubAPI.getTasks.mockResolvedValue({ items: [taskSummary], total: 1 });
  hubAPI.getTask.mockResolvedValue(taskSummary);
  hubAPI.getTaskComments.mockResolvedValue({
    items: [{ id: 'comment-1', username: 'commenter', body: 'Комментарий', created_at: '2026-03-21T09:20:00Z' }],
  });
  hubAPI.getTaskStatusLog.mockResolvedValue({
    items: [{ id: 'status-1', old_status: 'new', new_status: 'in_progress', changed_by_username: 'rev-user', changed_at: '2026-03-21T09:25:00Z' }],
  });
  hubAPI.markTaskCommentsSeen.mockResolvedValue({});
  hubAPI.transformMarkdown.mockImplementation(async ({ text }) => text);
  hubAPI.createTask.mockResolvedValue({ id: 'task-created' });
});

describe('Tasks page detail workspace', () => {
  it('opens the create dialog from the dashboard quick-action URL and consumes the flag', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks?create=1']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('textbox', { name: 'Что нужно сделать' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).not.toContain('create=1');
    });
  });

  it('opens full detail mode from URL and keeps active tab in search params', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks?task=task-1&task_tab=history']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Назад к доске' })).toBeInTheDocument();
    expect(await screen.findByText(/rev-user/)).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task_tab=history');

    fireEvent.click(screen.getByRole('tab', { name: /Файлы \(1\)/ }));

    expect(await screen.findByText('акт-перемещения.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task_tab=files');

    fireEvent.click(screen.getByRole('button', { name: 'Назад к доске' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Назад к доске' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Новая задача' })).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tasks');
    expect(screen.getByTestId('location-probe').textContent).not.toContain('task=');
    expect(screen.getByTestId('location-probe').textContent).not.toContain('task_tab=');
  });

  it('renders expanded analytics and filters by participant', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Аналитика' }));

    expect(await screen.findByText('Статусы')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-filters-panel')).toBeInTheDocument();
    expect(screen.getByText('Период отчёта')).toBeInTheDocument();
    expect(screen.getByText('Постановка и выполнение по времени')).toBeInTheDocument();
    expect(screen.getAllByText('По участникам').length).toBeGreaterThan(0);
    expect(screen.getByText('Выполнено без срока')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть фильтры' }));
    await waitFor(() => {
      expect(screen.getByText('Период отчёта')).not.toBeVisible();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Показать фильтры' }));
    await waitFor(() => {
      expect(screen.getByText('Период отчёта')).toBeVisible();
    });

    await selectAutocompleteOption('Участник', 'Испол', 'Исполнитель И.И.');

    await waitFor(() => {
      expect(hubAPI.getTaskAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({
        participant_user_id: 1,
      }));
    });

    const participantCard = await screen.findByTestId('analytics-participant-card');
    expect(participantCard).toBeInTheDocument();
    expect(within(participantCard).getByText(/Участник:/)).toHaveTextContent('Исполнитель И.И.');

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт Excel' }));
    await waitFor(() => {
      expect(hubAPI.exportTaskAnalyticsExcel).toHaveBeenCalledWith(expect.objectContaining({
        participant_user_id: 1,
      }));
    });
  });

  it('defaults to list mode, keeps role query when switching modes, and opens a task row', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks?task_view=creator']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    const listView = await screen.findByTestId('tasks-list-view');
    expect(within(listView).getByText('Название')).toBeInTheDocument();
    expect(within(listView).getByText('Активность')).toBeInTheDocument();
    expect(within(listView).getByText('Крайний срок')).toBeInTheDocument();
    expect(within(listView).getByText('Постановщик')).toBeInTheDocument();
    expect(within(listView).getByText('Исполнитель')).toBeInTheDocument();
    expect(within(listView).getByText('Проект')).toBeInTheDocument();
    expect(within(listView).getByText('Теги')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Сроки' }));

    expect(await screen.findByTestId('tasks-deadlines-view')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task_mode=deadlines');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task_view=creator');
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('deadlines');

    fireEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('list');
    const row = await screen.findByTestId('tasks-list-row-task-1');
    fireEvent.click(row);

    expect(await screen.findByRole('button', { name: 'Назад к доске' })).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task=task-1');
  });

  it('shows role scope switch on desktop and switches between assignee and creator', async () => {
    hubAPI.getTasks.mockImplementation(async (params) => ({
      items: [taskSummary],
      total: params?.role_scope === 'creator' ? 3 : 2,
    }));

    render(
      <MemoryRouter initialEntries={['/tasks?task_view=assignee']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-role-scope-switch')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-role-assignee')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('tasks-role-creator'));

    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenCalledWith(expect.objectContaining({
        role_scope: 'creator',
        scope: 'my',
      }));
      expect(screen.getByTestId('location-probe')).toHaveTextContent('task_view=creator');
      expect(window.localStorage.getItem('hub.tasks.personalRole')).toBe('creator');
    });

    fireEvent.click(screen.getByTestId('tasks-role-assignee'));

    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        role_scope: 'assignee',
        scope: 'my',
      }));
      expect(screen.getByTestId('location-probe')).toHaveTextContent('task_view=assignee');
    });
  });

  it('shows role scope switch on mobile and restores personal role from localStorage', async () => {
    installMatchMedia({ mobile: true });
    authState.user = { id: 5, role: 'user', username: 'user', permissions: ['tasks.write'] };
    window.localStorage.setItem('hub.tasks.personalRole', 'creator');

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-header-inline')).toBeInTheDocument();
    expect(await screen.findByTestId('tasks-role-scope-switch')).toBeInTheDocument();

    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenCalledWith(expect.objectContaining({
        role_scope: 'creator',
        scope: 'my',
      }));
    });
  });

  it('opens the last stored task mode when URL has no task_mode', async () => {
    window.localStorage.setItem('hub.tasks.taskMode', 'gantt');

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-gantt-view')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task_mode=gantt');
  });

  it('keeps URL task_mode above the stored task mode', async () => {
    window.localStorage.setItem('hub.tasks.taskMode', 'gantt');

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=calendar']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-calendar-view')).toBeInTheDocument();
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('calendar');
  });

  it('treats legacy task_mode=plan as list mode', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=plan']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-plan-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe').textContent).not.toContain('task_mode=plan');
  });

  it('renders deadlines, calendar, and gantt task modes without the removed plan tab', async () => {
    hubAPI.getTasks.mockResolvedValue({
      items: [
        {
          ...taskSummary,
          id: 'task-1',
          title: 'Проверить акт перемещения',
          due_at: '2026-06-13T12:00:00',
          protocol_date: '2026-06-10',
        },
        {
          ...taskSummary,
          id: 'task-2',
          title: 'Задача без срока',
          status: 'new',
          due_at: null,
        },
      ],
      total: 2,
    });

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Сроки' }));
    const deadlinesView = await screen.findByTestId('tasks-deadlines-view');
    expect(within(deadlinesView).getByText('На сегодня')).toBeInTheDocument();
    expect(within(deadlinesView).getAllByText('Без срока').length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: 'Мой план' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Календарь' }));
    const calendarView = await screen.findByTestId('tasks-calendar-view');
    expect(within(calendarView).getByText('Проверить акт перемещения')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Гант' }));
    const ganttView = await screen.findByTestId('tasks-gantt-view');
    expect(within(ganttView).getByText('Проверить акт перемещения')).toBeInTheDocument();
    expect(within(ganttView).getByText('Задача без срока')).toBeInTheDocument();
  });

  it('uses searchable people fields in board filters and create dialog', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Развернуть фильтры/i }));
    await selectAutocompleteOption('Исполнитель', 'Иван', 'Иванов И.И.');

    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        assignee_user_id: 4,
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }));
    const dialog = await screen.findByRole('dialog');

    await selectAutocompleteOption('Исполнители', 'Испол', 'Исполнитель И.И.', dialog);
    expect(within(dialog).getByText('Исполнитель И.И.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Контролёр'));
    const controllerInput = await selectAutocompleteOption('Контролёр', 'Контр', 'Контролер К.К.', dialog);
    expect(controllerInput).toHaveValue('Контролер К.К.');
  });

  it('sends priority and structured checklist from the quick task dialog', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Новая задача' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Крайний срок')).toHaveAttribute('type', 'datetime-local');

    fireEvent.change(within(dialog).getByLabelText(/Что нужно сделать/i), {
      target: { value: 'Проверить доступ сотрудника' },
    });
    await selectAutocompleteOption('Исполнители', 'Испол', 'Исполнитель И.И.', dialog);

    fireEvent.click(within(dialog).getByText('В приоритете'));
    fireEvent.click(within(dialog).getByText('Чек-листы'));
    fireEvent.change(within(dialog).getByPlaceholderText('Пункт 1'), {
      target: { value: 'Проверить доступ' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /^Создать/ }));

    await waitFor(() => {
      expect(hubAPI.createTask).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Проверить доступ сотрудника',
        controller_user_id: null,
        priority: 'high',
        checklist_items: [expect.objectContaining({
          text: 'Проверить доступ',
          done: false,
        })],
      }));
    });
  });

  it('uploads selected files after creating a task', async () => {
    hubAPI.createTask.mockResolvedValue({
      items: [{ id: 'task-created' }],
      created: 1,
    });
    hubAPI.uploadTaskAttachment.mockResolvedValue({ id: 'attachment-created' });

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Новая задача' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Что нужно сделать/i), {
      target: { value: 'Проверить вложения' },
    });
    await selectAutocompleteOption('Исполнители', 'Испол', 'Исполнитель И.И.', dialog);

    fireEvent.click(within(dialog).getByText('Файлы'));
    const fileInput = within(dialog)
      .getByText('Выбрать файлы')
      .closest('label')
      ?.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();

    const files = [
      new File(['first'], 'first.txt', { type: 'text/plain' }),
      new File(['second'], 'second.txt', { type: 'text/plain' }),
    ];
    fireEvent.change(fileInput, { target: { files } });

    expect(await within(dialog).findByText('first.txt')).toBeInTheDocument();
    expect(within(dialog).getByText('second.txt')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    await waitFor(() => {
      expect(hubAPI.createTask).toHaveBeenCalledWith(expect.objectContaining({
        controller_user_id: null,
      }));
    });
    await waitFor(() => {
      expect(hubAPI.uploadTaskAttachment).toHaveBeenCalledTimes(2);
    });
    expect(hubAPI.uploadTaskAttachment).toHaveBeenNthCalledWith(1, {
      taskId: 'task-created',
      file: files[0],
    });
    expect(hubAPI.uploadTaskAttachment).toHaveBeenNthCalledWith(2, {
      taskId: 'task-created',
      file: files[1],
    });
  });

  it('lets create-only viewers create a project from the task dialog', async () => {
    authState.user = {
      id: 8,
      role: 'viewer',
      username: 'viewer',
      permissions: ['tasks.read', 'tasks.create'],
    };
    hubAPI.getTaskProjects
      .mockResolvedValueOnce({
        items: [{ id: 'project-1', name: 'Проект Север', is_active: true }],
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'project-1', name: 'Проект Север', is_active: true },
          { id: 'project-new', name: 'Новый проект', is_active: true },
        ],
      });
    hubAPI.createTaskProject.mockResolvedValue({
      id: 'project-new',
      name: 'Новый проект',
      is_active: true,
    });

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    const createButton = await screen.findByRole('button', { name: 'Новая задача' });
    expect(createButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Справочники' })).not.toBeInTheDocument();

    fireEvent.click(createButton);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText(/Проект:/));
    fireEvent.change(within(dialog).getByLabelText('Новый проект'), {
      target: { value: 'Новый проект' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => {
      expect(hubAPI.createTaskProject).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Новый проект',
      }));
    });
  });

  it('updates a checklist item from task detail without editing the task body', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks?task=task-1']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    const checkbox = await screen.findByRole('checkbox', { name: /Отметить пункт 1/i });
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(hubAPI.updateTask).toHaveBeenCalledWith('task-1', {
        checklist_items: [
          expect.objectContaining({ id: 'check-1', text: 'Проверить доступ', done: true }),
          expect.objectContaining({ id: 'check-2', text: 'Сообщить пользователю', done: true }),
        ],
      });
    });
  });

  it('shows the compact mobile feed, segmented modes, more drawer, and create fab', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    const feedView = await screen.findByTestId('tasks-mobile-feed-view');
    expect(feedView).toBeInTheDocument();
    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
    expect(screen.queryByTestId('tasks-mobile-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tasks-list-view')).not.toBeInTheDocument();
    const mobileHeader = screen.getByTestId('tasks-mobile-header-inline');
    expect(within(mobileHeader).getByTestId('tasks-mobile-header-mode')).toHaveTextContent('Лента · 1');
    expect(within(mobileHeader).getByTestId('tasks-mobile-open-search')).toBeInTheDocument();
    expect(within(mobileHeader).getByTestId('tasks-mobile-open-navigation')).toBeInTheDocument();

    fireEvent.click(within(mobileHeader).getByTestId('tasks-mobile-open-search'));
    const mobileSearchInput = await within(mobileHeader).findByTestId('tasks-mobile-search-input');
    fireEvent.change(mobileSearchInput, { target: { value: 'акт' } });
    expect(mobileSearchInput).toHaveValue('акт');

    fireEvent.click(within(mobileHeader).getByTestId('tasks-mobile-close-search'));
    expect(within(mobileHeader).queryByTestId('tasks-mobile-search-input')).not.toBeInTheDocument();

    fireEvent.click(within(mobileHeader).getByTestId('tasks-mobile-open-navigation'));
    expect(await screen.findByTestId('tasks-mobile-navigation-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-mobile-close-navigation'));
    await waitFor(() => {
      expect(screen.queryByTestId('tasks-mobile-navigation-drawer')).not.toBeInTheDocument();
    });

    const taskCard = await screen.findByTestId('mobile-task-card-task-1');
    expect(taskCard).toBeInTheDocument();
    expect(within(taskCard).getByTestId('mobile-task-card-description-task-1')).toHaveTextContent('Нужно загрузить');
    expect(within(taskCard).queryByTestId('mobile-task-card-action-task-1')).not.toBeInTheDocument();

    expect(screen.queryByTestId('tasks-mobile-bottom-nav')).not.toBeInTheDocument();
    expect(screen.getByTestId('tasks-mobile-mode-segmented')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tasks-mobile-mode-deadlines'));
    expect(await screen.findByTestId('tasks-deadlines-view')).toBeInTheDocument();
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('deadlines');

    fireEvent.click(screen.getByTestId('tasks-mobile-open-navigation-segment'));
    const navigationDrawer = await screen.findByTestId('tasks-mobile-navigation-drawer');
    expect(within(navigationDrawer).getByRole('button', { name: /Календарь/i })).toBeInTheDocument();
    expect(within(navigationDrawer).getByRole('button', { name: /Гант/i })).toBeInTheDocument();
    expect(within(navigationDrawer).getByRole('button', { name: /Аналитика/i })).toBeInTheDocument();

    fireEvent.click(within(navigationDrawer).getByRole('button', { name: /Календарь/i }));
    expect(await screen.findByTestId('tasks-calendar-view')).toBeInTheDocument();
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('calendar');

    fireEvent.click(screen.getByTestId('tasks-mobile-mode-list'));
    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('mobile-task-card-task-1'));
    expect(await screen.findByTestId('task-detail-mobile-header')).toBeInTheDocument();
    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-mobile-bottom-nav-mode', 'hidden');
    const mobileContent = screen.getByTestId('task-mobile-content');
    const mobileActionRail = screen.getByTestId('task-mobile-action-rail');
    expect(mobileContent).toHaveTextContent('Проверить акт перемещения');
    expect(screen.getByTestId('task-mobile-description')).toHaveTextContent('Нужно загрузить');
    expect(screen.getByTestId('task-mobile-files')).toHaveTextContent('акт-перемещения.pdf');
    expect(mobileContent.compareDocumentPosition(mobileActionRail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('task-mobile-checklist-summary')).toHaveTextContent('1/2 выполнено');
    expect(screen.getByTestId('task-mobile-files-chip')).toHaveTextContent('Файлы: 2');
    expect(mobileActionRail).toHaveTextContent('Сдать');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task=task-1');

    fireEvent.click(screen.getByRole('button', { name: /Назад/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('task-detail-mobile-header')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tasks-create-fab'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-mobile-bottom-nav-mode', 'hidden');
    expect(screen.getByLabelText(/Что нужно сделать/i)).toBeInTheDocument();
  });

  it('sets tomorrow due date from the mobile create due sheet', async () => {
    installMatchMedia({ mobile: true });
    const expectedTomorrow = new Date();
    expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
    expectedTomorrow.setHours(19, 0, 0, 0);

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-create-fab'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByTestId('create-due-mobile-open'));
    const sheet = await screen.findByTestId('create-due-mobile-sheet');
    expect(sheet.closest('.MuiPaper-root')).toHaveStyle({ zIndex: '1303' });
    fireEvent.click(within(sheet).getByTestId('create-due-preset-tomorrow'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-due-mobile-sheet')).not.toBeInTheDocument();
    });
    expect(within(dialog).getByTestId('create-due-mobile-open')).toHaveTextContent('завтра в 19:00');

    fireEvent.change(within(dialog).getByLabelText(/Что нужно сделать/i), {
      target: { value: 'Проверить мобильный срок' },
    });
    fireEvent.click(within(dialog).getByTestId('create-assignees-mobile-open'));
    const assigneeSheet = await screen.findByTestId('create-mobile-sheet');
    fireEvent.click(within(assigneeSheet).getByTestId('create-assignee-mobile-option-1'));
    fireEvent.click(within(assigneeSheet).getByTestId('create-assignees-mobile-done'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    await waitFor(() => {
      expect(hubAPI.createTask).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Проверить мобильный срок',
        due_at: toLocalDateTimeInput(expectedTomorrow),
      }));
    });
  });

  it('clears due date and exposes custom due input in the mobile create sheet', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-create-fab'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByTestId('create-due-mobile-open'));
    let sheet = await screen.findByTestId('create-due-mobile-sheet');
    fireEvent.click(within(sheet).getByTestId('create-due-preset-tomorrow'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-due-mobile-sheet')).not.toBeInTheDocument();
    });

    fireEvent.click(within(dialog).getByTestId('create-due-mobile-open'));
    sheet = await screen.findByTestId('create-due-mobile-sheet');
    fireEvent.click(within(sheet).getByTestId('create-due-preset-none'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-due-mobile-sheet')).not.toBeInTheDocument();
    });
    expect(within(dialog).getByTestId('create-due-mobile-open')).toHaveTextContent('Без срока');

    fireEvent.click(within(dialog).getByTestId('create-due-mobile-open'));
    sheet = await screen.findByTestId('create-due-mobile-sheet');
    fireEvent.click(within(sheet).getByTestId('create-due-custom-open'));
    const customInput = await within(sheet).findByTestId('create-due-custom-input');
    fireEvent.change(customInput.querySelector('input'), { target: { value: '2026-06-20T19:00' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Готово' }));
    await waitFor(() => {
      expect(screen.queryByTestId('create-due-mobile-sheet')).not.toBeInTheDocument();
    });
    expect(within(dialog).getByTestId('create-due-mobile-open')).toHaveTextContent('20.06 в 19:00');
  });

  it('edits task description in a mobile bottom sheet and submits it', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-create-fab'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByTestId('create-description-mobile-open'));
    const sheet = await screen.findByTestId('create-mobile-sheet');
    expect(within(sheet).getByText('Описание задачи')).toBeInTheDocument();
    setRichEditorHtml(within(sheet).getByTestId('create-description-mobile-input'), 'Подробное описание для мобильной задачи');
    fireEvent.click(within(sheet).getByTestId('create-description-mobile-done'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
    });
    expect(within(dialog).getByTestId('create-description-mobile-open')).toHaveTextContent('Подробное описание');

    fireEvent.change(within(dialog).getByLabelText(/Что нужно сделать/i), {
      target: { value: 'Создать задачу с описанием' },
    });
    fireEvent.click(within(dialog).getByTestId('create-assignees-mobile-open'));
    const assigneeSheet = await screen.findByTestId('create-mobile-sheet');
    fireEvent.change(within(assigneeSheet).getByTestId('create-assignees-mobile-search'), {
      target: { value: 'assignee' },
    });
    fireEvent.click(within(assigneeSheet).getByTestId('create-assignee-mobile-option-1'));
    fireEvent.change(within(assigneeSheet).getByTestId('create-assignees-mobile-search'), {
      target: { value: 'ivanov' },
    });
    fireEvent.click(within(assigneeSheet).getByTestId('create-assignee-mobile-option-4'));
    fireEvent.click(within(assigneeSheet).getByTestId('create-assignees-mobile-done'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
    });
    expect(within(dialog).getByTestId('create-assignees-mobile-open')).toHaveTextContent('Исполнитель И.И., Иванов И.И.');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Создать/ }));

    await waitFor(() => {
      expect(hubAPI.createTask).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Создать задачу с описанием',
        description: 'Подробное описание для мобильной задачи',
        assignee_user_ids: [1, 4],
      }));
    });
  });

  it('formats mobile task description visually and attaches files from the editor', async () => {
    installMatchMedia({ mobile: true });
    hubAPI.createTask.mockResolvedValue({
      items: [{ id: 'task-created' }],
      created: 1,
    });
    hubAPI.uploadTaskAttachment.mockResolvedValue({ id: 'attachment-created' });
    const originalExecCommand = document.execCommand;
    document.execCommand = vi.fn((command) => {
      const editor = screen.queryByTestId('create-description-mobile-input');
      if (!editor) return true;
      if (command === 'bold') editor.innerHTML = '<strong>важный</strong> текст';
      if (command === 'insertUnorderedList') editor.innerHTML = '<ul><li><br></li></ul>';
      if (command === 'insertOrderedList') editor.innerHTML = '<ol><li><br></li></ol>';
      fireEvent.input(editor);
      return true;
    });

    try {
      render(
        <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
          <Routes>
            <Route path="/tasks" element={<Tasks />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('tasks-create-fab'));
      const dialog = await screen.findByRole('dialog');

      fireEvent.click(within(dialog).getByTestId('create-description-mobile-open'));
      const sheet = await screen.findByTestId('create-mobile-sheet');
      expect(within(sheet).getByTestId('create-description-toolbar-scroll')).toBeInTheDocument();
      expect(within(sheet).getByTestId('create-description-mobile-done')).toBeInTheDocument();
      const input = within(sheet).getByTestId('create-description-mobile-input');

      fireEvent.click(within(sheet).getByTestId('create-description-format-bold'));
      await waitFor(() => {
        expect(document.execCommand).toHaveBeenCalledWith('bold', false, null);
      });
      expect(input.innerHTML).toContain('<strong>');
      expect(input.textContent).toBe('важный текст');

      fireEvent.click(within(sheet).getByTestId('create-description-format-bullet'));
      expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList', false, null);
      expect(input.innerHTML).toContain('<ul>');
      expect(input.textContent).not.toContain('- ');

      fireEvent.click(within(sheet).getByTestId('create-description-format-numbered'));
      expect(document.execCommand).toHaveBeenCalledWith('insertOrderedList', false, null);
      expect(input.innerHTML).toContain('<ol>');
      expect(input.textContent).not.toContain('1.');

      const editorFileInput = within(sheet).getByTestId('create-description-file-input');
      const file = new File(['from editor'], 'editor.txt', { type: 'text/plain' });
      fireEvent.change(editorFileInput, { target: { files: [file] } });
      setRichEditorHtml(input, '<strong>важный</strong> текст');
      fireEvent.click(within(sheet).getByTestId('create-description-mobile-done'));
      await waitFor(() => {
        expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
      });
      expect(within(dialog).getByTestId('create-description-mobile-open')).toHaveTextContent('важный текст');
      expect(within(dialog).getByTestId('create-description-mobile-open')).not.toHaveTextContent('**');
      expect(within(dialog).getAllByText('Файлы: 1').length).toBeGreaterThan(0);

      fireEvent.change(within(dialog).getByLabelText(/Что нужно сделать/i), {
        target: { value: 'Создать задачу с файлом из редактора' },
      });
      fireEvent.click(within(dialog).getByTestId('create-assignees-mobile-open'));
      const assigneeSheet = await screen.findByTestId('create-mobile-sheet');
      fireEvent.click(within(assigneeSheet).getByTestId('create-assignee-mobile-option-1'));
      fireEvent.click(within(assigneeSheet).getByTestId('create-assignees-mobile-done'));
      await waitFor(() => {
        expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
      });
      fireEvent.click(within(dialog).getByRole('button', { name: /^Создать/ }));

      await waitFor(() => {
        expect(hubAPI.createTask).toHaveBeenCalledWith(expect.objectContaining({
          description: '**важный** текст',
        }));
        expect(hubAPI.uploadTaskAttachment).toHaveBeenCalledWith({
          taskId: 'task-created',
          file,
        });
      });
    } finally {
      if (originalExecCommand) document.execCommand = originalExecCommand;
      else delete document.execCommand;
    }
  });

  it('opens mobile bottom sheets from task create chips', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-create-fab'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByText('В приоритете'));
    let sheet = await screen.findByTestId('create-mobile-sheet');
    expect(within(sheet).getByText('Приоритет')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId('create-priority-mobile-high'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
    });
    expect(within(dialog).getByText('Высокий')).toBeInTheDocument();

    const chipChecks = [
      ['Файлы', 'Файлы'],
      ['Чек-листы', 'Чек-лист'],
      ['Проект: Проект Север', 'Проект'],
      ['Контролёр', 'Контролёр'],
      ['Полная форма', 'Полная форма'],
    ];

    for (const [chipLabel, sheetTitle] of chipChecks) {
      fireEvent.click(within(dialog).getByText(chipLabel));
      sheet = await screen.findByTestId('create-mobile-sheet');
      expect(within(sheet).getAllByText(sheetTitle).length).toBeGreaterThan(0);
      fireEvent.click(within(sheet).getByRole('button', { name: 'Закрыть плашку' }));
      await waitFor(() => {
        expect(screen.queryByTestId('create-mobile-sheet')).not.toBeInTheDocument();
      });
    }
  });

  it('hides the mobile create fab without create permission', async () => {
    installMatchMedia({ mobile: true });
    authState.user = {
      id: 8,
      role: 'user',
      username: 'viewer',
      permissions: ['tasks.read'],
    };

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-create-fab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tasks-create-fab')).not.toBeInTheDocument();
  });

  it('shows the mobile create fab above the bottom navigation', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-create-fab')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-create-fab'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-create-fab')).not.toBeInTheDocument();
  });

  it('opens the submit dialog from the mobile detail primary action', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId('mobile-task-card-task-1');
    expect(within(card).queryByTestId('mobile-task-card-action-task-1')).not.toBeInTheDocument();
    fireEvent.click(card);
    const actionRail = await screen.findByTestId('task-mobile-action-rail');
    fireEvent.click(within(actionRail).getByRole('button', { name: 'Сдать' }));

    expect(await screen.findByText('Сдать работу')).toBeInTheDocument();
  });

  it('opens a dedicated mobile checklist screen, toggles and adds checklist items', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task=task-1']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('task-mobile-detail-screen')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('task-mobile-checklist-summary'));

    expect(await screen.findByTestId('task-mobile-checklist-screen')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-mobile-title')).toHaveTextContent('Чек-лист');
    expect(screen.getByTestId('task-mobile-checklist-progress')).toHaveTextContent('1/2 выполнено');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task_mobile_view=checklist');

    fireEvent.click(screen.getByLabelText('Отметить пункт 1'));
    await waitFor(() => {
      expect(hubAPI.updateTask).toHaveBeenCalledWith('task-1', {
        checklist_items: [
          expect.objectContaining({ id: 'check-1', done: true }),
          expect.objectContaining({ id: 'check-2', done: true }),
        ],
      });
    });

    fireEvent.click(screen.getByTestId('task-mobile-checklist-add'));
    fireEvent.change(screen.getByTestId('task-mobile-checklist-new-input'), {
      target: { value: 'Новый пункт' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => {
      expect(hubAPI.updateTask).toHaveBeenLastCalledWith('task-1', {
        checklist_items: [
          expect.objectContaining({ id: 'check-1' }),
          expect.objectContaining({ id: 'check-2' }),
          expect.objectContaining({ text: 'Новый пункт', done: false }),
        ],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /Назад/i }));
    await waitFor(() => {
      expect(screen.getByTestId('task-mobile-detail-screen')).toBeInTheDocument();
      expect(screen.getByTestId('location-probe')).not.toHaveTextContent('task_mobile_view=checklist');
    });
  });

  it('uses mobile list and compact detail flow on small screens', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=board']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
    expect(screen.queryByTestId('tasks-mobile-header')).not.toBeInTheDocument();
    expect(await screen.findByTestId('tasks-mobile-header-inline')).toBeInTheDocument();
    expect(await screen.findByTestId('tasks-mobile-board')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-desktop-kanban')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-mobile-open-navigation'));
    const navigationDrawer = await screen.findByTestId('tasks-mobile-navigation-drawer');
    expect(navigationDrawer).toBeInTheDocument();

    fireEvent.click(within(navigationDrawer).getByTestId('tasks-mobile-status-done'));
    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        status: 'done',
      }));
    });

    fireEvent.click(screen.getByTestId('tasks-mobile-open-navigation'));
    expect(await screen.findByTestId('tasks-mobile-navigation-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-mobile-close-navigation'));
    await waitFor(() => {
      expect(screen.queryByTestId('tasks-mobile-navigation-drawer')).not.toBeInTheDocument();
    });

    if (false) {

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        status: 'done',
      }));
    });

    fireEvent.click(screen.getByTestId('tasks-mobile-open-filters'));
    const filtersDialog = await screen.findByRole('dialog');
    expect(filtersDialog).toBeInTheDocument();

    fireEvent.click(within(filtersDialog).getByRole('button', { name: /Закрыть/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    }

    fireEvent.click(await screen.findByTestId('mobile-task-card-task-1'));
    expect(await screen.findByTestId('task-detail-mobile-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-mobile-content')).toHaveTextContent('Проверить акт перемещения');
    expect(screen.getByTestId('task-mobile-detail-screen')).toBeInTheDocument();
    expect(screen.getByTestId('task-mobile-checklist-summary')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task=task-1');

    fireEvent.click(screen.getByRole('button', { name: /Назад/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('task-detail-mobile-header')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('tasks-mobile-board')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tasks');
  });

  it('opens task discussion chat from detail banner when feature flag is enabled', async () => {
    chatFeatureFlags.chat = true;
    chatFeatureFlags.taskDiscussion = true;
    hubAPI.openTaskDiscussion.mockResolvedValue({
      conversation_id: 'conv-task-1',
      created: true,
      kind: 'task',
    });

    render(
      <MemoryRouter initialEntries={['/tasks?task=task-1&task_tab=comments']}>
        <Routes>
          <Route
            path="/tasks"
            element={(
              <>
                <Tasks />
                <LocationProbe />
              </>
            )}
          />
          <Route path="/chat" element={(<><div data-testid="chat-page" /><LocationProbe /></>)} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть чат' }));

    await waitFor(() => {
      expect(hubAPI.openTaskDiscussion).toHaveBeenCalledWith('task-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/chat?conversation=conv-task-1');
    });

    chatFeatureFlags.chat = false;
    chatFeatureFlags.taskDiscussion = false;
  });

  it('keeps the mobile task layout and exposes a direct chat button', async () => {
    installMatchMedia({ mobile: true });
    chatFeatureFlags.chat = true;
    chatFeatureFlags.taskDiscussion = true;
    hubAPI.openTaskDiscussion.mockResolvedValue({
      conversation_id: 'conv-task-mobile',
      created: false,
      kind: 'task',
    });

    render(
      <MemoryRouter initialEntries={['/tasks?task=task-1']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/chat" element={<div data-testid="chat-page" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('task-detail-mobile-header')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('task-mobile-open-chat'));

    await waitFor(() => {
      expect(hubAPI.openTaskDiscussion).toHaveBeenCalledWith('task-1');
      expect(screen.getByTestId('chat-page')).toBeInTheDocument();
    });
  });
});
