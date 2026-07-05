import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(() => true),
  getDashboard: vi.fn(),
  getChatUnread: vi.fn(),
  getMailUnread: vi.fn(),
  savePreferences: vi.fn(),
}));

vi.mock('../api/client', () => ({
  hubAPI: {
    getDashboard: (...args) => mocks.getDashboard(...args),
  },
}));

vi.mock('../api/chatNotifications', () => ({
  chatNotificationsAPI: {
    getUnreadSummary: (...args) => mocks.getChatUnread(...args),
  },
}));

vi.mock('../api/mailNotifications', () => ({
  mailNotificationsAPI: {
    getUnreadCount: (...args) => mocks.getMailUnread(...args),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: 'ivanov',
      full_name: 'Иван Иванов',
      role: 'operator',
    },
    hasPermission: mocks.hasPermission,
  }),
}));

const preferences = {
  dashboard_sections: ['attention', 'tasks', 'communication', 'news'],
  dashboard_mobile_sections: ['urgent', 'tasks', 'announcements'],
};

vi.mock('../contexts/PreferencesContext', async () => {
  const actual = await vi.importActual('../contexts/PreferencesContext');
  return {
    ...actual,
    usePreferences: () => ({
      preferences,
      savePreferences: mocks.savePreferences,
    }),
  };
});

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

import Dashboard, { getFirstName, getGreeting } from './Dashboard';

const tasks = [
  {
    id: 'overdue-1',
    title: 'Просроченная задача',
    status: 'in_progress',
    due_at: '2025-01-01T08:00:00Z',
    is_overdue: true,
    has_unread_comments: false,
  },
  {
    id: 'review-1',
    title: 'Задача на проверке',
    status: 'review',
    due_at: '2027-01-02T08:00:00Z',
    created_by_user_id: 1,
    is_overdue: false,
    has_unread_comments: false,
  },
  {
    id: 'comment-1',
    title: 'Задача с комментарием',
    status: 'in_progress',
    due_at: '2027-01-03T08:00:00Z',
    is_overdue: false,
    has_unread_comments: true,
  },
];

const announcements = [
  {
    id: 'ann-1',
    title: 'Обязательное сообщение',
    preview: 'Нужно подтвердить ознакомление',
    is_ack_pending: true,
    updated_at: '2026-06-22T08:00:00Z',
  },
  {
    id: 'ann-2',
    title: 'Обычная новость',
    preview: 'Короткий текст новости',
    is_ack_pending: false,
    updated_at: '2026-06-21T08:00:00Z',
  },
];

function installMatchMedia(mobile = false) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile && query.includes('max-width:599.95px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderDashboard(initialEntry = '/dashboard', mobile = false) {
  installMatchMedia(mobile);
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
        <Route path="/dashboard/news" element={<LocationProbe />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Dashboard greeting helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('extracts the given name from surname-first Russian FIO', () => {
    expect(getFirstName({ full_name: 'Козловский Максим Евгеньевич' })).toBe('Максим');
    expect(getFirstName({ full_name: 'Иван Иванов' })).toBe('Иван');
    expect(getFirstName({ first_name: 'Анна', full_name: 'Смирнова Анна Олеговна' })).toBe('Анна');
  });

  it('changes the greeting for morning, daytime, and evening', () => {
    expect(getGreeting(new Date(2026, 5, 22, 9, 0))).toBe('Доброе утро');
    expect(getGreeting(new Date(2026, 5, 22, 14, 0))).toBe('Добрый день');
    expect(getGreeting(new Date(2026, 5, 22, 20, 0))).toBe('Добрый вечер');
  });
});

