import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useTasksPageController from './useTasksPageController';
import { hubAPI } from '../../api/client';
import { departmentsAPI } from '../../api/departments';

vi.mock('../../api/client', () => ({
  hubAPI: {
    getAssignees: vi.fn(),
    getControllers: vi.fn(),
    getTaskProjects: vi.fn(),
    getTaskObjects: vi.fn(),
    getTaskAnalytics: vi.fn(),
    exportTaskAnalyticsExcel: vi.fn(),
    getTasks: vi.fn(),
    getTask: vi.fn(),
    getTaskComments: vi.fn(),
    getTaskStatusLog: vi.fn(),
    markTaskCommentsSeen: vi.fn(),
    transformMarkdown: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    downloadTaskReport: vi.fn(),
    createTask: vi.fn(),
    createTaskProject: vi.fn(),
    createTaskObject: vi.fn(),
    reviewTask: vi.fn(),
    startTask: vi.fn(),
    submitTask: vi.fn(),
    reopenTask: vi.fn(),
    deleteTask: vi.fn(),
    updateTask: vi.fn(),
    updateTaskProject: vi.fn(),
    updateTaskObject: vi.fn(),
    uploadTaskAttachment: vi.fn(),
    addTaskComment: vi.fn(),
    openTaskDiscussion: vi.fn(),
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
    hubAPI.getTasks.mockResolvedValue({ items: [], total: 0, meta: {} });
    hubAPI.getControllers.mockResolvedValue({ items: [] });
    hubAPI.getTaskProjects.mockResolvedValue({ items: [] });
    hubAPI.getTaskObjects.mockResolvedValue({ items: [] });
    departmentsAPI.list.mockResolvedValue({ items: [] });
  });

  it('initializes with list page mode and empty tasks', async () => {
    const { result } = renderHook(() => useTasksPageController(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/tasks']}>{children}</MemoryRouter>
      ),
    });

    await waitFor(() => {
      expect(hubAPI.getTasks).toHaveBeenCalled();
    });

    expect(result.current.pageMode).toBe('list');
    expect(result.current.taskItems).toEqual([]);
    expect(result.current.boardFiltersPanelProps).toBeDefined();
    expect(result.current.mobileNavigationDrawerProps).toBeNull();
  });
});
