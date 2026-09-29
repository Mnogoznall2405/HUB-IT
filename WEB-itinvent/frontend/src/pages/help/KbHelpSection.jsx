import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import QuizOutlinedIcon from '@mui/icons-material/QuizOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { kbAPI } from '../../api/kb';
import { useAuth } from '../../contexts/AuthContext';
import { getOfficePanelSx } from '../../theme/officeUiTokens';

const ARTICLE_TYPE_LABELS = {
  runbook: 'Инструкция',
  faq: 'Вопросы и ответы',
  template: 'Шаблон',
  note: 'Заметка',
};

const ARTICLE_TYPE_ICONS = {
  runbook: ArticleOutlinedIcon,
  faq: QuizOutlinedIcon,
  template: DescriptionOutlinedIcon,
  note: MenuBookOutlinedIcon,
};

const CATEGORY_ACCENTS = ['primary', 'secondary', 'success', 'warning', 'info', 'error'];

const FILE_STYLES = [
  { match: /\.pdf$/i, icon: PictureAsPdfOutlinedIcon, tone: 'error' },
  { match: /\.(xlsx?|csv)$/i, icon: TableChartOutlinedIcon, tone: 'success' },
  { match: /\.(png|jpe?g|gif|webp|bmp|svg)$/i, icon: ImageOutlinedIcon, tone: 'secondary' },
  { match: /\.(docx?|rtf|odt|txt|md)$/i, icon: DescriptionOutlinedIcon, tone: 'primary' },
];

const normalizeText = (value) => String(value || '').trim();

const formatFileSize = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
};

const formatDate = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('ru-RU');
};

const fileStyleFor = (fileName) => (
  FILE_STYLES.find((entry) => entry.match.test(normalizeText(fileName)))
  || { icon: InsertDriveFileOutlinedIcon, tone: 'neutral' }
);

const resolveResponseFileName = (response, fallbackName) => {
  const header = normalizeText(response?.headers?.['content-disposition'] || response?.headers?.get?.('content-disposition'));
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  if (simpleMatch?.[1]) return simpleMatch[1];
  return fallbackName || 'file';
};

const downloadBlobResponse = (response, fallbackName) => {
  const blob = response?.data;
  if (!(blob instanceof Blob)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = resolveResponseFileName(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const articleMatchesQuery = (article, categoryTitle, query) => {
  if (!query) return true;
  const parts = [
    article?.title,
    article?.summary,
    categoryTitle,
    article?.article_type && ARTICLE_TYPE_LABELS[article.article_type],
    ...(Array.isArray(article?.tags) ? article.tags : []),
    ...(Array.isArray(article?.attachments) ? article.attachments.map((item) => item?.file_name) : []),
  ];
  return parts.filter(Boolean).some((part) => normalizeText(part).toLowerCase().includes(query));
};

const iconTileSx = (theme, tone, size = 34) => {
  const color = tone === 'neutral' ? theme.palette.text.secondary : (theme.palette[tone]?.main || theme.palette.primary.main);
  return {
    width: size,
    height: size,
    borderRadius: '10px',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    color,
    bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.18 : 0.10),
    border: '1px solid',
    borderColor: alpha(color, theme.palette.mode === 'dark' ? 0.30 : 0.18),
  };
};

function AttachmentRow({ articleId, attachment, onDownload, busy }) {
  const theme = useTheme();
  const { icon: FileIcon, tone } = fileStyleFor(attachment?.file_name);
  const size = formatFileSize(attachment?.size);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.75,
        py: 0.5,
        minWidth: 0,
        borderRadius: '8px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: (t) => (t.palette.mode === 'dark' ? alpha(t.palette.common.white, 0.03) : t.palette.grey[50]),
        transition: 'border-color 120ms ease, background-color 120ms ease',
        '&:hover': { borderColor: 'primary.light' },
      }}
    >
      <Box sx={iconTileSx(theme, tone, 24)}>
        <FileIcon sx={{ fontSize: 14 }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" noWrap sx={{ fontWeight: 600, lineHeight: 1.3, display: 'block', fontSize: '0.78rem' }}>
          {attachment?.file_name || 'Файл'}
        </Typography>
        {size ? <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>{size}</Typography> : null}
      </Box>
      <IconButton
        size="small"
        color="primary"
        aria-label={`Скачать ${attachment?.file_name || 'файл'}`}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onDownload(articleId, attachment);
        }}
      >
        {busy ? <CircularProgress size={16} /> : <DownloadOutlinedIcon fontSize="small" />}
      </IconButton>
    </Box>
  );
}

