import { describe, expect, it } from 'vitest';
import { formatTaskTransitionConflictMessage } from './useTaskWorkflowActions';

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
