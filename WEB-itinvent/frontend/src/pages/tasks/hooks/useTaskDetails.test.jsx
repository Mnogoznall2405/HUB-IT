import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useTaskDetails from './useTaskDetails';

const { mockGetTask, mockOpenTaskDiscussion } = vi.hoisted(() => ({
  mockGetTask: vi.fn(),
  mockOpenTaskDiscussion: vi.fn(),
}));

vi.mock('../../../api/hubTasks', () => ({ default: { getTask: mockGetTask } }));
vi.mock('../../../api/hubTaskActivity', () => ({ default: {} }));
vi.mock('../../../api/hubTaskFiles', () => ({ default: {} }));
vi.mock('../../../api/hubTaskDiscussion', () => ({
  default: { openTaskDiscussion: mockOpenTaskDiscussion },
}));

beforeEach(() => {
  mockGetTask.mockReset();
  mockGetTask.mockResolvedValue({ id: 'task-1', capabilities: { can_open_discussion: true } });
  mockOpenTaskDiscussion.mockReset();
  mockOpenTaskDiscussion.mockResolvedValue({ conversation_id: 'conversation-task-1' });
});

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

  it('allows an administrator to close another user\'s open task from list data', () => {
    const { result } = renderUseTaskDetails({
      user: { id: 5, role: 'admin' },
      canManageAllTasks: true,
    });

    expect(result.current.canCloseTask({
      id: 'task-admin-close',
      status: 'in_progress',
      created_by_user_id: 1,
      assignee_user_id: 2,
    })).toBe(true);
  });
});

describe('useTaskDetails shared assignees', () => {
  it('allows a secondary assignee to start and submit through list-data fallbacks', () => {
    const { result } = renderUseTaskDetails({ user: { id: 4 } });
    const task = {
      id: 'task-shared',
      status: 'new',
      assignee_user_id: 2,
      assignee_user_ids: [2, 4],
    };

    expect(result.current.canStartTask(task)).toBe(true);
    expect(result.current.canSubmitTask({ ...task, status: 'in_progress' })).toBe(true);
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

  it('keeps the canonical in-page card even when a legacy split preference is supplied', () => {
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

    expect(result.current.detailsOpen).toBe(true);
  });

  it('keeps the in-page canvas open instead of redirecting it to the task chat', async () => {
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
        <MemoryRouter initialEntries={['/tasks?task=task-1&task_detail_view=canvas']}>{children}</MemoryRouter>
      ),
    });

    expect(result.current.selectedTaskView).toBe('canvas');
    expect(result.current.detailsOpen).toBe(true);
    await waitFor(() => expect(result.current.detailsTask?.id).toBe('task-1'));
  });

  it('does not provision a discussion for an ordinary task-card open', async () => {
    const { result } = renderHook(() => useTaskDetails({
      user: { id: 3 },
      canManageAllTasks: false,
      canReviewTasks: true,
      taskDiscussionChatEnabled: true,
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

    await waitFor(() => expect(result.current.detailsTask?.id).toBe('task-1'));
    expect(result.current.selectedTaskView).toBe('overview');
    expect(mockOpenTaskDiscussion).not.toHaveBeenCalled();
  });

  it('provisions the discussion only after the discussion route is opened', async () => {
    const { result } = renderHook(() => useTaskDetails({
      user: { id: 3 },
      canManageAllTasks: false,
      canReviewTasks: true,
      taskDiscussionChatEnabled: true,
      isMobile: false,
      ui: {},
      setError: vi.fn(),
      patchTaskItem: vi.fn(),
      loadTasks: vi.fn(),
      departments: [],
    }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks?task=task-1&task_detail_view=discussion&message=message-9']}>
          {children}
        </MemoryRouter>
      ),
    });

    await waitFor(() => expect(result.current.selectedDiscussionConversationId).toBe('conversation-task-1'));
    expect(result.current.selectedTaskView).toBe('discussion');
    expect(result.current.selectedDiscussionMessageId).toBe('message-9');
    expect(mockOpenTaskDiscussion).toHaveBeenCalledTimes(1);
    expect(mockOpenTaskDiscussion).toHaveBeenCalledWith('task-1');
  });

  it('keeps a discussion error inside the card and retries without closing it', async () => {
    mockOpenTaskDiscussion
      .mockRejectedValueOnce(new Error('Chat unavailable'))
      .mockResolvedValueOnce({ conversation_id: 'conversation-task-1' });
    const { result } = renderHook(() => useTaskDetails({
      user: { id: 3 },
      canManageAllTasks: false,
      canReviewTasks: true,
      taskDiscussionChatEnabled: true,
      isMobile: false,
      ui: {},
      setError: vi.fn(),
      patchTaskItem: vi.fn(),
      loadTasks: vi.fn(),
      departments: [],
    }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks?task=task-1&task_detail_view=discussion']}>
          {children}
        </MemoryRouter>
      ),
    });

    await waitFor(() => expect(result.current.discussionError).toBe('Chat unavailable'));
    expect(result.current.detailsOpen).toBe(true);

    act(() => result.current.retryTaskDiscussion());

    await waitFor(() => expect(result.current.selectedDiscussionConversationId).toBe('conversation-task-1'));
    expect(mockOpenTaskDiscussion).toHaveBeenCalledTimes(2);
    expect(result.current.detailsOpen).toBe(true);
  });

  it('does not call the discussion API when the server capability disables it', async () => {
    const setError = vi.fn();
    mockGetTask.mockResolvedValue({
      id: 'task-1',
      capabilities: { can_open_discussion: false },
    });
    const { result } = renderHook(() => useTaskDetails({
      user: { id: 3 },
      canManageAllTasks: false,
      canReviewTasks: true,
      taskDiscussionChatEnabled: true,
      isMobile: false,
      ui: {},
      setError,
      patchTaskItem: vi.fn(),
      loadTasks: vi.fn(),
      departments: [],
    }), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks?task=task-1&task_detail_view=discussion']}>
          {children}
        </MemoryRouter>
      ),
    });

    await waitFor(() => expect(result.current.selectedTaskView).toBe('overview'));
    expect(mockOpenTaskDiscussion).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('Обсуждение этой задачи недоступно.');
  });
});
