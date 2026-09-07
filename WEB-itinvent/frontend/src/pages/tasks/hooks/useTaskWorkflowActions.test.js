import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useTaskWorkflowActions, { formatTaskTransitionConflictMessage } from './useTaskWorkflowActions';
import hubTasksAPI from '../../../api/hubTasks';

vi.mock('../../../api/hubTasks', () => ({ default: { deleteTask: vi.fn() } }));

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
