import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeBase from './KnowledgeBase';

const theme = createTheme();
const hoisted = vi.hoisted(() => ({
  notifyApiError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
  mockHasPermission: vi.fn(),
  kbAPIMock: {
    getCategories: vi.fn(),
    getServices: vi.fn(),
    getFeed: vi.fn(),
    getArticles: vi.fn(),
    getArticle: vi.fn(),
    createArticle: vi.fn(),
    updateArticle: vi.fn(),
    setArticleStatus: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    getCards: vi.fn(),
    getCard: vi.fn(),
    createCard: vi.fn(),
    updateCard: vi.fn(),
    setCardStatus: vi.fn(),
  },
}));
const {
  notifyApiError,
  notifyInfo,
  notifySuccess,
  mockHasPermission,
  kbAPIMock,
} = hoisted;

let runbookArticle;
let templateArticle;

const clone = (value) => JSON.parse(JSON.stringify(value));

vi.mock('../api/client', () => ({
  kbAPI: hoisted.kbAPIMock,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: hoisted.mockHasPermission,
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyApiError: hoisted.notifyApiError,
    notifyInfo: hoisted.notifyInfo,
    notifySuccess: hoisted.notifySuccess,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const renderPage = () => render(
  <ThemeProvider theme={theme}>
    <KnowledgeBase />
  </ThemeProvider>,
);

describe('KnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runbookArticle = {
      id: 'article-1',
      title: 'Инструкция по отпуску',
      category: 'hr',
      article_type: 'note',
      status: 'published',
      summary: 'Текстовая инструкция',
      tags: ['отпуск'],
      version: 1,
      owner_name: 'HR',
      updated_at: '2026-04-22T10:00:00Z',
      created_at: '2026-04-21T10:00:00Z',
      updated_by: 'tester',
      attachments: [],
      revisions: [],
      content: {
        overview: 'Описание процесса',
        symptoms: '',
        checks: [],
        commands: [],
        resolution_steps: [],
        rollback_steps: [],
        escalation: '',
        faq: [],
      },
    };
    templateArticle = {
      id: 'template-1',
      title: 'Заявление на отпуск',
      category: 'hr',
      article_type: 'template',
      status: 'published',
      summary: 'Шаблон заявления на отпуск',
      tags: ['отпуск', 'hr'],
      version: 2,
      owner_name: 'HR',
      updated_at: '2026-04-22T11:00:00Z',
      created_at: '2026-04-20T11:00:00Z',
      updated_by: 'tester',
      primary_attachment_id: null,
      attachments: [
        {
          id: 'att-1',
          file_name: 'leave-main.docx',
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 2048,
          uploaded_at: '2026-04-22T11:00:00Z',
          uploaded_by: 'tester',
        },
        {
          id: 'att-2',
          file_name: 'leave-alt.docx',
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 1024,
          uploaded_at: '2026-04-22T11:05:00Z',
          uploaded_by: 'tester',
        },
      ],
      revisions: [],
      content: {
        overview: 'Заполните заявление и подпишите его.',
        symptoms: '',
        checks: [],
        commands: [],
        resolution_steps: ['Заполните дату', 'Укажите период отпуска'],
        rollback_steps: [],
        escalation: '',
        faq: [],
      },
    };

    mockHasPermission.mockImplementation((permission) => permission === 'kb.read');

    kbAPIMock.getCategories.mockResolvedValue([
      { id: 'hr', title: 'HR', total_articles: 2, published_articles: 2 },
    ]);
    kbAPIMock.getServices.mockResolvedValue([
      { id: 'hr', title: 'HR', total_cards: 0, published_cards: 0 },
    ]);
    kbAPIMock.getFeed.mockResolvedValue([]);
    kbAPIMock.getCards.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    kbAPIMock.getCard.mockResolvedValue(null);
    kbAPIMock.getArticles.mockImplementation(async (params = {}) => {
      const items = String(params?.article_type || '') === 'template'
        ? [clone(templateArticle)]
        : [clone(runbookArticle)];
      return { items, total: items.length, limit: 100, offset: 0 };
    });
    kbAPIMock.getArticle.mockImplementation(async (articleId) => {
      if (articleId === runbookArticle.id) return clone(runbookArticle);
      if (articleId === templateArticle.id) return clone(templateArticle);
      throw new Error(`Unknown article: ${articleId}`);
    });
    kbAPIMock.updateArticle.mockImplementation(async (articleId, payload) => {
      if (articleId === templateArticle.id && Object.prototype.hasOwnProperty.call(payload, 'primary_attachment_id')) {
        templateArticle = {
          ...templateArticle,
          primary_attachment_id: payload.primary_attachment_id ?? null,
        };
      }
      return articleId === templateArticle.id ? clone(templateArticle) : clone(runbookArticle);
    });
    kbAPIMock.removeAttachment.mockImplementation(async (articleId, attachmentId) => {
      if (articleId === templateArticle.id) {
        templateArticle = {
          ...templateArticle,
          attachments: templateArticle.attachments.filter((item) => item.id !== attachmentId),
          primary_attachment_id: templateArticle.primary_attachment_id === attachmentId ? null : templateArticle.primary_attachment_id,
        };
      }
      return { ok: true };
    });
  });

  it('renders built-in KB tabs instead of iframe and respects read-only permissions', async () => {
    renderPage();

    expect(await screen.findByRole('tab', { name: 'Инструкции' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Шаблоны' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Карточки' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Лента' })).toBeInTheDocument();
    expect(screen.queryByTitle(/IT Wiki/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Открыть Wiki/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Инструкции' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Создать статью/i })).not.toBeInTheDocument();
  });

  it('allows selecting primary attachment and falls back to incomplete state after deleting it', async () => {
    mockHasPermission.mockImplementation((permission) => ['kb.read', 'kb.write', 'kb.publish'].includes(permission));
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Шаблоны' }));

    expect(await screen.findAllByText(/не настроен/i)).not.toHaveLength(0);

    const primaryButtons = await screen.findAllByRole('button', { name: /Сделать основным/i });
    fireEvent.click(primaryButtons[0]);

    await waitFor(() => {
      expect(kbAPIMock.updateArticle).toHaveBeenCalledWith('template-1', { primary_attachment_id: 'att-1' });
    });
    await waitFor(() => {
      expect(screen.getAllByText(/готов к отправке/i).length).toBeGreaterThan(0);
    });

    const deleteButtons = await screen.findAllByRole('button', { name: /Удалить/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(kbAPIMock.removeAttachment).toHaveBeenCalledWith('template-1', 'att-1');
    });
    await waitFor(() => {
      expect(screen.getAllByText(/не настроен/i).length).toBeGreaterThan(0);
    });
  });
});
