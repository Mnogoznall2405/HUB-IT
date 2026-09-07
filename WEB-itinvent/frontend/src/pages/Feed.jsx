import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useLocation, useNavigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import FeedPostCard from '../components/feed/FeedPostCard';
import FeedComposerDialog from '../components/feed/FeedComposerDialog';
import FeedCommentsPanel from '../components/feed/FeedCommentsPanel';
import FeedReactionsDialog from '../components/feed/FeedReactionsDialog';
import FeedShareDialog from '../components/feed/FeedShareDialog';
import FeedQuickComposer from '../components/feed/FeedQuickComposer';
import FeedSidebar from '../components/feed/FeedSidebar';
import { buildFeedPostPath } from '../components/feed/feedUtils';
import { hubAnnouncementsAPI } from '../api/hubAnnouncements';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { buildOfficeUiTokens } from '../theme/officeUiTokens';

const PAGE_SIZE = 20;
const MOBILE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Новое' },
  { id: 'important', label: 'Важное' },
  { id: 'saved', label: 'Сохранённые' },
];

const MANAGEMENT_STATUS_BY_FILTER = {
  drafts: 'draft', scheduled: 'scheduled', published: 'published', archived: 'archived',
};

const mergePost = (items, post) => {
  const targetId = String(post?.id || '');
  if (!targetId) return items;
  const exists = items.some((item) => String(item?.id || '') === targetId);
  return exists
    ? items.map((item) => (String(item?.id || '') === targetId ? { ...item, ...post } : item))
    : [post, ...items];
};

