import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskWorkspacePanel from './TaskWorkspacePanel';
import { hubAPI } from '../../api/client';
import { departmentsAPI } from '../../api/departments';

vi.mock('../../api/client', () => ({
  hubAPI: {
    getTask: vi.fn(),
    updateTask: vi.fn(),
    startTask: vi.fn(),
    submitTask: vi.fn(),
    reviewTask: vi.fn(),
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
    can_upload_files: true,
    can_update_checklist: true,
  },
};

const renderPanel = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <TaskWorkspacePanel taskId="task-1" {...props} />
  </ThemeProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  hubAPI.getTask.mockResolvedValue(task);
  hubAPI.updateTask.mockResolvedValue(task);
  hubAPI.startTask.mockResolvedValue({ ...task, status: 'in_progress' });
  hubAPI.getAssignees.mockResolvedValue({ items: [{ id: 2, full_name: 'Пётр Исполнитель' }] });
  hubAPI.getControllers.mockResolvedValue({ items: [{ id: 3, full_name: 'Анна Контролёр' }] });
  hubAPI.getTaskProjects.mockResolvedValue({ items: [{ id: 'project-1', name: 'Офис', is_active: true }] });
  hubAPI.getTaskObjects.mockResolvedValue({ items: [{ id: 'object-1', project_id: 'project-1', name: 'Кабинет 12', is_active: true }] });
  departmentsAPI.list.mockResolvedValue({ items: [] });
});

describe('TaskWorkspacePanel', () => {
  it('loads and renders the complete task workspace', async () => {
    renderPanel();

    expect(await screen.findByText('Настроить рабочее место')).toBeInTheDocument();
    expect(screen.getByText('Пётр Исполнитель')).toBeInTheDocument();
    expect(screen.getByText('plan.xlsx')).toBeInTheDocument();
    expect(screen.getByTestId('task-workspace-checklist')).toHaveTextContent('1/2');
    expect(screen.getByRole('button', { name: 'Начать' })).toBeInTheDocument();
    expect(hubAPI.getTask).toHaveBeenCalledWith('task-1');
  });

  it('does not reload the task when only the update callback identity changes', async () => {
    const firstUpdateHandler = vi.fn();
    const nextUpdateHandler = vi.fn();
    const { rerender } = renderPanel({ onTaskUpdated: firstUpdateHandler });

    await screen.findByText('Настроить рабочее место');
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

    await screen.findByText('Настроить рабочее место');

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
    await screen.findByText('Настроить рабочее место');

    expect(hubAPI.getAssignees).not.toHaveBeenCalled();
    expect(departmentsAPI.list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));

    await waitFor(() => {
      expect(hubAPI.getAssignees).toHaveBeenCalledTimes(1);
      expect(hubAPI.getControllers).toHaveBeenCalledTimes(1);
      expect(departmentsAPI.list).toHaveBeenCalledTimes(1);
      expect(hubAPI.getTaskProjects).toHaveBeenCalledWith({ include_inactive: true });
      expect(hubAPI.getTaskObjects).toHaveBeenCalledWith({ include_inactive: true });
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
