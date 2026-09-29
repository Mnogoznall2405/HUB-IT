import apiClient from './client';
import { getKbArticle, getKbCategories, listKbArticles } from './kbApi';

jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));
const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes categories and keeps bounded public fields', async () => {
  client.get.mockResolvedValue({ data: [
    { id: 'network', title: 'Сеть', description: 'Инструкции по сети', order: '2', total_articles: 10, published_articles: '7' },
    { id: 'pc', title: 'Компьютеры', order: 1, extra_internal: 'drop' },
  ] });
  await expect(getKbCategories()).resolves.toEqual([
    { id: 'network', title: 'Сеть', description: 'Инструкции по сети', order: 2, totalArticles: 10, publishedArticles: 7 },
    { id: 'pc', title: 'Компьютеры', description: '', order: 1, totalArticles: 0, publishedArticles: 0 },
  ]);
  expect(client.get).toHaveBeenCalledWith('/kb/categories', { signal: undefined });
});

it('lists published articles with query, category and capped limit', async () => {
  client.get.mockResolvedValue({ data: {
    items: [{
      id: 'a1', title: 'Не работает VPN', category: 'network', article_type: 'runbook',
      status: 'published', summary: 'Проверьте логин', tags: ['vpn'],
      owner_name: 'Иванов', department_name: 'ИТ', visibility_scope: 'global',
      version: '3', updated_at: '2026-08-20T10:00:00Z',
      attachments: [{ id: 'f1', file_name: 'vpn.pdf', content_type: 'application/pdf', size: '2048', uploaded_at: '2026-08-20', uploaded_by: 'ivanov' }],
      content: { overview: 'Текст', checks: ['Шаг 1'], resolution_steps: ['Действие'], faq: [{ question: 'В?', answer: 'О.' }] },
    }],
    total: '1',
  } });
  await expect(listKbArticles({ q: ' vpn ', category: 'network', limit: 5000 })).resolves.toEqual({
    items: [{
      id: 'a1', title: 'Не работает VPN', category: 'network', articleType: 'runbook',
      status: 'published', summary: 'Проверьте логин', tags: ['vpn'],
      ownerName: 'Иванов', departmentName: 'ИТ', visibilityScope: 'global',
      version: 3, updatedAt: '2026-08-20T10:00:00Z',
      attachments: [{ id: 'f1', fileName: 'vpn.pdf', contentType: 'application/pdf', size: 2048, uploadedAt: '2026-08-20', uploadedBy: 'ivanov' }],
      content: {
        overview: 'Текст', symptoms: '', checks: ['Шаг 1'], commands: [],
        resolutionSteps: ['Действие'], rollbackSteps: [], escalation: '',
        faq: [{ question: 'В?', answer: 'О.' }],
      },
    }],
    total: 1,
  });
  expect(client.get).toHaveBeenCalledWith('/kb/articles', {
    params: { q: 'vpn', status: 'published', category: 'network', limit: 500 },
    signal: undefined,
  });
});

it('loads a single article with content and attachments', async () => {
  client.get.mockResolvedValue({ data: {
    id: 'a1', title: 'Статья', category: 'pc', article_type: 'faq', status: 'published',
    version: 1, updated_at: '2026-08-21',
    content: { overview: 'Описание', resolution_steps: ['Шаг'], faq: [] },
    attachments: [],
  } });
  const article = await getKbArticle(' a1 ');
  expect(article.id).toBe('a1');
  expect(article.content?.overview).toBe('Описание');
  expect(client.get).toHaveBeenCalledWith('/kb/articles/a1', { signal: undefined });
});

it('rejects an empty article id before hitting the server', async () => {
  await expect(getKbArticle('   ')).rejects.toThrow('Статья базы знаний не выбрана');
  expect(client.get).not.toHaveBeenCalled();
});