describe('Dashboard today page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preferences.dashboard_sections = ['attention', 'tasks', 'communication', 'news'];
    preferences.dashboard_mobile_sections = ['urgent', 'tasks', 'announcements'];
    mocks.hasPermission.mockReturnValue(true);
    mocks.getDashboard.mockResolvedValue({
      announcements: { items: announcements, total: announcements.length },
      my_tasks: { items: tasks, total: tasks.length },
      unread_counts: { notifications_unread_total: 2 },
      summary: {},
    });
    mocks.getChatUnread.mockResolvedValue({ messages_unread_total: 3 });
    mocks.getMailUnread.mockResolvedValue({ unread_count: 4 });
    mocks.savePreferences.mockResolvedValue({
      dashboard_sections: ['attention', 'tasks', 'communication'],
    });
  });

  it('renders a personal today screen with attention first and one shared section order', async () => {
    renderDashboard();

    expect(await screen.findByTestId('dashboard-today-header')).toHaveTextContent('Иван');
    expect(screen.getByTestId('dashboard-section-attention')).toBeInTheDocument();
    expect(screen.getAllByText('Просроченная задача').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Задача на проверке').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Задача с комментарием').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Обязательное сообщение').length).toBeGreaterThan(0);

    const sections = screen.getByTestId('dashboard-sections');
    expect(sections).toHaveAttribute('data-dashboard-order', 'attention,tasks,communication,news');
    expect(sections).toHaveAttribute('data-layout', 'desktop-focus');
    expect(within(sections).getByTestId('dashboard-section-tasks')).toBeInTheDocument();
    expect(within(sections).getByTestId('dashboard-section-communication')).toBeInTheDocument();
    expect(within(sections).getByTestId('dashboard-section-news')).toBeInTheDocument();
    expect(screen.getAllByTestId('dashboard-task-status-dot')).toHaveLength(3);
    expect(screen.getAllByTestId('dashboard-task-row')[0]).toHaveTextContent('Просрочено');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('uses the same content model on mobile without tabs or swipe views', async () => {
    renderDashboard('/dashboard', true);

    expect(await screen.findByTestId('dashboard-today-header')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('dashboard-mobile-swipe-region')).toBeNull();
    expect(screen.getByTestId('dashboard-sections')).toHaveAttribute(
      'data-dashboard-order',
      'attention,tasks,communication,news',
    );
    expect(screen.getByTestId('dashboard-sections')).toHaveAttribute('data-layout', 'mobile-feed');
    expect(screen.getByTestId('dashboard-primary-action')).toHaveTextContent('Создать задачу');
    expect(screen.getByRole('button', { name: 'Открыть чат' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Написать письмо' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dashboard-primary-action'));
    expect(await screen.findByTestId('location')).toHaveTextContent('/tasks?create=1');
  });

  it('collapses attention into a calm status bar when no action is required', async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      announcements: { items: [], total: 0 },
      my_tasks: { items: [], total: 0 },
      unread_counts: { notifications_unread_total: 0 },
      summary: {},
    });

    renderDashboard();

    const attention = await screen.findByTestId('dashboard-section-attention');
    expect(attention).toHaveAttribute('data-state', 'calm');
    expect(attention).toHaveTextContent('Всё спокойно');
    expect(screen.queryByText('Требует внимания')).toBeNull();
  });

  it('keeps tasks first and expands the secondary column when tasks are hidden', async () => {
    preferences.dashboard_sections = ['attention', 'news', 'communication'];

    renderDashboard();

    await screen.findByTestId('dashboard-today-header');
    const sections = screen.getByTestId('dashboard-sections');
    expect(sections).toHaveAttribute('data-dashboard-order', 'attention,news,communication');
    expect(sections).toHaveAttribute('data-layout', 'desktop-full');
    expect(screen.queryByTestId('dashboard-section-tasks')).toBeNull();

    const secondary = screen.getByTestId('dashboard-secondary-column');
    const news = within(secondary).getByTestId('dashboard-section-news');
    const communication = within(secondary).getByTestId('dashboard-section-communication');
    expect(news.compareDocumentPosition(communication) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('normalizes a legacy mixed order into tasks first while preserving the secondary order', async () => {
    preferences.dashboard_sections = ['attention', 'news', 'tasks', 'communication'];

    renderDashboard();

    const sections = await screen.findByTestId('dashboard-sections');
    expect(sections).toHaveAttribute('data-dashboard-order', 'attention,tasks,news,communication');
    expect(sections.firstElementChild).toHaveAttribute('data-testid', 'dashboard-section-tasks');
  });

  it('filters task and communication blocks by permissions', async () => {
    mocks.hasPermission.mockImplementation((permission) => (
      permission === 'dashboard.read'
    ));

    renderDashboard();

    await screen.findByTestId('dashboard-today-header');
    expect(screen.queryByTestId('dashboard-section-tasks')).toBeNull();
    expect(screen.queryByTestId('dashboard-section-communication')).toBeNull();
    expect(screen.getByTestId('dashboard-section-news')).toBeInTheDocument();
    expect(mocks.getChatUnread).not.toHaveBeenCalled();
    expect(mocks.getMailUnread).not.toHaveBeenCalled();
  });

  it('saves a canonical shared dashboard configuration', async () => {
    renderDashboard();

    await screen.findByTestId('dashboard-today-header');
    fireEvent.click(screen.getByRole('button', { name: 'Настроить главную' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть Последние новости' }));
    fireEvent.click(screen.getByTestId('dashboard-customize-save'));

    await waitFor(() => {
      expect(mocks.savePreferences).toHaveBeenCalledWith({
        dashboard_sections: ['attention', 'tasks', 'communication'],
      });
    });
  });

  it('redirects legacy announcement deep links to the news route', async () => {
    renderDashboard('/dashboard?announcement=ann-1');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/news?announcement=ann-1');
    });
  });
});
