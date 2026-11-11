import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useTaskSubtasks from './useTaskSubtasks';
import hubTaskSubtasksAPI from '../../../api/hubTaskSubtasks';

vi.mock('../../../api/hubTaskSubtasks', () => ({
  default: { createSubtask: vi.fn() },
}));

const buildHook = () => {
  const deps = {
    setNotice: vi.fn(),
    loadTasks: vi.fn().mockResolvedValue(undefined),
    loadTaskDetails: vi.fn().mockResolvedValue(undefined),
    getAssigneeById: (id) => ({ id: String(id), full_name: `User ${id}` }),
    resolveAssigneesByIds: vi.fn().mockResolvedValue([]),
  };
  const view = renderHook(() => useTaskSubtasks(deps));
  return { ...view, deps };
};

const fillDraft = (result, patch) => act(() => {
  result.current.setSubtaskDraft((prev) => ({ ...prev, ...patch }));
});

describe('useTaskSubtasks', () => {
  beforeEach(() => {
    hubTaskSubtasksAPI.createSubtask.mockReset();
  });

  it('does not call the API until the title and an assignee are filled in', async () => {
    const { result } = buildHook();
    act(() => result.current.openSubtaskDialog({ id: 'parent-1', title: 'Родитель' }));

    await act(() => result.current.handleCreateSubtask());
    expect(result.current.subtaskFormError).toContain('Название');

    fillDraft(result, { title: 'Подзадача 1' });
    await act(() => result.current.handleCreateSubtask());
    expect(result.current.subtaskFormError).toContain('исполнителя');
    expect(hubTaskSubtasksAPI.createSubtask).not.toHaveBeenCalled();
  });

  it('creates the subtask, closes the dialog and refreshes the parent and the list', async () => {
    hubTaskSubtasksAPI.createSubtask.mockResolvedValue({ id: 'sub-1' });
    const { result, deps } = buildHook();
    act(() => result.current.openSubtaskDialog({ id: 'parent-1', title: 'Родитель' }));
    act(() => result.current.handleChangeSubtaskAssigneeIds(['6', '7']));
    fillDraft(result, { title: '  Подзадача 1  ', due_at: '2026-10-30T10:00', priority: 'high' });

    await act(() => result.current.handleCreateSubtask());

    expect(hubTaskSubtasksAPI.createSubtask).toHaveBeenCalledWith('parent-1', {
      title: 'Подзадача 1',
      description: '',
      assignee_user_ids: [6, 7],
      due_at: '2026-10-30T10:00',
      priority: 'high',
    });
    expect(result.current.subtaskParent).toBeNull();
    expect(deps.loadTaskDetails).toHaveBeenCalledWith('parent-1');
    expect(deps.loadTasks).toHaveBeenCalledTimes(1);
    expect(deps.setNotice).toHaveBeenCalledWith('Подзадача создана');
  });

  it('keeps the dialog open and shows the server error when creation is rejected', async () => {
    hubTaskSubtasksAPI.createSubtask.mockRejectedValue({
      response: { data: { detail: 'Родительская задача уже закрыта' } },
    });
    const { result, deps } = buildHook();
    act(() => result.current.openSubtaskDialog({ id: 'parent-1', title: 'Родитель' }));
    act(() => result.current.handleChangeSubtaskAssigneeIds(['6']));
    fillDraft(result, { title: 'Подзадача 1' });

    await act(() => result.current.handleCreateSubtask());

    expect(result.current.subtaskParent).toEqual({ id: 'parent-1', title: 'Родитель' });
    expect(result.current.subtaskFormError).toBe('Родительская задача уже закрыта');
    expect(result.current.subtaskSaving).toBe(false);
    expect(deps.loadTasks).not.toHaveBeenCalled();
  });
});
