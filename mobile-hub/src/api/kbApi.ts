import apiClient from './client';

export type KbArticleType = 'runbook' | 'faq' | 'template' | 'note' | string;
export type KbArticleStatus = 'draft' | 'published' | 'archived' | string;
export type KbVisibilityScope = 'private' | 'department' | 'department_managers' | 'global' | string;

export type KbCategory = {
  id: string;
  title: string;
  description: string;
  order: number;
  totalArticles: number;
  publishedArticles: number;
};

export type KbFaqItem = {
  question: string;
  answer: string;
};

export type KbContentBlock = {
  overview: string;
  symptoms: string;
  checks: string[];
  commands: string[];
  resolutionSteps: string[];
  rollbackSteps: string[];
  escalation: string;
  faq: KbFaqItem[];
};

export type KbAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
};

export type KbArticle = {
  id: string;
  title: string;
  category: string;
  articleType: KbArticleType;
  status: KbArticleStatus;
  summary: string;
  tags: string[];
  ownerName: string;
  departmentName: string;
  visibilityScope: KbVisibilityScope;
  version: number;
  updatedAt: string;
  attachments: KbAttachment[];
  content?: KbContentBlock;
};

export type KbArticleListResponse = {
  items: KbArticle[];
  total: number;
};

const KB_LIMIT = 300;

function text(value: unknown, maxLength = 2000): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 500)).filter(Boolean);
}

function normalizeCategory(raw: unknown): KbCategory {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(source.id, 64),
    title: text(source.title, 200),
    description: text(source.description, 500),
    order: Number(source.order || 0),
    totalArticles: Number(source.total_articles || 0),
    publishedArticles: Number(source.published_articles || 0),
  };
}

function normalizeAttachment(raw: unknown): KbAttachment {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(source.id, 64),
    fileName: text(source.file_name, 500),
    contentType: text(source.content_type, 200),
    size: Math.max(0, Number(source.size || 0)),
    uploadedAt: text(source.uploaded_at, 40),
    uploadedBy: text(source.uploaded_by, 200),
  };
}

function normalizeFaqItem(raw: unknown): KbFaqItem {
  const source = (raw ?? {}) as Record<string, unknown>;
  return { question: text(source.question, 1000), answer: text(source.answer, 5000) };
}

function normalizeContent(raw: unknown): KbContentBlock {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    overview: text(source.overview, 20000),
    symptoms: text(source.symptoms, 20000),
    checks: textList(source.checks),
    commands: textList(source.commands),
    resolutionSteps: textList(source.resolution_steps),
    rollbackSteps: textList(source.rollback_steps),
    escalation: text(source.escalation, 20000),
    faq: (Array.isArray(source.faq) ? source.faq : []).map(normalizeFaqItem),
  };
}

function normalizeArticle(raw: unknown): KbArticle {
  const source = (raw ?? {}) as Record<string, unknown>;
  const content = source.content === undefined ? undefined : normalizeContent(source.content);
  return {
    id: text(source.id, 64),
    title: text(source.title, 300),
    category: text(source.category, 64),
    articleType: text(source.article_type, 32),
    status: text(source.status, 32),
    summary: text(source.summary, 1000),
    tags: textList(source.tags),
    ownerName: text(source.owner_name, 200),
    departmentName: text(source.department_name, 200),
    visibilityScope: text(source.visibility_scope, 32),
    version: Number(source.version || 0),
    updatedAt: text(source.updated_at, 40),
    attachments: (Array.isArray(source.attachments) ? source.attachments : []).map(normalizeAttachment),
    ...(content ? { content } : {}),
  };
}

export async function getKbCategories(options: { signal?: AbortSignal } = {}): Promise<KbCategory[]> {
  const { data } = await apiClient.get<unknown[]>('/kb/categories', { signal: options.signal });
  return (Array.isArray(data) ? data : []).map(normalizeCategory);
}

export async function listKbArticles(
  options: { q?: string; category?: string; status?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<KbArticleListResponse> {
  const { data } = await apiClient.get<Record<string, unknown>>('/kb/articles', {
    params: {
      q: text(options.q, 200),
      status: text(options.status, 32) || 'published',
      ...(options.category ? { category: text(options.category, 64) } : {}),
      limit: Math.max(1, Math.min(500, Math.trunc(Number(options.limit || KB_LIMIT)))),
    },
    signal: options.signal,
  });
  return {
    items: (Array.isArray(data?.items) ? data.items : []).map(normalizeArticle),
    total: Math.max(0, Number(data?.total || 0)),
  };
}

export async function getKbArticle(
  articleId: string,
  options: { signal?: AbortSignal } = {},
): Promise<KbArticle> {
  const id = text(articleId, 64);
  if (!id) throw new Error('Статья базы знаний не выбрана');
  const { data } = await apiClient.get<Record<string, unknown>>(`/kb/articles/${encodeURIComponent(id)}`, {
    signal: options.signal,
  });
  return normalizeArticle(data);
}
