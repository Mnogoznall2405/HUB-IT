import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import useTaskDetails from './useTaskDetails';

vi.mock('../../../api/hubTasks', () => ({ default: {} }));
vi.mock('../../../api/hubTaskActivity', () => ({ default: {} }));
vi.mock('../../../api/hubTaskFiles', () => ({ default: {} }));
vi.mock('../../../api/hubTaskDiscussion', () => ({ default: {} }));

function renderUseTaskDetails(overrides = {}) {
  const defaults = {
    user: { id: 3 },
    canManageAllTasks: false,
    canReviewTasks: true,
    taskDiscussionChatEnabled: false,
    isMobile: false,
    ui: {},
    setError: vi.fn(),
    patchTaskItem: vi.fn(),
    loadTasks: vi.fn(),
    departments: [],
  };

  return renderHook(() => useTaskDetails({ ...defaults, ...overrides }), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={['/tasks']}>{children}</MemoryRouter>
    ),
  });
}

describe('useTaskDetails canReviewTask', () => {
  it('blocks assignee who is controller but not creator', () => {
    const { result } = renderUseTaskDetails({
      user: { id: 3 },
      canReviewTasks: true,
    });

    const canReview = result.current.canReviewTask({
      id: 'task-1',
      status: 'review',
      assignee_user_id: 3,
      created_by_user_id: 1,
      controller_user_id: 3,
    });

    expect(canReview).toBe(false);
  });

  it('allows self-assigned creator to review after submit', () => {
    const { result } = renderUseTaskDetails({
      user: { id: 1 },
      canReviewTasks: false,
    });

    const canReview = result.current.canReviewTask({
      id: 'task-2',
      status: 'review',
      assignee_user_id: 1,
      created_by_user_id: 1,
      controller_user_id: 3,
    });

    expect(canReview).toBe(true);
  });
});
