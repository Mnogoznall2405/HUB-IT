import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskWorkspacePanel from './TaskWorkspacePanel';
import { hubAPI } from '../../api/client';
import { departmentsAPI } from '../../api/departments';
import { hubTaskFilesAPI } from '../../api/hubTaskFiles';

vi.mock('../../api/client', () => ({
  hubAPI: {
    getTask: vi.fn(),
    deleteTask: vi.fn(),
    updateTask: vi.fn(),
    startTask: vi.fn(),
    submitTask: vi.fn(),
    reviewTask: vi.fn(),
    completeTask: vi.fn(),
    uploadTaskAttachment: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    getAssignees: vi.fn(),
    getControllers: vi.fn(),
    getTaskProjects: vi.fn(),
    getTaskObjects: vi.fn(),
  },
}));

vi.mock('../../api/departments', () => ({
  departmentsAPI: {
    list: vi.fn(),
  },
}));

vi.mock('../../api/hubTaskFiles', () => ({
  hubTaskFilesAPI: {
    getTaskAttachmentPreview: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    downloadTaskAttachmentPreviewPdf: vi.fn(),
  },
}));

const task = {
  id: 'task-1',
  title: 'Настроить рабочее место',
  description: 'Подключить **оборудование** и проверить сеть.',
  status: 'new',
  priority: 'high',
  created_by_user_id: 1,
  created_by_full_name: 'Иван Автор',
  assignee_user_id: 2,
  assignee_full_name: 'Пётр Исполнитель',
  controller_user_id: 3,
  controller_full_name: 'Анна Контролёр',
  due_at: '2026-06-29T19:00:00Z',
  created_at: '2026-06-22T13:23:00Z',
  project_id: 'project-1',
  project_name: 'Офис',
  object_id: 'object-1',
  object_name: 'Кабинет 12',
  attachments: [{
    id: 'file-1',
    file_name: 'plan.xlsx',
    file_size: 1024,
    uploaded_at: '2026-06-22T14:00:00Z',
  }],
  checklist_items: [
    { id: 'check-1', text: 'Подключить монитор', done: false },
    { id: 'check-2', text: 'Проверить сеть', done: true },
  ],
  capabilities: {
    can_edit: true,
    can_start: true,
    can_submit: false,
    can_review: false,
    can_close: true,
    can_upload_files: true,
    can_update_checklist: true,
    can_reopen: false,
  },
};

const renderPanel = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <TaskWorkspacePanel
      taskId="task-1"
      currentUser={{ id: 1, role: 'viewer', permissions: ['tasks.read'] }}
      {...props}
    />
  </ThemeProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  hubAPI.getTask.mockResolvedValue(task);
  hubAPI.deleteTask.mockResolvedValue({ ok: true, task_id: task.id });
  hubAPI.updateTask.mockResolvedValue(task);
  hubAPI.startTask.mockResolvedValue({ ...task, status: 'in_progress' });
  hubAPI.completeTask.mockResolvedValue({ ...task, status: 'done', capabilities: { ...task.capabilities, can_close: false, can_reopen: true } });
  hubAPI.getAssignees.mockResolvedValue({ items: [{ id: 2, full_name: 'Пётр Исполнитель' }] });
  hubAPI.getControllers.mockResolvedValue({ items: [{ id: 3, full_name: 'Анна Контролёр' }] });
  hubAPI.getTaskProjects.mockResolvedValue({ items: [{ id: 'project-1', name: 'Офис', is_active: true }] });
  hubAPI.getTaskObjects.mockResolvedValue({ items: [{ id: 'object-1', project_id: 'project-1', name: 'Кабинет 12', is_active: true }] });
  departmentsAPI.list.mockResolvedValue({ items: [] });
  hubTaskFilesAPI.getTaskAttachmentPreview.mockResolvedValue({
    status: 'ready',
    preview_kind: 'office_pdf',
    source_kind: 'excel',
    pdf_filename: 'plan.pdf',
    page_count: 1,
    sheets: [],
  });
  hubTaskFilesAPI.downloadTaskAttachment.mockRejectedValue(new Error('Excel grid unavailable'));
  hubTaskFilesAPI.downloadTaskAttachmentPreviewPdf.mockResolvedValue({
    data: new Blob(['%PDF'], { type: 'application/pdf' }),
    headers: { 'content-type': 'application/pdf' },
  });
});

const openMoreMenu = async () => {
  await screen.findByText('Пётр Исполнитель');
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
};

