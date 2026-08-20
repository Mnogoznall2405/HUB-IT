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

describe('useTaskDetails canCloseTask', () => {
  it('allows the task creator to close an open task and blocks the assignee', () => {
    const { result } = renderUseTaskDetails({ user: { id: 3 } });
    const openTask = {
      id: 'task-close',
      status: 'in_progress',
      created_by_user_id: 3,
      assignee_user_id: 8,
    };

    expect(result.current.canCloseTask(openTask)).toBe(true);
    expect(result.current.canCloseTask({ ...openTask, created_by_user_id: 4 })).toBe(false);
    expect(result.current.canCloseTask({ ...openTask, status: 'done' })).toBe(false);
  });

  it('prefers server capabilities when present', () => {
    const { result } = renderUseTaskDetails({ user: { id: 8 } });
    expect(result.current.canCloseTask({
      id: 'task-caps',
      status: 'new',
      created_by_user_id: 1,
      capabilities: { can_close: true },
    })).toBe(true);
  });
});

describe('useTaskDetails canDeleteTask', () => {
  it('allows the task creator and blocks another user', () => {
    const { result } = renderUseTaskDetails({ user: { id: 3 } });
    const creatorTask = {
      id: 'task-created-by-current-user',
      created_by_user_id: 3,
    };

    expect(result.current.canDeleteTask(creatorTask)).toBe(true);
    expect(result.current.canDeleteTask({ ...creatorTask, created_by_user_id: 4 })).toBe(false);
  });
});

describe('useTaskDetails detailsOpen', () => {
  it('keeps the in-page card when the task chat split is not used', () => {
    const { result } = renderHook(() => useTaskDetails({
      user: { id: 3 },
      canManageAllTasks: false,
      canReviewTasks: true,
      taskDiscussionChatEnabled: true,
      openTaskInChat: false,
      isMobile: false,
      ui: {},
      setError: vi.fn(),
      patchTaskItem: vi.fn(),
      loadTasks: vi.fn(),
      departments: [],
    }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks?task=task-1']}>{children}</MemoryRouter>
      ),
    });

    expect(result.current.detailsOpen).toBe(true);
  });

  it('hides the in-page card while the desktop task chat split is used', () => {
    const { result } = renderHook(() => useTaskDetails({
      user: { id: 3 },
      canManageAllTasks: false,
      canReviewTasks: true,
      taskDiscussionChatEnabled: true,
      openTaskInChat: true,
      isMobile: false,
      ui: {},
      setError: vi.fn(),
      patchTaskItem: vi.fn(),
      loadTasks: vi.fn(),
      departments: [],
    }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks?task=task-1']}>{children}</MemoryRouter>
      ),
    });

    expect(result.current.detailsOpen).toBe(false);
  });
});