function ContentSection({ title, children }) {
  if (!children) return null;
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

function LinesList({ items, ordered }) {
  const rows = (Array.isArray(items) ? items : []).map((item) => normalizeText(item)).filter(Boolean);
  if (!rows.length) return null;
  return (
    <Box component={ordered ? 'ol' : 'ul'} sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.4 }}>
      {rows.map((item, index) => (
        <Typography component="li" variant="body2" key={index} sx={{ lineHeight: 1.55 }}>{item}</Typography>
      ))}
    </Box>
  );
}

export default function KbHelpSection({ query = '', ui }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('kb.write');

  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [detailId, setDetailId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloadBusyKey, setDownloadBusyKey] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      kbAPI.getCategories(),
      kbAPI.getArticles({ status: 'published', limit: 300 }),
    ])
      .then(([categoriesPayload, articlesPayload]) => {
        if (cancelled) return;
        setCategories(Array.isArray(categoriesPayload) ? categoriesPayload : []);
        setArticles(Array.isArray(articlesPayload?.items) ? articlesPayload.items : []);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 401 || status === 403) setDenied(true);
        else setError('Не удалось загрузить базу знаний.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const normalizedQuery = normalizeText(query).toLowerCase();

  const groups = useMemo(() => {
    const ordered = [];
    (categories || []).forEach((category) => {
      const id = normalizeText(category?.id);
      if (!id) return;
      ordered.push({ id, title: normalizeText(category?.title) || id, description: normalizeText(category?.description), items: [] });
    });
    const other = { id: '__other__', title: 'Прочее', description: '', items: [] };
    const groupById = new Map(ordered.map((group) => [group.id, group]));
    (articles || []).forEach((article) => {
      const categoryId = normalizeText(article?.category).toLowerCase();
      const group = groupById.get(categoryId) || other;
      if (!articleMatchesQuery(article, group.title, normalizedQuery)) return;
      group.items.push(article);
    });
    const visible = ordered.filter((group) => group.items.length > 0);
    if (other.items.length > 0) visible.push(other);
    return visible;
  }, [articles, categories, normalizedQuery]);

  const openArticle = async (articleId) => {
    const id = normalizeText(articleId);
    if (!id) return;
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const payload = await kbAPI.getArticle(id);
      setDetail(payload && typeof payload === 'object' ? payload : null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadAttachment = async (articleId, attachment) => {
    const attachmentId = normalizeText(attachment?.id);
    if (!attachmentId || downloadBusyKey) return;
    setDownloadBusyKey(`${articleId}:${attachmentId}`);
    try {
      const response = await kbAPI.downloadAttachment(articleId, attachmentId);
      downloadBlobResponse(response, attachment?.file_name || 'file');
    } catch {
      setError('Не удалось скачать файл.');
    } finally {
      setDownloadBusyKey('');
    }
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  if (denied) return null;

  const detailAttachments = Array.isArray(detail?.attachments) ? detail.attachments : [];
  const content = detail?.content && typeof detail.content === 'object' ? detail.content : {};
  const totalArticles = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <Paper
      variant="outlined"
      sx={getOfficePanelSx(ui, {
        borderRadius: '18px',
        p: { xs: 1.5, sm: 2 },
        minWidth: 0,
        boxShadow: 'none',
        overflow: 'hidden',
      })}
    >
      <Stack spacing={1.75}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Box sx={iconTileSx(theme, 'primary', 40)}>
            <MenuBookOutlinedIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" fontWeight={800}>База знаний</Typography>
              {totalArticles > 0 ? (
                <Chip size="small" label={totalArticles} sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700 }} />
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              Инструкции, бланки и файлы IT-отдела — сгруппированы по темам. Файл можно скачать прямо из карточки.
            </Typography>
          </Box>
          {canWrite ? (
            <Button
              component={RouterLink}
              to="/kb/manage"
              size="small"
              variant="outlined"
              startIcon={<SettingsOutlinedIcon />}
              sx={{ textTransform: 'none', borderRadius: '999px', flexShrink: 0 }}
            >
              Управление
            </Button>
          ) : null}
        </Stack>

        {error ? <Alert severity="warning" sx={{ borderRadius: '10px' }}>{error}</Alert> : null}

        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Загружаю базу знаний…</Typography>
          </Stack>
        ) : groups.length === 0 ? (
          <Stack spacing={0.75} alignItems="center" sx={{ py: 3, textAlign: 'center' }}>
            <Box sx={iconTileSx(theme, 'neutral', 44)}>
              <MenuBookOutlinedIcon />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {normalizedQuery ? 'В базе знаний ничего не нашлось по этому запросу.' : 'В базе знаний пока нет опубликованных материалов.'}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2}>
            {groups.map((group, groupIndex) => {
              const accent = CATEGORY_ACCENTS[groupIndex % CATEGORY_ACCENTS.length];
              const accentColor = theme.palette[accent]?.main || theme.palette.primary.main;
              return (
                <Box
                  key={group.id}
                  sx={{
                    '@keyframes kbGroupIn': {
                      from: { opacity: 0, transform: 'translateY(6px)' },
                      to: { opacity: 1, transform: 'translateY(0)' },
                    },
                    animation: `kbGroupIn 260ms ease-out ${Math.min(groupIndex, 6) * 60}ms both`,
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.9 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: accentColor,
                        boxShadow: `0 0 0 3px ${alpha(accentColor, 0.18)}`,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="subtitle2" fontWeight={800}>{group.title}</Typography>
                    <Chip
                      size="small"
                      label={group.items.length}
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.18 : 0.10),
                        color: accentColor,
                        border: 'none',
                      }}
                    />
                    {group.description ? (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>{group.description}</Typography>
                    ) : null}
                  </Stack>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                      gap: 1,
                      alignItems: 'start',
                    }}
                  >
                    {(expandedGroups.has(group.id) ? group.items : group.items.slice(0, 4)).map((article) => {
                      const attachments = Array.isArray(article?.attachments) ? article.attachments : [];
                      const TypeIcon = ARTICLE_TYPE_ICONS[article?.article_type] || ArticleOutlinedIcon;
                      const updated = formatDate(article?.updated_at);
                      return (
                        <Paper
                          key={article.id}
                          variant="outlined"
                          sx={{
                            borderRadius: '14px',
                            p: 1.25,
                            minWidth: 0,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.75,
                            alignItems: 'stretch',
                            bgcolor: (t) => (t.palette.mode === 'dark' ? alpha(t.palette.common.white, 0.025) : t.palette.background.paper),
                            borderColor: 'divider',
                            transition: 'transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
                            '&:hover': {
                              transform: 'translateY(-2px)',
                              borderColor: alpha(accentColor, 0.5),
                              boxShadow: ui.shellShadow,
                            },
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="flex-start"
                            component="button"
                            type="button"
                            onClick={() => openArticle(article.id)}
                            aria-label={`Открыть статью ${article.title || ''}`}
                            sx={{
                              border: 0,
                              p: 0,
                              m: 0,
                              minWidth: 0,
                              bgcolor: 'transparent',
                              color: 'inherit',
                              font: 'inherit',
                              textAlign: 'left',
                              cursor: 'pointer',
                              borderRadius: '8px',
                              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                            }}
                          >
                            <Box sx={iconTileSx(theme, accent, 30)}>
                              <TypeIcon sx={{ fontSize: 17 }} />
                            </Box>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography
                                variant="body2"
                                fontWeight={700}
                                sx={{
                                  lineHeight: 1.35,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {article.title}
                              </Typography>
                              {article.summary && normalizeText(article.summary) !== normalizeText(article.title) ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  noWrap
                                  sx={{ display: 'block', mt: 0.25 }}
                                >
                                  {article.summary}
                                </Typography>
                              ) : null}
                              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                                {article.article_type && ARTICLE_TYPE_LABELS[article.article_type] ? (
                                  <Chip
                                    size="small"
                                    label={ARTICLE_TYPE_LABELS[article.article_type]}
                                    sx={{
                                      height: 18,
                                      fontSize: '0.66rem',
                                      fontWeight: 600,
                                      bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.16 : 0.08),
                                      color: accentColor,
                                      border: 'none',
                                    }}
                                  />
                                ) : null}
                                {updated ? (
                                  <Typography variant="caption" color="text.disabled" sx={{ alignSelf: 'center' }}>
                                    {updated}
                                  </Typography>
                                ) : null}
                              </Stack>
                            </Box>
                          </Stack>
                          {attachments.length > 0 ? (
                            <Stack spacing={0.4} sx={{ mt: 0.25 }}>
                              {attachments.slice(0, 2).map((attachment) => (
                                <AttachmentRow
                                  key={attachment.id || attachment.file_name}
                                  articleId={article.id}
                                  attachment={attachment}
                                  onDownload={downloadAttachment}
                                  busy={downloadBusyKey === `${article.id}:${attachment.id}`}
                                />
                              ))}
                              {attachments.length > 2 ? (
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                                  + ещё {attachments.length - 2} — в карточке статьи
                                </Typography>
                              ) : null}
                            </Stack>
                          ) : null}
                        </Paper>
                      );
                    })}
                  </Box>
                  {group.items.length > 4 ? (
                    <Button
                      size="small"
                      onClick={() => toggleGroup(group.id)}
                      sx={{ mt: 0.75, textTransform: 'none', borderRadius: '999px', fontSize: '0.78rem' }}
                    >
                      {expandedGroups.has(group.id) ? 'Свернуть' : `Показать ещё ${group.items.length - 4}`}
                    </Button>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        )}
      </Stack>

      <Dialog
        open={Boolean(detailId)}
        onClose={() => setDetailId('')}
        fullWidth
        maxWidth="sm"
        fullScreen={isMobile}
        aria-labelledby="kb-article-title"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pr: 6 }}>
          <Box sx={iconTileSx(theme, 'primary', 34)}>
            <MenuBookOutlinedIcon fontSize="small" />
          </Box>
          <Typography component="span" variant="h6" fontWeight={800} id="kb-article-title" sx={{ minWidth: 0 }}>
            {detail?.title || 'Статья'}
          </Typography>
          <IconButton onClick={() => setDetailId('')} aria-label="Закрыть" sx={{ position: 'absolute', right: 8, top: 8 }}>
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Открываю статью…</Typography>
            </Stack>
          ) : !detail ? (
            <Typography variant="body2" color="text.secondary">Не удалось открыть статью.</Typography>
          ) : (
            <Stack spacing={1.5}>
              {detail.summary ? <Typography variant="body2">{detail.summary}</Typography> : null}
              <ContentSection title="Описание">
                {normalizeText(content.overview) ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{content.overview}</Typography> : null}
              </ContentSection>
              <ContentSection title="Симптомы">
                {normalizeText(content.symptoms) ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{content.symptoms}</Typography> : null}
              </ContentSection>
              <ContentSection title="Что проверить">
                <LinesList items={content.checks} />
              </ContentSection>
              <ContentSection title="Команды">
                <LinesList items={content.commands} />
              </ContentSection>
              <ContentSection title="Шаги решения">
                <LinesList items={content.resolution_steps} ordered />
              </ContentSection>
              <ContentSection title="Откат">
                <LinesList items={content.rollback_steps} />
              </ContentSection>
              <ContentSection title="Эскалация">
                {normalizeText(content.escalation) ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{content.escalation}</Typography> : null}
              </ContentSection>
              <ContentSection title="Вопросы и ответы">
                {Array.isArray(content.faq) && content.faq.length > 0 ? (
                  <Stack spacing={0.75}>
                    {content.faq.map((row, index) => (
                      <Box key={index}>
                        <Typography variant="body2" fontWeight={700}>{row.question}</Typography>
                        <Typography variant="body2" color="text.secondary">{row.answer}</Typography>
                      </Box>
                    ))}
                  </Stack>
                ) : null}
              </ContentSection>
              {detailAttachments.length > 0 ? (
                <>
                  <Divider />
                  <ContentSection title="Файлы">
                    <Stack spacing={0.5}>
                      {detailAttachments.map((attachment) => (
                        <AttachmentRow
                          key={attachment.id || attachment.file_name}
                          articleId={detail.id}
                          attachment={attachment}
                          onDownload={downloadAttachment}
                          busy={downloadBusyKey === `${detail.id}:${attachment.id}`}
                        />
                      ))}
                    </Stack>
                  </ContentSection>
                </>
              ) : null}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Paper>
  );
}
