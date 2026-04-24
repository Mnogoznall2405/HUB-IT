import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import StarOutlineOutlinedIcon from '@mui/icons-material/StarOutlineOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { kbAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { buildOfficeUiTokens, getOfficePanelSx, getOfficeSubtlePanelSx } from '../theme/officeUiTokens';

const WIKI_URL = 'https://wiki.zsgp.ru/';
const KB_TABS = [
  { value: 'articles', label: 'Инструкции' },
  { value: 'templates', label: 'Шаблоны' },
  { value: 'cards', label: 'Карточки' },
  { value: 'feed', label: 'Лента' },
];
const ARTICLE_TYPE_OPTIONS = [
  { value: 'runbook', label: 'Инструкция' },
  { value: 'faq', label: 'Вопросы и ответы' },
  { value: 'template', label: 'Шаблон' },
  { value: 'note', label: 'Заметка' },
];
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Черновик' },
  { value: 'published', label: 'Опубликовано' },
  { value: 'archived', label: 'Архив' },
];
const CARD_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' },
];
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label]));
const ARTICLE_TYPE_LABELS = Object.fromEntries(ARTICLE_TYPE_OPTIONS.map((item) => [item.value, item.label]));
const PRIORITY_LABELS = Object.fromEntries(CARD_PRIORITY_OPTIONS.map((item) => [item.value, item.label]));
const REVISION_ACTION_LABELS = {
  create: 'Создание',
  update: 'Обновление',
  status: 'Смена статуса',
  'attachment:add': 'Добавление файла',
  'attachment:remove': 'Удаление файла',
};
const DEFAULT_ARTICLE_FORM = {
  title: '',
  category: '',
  article_type: 'runbook',
  summary: '',
  tags: '',
  owner_name: '',
  last_reviewed_at: '',
  overview: '',
  symptoms: '',
  checks: '',
  commands: '',
  resolution_steps: '',
  rollback_steps: '',
  escalation: '',
  faq: '',
};
const DEFAULT_CARD_FORM = {
  title: '',
  summary_short: '',
  service_key: '',
  external_url: '',
  tags: '',
  priority: 'normal',
  is_pinned: false,
  cover_image_url: '',
  quick_steps: '',
  owner_name: '',
};

const parseTags = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const parseMultiline = (value) => String(value || '')
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

const stringifyMultiline = (value) => (Array.isArray(value) ? value.filter(Boolean).join('\n') : '');

const parseFaqRows = (value) => parseMultiline(value).map((row) => {
  const separatorIndex = row.indexOf('|');
  if (separatorIndex < 0) return null;
  const question = row.slice(0, separatorIndex).trim();
  const answer = row.slice(separatorIndex + 1).trim();
  if (!question || !answer) return null;
  return { question, answer };
}).filter(Boolean);

const stringifyFaqRows = (value) => (
  Array.isArray(value)
    ? value
      .filter((item) => item?.question && item?.answer)
      .map((item) => `${item.question} | ${item.answer}`)
      .join('\n')
    : ''
);

const buildArticleForm = (article = {}) => {
  const content = article?.content || {};
  return {
    title: String(article?.title || ''),
    category: String(article?.category || ''),
    article_type: String(article?.article_type || 'runbook'),
    summary: String(article?.summary || ''),
    tags: Array.isArray(article?.tags) ? article.tags.join(', ') : '',
    owner_name: String(article?.owner_name || ''),
    last_reviewed_at: String(article?.last_reviewed_at || ''),
    overview: String(content?.overview || ''),
    symptoms: String(content?.symptoms || ''),
    checks: stringifyMultiline(content?.checks),
    commands: stringifyMultiline(content?.commands),
    resolution_steps: stringifyMultiline(content?.resolution_steps),
    rollback_steps: stringifyMultiline(content?.rollback_steps),
    escalation: String(content?.escalation || ''),
    faq: stringifyFaqRows(content?.faq),
  };
};

const buildArticlePayload = (form) => ({
  title: String(form?.title || '').trim(),
  category: String(form?.category || '').trim().toLowerCase(),
  article_type: String(form?.article_type || 'runbook').trim().toLowerCase(),
  summary: String(form?.summary || '').trim(),
  tags: parseTags(form?.tags),
  owner_name: String(form?.owner_name || '').trim(),
  last_reviewed_at: String(form?.last_reviewed_at || '').trim() || null,
  content: {
    overview: String(form?.overview || '').trim(),
    symptoms: String(form?.symptoms || '').trim(),
    checks: parseMultiline(form?.checks),
    commands: parseMultiline(form?.commands),
    resolution_steps: parseMultiline(form?.resolution_steps),
    rollback_steps: parseMultiline(form?.rollback_steps),
    escalation: String(form?.escalation || '').trim(),
    faq: parseFaqRows(form?.faq),
  },
});

const buildCardForm = (card = {}) => ({
  title: String(card?.title || ''),
  summary_short: String(card?.summary_short || ''),
  service_key: String(card?.service_key || ''),
  external_url: String(card?.external_url || ''),
  tags: Array.isArray(card?.tags) ? card.tags.join(', ') : '',
  priority: String(card?.priority || 'normal'),
  is_pinned: Boolean(card?.is_pinned),
  cover_image_url: String(card?.cover_image_url || ''),
  quick_steps: stringifyMultiline(card?.quick_steps),
  owner_name: String(card?.owner_name || ''),
});

const buildCardPayload = (form) => ({
  title: String(form?.title || '').trim(),
  summary_short: String(form?.summary_short || '').trim(),
  service_key: String(form?.service_key || '').trim().toLowerCase(),
  external_url: String(form?.external_url || '').trim(),
  tags: parseTags(form?.tags),
  priority: String(form?.priority || 'normal').trim().toLowerCase(),
  is_pinned: Boolean(form?.is_pinned),
  cover_image_url: String(form?.cover_image_url || '').trim(),
  quick_steps: parseMultiline(form?.quick_steps),
  owner_name: String(form?.owner_name || '').trim(),
});

const formatDateTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'нет данных';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString('ru-RU');
};

const formatFileSize = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const resolveTemplateDeliveryState = (article) => {
  if (String(article?.article_type || '') !== 'template') {
    return { label: 'статья', color: 'default' };
  }
  const ready = String(article?.status || '') === 'published' && Boolean(article?.primary_attachment_id);
  return ready
    ? { label: 'готов к отправке', color: 'success' }
    : { label: 'не настроен', color: 'warning' };
};