describe('TaskWorkspacePanel', () => {
  it('lets the task creator delete it from the chat workspace', async () => {
    const onOpenInTasks = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel({ onOpenInTasks });

    await openMoreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => {
      expect(hubAPI.deleteTask).toHaveBeenCalledWith('task-1');
      expect(onOpenInTasks).toHaveBeenCalledTimes(1);
    });
    confirmSpy.mockRestore();
  });

  it('hides deletion from a user who did not create the task', async () => {
    renderPanel({ currentUser: { id: 2, role: 'viewer', permissions: ['tasks.read'] } });

    await openMoreMenu();

    expect(screen.queryByRole('menuitem', { name: 'Удалить' })).not.toBeInTheDocument();
  });

  it('shows a direct way back to the tasks list', async () => {
    const onOpenInTasks = vi.fn();
    renderPanel({ onOpenInTasks });

    await openMoreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть в задачах' }));

    expect(onOpenInTasks).toHaveBeenCalledTimes(1);
  });

  it('loads and renders the complete task workspace', async () => {
    renderPanel();

    expect(await screen.findByText('Пётр Исполнитель')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Файлы/ }));
    expect(screen.getByText('plan.xlsx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Предпросмотр plan\.xlsx/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Обзор' }));
    expect(screen.getByTestId('task-workspace-checklist')).toHaveTextContent('1/2');
    const actions = screen.getByTestId('task-workspace-actions');
    expect(within(actions).getByRole('button', { name: 'В работу' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Отправить на проверку' })).toBeDisabled();
    expect(within(actions).getByRole('button', { name: 'Закрыть' })).toBeEnabled();
    expect(screen.queryByText(/Недоступно: вы являетесь постановщиком/i)).not.toBeInTheDocument();
    expect(hubAPI.getTask).toHaveBeenCalledWith('task-1');
  });

  it('lets the task creator close the task without review', async () => {
    renderPanel();

    const actions = await screen.findByTestId('task-workspace-actions');
    fireEvent.click(within(actions).getByRole('button', { name: 'Закрыть' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Закрыть задачу');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));

    await waitFor(() => {
      expect(hubAPI.completeTask).toHaveBeenCalledWith('task-1', { comment: '' });
    });
  });

  it('opens task files through the background preview flow', async () => {
    renderPanel();
    await screen.findByText('Пётр Исполнитель');
    fireEvent.click(screen.getByRole('tab', { name: /Файлы/ }));
    await screen.findByText('plan.xlsx');

    fireEvent.click(screen.getByRole('button', { name: /Предпросмотр plan\.xlsx/i }));

    await waitFor(() => {
      expect(hubTaskFilesAPI.getTaskAttachmentPreview).toHaveBeenCalledWith({
        taskId: 'task-1',
        attachmentId: 'file-1',
        signal: expect.any(AbortSignal),
      });
      expect(hubTaskFilesAPI.downloadTaskAttachmentPreviewPdf).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('dialog')).toHaveTextContent('plan.xlsx');
  });

  it('does not reload the task when only the update callback identity changes', async () => {
    const firstUpdateHandler = vi.fn();
    const nextUpdateHandler = vi.fn();
    const { rerender } = renderPanel({ onTaskUpdated: firstUpdateHandler });

    await screen.findByText('Пётр Исполнитель');
    expect(hubAPI.getTask).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider theme={createTheme()}>
        <TaskWorkspacePanel taskId="task-1" onTaskUpdated={nextUpdateHandler} />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(hubAPI.getTask).toHaveBeenCalledTimes(1);
    });
  });

  it('reloads the workspace when the task id changes', async () => {
    const { rerender } = renderPanel();

    await screen.findByText('Пётр Исполнитель');

    rerender(
      <ThemeProvider theme={createTheme()}>
        <TaskWorkspacePanel taskId="task-2" />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(hubAPI.getTask).toHaveBeenCalledTimes(2);
      expect(hubAPI.getTask).toHaveBeenLastCalledWith('task-2');
    });
  });

  it('renders observers in task workspace panel', async () => {
    hubAPI.getTask.mockResolvedValue({
      ...task,
      observers: [
        { user_id: 4, full_name: 'Наблюдатель Н.Н.', username: 'observer' },
      ],
    });
    renderPanel();

    expect(await screen.findByText('Наблюдатели')).toBeInTheDocument();
    expect(screen.getByText('Наблюдатель Н.Н.')).toBeInTheDocument();
  });

  it('updates checklist items and reloads the task', async () => {
    renderPanel();
    await screen.findByText('Подключить монитор');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Отметить пункт 1' }));

    await waitFor(() => {
      expect(hubAPI.updateTask).toHaveBeenCalledWith('task-1', {
        checklist_items: [
          { id: 'check-1', text: 'Подключить монитор', done: true },
          { id: 'check-2', text: 'Проверить сеть', done: true },
        ],
      });
    });
    expect(hubAPI.getTask).toHaveBeenCalledTimes(2);
  });

  it('loads edit reference data only after the user opens editing', async () => {
    renderPanel();
    await screen.findByText('Пётр Исполнитель');

    expect(hubAPI.getAssignees).not.toHaveBeenCalled();
    expect(departmentsAPI.list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }));

    await waitFor(() => {
      expect(hubAPI.getAssignees).toHaveBeenCalledWith({ ids: '2' });
      expect(hubAPI.getControllers).toHaveBeenCalledTimes(1);
      expect(departmentsAPI.list).toHaveBeenCalledTimes(1);
      expect(hubAPI.getTaskProjects).toHaveBeenCalledWith({ include_inactive: true });
      expect(hubAPI.getTaskObjects).toHaveBeenCalledWith({ include_inactive: true });
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue(task.title)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Сохранить изменения' })).toBeEnabled();
    expect(within(dialog).queryByText('Редактирование задачи')).not.toBeInTheDocument();
  });

  it('saves workspace edits from the modern task form', async () => {
    renderPanel();
    await openMoreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByDisplayValue(task.title), {
      target: { value: 'Обновлённое рабочее место' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => {
      expect(hubAPI.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        title: 'Обновлённое рабочее место',
        assignee_user_id: 2,
        controller_user_id: 3,
        project_id: 'project-1',
        object_id: 'object-1',
        priority: 'high',
      }));
    });
  });
});