export default function Feed() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const feedSurface = ui.panelSolid;
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const { notifyApiError, notifySuccess, notifyWarning } = useNotification();
  const canPublish = hasPermission('announcements.write');
  const canModerate = hasPermission('announcements.moderate');
  const canManageFeed = canPublish || canModerate;
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const deepLinkedPostId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('post') || params.get('announcement') || '').trim();
  }, [location.search]);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [feedTotal, setFeedTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [tag, setTag] = useState('');
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [likingIds, setLikingIds] = useState(new Set());
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [recipients, setRecipients] = useState({ users: [], roles: [] });
  const [sharePost, setSharePost] = useState(null);
  const [reactionsView, setReactionsView] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [analyticsPost, setAnalyticsPost] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const commentComposerRef = useRef(null);
  const focusedCommentsPostRef = useRef('');
  const feedScrollPositionRef = useRef(0);
  const openedPostIdRef = useRef('');
  const wasInDetailRef = useRef(Boolean(deepLinkedPostId));
  const queryRef = useRef(query);
  const activeFilterRef = useRef(activeFilter);
  const categoryIdRef = useRef(categoryId);
  const tagRef = useRef(tag);
  const itemsLengthRef = useRef(items.length);
  const listRequestRef = useRef(0);
  const listPendingRef = useRef(false);
  const listScope = JSON.stringify([query, activeFilter, categoryId, tag, deepLinkedPostId]);
  const listScopeRef = useRef(listScope);
  if (listScopeRef.current !== listScope) {
    listScopeRef.current = listScope;
    listRequestRef.current += 1;
  }
  queryRef.current = query;
  activeFilterRef.current = activeFilter;
  categoryIdRef.current = categoryId;
  tagRef.current = tag;
  itemsLengthRef.current = items.length;

  const loadPage = useCallback(async ({ reset = false } = {}) => {
    if (!reset && listPendingRef.current) return;
    const requestId = ++listRequestRef.current;
    const isCurrent = () => requestId === listRequestRef.current;
    listPendingRef.current = true;
    const offset = reset ? 0 : itemsLengthRef.current;
    if (reset) {
      if (itemsLengthRef.current > 0) setRefreshing(true);
      else setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError('');
    try {
      const managementStatus = MANAGEMENT_STATUS_BY_FILTER[activeFilterRef.current];
      const payload = managementStatus
        ? await hubAnnouncementsAPI.getManagedAnnouncements(managementStatus, { limit: 100 })
        : await hubAnnouncementsAPI.getAnnouncements({
          q: queryRef.current.trim(),
          unread_only: activeFilterRef.current === 'unread',
          priority: activeFilterRef.current === 'important' ? 'high' : '',
          bookmarked_only: activeFilterRef.current === 'saved',
          category_id: categoryIdRef.current,
          tag: tagRef.current,
          include_body: true,
          limit: PAGE_SIZE,
          offset,
          sort_by: 'published_at',
          sort_dir: 'desc',
        });
      if (!isCurrent()) return;
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems((current) => {
        if (!isCurrent()) return current;
        if (reset) return nextItems;
        const ids = new Set(current.map((item) => String(item.id)));
        return [...current, ...nextItems.filter((item) => !ids.has(String(item.id)))];
      });
      setTotal(Number(payload?.total || nextItems.length));
      if (activeFilterRef.current === 'all' && !queryRef.current.trim()) {
        setFeedTotal(Number(payload?.total || nextItems.length));
        setUnreadTotal(Number(payload?.unread_total || 0));
      }
    } catch (requestError) {
      if (!isCurrent()) return;
      const message = requestError?.response?.data?.detail || requestError?.message || 'Не удалось загрузить ленту.';
      setError(String(message));
    } finally {
      if (isCurrent()) {
        listPendingRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const loadTaxonomy = useCallback(async () => {
    const [categoryPayload, tagPayload] = await Promise.all([
      hubAnnouncementsAPI.getCategories(), hubAnnouncementsAPI.getTags(),
    ]);
    setCategories(Array.isArray(categoryPayload?.items) ? categoryPayload.items : []);
    setTags(Array.isArray(tagPayload?.items) ? tagPayload.items : []);
  }, []);

  useEffect(() => { void loadTaxonomy().catch(() => undefined); }, [loadTaxonomy]);

  useEffect(() => {
    if (deepLinkedPostId) return undefined;
    const timeout = window.setTimeout(() => void loadPage({ reset: true }), 250);
    return () => window.clearTimeout(timeout);
  }, [activeFilter, categoryId, deepLinkedPostId, loadPage, query, tag]);

  useEffect(() => {
    if (!deepLinkedPostId) {
      setDetailLoading(false);
      setDetailError('');
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');
    hubAnnouncementsAPI.getAnnouncement(deepLinkedPostId)
      .then((post) => {
        if (!cancelled && post?.id) setItems((current) => mergePost(current, post));
      })
      .catch((requestError) => {
        if (!cancelled) {
          const message = requestError?.response?.data?.detail || requestError?.message || 'Публикация по ссылке недоступна.';
          setDetailError(String(message));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [deepLinkedPostId]);

  const selectedPost = useMemo(() => (
    deepLinkedPostId
      ? items.find((item) => String(item?.id || '') === deepLinkedPostId) || null
      : null
  ), [deepLinkedPostId, items]);

  const openPost = useCallback((post, { comments = false } = {}) => {
    if (!post?.id) return;
    feedScrollPositionRef.current = window.scrollY;
    openedPostIdRef.current = String(post.id);
    const path = buildFeedPostPath(post.id);
    navigate(comments ? `${path}#comments` : path);
    if (!comments) {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }
  }, [navigate]);

  const closePost = useCallback(() => {
    navigate('/feed');
  }, [navigate]);

  useEffect(() => {
    const isInDetail = Boolean(deepLinkedPostId);
    if (!isInDetail && wasInDetailRef.current) {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: feedScrollPositionRef.current, left: 0, behavior: 'auto' });
        const openedPostId = openedPostIdRef.current;
        const trigger = Array.from(document.querySelectorAll('[data-feed-post-open]'))
          .find((element) => element.getAttribute('data-feed-post-open') === openedPostId);
        trigger?.focus({ preventScroll: true });
      });
    }
    wasInDetailRef.current = isInDetail;
  }, [deepLinkedPostId]);

  const focusCommentComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      document.getElementById('feed-comments')?.scrollIntoView({ block: 'start', behavior: 'auto' });
      commentComposerRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!selectedPost || location.hash !== '#comments') {
      focusedCommentsPostRef.current = '';
      return;
    }
    if (focusedCommentsPostRef.current === deepLinkedPostId) return;
    focusedCommentsPostRef.current = deepLinkedPostId;
    focusCommentComposer();
  }, [deepLinkedPostId, focusCommentComposer, location.hash, selectedPost]);

  const patchPost = useCallback((postId, patch) => {
    setItems((current) => current.map((item) => (
      String(item?.id || '') === String(postId || '') ? { ...item, ...(patch || {}) } : item
    )));
  }, []);

  const handleCommentCountChange = useCallback((postId, count) => {
    patchPost(postId, { comments_count: count });
  }, [patchPost]);

  const handleExpanded = useCallback(async (post) => {
    if (!post?.id) return;
    const requests = [];
    if (!Array.isArray(post.attachments)) {
      requests.push(
        hubAnnouncementsAPI.getAnnouncement(post.id).then((detail) => patchPost(post.id, detail)),
      );
    }
    if (post.is_unread) {
      patchPost(post.id, { is_unread: false, is_updated: false });
      setUnreadTotal((current) => Math.max(0, current - 1));
      requests.push(
        hubAnnouncementsAPI.markAnnouncementRead(post.id).catch((requestError) => {
          patchPost(post.id, { is_unread: true });
          setUnreadTotal((current) => current + 1);
          throw requestError;
        }),
      );
    }
    try {
      await Promise.all(requests);
      if (post.is_unread) window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось открыть публикацию полностью.');
    }
  }, [notifyApiError, patchPost]);

  const handleLike = useCallback(async (post) => {
    const postId = String(post?.id || '');
    if (!postId || likingIds.has(postId)) return;
    const wasLiked = Boolean(post.viewer_has_liked);
    const previousCount = Number(post.likes_count || 0);
    setLikingIds((current) => new Set(current).add(postId));
    patchPost(postId, {
      viewer_has_liked: !wasLiked,
      likes_count: Math.max(0, previousCount + (wasLiked ? -1 : 1)),
    });
    try {
      const result = wasLiked
        ? await hubAnnouncementsAPI.unlikeAnnouncement(postId)
        : await hubAnnouncementsAPI.likeAnnouncement(postId);
      patchPost(postId, result);
    } catch (requestError) {
      patchPost(postId, { viewer_has_liked: wasLiked, likes_count: previousCount });
      notifyApiError(requestError, 'Не удалось изменить отметку «Нравится».');
    } finally {
      setLikingIds((current) => {
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    }
  }, [likingIds, notifyApiError, patchPost]);

  const handleReaction = useCallback(async (post, reactionType) => {
    const postId = String(post?.id || '');
    if (!postId || likingIds.has(postId)) return;
    const previousType = post?.viewer_reaction || null;
    const previousCounts = { ...(post?.reaction_counts || {}) };
    const nextCounts = { ...previousCounts };
    if (previousType) nextCounts[previousType] = Math.max(0, Number(nextCounts[previousType] || 0) - 1);
    if (reactionType) nextCounts[reactionType] = Number(nextCounts[reactionType] || 0) + 1;
    setLikingIds((current) => new Set(current).add(postId));
    patchPost(postId, {
      viewer_reaction: reactionType,
      reaction_counts: nextCounts,
      reactions_count: Object.values(nextCounts).reduce((sum, value) => sum + Number(value || 0), 0),
      viewer_has_liked: reactionType === 'like',
    });
    try {
      const result = reactionType
        ? await hubAnnouncementsAPI.setReaction(postId, reactionType)
        : await hubAnnouncementsAPI.removeReaction(postId);
      patchPost(postId, result);
    } catch (requestError) {
      patchPost(postId, {
        viewer_reaction: previousType,
        reaction_counts: previousCounts,
        reactions_count: Number(post?.reactions_count || 0),
        viewer_has_liked: previousType === 'like',
      });
      notifyApiError(requestError, 'Не удалось изменить реакцию.');
    } finally {
      setLikingIds((current) => { const next = new Set(current); next.delete(postId); return next; });
    }
  }, [likingIds, notifyApiError, patchPost]);

  const openReactions = useCallback((post, reactionType = '') => {
    if (!post?.id) return;
    setReactionsView({ post, reactionType: String(reactionType || '') });
  }, []);

  const handleBookmark = useCallback(async (post) => {
    const nextValue = !post?.viewer_bookmarked;
    patchPost(post.id, { viewer_bookmarked: nextValue });
    try {
      await hubAnnouncementsAPI.setBookmark(post.id, nextValue);
      if (!nextValue && activeFilterRef.current === 'saved') {
        setItems((current) => current.filter((item) => item.id !== post.id));
      }
    } catch (requestError) {
      patchPost(post.id, { viewer_bookmarked: !nextValue });
      notifyApiError(requestError, 'Не удалось изменить сохранённые публикации.');
    }
  }, [notifyApiError, patchPost]);

  const handlePollVote = useCallback(async (post, optionIds) => {
    try {
      const result = await hubAnnouncementsAPI.votePoll(post.id, optionIds);
      patchPost(post.id, { poll: result?.poll || null });
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось сохранить голос.');
      throw requestError;
    }
  }, [notifyApiError, patchPost]);

  const handleAcknowledge = useCallback(async (post) => {
    try {
      await hubAnnouncementsAPI.acknowledgeAnnouncement(post.id);
      patchPost(post.id, { is_ack_pending: false, is_unread: false });
      notifySuccess('Ознакомление подтверждено.', { source: 'feed' });
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось подтвердить ознакомление.');
    }
  }, [notifyApiError, notifySuccess, patchPost]);

  const loadRecipients = useCallback(async () => {
    if (!canManageFeed) return;
    try {
      const payload = await hubAnnouncementsAPI.getAnnouncementRecipients();
      setRecipients({
        users: Array.isArray(payload?.users) ? payload.users : [],
        roles: Array.isArray(payload?.roles) ? payload.roles : [],
      });
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось загрузить список получателей.');
    }
  }, [canManageFeed, notifyApiError]);

  const openComposer = useCallback((post = null) => {
    setEditingPost(post);
    setComposerOpen(true);
    void loadRecipients();
  }, [loadRecipients]);

  const closeComposer = () => {
    setComposerOpen(false);
    setEditingPost(null);
  };

  const handleSaved = async (post, { editing } = {}) => {
    closeComposer();
    notifySuccess(editing ? 'Публикация обновлена.' : 'Публикация добавлена в ленту.', { source: 'feed' });
    if (post?.id) navigate(buildFeedPostPath(post.id), { replace: false });
    await loadPage({ reset: true });
    window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
  };

  const archivePost = async (post) => {
    if (!post?.id || !window.confirm(`Снять публикацию «${post.title || ''}» с ленты?`)) return;
    try {
      await hubAnnouncementsAPI.archiveAnnouncement(post.id);
      setItems((current) => current.filter((item) => item.id !== post.id));
      setTotal((current) => Math.max(0, current - 1));
      setFeedTotal((current) => Math.max(0, current - 1));
      notifySuccess('Публикация снята с ленты.', { source: 'feed' });
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось снять публикацию с ленты.');
    }
  };

  const deletePost = async (post) => {
    if (!post?.id || !window.confirm(`Удалить публикацию «${post.title || ''}» без возможности восстановления?`)) return;
    try {
      await hubAnnouncementsAPI.deleteAnnouncement(post.id);
      setItems((current) => current.filter((item) => item.id !== post.id));
      setTotal((current) => Math.max(0, current - 1));
      setFeedTotal((current) => Math.max(0, current - 1));
      notifySuccess('Публикация удалена.', { source: 'feed' });
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось удалить публикацию.');
    }
  };

  const openAnalytics = async (post) => {
    setAnalyticsPost(post);
    setAnalytics(null);
    setAnalyticsLoading(true);
    try {
      setAnalytics(await hubAnnouncementsAPI.getAnalytics(post.id));
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось загрузить статистику публикации.');
      setAnalyticsPost(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const createCategory = async () => {
    const name = categoryName.trim();
    if (name.length < 2) return;
    try {
      await hubAnnouncementsAPI.createCategory({ name, is_active: true });
      setCategoryName('');
      await loadTaxonomy();
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось создать категорию.');
    }
  };

  const renameCategory = async (category) => {
    const name = window.prompt('Новое название категории', category.name);
    if (!name?.trim() || name.trim() === category.name) return;
    try {
      await hubAnnouncementsAPI.updateCategory(category.id, { name: name.trim(), is_active: true });
      await loadTaxonomy();
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось переименовать категорию.');
    }
  };

  const deactivateCategory = async (category) => {
    if (!window.confirm(`Скрыть категорию «${category.name}»?`)) return;
    try {
      await hubAnnouncementsAPI.deleteCategory(category.id);
      await loadTaxonomy();
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось скрыть категорию.');
    }
  };

  const shareUrl = sharePost?.id
    ? new URL(buildFeedPostPath(sharePost.id), window.location.origin).toString()
    : '';
  const mobileAdvancedFiltersActive = Boolean(
    query.trim() || categoryId || tag || MANAGEMENT_STATUS_BY_FILTER[activeFilter],
  );

  const renderPostCard = (post, { detail = false } = {}) => {
    const cover = post?.cover_attachment;
    const coverUrl = cover?.id ? hubAnnouncementsAPI.buildAttachmentUrl(post.id, cover.id) : '';
    return (
      <FeedPostCard
        key={post.id}
        post={post}
        coverUrl={coverUrl}
        initialExpanded={detail}
        detailView={detail}
        onOpen={detail ? undefined : openPost}
        onExpanded={handleExpanded}
        onLike={post?.reactions_enabled === false ? null : handleLike}
        onReaction={post?.reactions_enabled === false ? null : handleReaction}
        onOpenReactions={openReactions}
        onBookmark={handleBookmark}
        onComments={detail ? focusCommentComposer : (targetPost) => openPost(targetPost, { comments: true })}
        onShare={setSharePost}
        onAcknowledge={handleAcknowledge}
        onEdit={canManageFeed && post.can_manage ? openComposer : null}
        onArchive={canManageFeed && post.can_manage ? archivePost : null}
        onDelete={(isAdmin || canModerate) && post.can_manage ? deletePost : null}
        onAnalytics={post.can_manage ? openAnalytics : null}
        onPollVote={post?.status === 'published' ? handlePollVote : null}
        buildAttachmentUrl={hubAnnouncementsAPI.buildAttachmentUrl}
      />
    );
  };

  return (
    <MainLayout>
      <PageShell
        sx={{
          px: { xs: 0, sm: 1.5 },
          pb: mobile ? 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 16px)' : 3,
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: deepLinkedPostId ? 640 : 1020,
            mx: 'auto',
            display: 'grid',
            gridTemplateColumns: deepLinkedPostId
              ? 'minmax(0, 640px)'
              : { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 640px) minmax(280px, 320px)' },
            gap: { xs: 1.25, lg: 2 },
            alignItems: 'start',
          }}
        >
          <Stack
            component="section"
            aria-labelledby="feed-page-title"
            spacing={1.25}
            sx={{
              minWidth: 0,
            }}
          >
            <Paper
              component="header"
              elevation={0}
              sx={{
                position: 'sticky',
                top: { xs: 0, sm: 8 },
                zIndex: 3,
                px: { xs: 1.5, sm: 2 },
                py: 1,
                minHeight: 54,
                borderRadius: { xs: 0, sm: '14px' },
                bgcolor: alpha(feedSurface, ui.isDark ? 0.92 : 0.96),
                backdropFilter: 'blur(12px)',
                boxShadow: 'none',
                border: 0,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                {deepLinkedPostId ? (
                  <IconButton
                    aria-label="Вернуться в ленту"
                    onClick={closePost}
                    sx={{ width: 44, height: 44, flexShrink: 0 }}
                  >
                    <ArrowBackRoundedIcon />
                  </IconButton>
                ) : null}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    id="feed-page-title"
                    component="h1"
                    tabIndex={-1}
                    sx={{ fontSize: '1.22rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '-0.015em' }}
                  >
                    {deepLinkedPostId ? 'Публикация' : 'Лента'}
                  </Typography>
                </Box>
                {refreshing ? <CircularProgress aria-label="Обновление ленты" size={18} /> : null}
              </Stack>
            </Paper>

            {deepLinkedPostId ? (
              <>
                {detailError && !selectedPost ? (
                  <Alert
                    severity="error"
                    action={<Button color="inherit" onClick={closePost}>К ленте</Button>}
                  >
                    {detailError}
                  </Alert>
                ) : null}
                {detailLoading && !selectedPost ? (
                  <Paper
                    elevation={0}
                    aria-label="Загрузка публикации"
                    sx={{
                      p: 2,
                      borderRadius: { xs: 0, sm: '14px' },
                      bgcolor: feedSurface,
                      boxShadow: 'none',
                      border: 0,
                    }}
                  >
                    <Stack direction="row" spacing={1.25}>
                      <Skeleton variant="circular" width={44} height={44} />
                      <Box sx={{ flex: 1 }}><Skeleton width="34%" /><Skeleton width="22%" /></Box>
                    </Stack>
                    <Skeleton height={36} sx={{ mt: 1 }} />
                    <Skeleton height={96} />
                    <Skeleton variant="rounded" height={260} sx={{ mt: 1, borderRadius: '14px' }} />
                  </Paper>
                ) : null}
                {selectedPost ? (
                  <>
                    {renderPostCard(selectedPost, { detail: true })}
                    <FeedCommentsPanel
                      post={selectedPost}
                      user={user}
                      composerInputRef={commentComposerRef}
                      onCountChange={handleCommentCountChange}
                      notifyError={notifyApiError}
                    />
                  </>
                ) : null}
              </>
            ) : (
              <>
                {canPublish ? <FeedQuickComposer user={user} onCreate={() => openComposer()} /> : null}

            <Paper
              elevation={0}
              aria-label="Разделы мобильной ленты"
              sx={{
                display: { xs: 'flex', sm: 'none' },
                alignItems: 'center',
                gap: 0.5,
                py: 0.75,
                pl: 1,
                pr: 0.75,
                bgcolor: feedSurface,
                borderRadius: 0,
                overflow: 'hidden',
              }}
            >
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ flex: 1, minWidth: 0, overflowX: 'auto', pr: 2, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
              >
                {MOBILE_FILTERS.map((filter) => {
                  const selected = activeFilter === filter.id;
                  return (
                    <Button
                      key={filter.id}
                      aria-pressed={selected}
                      onClick={() => setActiveFilter(filter.id)}
                      variant={selected ? 'contained' : 'text'}
                      color={selected ? 'primary' : 'inherit'}
                      sx={{
                        flexShrink: 0,
                        minWidth: 72,
                        minHeight: 44,
                        px: 1.25,
                        borderRadius: '999px',
                        boxShadow: 'none',
                        textTransform: 'none',
                        fontWeight: 750,
                      }}
                    >
                      {filter.label}{filter.id === 'unread' && unreadTotal > 0 ? ` · ${unreadTotal}` : ''}
                    </Button>
                  );
                })}
              </Stack>
              <IconButton
                aria-label={mobileAdvancedFiltersActive ? 'Открыть фильтры, есть активные' : 'Открыть фильтры'}
                aria-haspopup="dialog"
                onClick={() => setMobileFiltersOpen(true)}
                color={mobileAdvancedFiltersActive ? 'primary' : 'default'}
                sx={{ width: 44, height: 44, flexShrink: 0, bgcolor: mobileAdvancedFiltersActive ? alpha(theme.palette.primary.main, 0.12) : ui.panelBg }}
              >
                <TuneRoundedIcon />
              </IconButton>
            </Paper>

            <Stack
              direction="row"
              spacing={0}
              aria-label="Фильтры ленты"
              sx={{
                display: { xs: 'none', sm: 'flex', lg: 'none' },
                overflowX: 'auto',
                px: 0.75,
                py: 0.5,
                bgcolor: feedSurface,
                border: 0,
                borderRadius: { xs: 0, sm: '14px' },
              }}
            >
              {[...MOBILE_FILTERS, ...(canManageFeed ? [
                { id: 'drafts', label: 'Черновики' },
                { id: 'scheduled', label: 'Запланированные' },
                { id: 'archived', label: 'Архив' },
              ] : [])].map((filter) => {
                const selected = activeFilter === filter.id;
                return (
                  <Button
                    key={filter.id}
                    aria-pressed={selected}
                    color={selected ? 'primary' : 'inherit'}
                    onClick={() => setActiveFilter(filter.id)}
                    sx={{
                      position: 'relative',
                      flex: 1,
                      minWidth: 96,
                      minHeight: 48,
                      px: 1.25,
                      borderRadius: '9px',
                      bgcolor: selected ? alpha(theme.palette.primary.main, ui.isDark ? 0.18 : 0.1) : 'transparent',
                      fontWeight: selected ? 700 : 600,
                      whiteSpace: 'nowrap',
                      '&:hover': { bgcolor: ui.actionHover },
                    }}
                  >
                    {filter.label}
                    {filter.id === 'unread' && unreadTotal > 0 ? ` · ${unreadTotal}` : ''}
                  </Button>
                );
              })}
            </Stack>

            <TextField
              fullWidth
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск"
              inputProps={{ 'aria-label': 'Поиск в ленте' }}
              sx={{
                display: { xs: 'none', sm: 'block', lg: 'none' },
                px: 1.5,
                py: 1.1,
                bgcolor: feedSurface,
                border: 0,
                borderRadius: { xs: 0, sm: '14px' },
                '& .MuiOutlinedInput-root': { minHeight: 44, borderRadius: '10px', bgcolor: ui.panelBg },
                '& .MuiInputBase-input': { fontSize: { xs: '1rem', sm: '0.95rem' } },
              }}
            />

            {error ? <Alert severity="error">{error}</Alert> : null}

            {loading ? (
              <Stack spacing={1.25} aria-label="Загрузка публикаций">
                {[0, 1, 2].map((index) => (
                  <Paper
                    key={index}
                    elevation={0}
                    sx={{
                      p: 2,
                      borderRadius: { xs: 0, sm: '14px' },
                      bgcolor: feedSurface,
                      boxShadow: 'none',
                      border: 0,
                    }}
                  >
                    <Stack direction="row" spacing={1.25}>
                      <Skeleton variant="circular" width={44} height={44} />
                      <Box sx={{ flex: 1 }}><Skeleton width="34%" /><Skeleton width="22%" /></Box>
                    </Stack>
                    <Skeleton height={34} sx={{ mt: 1 }} />
                    <Skeleton height={72} />
                  </Paper>
                ))}
              </Stack>
            ) : items.length ? (
              <Stack spacing={1.25}>
                {items.map((post) => renderPostCard(post))}
              </Stack>
            ) : (
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 4, sm: 5 },
                  textAlign: 'center',
                  borderRadius: { xs: 0, sm: '14px' },
                  bgcolor: feedSurface,
                  boxShadow: 'none',
                  border: 0,
                }}
              >
                <DynamicFeedRoundedIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                <Typography sx={{ mt: 1, fontSize: '1.05rem', fontWeight: 800 }}>
                  {query ? 'Публикации не найдены' : activeFilter === 'all' ? 'Лента пока пуста' : 'Здесь пока ничего нет'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, textWrap: 'pretty' }}>
                  {query ? 'Попробуйте изменить запрос.' : activeFilter === 'all' ? 'Первая корпоративная новость появится здесь.' : 'Выберите другой раздел ленты.'}
                </Typography>
                {query ? <Button onClick={() => setQuery('')} sx={{ mt: 1 }}>Очистить поиск</Button> : null}
              </Paper>
            )}

            {!loading && items.length < total ? (
              <Button
                variant="outlined"
                onClick={() => void loadPage({ reset: false })}
                disabled={loadingMore}
                sx={{ minHeight: 48, borderRadius: { xs: 0, sm: '12px' }, bgcolor: feedSurface, textTransform: 'none', fontWeight: 700 }}
              >
                {loadingMore ? <CircularProgress size={22} /> : `Показать ещё · ${Math.max(0, total - items.length)}`}
              </Button>
            ) : null}
              </>
            )}
          </Stack>

          {!deepLinkedPostId ? (
            <FeedSidebar
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              query={query}
              onQueryChange={setQuery}
              total={feedTotal}
              unreadTotal={unreadTotal}
              canManage={canManageFeed}
              categories={categories}
              categoryId={categoryId}
              onCategoryChange={setCategoryId}
              tags={tags}
              tag={tag}
              onTagChange={setTag}
              onManageCategories={canModerate ? () => setCategoryDialogOpen(true) : null}
            />
          ) : null}
        </Box>

        <Drawer
          anchor="bottom"
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            sx: {
              maxHeight: '86dvh',
              borderRadius: '20px 20px 0 0',
              bgcolor: ui.panelSolid,
              overscrollBehavior: 'contain',
              pb: 'max(16px, env(safe-area-inset-bottom))',
            },
          }}
        >
          <Box role="dialog" aria-modal="true" aria-labelledby="feed-mobile-filters-title" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <Box sx={{ flex: 1 }}>
                <Typography id="feed-mobile-filters-title" component="h2" sx={{ fontSize: '1.1rem', fontWeight: 800 }}>Разделы и фильтры</Typography>
                <Typography variant="body2" color="text.secondary">Быстрый доступ к нужным публикациям</Typography>
              </Box>
              <IconButton aria-label="Закрыть фильтры" onClick={() => setMobileFiltersOpen(false)} sx={{ width: 44, height: 44 }}><CloseRoundedIcon /></IconButton>
            </Stack>

            <Stack spacing={2.25}>
              <TextField
                fullWidth
                label="Поиск в ленте"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                inputProps={{ enterKeyHint: 'search' }}
              />

              {canManageFeed ? (
                <Box>
                  <Typography sx={{ mb: 1, fontWeight: 800 }}>Мои публикации</Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {[
                      { id: 'drafts', label: 'Черновики' },
                      { id: 'scheduled', label: 'Запланированные' },
                      { id: 'published', label: 'Опубликованные' },
                      { id: 'archived', label: 'Архив' },
                    ].map((filter) => <Button key={filter.id} variant={activeFilter === filter.id ? 'contained' : 'outlined'} onClick={() => { setActiveFilter(filter.id); setMobileFiltersOpen(false); }} sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none' }}>{filter.label}</Button>)}
                  </Stack>
                </Box>
              ) : null}

              <Divider />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <FormControl fullWidth>
                  <InputLabel id="feed-mobile-category-label">Категория</InputLabel>
                  <Select labelId="feed-mobile-category-label" label="Категория" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    <MenuItem value="">Все категории</MenuItem>
                    {categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel id="feed-mobile-tag-label">Тег</InputLabel>
                  <Select labelId="feed-mobile-tag-label" label="Тег" value={tag} onChange={(event) => setTag(event.target.value)}>
                    <MenuItem value="">Все теги</MenuItem>
                    {tags.map((item) => <MenuItem key={item.id || item.slug} value={item.slug || item.name}>{item.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button fullWidth color="inherit" onClick={() => { setQuery(''); setCategoryId(''); setTag(''); setActiveFilter('all'); }}>Сбросить</Button>
                <Button fullWidth variant="contained" onClick={() => setMobileFiltersOpen(false)}>Показать</Button>
              </Stack>
            </Stack>
          </Box>
        </Drawer>
      </PageShell>

      <FeedComposerDialog
        open={composerOpen}
        post={editingPost}
        recipients={recipients}
        user={user}
        onClose={closeComposer}
        onSaved={handleSaved}
        notifyError={notifyApiError}
      />
      <FeedShareDialog
        open={Boolean(sharePost)}
        post={sharePost}
        url={shareUrl}
        onClose={() => setSharePost(null)}
        notifySuccess={(message) => notifySuccess(message, { source: 'feed-share' })}
        notifyWarning={(message) => notifyWarning(message, { source: 'feed-share' })}
      />
      <FeedReactionsDialog
        key={`${reactionsView?.post?.id || 'closed'}-${reactionsView?.reactionType || 'all'}`}
        open={Boolean(reactionsView?.post)}
        post={reactionsView?.post || null}
        initialReaction={reactionsView?.reactionType || ''}
        onClose={() => setReactionsView(null)}
        notifyError={notifyApiError}
      />
      <Dialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Категории ленты</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField autoFocus fullWidth label="Новая категория" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} inputProps={{ maxLength: 80 }} />
              <Button variant="contained" onClick={createCategory} disabled={categoryName.trim().length < 2} sx={{ minHeight: 56, textTransform: 'none' }}>Добавить</Button>
            </Stack>
            {(categories || []).map((category) => (
              <Stack key={category.id} direction="row" alignItems="center" spacing={1} sx={{ minHeight: 44 }}>
                <Typography sx={{ flex: 1 }}>{category.name}</Typography>
                <Button onClick={() => renameCategory(category)} sx={{ textTransform: 'none' }}>Переименовать</Button>
                <Button color="error" onClick={() => deactivateCategory(category)} sx={{ textTransform: 'none' }}>Скрыть</Button>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setCategoryDialogOpen(false)}>Закрыть</Button></DialogActions>
      </Dialog>
      <Dialog open={Boolean(analyticsPost)} onClose={() => setAnalyticsPost(null)} fullWidth maxWidth="sm">
        <DialogTitle>Статистика публикации</DialogTitle>
        <DialogContent dividers>
          {analyticsLoading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress /></Stack> : analytics?.summary ? (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                {[
                  ['Аудитория', analytics.summary.recipients_total],
                  ['Прочитали', analytics.summary.seen_total],
                  ['Подтвердили', analytics.summary.ack_total],
                  ['Комментарии', analytics.summary.comments_total],
                  ['Участники опроса', analytics.summary.poll_total_voters],
                  ['Голоса в опросе', analytics.summary.poll_total_votes],
                ].map(([label, value]) => <Paper key={label} elevation={0} sx={{ p: 1.5, bgcolor: ui.panelBg, borderRadius: '12px' }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography sx={{ fontSize: '1.35rem', fontWeight: 800 }}>{Number(value || 0)}</Typography></Paper>)}
              </Box>
              <Typography sx={{ fontWeight: 800 }}>Реакции</Typography>
              <Typography color="text.secondary">{Object.entries(analytics.summary.reaction_counts || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Реакций пока нет'}</Typography>
              <Typography sx={{ fontWeight: 800 }}>Получатели</Typography>
              <Stack spacing={0.75}>{(analytics.items || []).map((item) => <Stack key={item.user_id} direction="row" spacing={1}><Typography sx={{ flex: 1 }}>{item.full_name || item.username}</Typography><Typography variant="caption" color="text.secondary">{item.is_seen ? 'Прочитано' : 'Не прочитано'}{item.is_acknowledged ? ' · подтверждено' : ''}</Typography></Stack>)}</Stack>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setAnalyticsPost(null)}>Закрыть</Button></DialogActions>
      </Dialog>
    </MainLayout>
  );
}