const localizeStatus = (value) => STATUS_LABELS[String(value || '').trim().toLowerCase()] || String(value || '').trim() || 'Нет статуса';
const localizeArticleType = (value) => ARTICLE_TYPE_LABELS[String(value || '').trim().toLowerCase()] || String(value || '').trim() || 'Статья';
const localizePriority = (value) => PRIORITY_LABELS[String(value || '').trim().toLowerCase()] || String(value || '').trim() || 'Нет приоритета';
const localizeRevisionAction = (value) => REVISION_ACTION_LABELS[String(value || '').trim()] || String(value || '').trim() || 'Изменение';

const resolveResponseFileName = (response, fallbackName) => {
  const header = String(response?.headers?.['content-disposition'] || response?.headers?.get?.('content-disposition') || '').trim();
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  if (simpleMatch?.[1]) return simpleMatch[1];
  return fallbackName || 'вложение.bin';
};

const downloadBlobResponse = (response, fallbackName) => {
  const blob = response?.data;
  if (!(blob instanceof Blob)) return;
  const fileName = resolveResponseFileName(response, fallbackName);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

function ArticleEditorDialog({
  open,
  mode,
  form,
  saving,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{mode === 'create' ? 'Новая статья KB' : 'Редактировать статью KB'}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={7}>
            <TextField label="Название" fullWidth value={form.title} onChange={(event) => onChange('title', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField label="Категория" fullWidth value={form.category} onChange={(event) => onChange('category', event.target.value)} placeholder="hr" />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField select label="Тип" fullWidth value={form.article_type} onChange={(event) => onChange('article_type', event.target.value)}>
              {ARTICLE_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={8}>
            <TextField label="Краткое описание" fullWidth value={form.summary} onChange={(event) => onChange('summary', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Теги" fullWidth value={form.tags} onChange={(event) => onChange('tags', event.target.value)} placeholder="отпуск, hr, шаблон" />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField label="Ответственный" fullWidth value={form.owner_name} onChange={(event) => onChange('owner_name', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Проверено"
              type="date"
              fullWidth
              value={form.last_reviewed_at}
              onChange={(event) => onChange('last_reviewed_at', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Описание" fullWidth multiline minRows={3} value={form.overview} onChange={(event) => onChange('overview', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Симптомы" fullWidth multiline minRows={2} value={form.symptoms} onChange={(event) => onChange('symptoms', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Проверки" helperText="По одному пункту на строку" fullWidth multiline minRows={4} value={form.checks} onChange={(event) => onChange('checks', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Команды" helperText="По одной команде на строку" fullWidth multiline minRows={4} value={form.commands} onChange={(event) => onChange('commands', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Шаги решения" helperText="По одному шагу на строку" fullWidth multiline minRows={4} value={form.resolution_steps} onChange={(event) => onChange('resolution_steps', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField label="Шаги отката" helperText="По одному шагу на строку" fullWidth multiline minRows={4} value={form.rollback_steps} onChange={(event) => onChange('rollback_steps', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Эскалация" fullWidth multiline minRows={2} value={form.escalation} onChange={(event) => onChange('escalation', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Вопросы и ответы"
              helperText="Одна строка = вопрос | ответ"
              fullWidth
              multiline
              minRows={4}
              value={form.faq}
              onChange={(event) => onChange('faq', event.target.value)}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="contained" onClick={onSubmit} disabled={saving || !String(form.title || '').trim() || !String(form.category || '').trim()}>
          {mode === 'create' ? 'Создать' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CardEditorDialog({
  open,
  mode,
  form,
  saving,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{mode === 'create' ? 'Новая карточка KB' : 'Редактировать карточку KB'}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={7}>
            <TextField label="Название" fullWidth value={form.title} onChange={(event) => onChange('title', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField label="Ключ сервиса" fullWidth value={form.service_key} onChange={(event) => onChange('service_key', event.target.value)} placeholder="hr" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Краткое описание" fullWidth value={form.summary_short} onChange={(event) => onChange('summary_short', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Ссылка" fullWidth value={form.external_url} onChange={(event) => onChange('external_url', event.target.value)} placeholder="https://wiki.zsgp.ru/" />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField select label="Приоритет" fullWidth value={form.priority} onChange={(event) => onChange('priority', event.target.value)}>
              {CARD_PRIORITY_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={7}>
            <TextField label="Теги" fullWidth value={form.tags} onChange={(event) => onChange('tags', event.target.value)} placeholder="helpdesk, onboarding" />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel control={<Switch checked={form.is_pinned} onChange={(event) => onChange('is_pinned', event.target.checked)} />} label="Закрепить карточку" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Ссылка на обложку" fullWidth value={form.cover_image_url} onChange={(event) => onChange('cover_image_url', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Быстрые шаги" helperText="По одному шагу на строку" fullWidth multiline minRows={5} value={form.quick_steps} onChange={(event) => onChange('quick_steps', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Ответственный" fullWidth value={form.owner_name} onChange={(event) => onChange('owner_name', event.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="contained" onClick={onSubmit} disabled={saving || !String(form.title || '').trim() || !String(form.external_url || '').trim()}>
          {mode === 'create' ? 'Создать' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function KnowledgeBase() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { hasPermission } = useAuth();
  const { notifyApiError, notifyInfo, notifySuccess } = useNotification();
  const canWrite = hasPermission('kb.write');
  const canPublish = hasPermission('kb.publish');

  const [tab, setTab] = useState('articles');
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);

  const [articleFilters, setArticleFilters] = useState({ q: '', category: '', status: '', article_type: '', tags: '' });
  const [templateFilters, setTemplateFilters] = useState({ q: '', category: '', status: '', tags: '' });
  const [cardFilters, setCardFilters] = useState({ q: '', service: '', status: '', priority: '', tags: '', pinned: '' });

  const [articlesState, setArticlesState] = useState({ items: [], total: 0 });
  const [templatesState, setTemplatesState] = useState({ items: [], total: 0 });
  const [cardsState, setCardsState] = useState({ items: [], total: 0 });
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [cardsLoading, setCardsLoading] = useState(true);

  const [selectedArticleId, setSelectedArticleId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [detailLoading, setDetailLoading] = useState('');

  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [articleDialogMode, setArticleDialogMode] = useState('create');
  const [articleForm, setArticleForm] = useState(DEFAULT_ARTICLE_FORM);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [cardDialogMode, setCardDialogMode] = useState('create');
  const [cardForm, setCardForm] = useState(DEFAULT_CARD_FORM);
  const [savingArticle, setSavingArticle] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [attachmentBusyKey, setAttachmentBusyKey] = useState('');

  const loadReferenceData = useCallback(async () => {
    setReferenceLoading(true);
    try {
      const [categoriesPayload, servicesPayload] = await Promise.all([
        kbAPI.getCategories(),
        kbAPI.getServices(),
      ]);
      setCategories(Array.isArray(categoriesPayload) ? categoriesPayload : []);
      setServices(Array.isArray(servicesPayload) ? servicesPayload : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить справочники KB.', { dedupeMode: 'none' });
    } finally {
      setReferenceLoading(false);
    }
  }, [notifyApiError]);

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const payload = await kbAPI.getFeed({ limit: 100 });
      setFeed(Array.isArray(payload) ? payload : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить ленту изменений KB.', { dedupeMode: 'none' });
    } finally {
      setFeedLoading(false);
    }
  }, [notifyApiError]);

  const loadArticleDetail = useCallback(async (articleId, target = 'article') => {
    const normalizedId = String(articleId || '').trim();
    if (!normalizedId) {
      if (target === 'template') setSelectedTemplate(null);
      else setSelectedArticle(null);
      return;
    }
    setDetailLoading(`${target}:${normalizedId}`);
    try {
      const payload = await kbAPI.getArticle(normalizedId);
      if (target === 'template') setSelectedTemplate(payload);
      else setSelectedArticle(payload);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить карточку статьи KB.', { dedupeMode: 'none' });
    } finally {
      setDetailLoading('');
    }
  }, [notifyApiError]);

  const loadCardDetail = useCallback(async (cardId) => {
    const normalizedId = String(cardId || '').trim();
    if (!normalizedId) {
      setSelectedCard(null);
      return;
    }
    setDetailLoading(`card:${normalizedId}`);
    try {
      const payload = await kbAPI.getCard(normalizedId);
      setSelectedCard(payload);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить KB-card.', { dedupeMode: 'none' });
    } finally {
      setDetailLoading('');
    }
  }, [notifyApiError]);

  const loadArticles = useCallback(async () => {
    setArticlesLoading(true);
    try {
      const payload = await kbAPI.getArticles({
        q: articleFilters.q,
        category: articleFilters.category,
        status: articleFilters.status,
        article_type: articleFilters.article_type,
        tags: articleFilters.tags,
        limit: 100,
        offset: 0,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setArticlesState({ items, total: Number(payload?.total || items.length) });
      const nextSelectedId = items.some((item) => item.id === selectedArticleId) ? selectedArticleId : (items[0]?.id || '');
      setSelectedArticleId(nextSelectedId);
      if (nextSelectedId) {
        await loadArticleDetail(nextSelectedId, 'article');
      } else {
        setSelectedArticle(null);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить статьи KB.', { dedupeMode: 'none' });
    } finally {
      setArticlesLoading(false);
    }
  }, [articleFilters, loadArticleDetail, notifyApiError, selectedArticleId]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const payload = await kbAPI.getArticles({
        q: templateFilters.q,
        category: templateFilters.category,
        status: templateFilters.status,
        article_type: 'template',
        tags: templateFilters.tags,
        limit: 100,
        offset: 0,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setTemplatesState({ items, total: Number(payload?.total || items.length) });
      const nextSelectedId = items.some((item) => item.id === selectedTemplateId) ? selectedTemplateId : (items[0]?.id || '');
      setSelectedTemplateId(nextSelectedId);
      if (nextSelectedId) {
        await loadArticleDetail(nextSelectedId, 'template');
      } else {
        setSelectedTemplate(null);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить шаблоны KB.', { dedupeMode: 'none' });
    } finally {
      setTemplatesLoading(false);
    }
  }, [loadArticleDetail, notifyApiError, selectedTemplateId, templateFilters]);

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    try {
      const payload = await kbAPI.getCards({
        q: cardFilters.q,
        service: cardFilters.service,
        status: cardFilters.status,
        priority: cardFilters.priority,
        tags: cardFilters.tags,
        pinned: cardFilters.pinned === '' ? undefined : cardFilters.pinned === 'true',
        limit: 100,
        offset: 0,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setCardsState({ items, total: Number(payload?.total || items.length) });
      const nextSelectedId = items.some((item) => item.id === selectedCardId) ? selectedCardId : (items[0]?.id || '');
      setSelectedCardId(nextSelectedId);
      if (nextSelectedId) {
        await loadCardDetail(nextSelectedId);
      } else {
        setSelectedCard(null);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить KB-cards.', { dedupeMode: 'none' });
    } finally {
      setCardsLoading(false);
    }
  }, [cardFilters, loadCardDetail, notifyApiError, selectedCardId]);

  useEffect(() => {
    void loadReferenceData();
    void loadFeed();
  }, [loadFeed, loadReferenceData]);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadReferenceData(),
      loadFeed(),
      loadArticles(),
      loadTemplates(),
      loadCards(),
    ]);
    notifyInfo('KB обновлена.', { dedupeMode: 'none' });
  }, [loadArticles, loadCards, loadFeed, loadReferenceData, loadTemplates, notifyInfo]);

  const handleOpenWiki = useCallback(() => {
    window.open(WIKI_URL, '_blank', 'noopener,noreferrer');
  }, []);

  const handleOpenInstructions = useCallback(() => {
    setTab('articles');
  }, []);

  const handleArticleDialogChange = useCallback((field, value) => {
    setArticleForm((current) => ({ ...current, [field]: value }));
  }, []);

  const handleCardDialogChange = useCallback((field, value) => {
    setCardForm((current) => ({ ...current, [field]: value }));
  }, []);

  const openCreateArticleDialog = useCallback((type = 'runbook') => {
    setArticleDialogMode('create');
    setArticleForm({ ...DEFAULT_ARTICLE_FORM, article_type: type });
    setArticleDialogOpen(true);
  }, []);

  const openEditArticleDialog = useCallback((article) => {
    setArticleDialogMode('edit');
    setArticleForm(buildArticleForm(article));
    setArticleDialogOpen(true);
  }, []);

  const openCreateCardDialog = useCallback(() => {
    setCardDialogMode('create');
    setCardForm(DEFAULT_CARD_FORM);
    setCardDialogOpen(true);
  }, []);

  const openEditCardDialog = useCallback((card) => {
    setCardDialogMode('edit');
    setCardForm(buildCardForm(card));
    setCardDialogOpen(true);
  }, []);

  const handleSubmitArticle = useCallback(async () => {
    setSavingArticle(true);
    try {
      const payload = buildArticlePayload(articleForm);
      let saved = null;
      if (articleDialogMode === 'create') {
        saved = await kbAPI.createArticle(payload);
        notifySuccess(`Статья "${saved?.title || payload.title}" создана.`, { dedupeMode: 'none' });
      } else {
        const currentId = tab === 'templates' ? selectedTemplateId : selectedArticleId;
        saved = await kbAPI.updateArticle(currentId, payload);
        notifySuccess(`Статья "${saved?.title || payload.title}" обновлена.`, { dedupeMode: 'none' });
      }
      setArticleDialogOpen(false);
      await Promise.all([loadArticles(), loadTemplates(), loadFeed(), loadReferenceData()]);
      if (saved?.id) {
        if (String(saved.article_type || '') === 'template') {
          setSelectedTemplateId(saved.id);
          await loadArticleDetail(saved.id, 'template');
        } else {
          setSelectedArticleId(saved.id);
          await loadArticleDetail(saved.id, 'article');
        }
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить статью KB.', { dedupeMode: 'none' });
    } finally {
      setSavingArticle(false);
    }
  }, [
    articleDialogMode,
    articleForm,
    loadArticleDetail,
    loadArticles,
    loadFeed,
    loadReferenceData,
    loadTemplates,
    notifyApiError,
    notifySuccess,
    selectedArticleId,
    selectedTemplateId,
    tab,
  ]);

  const handleSubmitCard = useCallback(async () => {
    setSavingCard(true);
    try {
      const payload = buildCardPayload(cardForm);
      let saved = null;
      if (cardDialogMode === 'create') {
        saved = await kbAPI.createCard(payload);
        notifySuccess(`Карточка "${saved?.title || payload.title}" создана.`, { dedupeMode: 'none' });
      } else {
        saved = await kbAPI.updateCard(selectedCardId, payload);
        notifySuccess(`Карточка "${saved?.title || payload.title}" обновлена.`, { dedupeMode: 'none' });
      }
      setCardDialogOpen(false);
      await Promise.all([loadCards(), loadFeed(), loadReferenceData()]);
      if (saved?.id) {
        setSelectedCardId(saved.id);
        await loadCardDetail(saved.id);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить KB-card.', { dedupeMode: 'none' });
    } finally {
      setSavingCard(false);
    }
  }, [cardDialogMode, cardForm, loadCardDetail, loadCards, loadFeed, loadReferenceData, notifyApiError, notifySuccess, selectedCardId]);

  const handleSetArticleStatus = useCallback(async (article, status) => {
    if (!article?.id) return;
    try {
      await kbAPI.setArticleStatus(article.id, { status });
      notifySuccess(`Статус статьи "${article.title}" обновлён: ${status}.`, { dedupeMode: 'none' });
      await Promise.all([loadArticles(), loadTemplates(), loadFeed(), loadReferenceData()]);
      await loadArticleDetail(article.id, String(article.article_type || '') === 'template' ? 'template' : 'article');
    } catch (error) {
      notifyApiError(error, 'Не удалось изменить статус статьи KB.', { dedupeMode: 'none' });
    }
  }, [loadArticleDetail, loadArticles, loadFeed, loadReferenceData, loadTemplates, notifyApiError, notifySuccess]);

  const handleSetCardStatus = useCallback(async (card, status) => {
    if (!card?.id) return;
    try {
      await kbAPI.setCardStatus(card.id, { status });
      notifySuccess(`Статус карточки "${card.title}" обновлён: ${status}.`, { dedupeMode: 'none' });
      await Promise.all([loadCards(), loadFeed(), loadReferenceData()]);
      await loadCardDetail(card.id);
    } catch (error) {
      notifyApiError(error, 'Не удалось изменить статус KB-card.', { dedupeMode: 'none' });
    }
  }, [loadCardDetail, loadCards, loadFeed, loadReferenceData, notifyApiError, notifySuccess]);

  const handleDownloadAttachment = useCallback(async (articleId, attachment) => {
    try {
      const response = await kbAPI.downloadAttachment(articleId, attachment.id);
      downloadBlobResponse(response, attachment.file_name);
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать KB-вложение.', { dedupeMode: 'none' });
    }
  }, [notifyApiError]);

  const handleUploadAttachment = useCallback(async (article, file) => {
    if (!article?.id || !file) return;
    setAttachmentBusyKey(`upload:${article.id}`);
    try {
      await kbAPI.uploadAttachment(article.id, file);
      notifySuccess(`Файл "${file.name}" загружен.`, { dedupeMode: 'none' });
      await Promise.all([loadArticles(), loadTemplates(), loadFeed(), loadReferenceData()]);
      await loadArticleDetail(article.id, String(article.article_type || '') === 'template' ? 'template' : 'article');
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить KB-вложение.', { dedupeMode: 'none' });
    } finally {
      setAttachmentBusyKey('');
    }
  }, [loadArticleDetail, loadArticles, loadFeed, loadReferenceData, loadTemplates, notifyApiError, notifySuccess]);

  const handleDeleteAttachment = useCallback(async (article, attachment) => {
    if (!article?.id || !attachment?.id) return;
    setAttachmentBusyKey(`delete:${attachment.id}`);
    try {
      await kbAPI.removeAttachment(article.id, attachment.id);
      notifySuccess(`Файл "${attachment.file_name}" удалён.`, { dedupeMode: 'none' });
      await Promise.all([loadArticles(), loadTemplates(), loadFeed(), loadReferenceData()]);
      await loadArticleDetail(article.id, String(article.article_type || '') === 'template' ? 'template' : 'article');
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить KB-вложение.', { dedupeMode: 'none' });
    } finally {
      setAttachmentBusyKey('');
    }
  }, [loadArticleDetail, loadArticles, loadFeed, loadReferenceData, loadTemplates, notifyApiError, notifySuccess]);

  const handleSetPrimaryAttachment = useCallback(async (article, attachmentId) => {
    if (!article?.id) return;
    setAttachmentBusyKey(`primary:${article.id}`);
    try {
      await kbAPI.updateArticle(article.id, { primary_attachment_id: attachmentId });
      notifySuccess('Основной файл шаблона обновлён.', { dedupeMode: 'none' });
      await Promise.all([loadArticles(), loadTemplates(), loadFeed(), loadReferenceData()]);
      await loadArticleDetail(article.id, String(article.article_type || '') === 'template' ? 'template' : 'article');
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить основной файл шаблона.', { dedupeMode: 'none' });
    } finally {
      setAttachmentBusyKey('');
    }
  }, [loadArticleDetail, loadArticles, loadFeed, loadReferenceData, loadTemplates, notifyApiError, notifySuccess]);

  const renderArticleList = (items, currentId, onSelect, loading, templateOnly = false) => (
    <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }) }}>
      <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {templateOnly ? `Шаблоны (${items.length})` : `Инструкции (${items.length})`}
        </Typography>
      </Box>
      {loading ? (
        <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, py: 6 }}>
          <CircularProgress size={26} />
        </Stack>
      ) : (
        <List sx={{ py: 0, overflowY: 'auto', minHeight: 0 }}>
          {items.map((item) => {
            const templateState = resolveTemplateDeliveryState(item);
            return (
              <ListItemButton
                key={item.id}
                selected={item.id === currentId}
                onClick={() => onSelect(item.id)}
                sx={{ alignItems: 'flex-start', py: 1.2, borderBottom: '1px solid', borderColor: ui.borderSoft }}
              >
                <ListItemText
                  primaryTypographyProps={{ component: 'div' }}
                  secondaryTypographyProps={{ component: 'div' }}
                  primary={(
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography sx={{ fontWeight: 700 }}>{item.title}</Typography>
                      <Chip size="small" label={localizeStatus(item.status)} />
                      {!templateOnly ? <Chip size="small" variant="outlined" label={localizeArticleType(item.article_type)} /> : null}
                      {templateOnly ? <Chip size="small" color={templateState.color} label={templateState.label} /> : null}
                    </Stack>
                  )}
                  secondary={(
                    <Stack spacing={0.45} sx={{ mt: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">{item.summary || 'Без краткого описания.'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.category} • v{item.version} • {formatDateTime(item.updated_at)}
                      </Typography>
                    </Stack>
                  )}
                />
              </ListItemButton>
            );
          })}
          {items.length === 0 ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="info">{templateOnly ? 'Шаблоны не найдены.' : 'Статьи не найдены.'}</Alert>
            </Box>
          ) : null}
        </List>
      )}
    </Paper>
  );

  const renderArticleDetail = (article, target = 'article') => {
    if (!article) {
      return (
        <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 2.5, minHeight: 420 }) }}>
          <Alert severity="info">Выберите элемент слева, чтобы открыть подробности.</Alert>
        </Paper>
      );
    }
    const content = article.content || {};
    const attachments = Array.isArray(article.attachments) ? article.attachments : [];
    const deliveryState = resolveTemplateDeliveryState(article);
    const currentDetailKey = `${target}:${article.id}`;
    return (
      <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 2, minHeight: 420 }) }}>
        <Stack spacing={1.4}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
            <Box>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                <Typography variant="h6" sx={{ fontWeight: 800 }}>{article.title}</Typography>
                <Chip size="small" label={localizeStatus(article.status)} />
                <Chip size="small" variant="outlined" label={localizeArticleType(article.article_type)} />
                {String(article.article_type || '') === 'template' ? (
                  <Chip size="small" color={deliveryState.color} label={deliveryState.label} />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {article.summary || 'Без краткого описания.'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {article.category} • обновлено {formatDateTime(article.updated_at)} • ответственный {article.owner_name || 'нет данных'}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              {canWrite ? <Button variant="outlined" onClick={() => openEditArticleDialog(article)}>Редактировать</Button> : null}
              {canPublish ? (
                <>
                  <Button variant="outlined" onClick={() => handleSetArticleStatus(article, 'published')}>Опубликовать</Button>
                  <Button variant="outlined" onClick={() => handleSetArticleStatus(article, 'draft')}>В черновик</Button>
                  <Button variant="outlined" color="warning" onClick={() => handleSetArticleStatus(article, 'archived')}>В архив</Button>
                </>
              ) : null}
            </Stack>
          </Stack>

          {detailLoading === currentDetailKey ? <LinearDetailLoading /> : null}

          <Grid container spacing={1.4}>
            <Grid item xs={12} md={7}>
              <Stack spacing={1.2}>
                <Paper variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.5 }) }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>Содержание</Typography>
                  <Stack spacing={1}>
                    <ContentBlock title="Описание" value={content.overview} />
                    <ContentBlock title="Симптомы" value={content.symptoms} />
                    <ContentListBlock title="Проверки" items={content.checks} />
                    <ContentListBlock title="Команды" items={content.commands} />
                    <ContentListBlock title="Шаги решения" items={content.resolution_steps} />
                    <ContentListBlock title="Шаги отката" items={content.rollback_steps} />
                    <ContentBlock title="Эскалация" value={content.escalation} />
                    <FaqBlock items={content.faq} />
                  </Stack>
                </Paper>
              </Stack>
            </Grid>
            <Grid item xs={12} md={5}>
              <Stack spacing={1.2}>
                <Paper variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.5 }) }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Вложения</Typography>
                      {String(article.article_type || '') === 'template' ? (
                        <Typography variant="caption" color="text.secondary">
                          Для автоотправки используется только основной файл из опубликованного шаблона.
                        </Typography>
                      ) : null}
                    </Box>
                    {canWrite ? (
                      <Button
                        component="label"
                        size="small"
                        variant="contained"
                        startIcon={<UploadFileOutlinedIcon />}
                        disabled={attachmentBusyKey === `upload:${article.id}`}
                      >
                        Загрузить
                        <input
                          hidden
                          type="file"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) {
                              void handleUploadAttachment(article, file);
                            }
                          }}
                        />
                      </Button>
                    ) : null}
                  </Stack>
                  <Stack spacing={1}>
                    {attachments.map((attachment) => {
                      const isPrimary = String(article.primary_attachment_id || '') === String(attachment.id || '');
                      const isBusy = attachmentBusyKey === `delete:${attachment.id}` || attachmentBusyKey === `primary:${article.id}`;
                      return (
                        <Paper key={attachment.id} variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.1 }) }}>
                          <Stack spacing={0.75}>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography sx={{ fontWeight: 700 }}>{attachment.file_name}</Typography>
                              {isPrimary ? <Chip size="small" color="success" label="основной" /> : null}
                              <Chip size="small" variant="outlined" label={formatFileSize(attachment.size)} />
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {attachment.content_type} • загружено {formatDateTime(attachment.uploaded_at)}
                            </Typography>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
                              <Button size="small" startIcon={<DownloadOutlinedIcon />} onClick={() => handleDownloadAttachment(article.id, attachment)}>
                                Скачать
                              </Button>
                              {canWrite && String(article.article_type || '') === 'template' ? (
                                <Button
                                  size="small"
                                  startIcon={<StarOutlineOutlinedIcon />}
                                  onClick={() => handleSetPrimaryAttachment(article, attachment.id)}
                                  disabled={isBusy}
                                >
                                  {isPrimary ? 'Основной файл' : 'Сделать основным'}
                                </Button>
                              ) : null}
                              {canWrite ? (
                                <Button
                                  size="small"
                                  color="error"
                                  startIcon={<DeleteOutlineOutlinedIcon />}
                                  onClick={() => handleDeleteAttachment(article, attachment)}
                                  disabled={isBusy}
                                >
                                  Удалить
                                </Button>
                              ) : null}
                            </Stack>
                          </Stack>
                        </Paper>
                      );
                    })}
                    {attachments.length === 0 ? <Alert severity="info">Вложений пока нет.</Alert> : null}
                    {canWrite && String(article.article_type || '') === 'template' && article.primary_attachment_id ? (
                      <Button size="small" onClick={() => handleSetPrimaryAttachment(article, null)}>
                        Снять основной файл
                      </Button>
                    ) : null}
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.5 }) }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>История изменений</Typography>
                  <Stack spacing={0.75}>
                    {(Array.isArray(article.revisions) ? article.revisions : []).slice(0, 6).map((revision) => (
                      <Box key={revision.id}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {localizeRevisionAction(revision.action)} • v{revision.version} • {localizeStatus(revision.status)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {revision.changed_by} • {formatDateTime(revision.changed_at)} • {revision.change_note || 'Без комментария'}
                        </Typography>
                      </Box>
                    ))}
                    {(!Array.isArray(article.revisions) || article.revisions.length === 0) ? (
                      <Alert severity="info">История изменений пока пустая.</Alert>
                    ) : null}
                  </Stack>
                </Paper>
              </Stack>
            </Grid>
          </Grid>
        </Stack>
      </Paper>
    );
  };

  const renderCardsPanel = () => (
    <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Grid item xs={12} md={4}>
        <Stack spacing={1.2} sx={{ height: '100%' }}>
          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 1.4 }) }}>
            <Stack spacing={1}>
              <TextField label="Поиск" size="small" value={cardFilters.q} onChange={(event) => setCardFilters((current) => ({ ...current, q: event.target.value }))} />
              <TextField select label="Сервис" size="small" value={cardFilters.service} onChange={(event) => setCardFilters((current) => ({ ...current, service: event.target.value }))}>
                <MenuItem value="">Все</MenuItem>
                {services.map((service) => (
                  <MenuItem key={service.id} value={service.id}>{service.title}</MenuItem>
                ))}
              </TextField>
              <TextField select label="Статус" size="small" value={cardFilters.status} onChange={(event) => setCardFilters((current) => ({ ...current, status: event.target.value }))}>
                <MenuItem value="">Все</MenuItem>
                {STATUS_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
              <TextField select label="Приоритет" size="small" value={cardFilters.priority} onChange={(event) => setCardFilters((current) => ({ ...current, priority: event.target.value }))}>
                <MenuItem value="">Все</MenuItem>
                {CARD_PRIORITY_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
              <TextField label="Теги" size="small" value={cardFilters.tags} onChange={(event) => setCardFilters((current) => ({ ...current, tags: event.target.value }))} />
              <TextField select label="Закрепление" size="small" value={cardFilters.pinned} onChange={(event) => setCardFilters((current) => ({ ...current, pinned: event.target.value }))}>
                <MenuItem value="">Все</MenuItem>
                <MenuItem value="true">Только закреплённые</MenuItem>
                <MenuItem value="false">Без закрепления</MenuItem>
              </TextField>
              {canWrite ? (
                <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openCreateCardDialog}>
                  Создать карточку
                </Button>
              ) : null}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }) }}>
            <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Карточки ({cardsState.total})</Typography>
            </Box>
            {cardsLoading ? (
              <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, py: 6 }}>
                <CircularProgress size={26} />
              </Stack>
            ) : (
              <List sx={{ py: 0, overflowY: 'auto', minHeight: 0 }}>
                {cardsState.items.map((card) => (
                  <ListItemButton
                    key={card.id}
                    selected={card.id === selectedCardId}
                    onClick={() => {
                      setSelectedCardId(card.id);
                      void loadCardDetail(card.id);
                    }}
                    sx={{ alignItems: 'flex-start', py: 1.2, borderBottom: '1px solid', borderColor: ui.borderSoft }}
                  >
                    <ListItemText
                      primaryTypographyProps={{ component: 'div' }}
                      secondaryTypographyProps={{ component: 'div' }}
                      primary={(
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography sx={{ fontWeight: 700 }}>{card.title}</Typography>
                          <Chip size="small" label={localizeStatus(card.status)} />
                          <Chip size="small" color={card.priority === 'critical' ? 'error' : card.priority === 'high' ? 'warning' : 'default'} label={localizePriority(card.priority)} />
                          {card.is_pinned ? <Chip size="small" color="primary" label="закреплено" /> : null}
                        </Stack>
                      )}
                      secondary={(
                        <Stack spacing={0.45} sx={{ mt: 0.5 }}>
                          <Typography variant="body2" color="text.secondary">{card.summary_short}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {card.service_key} • {formatDateTime(card.updated_at)}
                          </Typography>
                        </Stack>
                      )}
                    />
                  </ListItemButton>
                ))}
                {cardsState.items.length === 0 ? (
                  <Box sx={{ p: 2 }}>
                    <Alert severity="info">Карточки не найдены.</Alert>
                  </Box>
                ) : null}
              </List>
            )}
          </Paper>
        </Stack>
      </Grid>
      <Grid item xs={12} md={8}>
        {!selectedCard ? (
          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 2.5, minHeight: 420 }) }}>
            <Alert severity="info">Выберите карточку слева.</Alert>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 2, minHeight: 420 }) }}>
            <Stack spacing={1.4}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{selectedCard.title}</Typography>
                    <Chip size="small" label={localizeStatus(selectedCard.status)} />
                    <Chip size="small" color={selectedCard.priority === 'critical' ? 'error' : selectedCard.priority === 'high' ? 'warning' : 'default'} label={localizePriority(selectedCard.priority)} />
                    {selectedCard.is_pinned ? <Chip size="small" color="primary" label="закреплено" /> : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {selectedCard.summary_short}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedCard.service_key} • обновлено {formatDateTime(selectedCard.updated_at)} • ответственный {selectedCard.owner_name || 'нет данных'}
                  </Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => window.open(selectedCard.external_url, '_blank', 'noopener,noreferrer')}>
                    Открыть
                  </Button>
                  {canWrite ? <Button variant="outlined" onClick={() => openEditCardDialog(selectedCard)}>Редактировать</Button> : null}
                  {canPublish ? (
                    <>
                      <Button variant="outlined" onClick={() => handleSetCardStatus(selectedCard, 'published')}>Опубликовать</Button>
                      <Button variant="outlined" onClick={() => handleSetCardStatus(selectedCard, 'draft')}>В черновик</Button>
                      <Button variant="outlined" color="warning" onClick={() => handleSetCardStatus(selectedCard, 'archived')}>В архив</Button>
                    </>
                  ) : null}
                </Stack>
              </Stack>

              {detailLoading === `card:${selectedCard.id}` ? <LinearDetailLoading /> : null}

              <Grid container spacing={1.4}>
                <Grid item xs={12} md={7}>
                  <Paper variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.5 }) }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>Быстрые шаги</Typography>
                    <ContentListBlock title="" items={selectedCard.quick_steps} emptyText="Шаги ещё не заполнены." />
                  </Paper>
                </Grid>
                <Grid item xs={12} md={5}>
                  <Paper variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.5 }) }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>Сводка по сервису</Typography>
                    <Stack spacing={0.75}>
                      <InfoRow label="Сервис" value={selectedCard.service_key} />
                      <InfoRow label="Теги" value={(selectedCard.tags || []).join(', ') || 'нет данных'} />
                      <InfoRow label="Создано" value={formatDateTime(selectedCard.created_at)} />
                      <InfoRow label="Обновил" value={selectedCard.updated_by || 'нет данных'} />
                      {selectedCard.cover_image_url ? (
                        <Button variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => window.open(selectedCard.cover_image_url, '_blank', 'noopener,noreferrer')}>
                          Открыть обложку
                        </Button>
                      ) : null}
                    </Stack>
                  </Paper>
                </Grid>
              </Grid>

              <Paper variant="outlined" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.25 }) }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Счётчики сервисов</Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {services.map((service) => (
                    <Chip
                      key={service.id}
                      variant={service.id === selectedCard.service_key ? 'filled' : 'outlined'}
                      label={`${service.title}: ${service.published_cards}/${service.total_cards}`}
                    />
                  ))}
                </Stack>
              </Paper>
            </Stack>
          </Paper>
        )}
      </Grid>
    </Grid>
  );

  const activeArticle = tab === 'templates' ? selectedTemplate : selectedArticle;

  return (
    <MainLayout>
      <PageShell fullHeight>
        <Stack spacing={2} sx={{ height: '100%', minHeight: 0 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Box>
              <Typography variant="h4">База знаний</Typography>
              <Typography variant="body2" color="text.secondary">
                Встроенный раздел для инструкций, шаблонов документов, карточек сервисов и ленты изменений.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant={tab === 'articles' ? 'contained' : 'outlined'} onClick={handleOpenInstructions}>
                Инструкции
              </Button>
              <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} onClick={() => void refreshAll()}>
                Обновить
              </Button>
              <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={handleOpenWiki}>
                Открыть Wiki
              </Button>
            </Stack>
          </Stack>

          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1}>
            <Alert severity="info" sx={{ flex: 1 }}>
              Шаблоны для автоотправки ботом берутся только из статей со статусом «Опубликовано», типом «Шаблон» и выбранным основным вложением.
            </Alert>
            {!canWrite ? (
              <Alert severity="warning" sx={{ minWidth: { lg: 360 } }}>
                Режим только для чтения. Для редактирования нужен `kb.write`.
              </Alert>
            ) : null}
          </Stack>

          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 0.6, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }) }}>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
              {KB_TABS.map((item) => (
                <Tab key={item.value} value={item.value} label={item.label} />
              ))}
            </Tabs>
            <Divider />

            <Box sx={{ p: 1.5, flex: 1, minHeight: 0, overflow: 'auto' }}>
              {referenceLoading ? (
                <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
                  <CircularProgress size={28} />
                </Stack>
              ) : null}

              {!referenceLoading && tab === 'articles' ? (
                <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
                  <Grid item xs={12} md={4}>
                    <Stack spacing={1.2} sx={{ height: '100%' }}>
                      <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 1.4 }) }}>
                        <Stack spacing={1}>
                          <TextField label="Поиск" size="small" value={articleFilters.q} onChange={(event) => setArticleFilters((current) => ({ ...current, q: event.target.value }))} />
                          <TextField select label="Категория" size="small" value={articleFilters.category} onChange={(event) => setArticleFilters((current) => ({ ...current, category: event.target.value }))}>
                            <MenuItem value="">Все</MenuItem>
                            {categories.map((category) => (
                              <MenuItem key={category.id} value={category.id}>{category.title}</MenuItem>
                            ))}
                          </TextField>
                          <TextField select label="Статус" size="small" value={articleFilters.status} onChange={(event) => setArticleFilters((current) => ({ ...current, status: event.target.value }))}>
                            <MenuItem value="">Все</MenuItem>
                            {STATUS_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </TextField>
                          <TextField select label="Тип" size="small" value={articleFilters.article_type} onChange={(event) => setArticleFilters((current) => ({ ...current, article_type: event.target.value }))}>
                            <MenuItem value="">Все</MenuItem>
                            {ARTICLE_TYPE_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </TextField>
                          <TextField label="Теги" size="small" value={articleFilters.tags} onChange={(event) => setArticleFilters((current) => ({ ...current, tags: event.target.value }))} />
                          {canWrite ? (
                            <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => openCreateArticleDialog('runbook')}>
                              Создать статью
                            </Button>
                          ) : null}
                        </Stack>
                      </Paper>
                      {renderArticleList(
                        articlesState.items,
                        selectedArticleId,
                        (id) => {
                          setSelectedArticleId(id);
                          void loadArticleDetail(id, 'article');
                        },
                        articlesLoading,
                        false,
                      )}
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={8}>
                    {renderArticleDetail(activeArticle, 'article')}
                  </Grid>
                </Grid>
              ) : null}

              {!referenceLoading && tab === 'templates' ? (
                <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
                  <Grid item xs={12} md={4}>
                    <Stack spacing={1.2} sx={{ height: '100%' }}>
                      <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 1.4 }) }}>
                        <Stack spacing={1}>
                          <TextField label="Поиск" size="small" value={templateFilters.q} onChange={(event) => setTemplateFilters((current) => ({ ...current, q: event.target.value }))} />
                          <TextField select label="Категория" size="small" value={templateFilters.category} onChange={(event) => setTemplateFilters((current) => ({ ...current, category: event.target.value }))}>
                            <MenuItem value="">Все</MenuItem>
                            {categories.map((category) => (
                              <MenuItem key={category.id} value={category.id}>{category.title}</MenuItem>
                            ))}
                          </TextField>
                          <TextField select label="Статус" size="small" value={templateFilters.status} onChange={(event) => setTemplateFilters((current) => ({ ...current, status: event.target.value }))}>
                            <MenuItem value="">Все</MenuItem>
                            {STATUS_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </TextField>
                          <TextField label="Теги" size="small" value={templateFilters.tags} onChange={(event) => setTemplateFilters((current) => ({ ...current, tags: event.target.value }))} />
                          {canWrite ? (
                            <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => openCreateArticleDialog('template')}>
                              Создать шаблон
                            </Button>
                          ) : null}
                        </Stack>
                      </Paper>
                      {renderArticleList(
                        templatesState.items,
                        selectedTemplateId,
                        (id) => {
                          setSelectedTemplateId(id);
                          void loadArticleDetail(id, 'template');
                        },
                        templatesLoading,
                        true,
                      )}
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={8}>
                    {renderArticleDetail(activeArticle, 'template')}
                  </Grid>
                </Grid>
              ) : null}

              {!referenceLoading && tab === 'cards' ? renderCardsPanel() : null}

              {!referenceLoading && tab === 'feed' ? (
                <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 0, minHeight: 320 }) }}>
                  <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Лента изменений</Typography>
                  </Box>
                  {feedLoading ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
                      <CircularProgress size={26} />
                    </Stack>
                  ) : (
                    <Stack spacing={0} divider={<Divider flexItem />}>
                      {feed.map((event) => (
                        <Box key={`${event.article_id}:${event.version}:${event.changed_at}`} sx={{ px: 1.5, py: 1.2 }}>
                          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
                            <Box>
                              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                                <Typography sx={{ fontWeight: 700 }}>{event.article_title}</Typography>
                                <Chip size="small" label={localizeRevisionAction(event.action)} />
                                <Chip size="small" variant="outlined" label={localizeStatus(event.status)} />
                              </Stack>
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45 }}>
                                {event.change_note || 'Без комментария'}
                              </Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                              {event.changed_by} • v{event.version} • {formatDateTime(event.changed_at)}
                            </Typography>
                          </Stack>
                        </Box>
                      ))}
                      {feed.length === 0 ? (
                        <Box sx={{ p: 2 }}>
                          <Alert severity="info">Лента изменений пока пустая.</Alert>
                        </Box>
                      ) : null}
                    </Stack>
                  )}
                </Paper>
              ) : null}
            </Box>
          </Paper>
        </Stack>

        <ArticleEditorDialog
          open={articleDialogOpen}
          mode={articleDialogMode}
          form={articleForm}
          saving={savingArticle}
          onChange={handleArticleDialogChange}
          onClose={() => setArticleDialogOpen(false)}
          onSubmit={() => void handleSubmitArticle()}
        />

        <CardEditorDialog
          open={cardDialogOpen}
          mode={cardDialogMode}
          form={cardForm}
          saving={savingCard}
          onChange={handleCardDialogChange}
          onClose={() => setCardDialogOpen(false)}
          onSubmit={() => void handleSubmitCard()}
        />
      </PageShell>
    </MainLayout>
  );
}

