import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useTaskWorkflowActions, { formatTaskTransitionConflictMessage } from './useTaskWorkflowActions';
import hubTasksAPI from '../../../api/hubTasks';

const { mockSubmitTask, mockReviewTask, mockCompleteTask, mockStartTask, mockReopenTask } = vi.hoisted(() => ({
  mockSubmitTask: vi.fn(),
  mockReviewTask: vi.fn(),
  mockCompleteTask: vi.fn(),
  mockStartTask: vi.fn(),
  mockReopenTask: vi.fn(),
}));

vi.mock('../../../api/hubTasks', () => ({
  default: {
    deleteTask: vi.fn(),
    submitTask: mockSubmitTask,
    reviewTask: mockReviewTask,
    completeTask: mockCompleteTask,
    startTask: mockStartTask,
    reopenTask: mockReopenTask,
  },
}));

const UPDATED = { id: 'task-1', status: 'review', title: 'Задача' };

function renderActions({ applyTaskUpdate, refreshTasksAndDetails } = {}) {
  const closeTaskDetails = vi.fn();
  const loadTasks = vi.fn();
  const setError = vi.fn();
  const loadTaskDetails = vi.fn();
  const props = {
    setError,
    refreshTasksAndDetails: refreshTasksAndDetails || vi.fn(),
    applyTaskUpdate: applyTaskUpdate || vi.fn(),
    loadTaskDetails,
    loadTasks,
    closeTaskDetails,
    selectedTaskId: '',
    detailsTask: null,
    visibleTaskItems: [],
  };
  const rendered = renderHook(() => useTaskWorkflowActions(props));
  return { ...rendered, setError, loadTasks, applyTaskUpdate: props.applyTaskUpdate, refreshTasksAndDetails: props.refreshTasksAndDetails };
}

describe('workflow mutations use returned task patches instead of full reloads', () => {
  beforeEach(() => {
    mockSubmitTask.mockReset();
    mockReviewTask.mockReset();
    mockCompleteTask.mockReset();
    mockStartTask.mockReset();
    mockReopenTask.mockReset();
  });

  it('submit task: no loadTasks, server task goes through applyTaskUpdate', async () => {
    mockSubmitTask.mockResolvedValue(UPDATED);
    const applyTaskUpdate = vi.fn();
    const refreshTasksAndDetails = vi.fn();
    const { result } = renderActions({ applyTaskUpdate, refreshTasksAndDetails });
    await act(async () => {
      result.current.setSubmitTask({ id: 'task-1' });
    });
    await act(async () => result.current.handleSubmitTask({ comment: 'готово' }));
    expect(mockSubmitTask).toHaveBeenCalledTimes(1);
    expect(applyTaskUpdate).toHaveBeenCalledWith('task-1', UPDATED);
    expect(refreshTasksAndDetails).not.toHaveBeenCalled();
  });

  it('review and close: no loadTasks, server task goes through applyTaskUpdate', async () => {
    mockReviewTask.mockResolvedValue(UPDATED);
    mockCompleteTask.mockResolvedValue(UPDATED);
    const applyTaskUpdate = vi.fn();
    const refreshTasksAndDetails = vi.fn();
    const { result } = renderActions({ applyTaskUpdate, refreshTasksAndDetails });
    await act(async () => { result.current.setReviewTask({ id: 'task-1' }); });
    await act(async () => { result.current.setCloseTask({ id: 'task-1' }); });
    await act(async () => result.current.handleReviewTask('approve'));
    expect(mockReviewTask).toHaveBeenCalledTimes(1);
    await act(async () => result.current.handleCloseTask({ comment: '' }));
    expect(mockCompleteTask).toHaveBeenCalledTimes(1);
    expect(applyTaskUpdate).toHaveBeenCalledTimes(2);
    expect(refreshTasksAndDetails).not.toHaveBeenCalled();
  });

  it('start and reopen: no loadTasks, server task goes through applyTaskUpdate', async () => {
    mockStartTask.mockResolvedValue(UPDATED);
    mockReopenTask.mockResolvedValue(UPDATED);
    const applyTaskUpdate = vi.fn();
    const refreshTasksAndDetails = vi.fn();
    const { result } = renderActions({ applyTaskUpdate, refreshTasksAndDetails });
    await act(async () => { result.current.setReopenTargetTask({ id: 'task-1' }); });
    await act(async () => { result.current.handleStartTask('task-1'); });
    await act(async () => result.current.handleConfirmReopenTask({ due_at: null }));
    expect(mockStartTask).toHaveBeenCalledTimes(1);
    expect(mockReopenTask).toHaveBeenCalledTimes(1);
    expect(applyTaskUpdate).toHaveBeenCalledTimes(2);
    expect(refreshTasksAndDetails).not.toHaveBeenCalled();
  });
});

it.each(['B', 'A'])('does not close a new selection %s while deletion is pending', async (nextId) => {
  let finish;
  hubTasksAPI.deleteTask.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const closeTaskDetails = vi.fn();
  const loadTasks = vi.fn();
  const { result, rerender } = renderHook(({ selectedTaskId }) => useTaskWorkflowActions({
    selectedTaskId, closeTaskDetails, loadTasks, setError: vi.fn(),
  }), { initialProps: { selectedTaskId: 'A' } });
  let pending;
  act(() => { pending = result.current.handleDeleteTask({ id: 'A' }); });
  rerender({ selectedTaskId: 'B' });
  if (nextId === 'A') rerender({ selectedTaskId: 'A' });
  await act(async () => { finish(); await pending; });
  expect(closeTaskDetails).not.toHaveBeenCalled();
  expect(loadTasks).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

describe('formatTaskTransitionConflictMessage', () => {
  it('renders russian status label for conflict payload', () => {
    expect(formatTaskTransitionConflictMessage({
      code: 'task_transition_conflict',
      current_status: 'in_progress',
    })).toBe(
      'Задача уже была изменена другим пользователем.\nТекущий статус: «В работе».',
    );
  });
});
