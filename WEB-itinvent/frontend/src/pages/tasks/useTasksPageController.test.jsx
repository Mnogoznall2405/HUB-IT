import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useTasksPageController from './useTasksPageController';
import hubTasksAPI from '../../api/hubTasks';
import hubTaskSupportAPI from '../../api/hubTaskSupport';
import { departmentsAPI } from '../../api/departments';

vi.mock('../../api/hubTasks', () => ({
  default: {
    getTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    startTask: vi.fn(),
    submitTask: vi.fn(),
    reviewTask: vi.fn(),
    reopenTask: vi.fn(),
  },
}));

vi.mock('../../api/hubTaskSupport', () => ({
  default: {
    getAssignees: vi.fn(),
    getControllers: vi.fn(),
    getTaskProjects: vi.fn(),
    getTaskObjects: vi.fn(),
    createTaskProject: vi.fn(),
    createTaskObject: vi.fn(),
    updateTaskProject: vi.fn(),
    updateTaskObject: vi.fn(),
  },
}));

vi.mock('../../api/hubTaskAnalytics', () => ({
  default: {
    getTaskAnalytics: vi.fn(),
    exportTaskAnalyticsExcel: vi.fn(),
  },
}));

vi.mock('../../api/hubTaskActivity', () => ({
  default: {
    getTaskComments: vi.fn(),
    getTaskStatusLog: vi.fn(),
    markTaskCommentsSeen: vi.fn(),
    addTaskComment: vi.fn(),
  },
}));

vi.mock('../../api/hubTaskFiles', () => ({
  default: {
    uploadTaskAttachment: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    downloadTaskReport: vi.fn(),
  },
}));

vi.mock('../../api/hubTaskDiscussion', () => ({
  default: {
    openTaskDiscussion: vi.fn(),
  },
}));

vi.mock('../../api/hubMarkdown', () => ({
  default: {
    transformMarkdown: vi.fn(),
  },
}));

vi.mock('../../api/departments', () => ({
  departmentsAPI: {
    list: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: false,
  TASK_DISCUSSION_CHAT_ENABLED: false,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', username: 'admin' },
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

function installMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('useTasksPageController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMatchMedia();
    hubTasksAPI.getTasks.mockResolvedValue({ items: [], total: 0, meta: {} });
    hubTaskSupportAPI.getControllers.mockResolvedValue({ items: [] });
    hubTaskSupportAPI.getTaskProjects.mockResolvedValue({ items: [] });
    hubTaskSupportAPI.getTaskObjects.mockResolvedValue({ items: [] });
    departmentsAPI.list.mockResolvedValue({ items: [] });
  });

  it('initializes with list page mode and empty tasks', async () => {
    const { result } = renderHook(() => useTasksPageController(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks']}>{children}</MemoryRouter>
      ),
    });

    await waitFor(() => {
      expect(hubTasksAPI.getTasks).toHaveBeenCalled();
    });

    expect(result.current.pageMode).toBe('list');
    expect(result.current.taskItems).toEqual([]);
    expect(result.current.boardFiltersPanelProps).toBeDefined();
    expect(result.current.mobileNavigationDrawerProps).toBeNull();
  });
});
