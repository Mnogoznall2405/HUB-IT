import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function installMatchMedia({ mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile ? query.includes('max-width:599.95px') : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

vi.mock('../api/client', () => ({
  hubAPI: {
    getDashboard: vi.fn(),
    getAnnouncementRecipients: vi.fn(),
    transformMarkdown: vi.fn(),
    downloadAnnouncementAttachment: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    downloadTaskReport: vi.fn(),
    getAnnouncement: vi.fn(),
    markAnnouncementRead: vi.fn(),
    getAnnouncementReads: vi.fn(),
    acknowledgeAnnouncement: vi.fn(),
    createAnnouncement: vi.fn(),
    updateAnnouncement: vi.fn(),
    deleteAnnouncement: vi.fn(),
    getTask: vi.fn(),
    markTaskCommentsSeen: vi.fn(),
    addTaskComment: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', username: 'admin' },
    hasPermission: (permission) => permission !== 'announcements.write',
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
  }),
}));

const mockPreferences = {
  dashboard_mobile_sections: ['urgent', 'announcements', 'tasks'],
};
const savePreferencesMock = vi.fn();

vi.mock('../contexts/PreferencesContext', () => ({
  DEFAULT_DASHBOARD_MOBILE_SECTIONS: ['urgent', 'announcements', 'tasks'],
  normalizeDashboardMobileSections: (value) => {
    const allowed = ['urgent', 'announcements', 'tasks'];
    const source = Array.isArray(value) ? value : [];
    const result = [];
    source.forEach((item) => {
      const token = String(item || '').trim().toLowerCase();
      if (allowed.includes(token) && !result.includes(token)) {
        result.push(token);
      }
    });
    return result.length ? result : ['urgent', 'announcements', 'tasks'];
  },
  usePreferences: () => ({
    preferences: mockPreferences,
    savePreferences: savePreferencesMock,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children, headerMode = 'default' }) => <div data-testid="main-layout" data-header-mode={headerMode}>{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../components/hub/MarkdownEditor', () => ({
  default: ({ value, onChange }) => (
    <textarea
      aria-label="markdown-editor"
      value={value || ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

import { hubAPI } from '../api/client';
import Dashboard, { getAnnouncementReadSecondaryText, normalizeAnnouncementReadsPayload } from './Dashboard';

const baseTask = {
  id: 'task-card-1',
  title: 'Добавление данных',
  status: 'new',
  priority: 'high',
  assignee_full_name: 'Тестовый Исполнитель',
  due_at: '2026-03-21T10:00:00Z',
  description: '## Заголовок блока\n\n- Первый пункт\n- Второй пункт',
  latest_comment_preview: '',
  latest_comment_full_name: '',
  latest_comment_username: '',
  has_unread_comments: false,
  is_overdue: false,
  attachments_count: 0,
  comments_count: 0,
};

const createDashboardPayload = ({ announcements = [], tasks = [baseTask], summary = {}, unread_counts = {} } = {}) => ({
  announcements: {
    items: announcements,
    total: announcements.length,
    unread_total: announcements.filter((item) => item?.is_unread).length,
    ack_pending_total: announcements.filter((item) => item?.is_ack_pending).length,
  },
  my_tasks: {
    items: tasks,
    total: tasks.length,
  },
  unread_counts,
  summary,
});

beforeEach(() => {
  vi.clearAllMocks();
  installMatchMedia({ mobile: false });
  mockPreferences.dashboard_mobile_sections = ['urgent', 'announcements', 'tasks'];
  savePreferencesMock.mockResolvedValue({
    dashboard_mobile_sections: ['urgent', 'announcements', 'tasks'],
  });
  hubAPI.getDashboard.mockResolvedValue(createDashboardPayload());
  hubAPI.getTask.mockResolvedValue({
    id: 'task-card-1',
    title: 'Добавление данных',
    status: 'review',
    priority: 'high',
    due_at: '2026-03-21T10:00:00Z',
    updated_at: '2026-03-21T09:30:00Z',
    description: 'Preview description',
    comments: [],
    attachments: [],
    status_log: [],
    has_unread_comments: false,
  });
});

describe('Dashboard announcement reads helpers', () => {
  it('normalizes announcement reads payload using backend contract fields', () => {
    const payload = normalizeAnnouncementReadsPayload({
      items: [
        {
          user_id: 2,
          full_name: 'Иван Иванов',
          is_seen: true,
          is_acknowledged: true,
          read_at: '2026-03-17T12:00:00Z',
          acknowledged_at: '2026-03-17T12:05:00Z',
        },
        {
          user_id: 3,
          full_name: 'Петр Петров',
          is_seen: false,
          is_acknowledged: false,
          read_at: '',
          acknowledged_at: '',
        },
      ],
      summary: {
        recipients_total: 2,
        seen_total: 1,
        ack_total: 1,
        pending_ack_total: 1,
      },
    });

    expect(payload.summary.seen_total).toBe(1);
    expect(payload.items[0].is_seen).toBe(true);
    expect(payload.items[0].is_acknowledged).toBe(true);
    expect(payload.items[1].is_seen).toBe(false);
    expect(payload.items[1].is_acknowledged).toBe(false);
  });

  it('builds readable secondary text for seen and unseen recipients', () => {
    const formatDate = (value) => value || '-';

    expect(getAnnouncementReadSecondaryText(
      { is_seen: true, is_acknowledged: true, read_at: 'READ_AT', acknowledged_at: 'ACK_AT' },
      true,
      formatDate,
    )).toBe('Прочитал: READ_AT · Подтвердил: ACK_AT');

    expect(getAnnouncementReadSecondaryText(
      { is_seen: false, is_acknowledged: false, read_at: '', acknowledged_at: '' },
      true,
      formatDate,
    )).toBe('Не открывал · Подтверждение не получено');

    expect(getAnnouncementReadSecondaryText(
      { is_seen: true, is_acknowledged: false, read_at: 'READ_AT', acknowledged_at: '' },
      false,
      formatDate,
    )).toBe('Прочитал: READ_AT');
  });

  it('does not render task description in closed dashboard cards', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Добавление данных')).toBeInTheDocument();
    expect(screen.queryByText('Заголовок блока')).not.toBeInTheDocument();
    expect(screen.queryByText('Показать полностью')).not.toBeInTheDocument();
    expect(hubAPI.getTask).not.toHaveBeenCalled();
  });

  it('hides empty announcement special sections and keeps the all section', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Все заметки')).toBeInTheDocument();
    expect(screen.getByText('По текущим фильтрам заметки не найдены.')).toBeInTheDocument();
    expect(screen.queryByText('Требуют подтверждения')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет заметок, которые нужно подтвердить.')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет новых или обновлённых заметок.')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет закреплённых заметок.')).not.toBeInTheDocument();
  });

  it('renders populated special sections and still keeps the all section', async () => {
    hubAPI.getDashboard.mockResolvedValueOnce(createDashboardPayload({
      announcements: [
        {
          id: 'ann-1',
          title: 'Нужно подтвердить',
          preview: 'Подтвердите получение заметки.',
          priority: 'normal',
          is_ack_pending: true,
          is_unread: false,
          is_pinned_active: false,
          attachments_count: 0,
          author_full_name: 'Администратор',
          author_username: 'admin',
        },
      ],
    }));

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Требуют подтверждения')).toBeInTheDocument();
    expect(screen.getByText('Все заметки')).toBeInTheDocument();
    expect(screen.getAllByText('Нужно подтвердить').length).toBeGreaterThan(0);
    expect(screen.queryByText('Нет заметок, которые нужно подтвердить.')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет новых или обновлённых заметок.')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет закреплённых заметок.')).not.toBeInTheDocument();
  });

  it('renders mobile dashboard with notifications-only header and the overview as default view', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('dashboard-mobile-layout')).toBeInTheDocument();
    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-header-mode', 'notifications-only');
    expect(screen.getByTestId('dashboard-mobile-tab-overview')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('dashboard-mobile-overview-section-urgent')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-mobile-overview-section-announcements')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-mobile-overview-section-tasks')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dashboard-mobile-tab-tasks'));

    expect(screen.getByTestId('dashboard-mobile-tab-tasks')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Очередь задач')).toBeInTheDocument();
  });

  it('respects mobile overview section preferences and saves customization', async () => {
    installMatchMedia({ mobile: true });
    mockPreferences.dashboard_mobile_sections = ['urgent', 'tasks'];

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('dashboard-mobile-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-mobile-overview-section-announcements')).not.toBeInTheDocument();

    const overviewSections = screen.getAllByTestId(/dashboard-mobile-overview-section-/);
    expect(overviewSections[0]).toHaveAttribute('data-testid', 'dashboard-mobile-overview-section-urgent');
    expect(overviewSections[1]).toHaveAttribute('data-testid', 'dashboard-mobile-overview-section-tasks');

    fireEvent.click(screen.getByRole('button', { name: 'Действия центра' }));
    fireEvent.click(await screen.findByText('Настроить экран'));

    expect(await screen.findByTestId('dashboard-mobile-customize-dialog')).toBeInTheDocument();

    const tasksCard = screen.getByTestId('dashboard-mobile-customize-section-tasks');
    fireEvent.click(within(tasksCard).getByRole('button', { name: 'Скрыть' }));
    fireEvent.click(screen.getByTestId('dashboard-mobile-customize-save'));

    await waitFor(() => {
      expect(savePreferencesMock).toHaveBeenCalledWith({
        dashboard_mobile_sections: ['urgent'],
      });
    });
  });

  it('opens mobile filters and task preview flow', async () => {
    installMatchMedia({ mobile: true });
    hubAPI.getDashboard.mockResolvedValueOnce(createDashboardPayload({
      tasks: [
        {
          id: 'task-card-1',
          title: 'Проверить мобильный preview',
          status: 'review',
          priority: 'high',
          assignee_full_name: 'Тестовый Исполнитель',
          due_at: '2026-03-21T10:00:00Z',
          latest_comment_preview: 'Новый комментарий',
          latest_comment_full_name: 'Автор',
          has_unread_comments: true,
          is_overdue: false,
          attachments_count: 0,
          comments_count: 1,
        },
      ],
      summary: {
        tasks_review_required: 1,
      },
      unread_counts: {
        tasks_review_required: 1,
      },
    }));

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByTestId('dashboard-mobile-layout');

    fireEvent.click(screen.getByTestId('dashboard-mobile-tab-announcements'));
    fireEvent.click(screen.getByTestId('dashboard-mobile-filters-button'));
    expect(await screen.findByText('Фильтры заметок')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('dashboard-summary-chip-review'));
    expect(screen.getByTestId('dashboard-mobile-tab-tasks')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByText('Проверить мобильный preview'));

    await waitFor(() => {
      expect(hubAPI.getTask).toHaveBeenCalledWith('task-card-1');
    });
    expect(await screen.findByTestId('task-preview-mobile-header')).toBeInTheDocument();
  });

  it('opens announcement details in compact mobile dialog mode', async () => {
    installMatchMedia({ mobile: true });
    hubAPI.getDashboard.mockResolvedValueOnce(createDashboardPayload({
      announcements: [
        {
          id: 'ann-1',
          title: 'Мобильная заметка',
          preview: 'Короткое превью для мобильного режима.',
          priority: 'high',
          is_ack_pending: true,
          is_unread: true,
          is_updated: false,
          is_pinned_active: false,
          requires_ack: true,
          attachments_count: 0,
          author_full_name: 'Администратор',
          author_username: 'admin',
          can_manage: true,
        },
      ],
    }));
    hubAPI.getAnnouncement.mockResolvedValueOnce({
      id: 'ann-1',
      title: 'Мобильная заметка',
      preview: 'Короткое превью для мобильного режима.',
      body: 'Полный текст заметки',
      priority: 'high',
      is_ack_pending: true,
      is_unread: true,
      is_updated: false,
      is_pinned_active: false,
      requires_ack: true,
      attachments: [],
      author_full_name: 'Администратор',
      author_username: 'admin',
      recipients_summary: 'Всем',
      published_at: '2026-03-21T10:00:00Z',
      updated_at: '2026-03-21T10:00:00Z',
      can_manage: true,
      version: 1,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Мобильная заметка')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText('Мобильная заметка')[0]);

    await waitFor(() => {
      expect(hubAPI.getAnnouncement).toHaveBeenCalledWith('ann-1');
    });
    expect(await screen.findByTestId('dashboard-mobile-announcement-header')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Назад к ленте заметок' })).toBeInTheDocument();
  });
});
