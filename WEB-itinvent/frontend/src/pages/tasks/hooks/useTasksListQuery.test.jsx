import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useTasksListQuery from './useTasksListQuery';
import hubTasksAPI from '../../../api/hubTasks';
import { departmentsAPI } from '../../../api/departments';
import { clearSWRCache } from '../../../lib/swrCache';

const { mockGetTasks } = vi.hoisted(() => ({ mockGetTasks: vi.fn() }));

vi.mock('../../../api/hubTasks', () => ({ default: { getTasks: mockGetTasks } }));
vi.mock('../../../api/hubTaskSupport', () => ({
  default: {
    getControllers: vi.fn(),
    getTaskProjects: vi.fn(),
    getTaskObjects: vi.fn(),
    getAssignees: vi.fn(),
  },
}));
vi.mock('../../../api/departments', () => ({ departmentsAPI: { list: vi.fn() } }));

const TASKS = [
  { id: 't1', title: 'Активная с дедлайном', status: 'in_progress', due_at: '2099-01-01T10:00:00Z', updated_at: '2026-09-16T10:00:00Z' },
  { id: 't2', title: 'Активная без дедлайна', status: 'new', updated_at: '2026-09-16T11:00:00Z' },
  { id: 't3', title: 'Завершённая', status: 'done', updated_at: '2026-09-16T12:00:00Z' },
];

function installMatchMedia() {
  window.matchMedia = window.matchMedia || vi.fn().mockImplementation(() => ({
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

describe('useTasksListQuery view-model gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMatchMedia();
    mockGetTasks.mockResolvedValue({ items: TASKS, total: 3, meta: {} });
    hubTasksAPI.getTasks = mockGetTasks;
    departmentsAPI.list.mockResolvedValue({ items: [] });
  });

  const stableSetError = vi.fn();
  const setup = (pageMode, query = '') => ({
    setError: stableSetError,
    debouncedQ: query,
    viewMode: 'my',
    statusFilter: '',
    dueState: '',
    assigneeFilter: '',
    controllerFilter: '',
    departmentFilter: '',
    hasAttachments: false,
    unreadCommentsOnly: false,
    focusMode: 'all',
    dateSortDirection: 'desc',
    pageMode,
  });

  it('computes only the active page-mode view model and skips the others', async () => {
    const { result } = renderHook(
      ({ pageMode, query = '' }) => useTasksListQuery(setup(pageMode, query)),
      { initialProps: { pageMode: 'list' } },
    );

    await waitFor(() => expect(result.current.taskItems).toHaveLength(3));

    expect(result.current.taskListSections.active.items.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.current.taskListSections.completed.items.map((t) => t.id)).toEqual(['t3']);
    expect(result.current.calendarPayload.days).toEqual([]);
    expect(result.current.ganttPayload.rows).toEqual([]);
    expect(result.current.calendarPayload.noDueCount).toBe(0);
    expect(result.current.deadlineBuckets).toEqual([]);
  });

  it('builds deadline buckets only in deadlines mode', async () => {
    const { result, rerender } = renderHook(
      ({ pageMode, query = '' }) => useTasksListQuery(setup(pageMode, query)),
      { initialProps: { pageMode: 'deadlines' } },
    );

    await waitFor(() => expect(result.current.taskItems).toHaveLength(3));
    expect(result.current.deadlineBuckets.length).toBeGreaterThan(0);
    expect(result.current.deadlineBuckets.flatMap((b) => b.items.map((t) => t.id))).toContain('t1');
    expect(result.current.taskListSections.active.items).toEqual([]);

    rerender({ pageMode: 'list' });
    expect(result.current.deadlineBuckets).toEqual([]);
  });

  it('caps the append buffer with a sliding window beyond three pages', async () => {
    mockGetTasks.mockReset();
    vi.mocked(hubTasksAPI.getTasks).mockImplementation(mockGetTasks);
    mockGetTasks.mockImplementation(async () => ({ items: TASKS, total: 900, meta: {} }));

    const { result } = renderHook(
      ({ pageMode, query = '' }) => useTasksListQuery(setup(pageMode, query)),
      { initialProps: { pageMode: 'list' } },
    );

    await waitFor(() => expect(result.current.taskItems).toHaveLength(3));

    result.current.loadMoreTasks();
    await waitFor(() => expect(result.current.taskItems).toHaveLength(6));
    const callsAfterAppend = mockGetTasks.mock.calls.slice();
    result.current.loadMoreTasks();
    await waitFor(() => expect(mockGetTasks.mock.calls.length).toBeGreaterThan(callsAfterAppend.length));
    result.current.loadMoreTasks();
    await waitFor(() => expect(mockGetTasks.mock.calls.length).toBeGreaterThan(callsAfterAppend.length + 1));
    const windowedCall = mockGetTasks.mock.calls[mockGetTasks.mock.calls.length - 1][0];
    expect(windowedCall.offset).toBe(450);
    expect(result.current.taskItems).toHaveLength(3);
    expect(result.current.hasMoreTasks).toBe(true);
  });

  it('does not send q to the network for a single-character query', async () => {
    const { result, rerender } = renderHook(
      ({ pageMode, query = '' }) => useTasksListQuery(setup(pageMode, query)),
      { initialProps: { pageMode: 'list' } },
    );

    await waitFor(() => expect(result.current.taskItems).toHaveLength(3));
    const callsBeforeGibberish = mockGetTasks.mock.calls.length;

    rerender({ pageMode: 'list', query: 'a' });

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(mockGetTasks.mock.calls.length).toBe(callsBeforeGibberish);

    await act(async () => {
      rerender({ pageMode: 'list', query: 'ab' });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await waitFor(() => {
      const lastCall = mockGetTasks.mock.calls[mockGetTasks.mock.calls.length - 1]?.[0];
      expect(lastCall.q).toBe('ab');
    });
  });

  it('caches the departments directory between mounts (SWR, zero refetch in TTL)', async () => {
    clearSWRCache();
    vi.mocked(departmentsAPI.list).mockReset();
    vi.mocked(departmentsAPI.list).mockClear();
    vi.mocked(departmentsAPI.list).mockResolvedValue({ items: [{ id: 'd1', name: 'Отдел' }] });

    const first = renderHook(() => useTasksListQuery(setup('list')));
    await waitFor(() => expect(first.result.current.departments).toHaveLength(1));

    const second = renderHook(() => useTasksListQuery(setup('list')));
    await waitFor(() => expect(second.result.current.departments).toHaveLength(1));

    expect(departmentsAPI.list).toHaveBeenCalledTimes(1);
  });
});






