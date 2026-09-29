import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KbHelpSection from './KbHelpSection';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const hoisted = vi.hoisted(() => ({
  mockHasPermission: vi.fn(),
  kbAPIMock: {
    getCategories: vi.fn(),
    getArticles: vi.fn(),
    getArticle: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

vi.mock('../../api/kb', () => ({ kbAPI: hoisted.kbAPIMock }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ hasPermission: hoisted.mockHasPermission }),
}));

const CATEGORIES = [
  { id: 'forms', title: 'Бланки и заявления', description: 'Формы для заявлений', order: 1 },
  { id: 'instructions', title: 'Инструкции', description: 'Как что-то сделать', order: 2 },
];

const ARTICLES = [
  {
    id: 'a1',
    title: 'Заявление на оплачиваемые дни',
    summary: 'Бланк заявления по уходу',
    category: 'forms',
    article_type: 'template',
    status: 'published',
    updated_at: '2026-07-20T10:00:00Z',
    tags: ['заявление'],
    attachments: [
      { id: 'att1', file_name: 'blank.doc', size: 44032 },
    ],
  },
  {
    id: 'a2',
    title: 'Сброс пароля Windows',
    summary: 'Как сбросить пароль',
    category: 'instructions',
    article_type: 'runbook',
    status: 'published',
    updated_at: '2026-07-21T10:00:00Z',
    tags: ['пароль'],
    attachments: [],
  },
];

const renderSection = (query = '') => render(
  <ThemeProvider theme={theme}>
    <MemoryRouter>
      <KbHelpSection query={query} ui={ui} />
    </MemoryRouter>
  </ThemeProvider>,
);

describe('KbHelpSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockHasPermission.mockImplementation((perm) => perm === 'kb.read');
    hoisted.kbAPIMock.getCategories.mockResolvedValue(CATEGORIES);
    hoisted.kbAPIMock.getArticles.mockResolvedValue({ items: ARTICLES, total: 2 });
    hoisted.kbAPIMock.getArticle.mockResolvedValue({
      ...ARTICLES[0],
      content: { overview: 'Описание бланка', resolution_steps: ['Шаг 1', 'Шаг 2'] },
    });
  });

  it('renders nothing when the API denies access (403)', async () => {
    hoisted.kbAPIMock.getArticles.mockRejectedValue({ response: { status: 403 } });
    hoisted.kbAPIMock.getCategories.mockRejectedValue({ response: { status: 403 } });
    const { container } = renderSection();
    await waitFor(() => expect(hoisted.kbAPIMock.getArticles).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('groups articles under category headers with file blocks', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Бланки и заявления')).toBeInTheDocument());
    expect(screen.getByText('Инструкции')).toBeInTheDocument();
    expect(screen.getByText('Заявление на оплачиваемые дни')).toBeInTheDocument();
    expect(screen.getByText('Сброс пароля Windows')).toBeInTheDocument();
    expect(screen.getByText('blank.doc')).toBeInTheDocument();
    expect(screen.getByText('43 КБ')).toBeInTheDocument();
  });

  it('filters articles by search query including attachment names', async () => {
    renderSection('blank');
    await waitFor(() => expect(screen.getByText('Заявление на оплачиваемые дни')).toBeInTheDocument());
    expect(screen.queryByText('Сброс пароля Windows')).not.toBeInTheDocument();
  });

  it('opens article detail dialog with content sections and files', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Заявление на оплачиваемые дни')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Заявление на оплачиваемые дни'));
    await waitFor(() => expect(hoisted.kbAPIMock.getArticle).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.getByText('Описание бланка')).toBeInTheDocument());
    expect(screen.getByText('Шаги решения')).toBeInTheDocument();
    expect(screen.getByText('Файлы')).toBeInTheDocument();
  });

  it('downloads an attachment from the card', async () => {
    hoisted.kbAPIMock.downloadAttachment.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSection();
    await waitFor(() => expect(screen.getByLabelText('Скачать blank.doc')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Скачать blank.doc'));
    await waitFor(() => expect(hoisted.kbAPIMock.downloadAttachment).toHaveBeenCalledWith('a1', 'att1'));
    clickSpy.mockRestore();
  });
});