function ContentBlock({ title, value }) {
  const text = String(value || '').trim();
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {text || 'Не заполнено.'}
      </Typography>
    </Box>
  );
}

function ContentListBlock({ title, items, emptyText = 'Нет данных.' }) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <Box>
      {title ? <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography> : null}
      {rows.length > 0 ? (
        <Stack component="ul" spacing={0.35} sx={{ pl: title ? 2.4 : 2.1, my: 0.35 }}>
          {rows.map((item) => (
            <Typography component="li" key={`${title}:${item}`} variant="body2" color="text.secondary">
              {item}
            </Typography>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">{emptyText}</Typography>
      )}
    </Box>
  );
}

function FaqBlock({ items }) {
  const rows = Array.isArray(items) ? items.filter((item) => item?.question && item?.answer) : [];
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Вопросы и ответы</Typography>
      {rows.length > 0 ? (
        <Stack spacing={0.75} sx={{ mt: 0.45 }}>
          {rows.map((item) => (
            <Box key={`${item.question}:${item.answer}`}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.question}</Typography>
              <Typography variant="body2" color="text.secondary">{item.answer}</Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">Раздел не заполнен.</Typography>
      )}
    </Box>
  );
}

function InfoRow({ label, value }) {
  return (
    <Stack direction="row" spacing={1} justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}

function LinearDetailLoading() {
  return (
    <Alert severity="info" sx={{ py: 0 }}>
      Загружаем актуальные данные элемента...
    </Alert>
  );
}

export default KnowledgeBase;
