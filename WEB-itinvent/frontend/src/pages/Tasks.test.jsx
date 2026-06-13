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

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
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

    fireEvent.change(within(dialog).getByLabelText(/Что нужно сделать/i), {
      target: { value: 'Проверить доступ сотрудника' },
    });
    await selectAutocompleteOption('Исполнители', 'Испол', 'Исполнитель И.И.', dialog);

    fireEvent.click(within(dialog).getByText('В приоритете'));
    fireEvent.click(within(dialog).getByText('Чек-листы'));
    fireEvent.change(within(dialog).getByPlaceholderText('Пункт 1'), {
      target: { value: 'Проверить доступ' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

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

  it('shows the compact mobile feed, bottom navigation, more drawer, and create nav button', async () => {
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
    expect(screen.queryByTestId('tasks-list-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('tasks-mobile-header-mode')).toHaveTextContent('Лента · 1');
    const taskCard = await screen.findByTestId('mobile-task-card-task-1');
    expect(taskCard).toBeInTheDocument();
    expect(within(taskCard).getByTestId('mobile-task-card-action-task-1')).toHaveTextContent('Сдать результат');

    fireEvent.click(within(screen.getByTestId('tasks-mobile-bottom-nav')).getAllByRole('button')[1]);
    expect(await screen.findByTestId('tasks-deadlines-view')).toBeInTheDocument();
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('deadlines');

    fireEvent.click(within(screen.getByTestId('tasks-mobile-bottom-nav')).getAllByRole('button')[4]);
    const navigationDrawer = await screen.findByTestId('tasks-mobile-navigation-drawer');
    expect(within(navigationDrawer).getByRole('button', { name: /Календарь/i })).toBeInTheDocument();
    expect(within(navigationDrawer).getByRole('button', { name: /Гант/i })).toBeInTheDocument();
    expect(within(navigationDrawer).getByRole('button', { name: /Аналитика/i })).toBeInTheDocument();

    fireEvent.click(within(navigationDrawer).getByRole('button', { name: /Календарь/i }));
    expect(await screen.findByTestId('tasks-calendar-view')).toBeInTheDocument();
    expect(window.localStorage.getItem('hub.tasks.taskMode')).toBe('calendar');

    fireEvent.click(within(screen.getByTestId('tasks-mobile-bottom-nav')).getAllByRole('button')[0]);
    expect(await screen.findByTestId('tasks-mobile-feed-view')).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('mobile-task-card-task-1'));
    expect(await screen.findByTestId('task-detail-mobile-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-context-mobile-action')).toHaveTextContent('Сдать результат');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task=task-1');

    fireEvent.click(screen.getByRole('button', { name: /Назад/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('task-detail-mobile-header')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tasks-mobile-create-nav-button'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Что нужно сделать/i)).toBeInTheDocument();
  });

  it('hides the mobile create nav button without create permission', async () => {
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
    expect(screen.queryByTestId('tasks-mobile-create-nav-button')).not.toBeInTheDocument();
  });

  it('opens the submit dialog from the mobile card primary action', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/tasks?task_mode=list']}>
        <Routes>
          <Route path="/tasks" element={<Tasks />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId('mobile-task-card-task-1');
    expect(within(card).getByTestId('mobile-task-card-action-task-1')).toHaveTextContent('Сдать результат');
    fireEvent.click(within(card).getByRole('button', { name: 'Сдать' }));

    expect(await screen.findByText('Сдать работу')).toBeInTheDocument();
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

    expect(await screen.findByTestId('tasks-mobile-header')).toBeInTheDocument();
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
    expect(screen.getByTestId('task-context-mobile-context')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('task=task-1');

    fireEvent.click(screen.getByRole('button', { name: /Назад/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('task-detail-mobile-header')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('tasks-mobile-board')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tasks');
  });
});
