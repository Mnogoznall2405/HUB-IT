import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Card,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded';
import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded';
import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import MarkdownRenderer from '../hub/MarkdownRenderer';
import FeedPoll from './FeedPoll';
import { FEED_REACTIONS, getFeedReaction, getFeedReactionGroups } from './feedReactions';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { formatFeedDate, getFeedInitials, stripFeedMarkdown } from './feedUtils';

const priorityMeta = (priority) => {
  if (priority === 'high') return { label: 'Важное', tone: 'warning.main' };
  if (priority === 'low') return { label: 'Информация', tone: 'text.secondary' };
  return null;
};

const isImageAttachment = (attachment) => {
  const mime = String(attachment?.file_mime || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(String(attachment?.file_name || '').trim());
};

const MOBILE_VISIBLE_REACTIONS = 3;
const DESKTOP_VISIBLE_REACTIONS = 5;

export default function FeedPostCard({
  post,
  coverUrl = '',
  initialExpanded = false,
  detailView = false,
  onOpen,
  onExpanded,
  onLike,
  onReaction,
  onOpenReactions,
  onBookmark,
  onComments,
  onShare,
  onAcknowledge,
  onEdit,
  onArchive,
  onDelete,
  onAnalytics,
  onPollVote,
  buildAttachmentUrl,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [expanded, setExpanded] = useState(Boolean(initialExpanded));
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [reactionAnchor, setReactionAnchor] = useState(null);
  const [failedMediaIds, setFailedMediaIds] = useState(() => new Set());
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const initialExpansionReportedRef = useRef(false);
  const previewText = String(post?.preview || stripFeedMarkdown(post?.body) || '').trim();
  const hasFullBody = Boolean(String(post?.body || '').trim());
  const canExpand = hasFullBody || previewText.length > 180;
  const priority = priorityMeta(String(post?.priority || '').toLowerCase());
  const attachments = Array.isArray(post?.attachments) ? post.attachments : [];
  const coverId = String(post?.cover_attachment?.id || '');
  const otherAttachments = attachments.filter((item) => !isImageAttachment(item));
  const reactionGroups = getFeedReactionGroups(post?.reaction_counts);
  const viewerReaction = getFeedReaction(post?.viewer_reaction);
  const commentsCount = Math.max(0, Number(post?.comments_count || 0));
  const contentExpanded = detailView || expanded;
  const authorName = post?.author_full_name || post?.author_username || 'Автор публикации';
  const authorHandle = post?.author_username ? `@${String(post.author_username).replace(/^@/, '')}` : '';
  const publishedAt = formatFeedDate(post?.updated_at || post?.published_at);
  const galleryItems = useMemo(() => {
    const images = attachments.filter(isImageAttachment);
    const ordered = [
      ...images.filter((item) => String(item?.id || '') === coverId),
      ...images.filter((item) => String(item?.id || '') !== coverId),
    ];
    const resolved = ordered.map((item) => ({
      ...item,
      key: String(item?.id || item?.file_name || ''),
      url: buildAttachmentUrl?.(post?.id, item?.id) || '',
    })).filter((item) => item.key && item.url);

    if (coverUrl && !resolved.some((item) => item.key === coverId || item.url === coverUrl)) {
      resolved.unshift({
        ...(post?.cover_attachment || {}),
        key: coverId || `cover-${post?.id || ''}`,
        url: coverUrl,
      });
    }
    return resolved;
  }, [attachments, buildAttachmentUrl, coverId, coverUrl, post?.cover_attachment, post?.id]);
  const visibleGalleryItems = galleryItems.filter((item) => !failedMediaIds.has(item.key));
  const activeMedia = visibleGalleryItems[activeMediaIndex] || null;

  useEffect(() => {
    setFailedMediaIds(new Set());
    setActiveMediaIndex(0);
  }, [coverUrl, post?.id]);

  useEffect(() => {
    if (activeMediaIndex >= visibleGalleryItems.length) {
      setActiveMediaIndex(Math.max(0, visibleGalleryItems.length - 1));
    }
  }, [activeMediaIndex, visibleGalleryItems.length]);

  useEffect(() => {
    if (!initialExpanded) {
      initialExpansionReportedRef.current = false;
      return;
    }
    setExpanded(true);
    if (!initialExpansionReportedRef.current) {
      initialExpansionReportedRef.current = true;
      onExpanded?.(post);
    }
  }, [initialExpanded, onExpanded, post]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onExpanded?.(post);
  };

  const menuAction = (callback) => {
    setMenuAnchor(null);
    callback?.(post);
  };

  const openPost = () => {
    if (!detailView) onOpen?.(post);
  };

  const handleCardClick = (event) => {
    if (detailView || !onOpen) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, textarea, select, [role="menuitem"]')) return;
    onOpen(post);
  };

  const actionButtonSx = {
    minWidth: 0,
    minHeight: { xs: 44, sm: 36 },
    px: { xs: 0.75, sm: 0.5 },
    borderRadius: '8px',
    color: 'text.secondary',
    fontSize: '0.84rem',
    fontWeight: 650,
    fontVariantNumeric: 'tabular-nums',
    textTransform: 'none',
    '& .MuiButton-startIcon': { m: 0, mr: 0.55 },
    '@media (prefers-reduced-motion: no-preference)': {
      transition: 'color 120ms ease-out, background-color 120ms ease-out, transform 120ms ease-out',
      '&:active': { transform: 'scale(0.96)' },
    },
  };

  const headerMeta = [
    authorHandle && authorHandle !== `@${authorName}` ? authorHandle : '',
    priority?.label || '',
    post?.is_pinned_active ? 'Закреплено' : '',
  ].filter(Boolean);

  const showPreviousMedia = () => {
    setActiveMediaIndex((current) => (current - 1 + visibleGalleryItems.length) % visibleGalleryItems.length);
  };

  const showNextMedia = () => {
    setActiveMediaIndex((current) => (current + 1) % visibleGalleryItems.length);
  };

  return (
    <Card
      component="article"
      id={`feed-post-${post?.id}`}
      aria-labelledby={`feed-post-title-${post?.id}`}
      onClick={handleCardClick}
      elevation={0}
      sx={{
        borderRadius: { xs: 0, sm: '14px' },
        border: 0,
        bgcolor: ui.panelSolid,
        boxShadow: 'none',
        overflow: 'hidden',
        cursor: detailView || !onOpen ? 'default' : 'pointer',
        transition: 'background-color 140ms ease-out',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
        <Avatar
          sx={{
            width: 44,
            height: 44,
            bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.24 : 0.12),
            color: 'primary.main',
            border: '2px solid',
            borderColor: alpha(theme.palette.primary.main, ui.isDark ? 0.48 : 0.26),
            boxShadow: `0 0 0 2px ${ui.panelSolid}`,
            fontSize: 13,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {getFeedInitials(authorName)}
        </Avatar>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={0.65}>
            <Typography noWrap sx={{ minWidth: 0, fontSize: '0.95rem', fontWeight: 800, lineHeight: 1.25 }}>
              {authorName}
            </Typography>
            {post?.is_unread ? (
              <Box
                component="span"
                title="Новая публикация"
                sx={{ width: 7, height: 7, flexShrink: 0, borderRadius: '50%', bgcolor: 'primary.main' }}
              />
            ) : null}
          </Stack>
          <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0, mt: 0.2 }}>
            {post?.is_pinned_active ? <PushPinOutlinedIcon sx={{ flexShrink: 0, fontSize: 13, color: 'text.secondary' }} /> : null}
            <Typography
              noWrap
              color="text.secondary"
              sx={{ minWidth: 0, fontSize: '0.78rem', lineHeight: 1.3 }}
            >
              {headerMeta.length ? headerMeta.join(' · ') : 'Новости компании'}
            </Typography>
          </Stack>
        </Box>

        {post?.can_manage ? (
          <>
            <Tooltip title="Действия с публикацией">
              <IconButton
                aria-label="Действия с публикацией"
                onClick={(event) => setMenuAnchor(event.currentTarget)}
                size="small"
                sx={{ width: 40, height: 40, color: 'text.secondary', mr: -0.75 }}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              {onEdit ? <MenuItem onClick={() => menuAction(onEdit)}>Редактировать</MenuItem> : null}
              {onAnalytics ? <MenuItem onClick={() => menuAction(onAnalytics)}>Статистика</MenuItem> : null}
              {onArchive ? <MenuItem onClick={() => menuAction(onArchive)}>Снять с публикации</MenuItem> : null}
              {onDelete ? <MenuItem onClick={() => menuAction(onDelete)} sx={{ color: 'error.main' }}>Удалить</MenuItem> : null}
            </Menu>
          </>
        ) : null}
      </Stack>

      {activeMedia ? (
        <Box
          sx={{
            position: 'relative',
            bgcolor: '#101114',
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={activeMedia.url}
            alt={visibleGalleryItems.length > 1
              ? `Иллюстрация ${activeMediaIndex + 1} из ${visibleGalleryItems.length} к публикации «${post?.title || ''}»`
              : `Иллюстрация к публикации «${post?.title || ''}»`}
            loading="lazy"
            onError={() => setFailedMediaIds((current) => new Set([...current, activeMedia.key]))}
            sx={{
              display: 'block',
              width: '100%',
              maxHeight: { xs: 560, sm: 680 },
              minHeight: { xs: 210, sm: 280 },
              objectFit: 'cover',
              bgcolor: ui.panelInset,
            }}
          />
          {visibleGalleryItems.length > 1 ? (
            <>
              <Typography
                component="span"
                aria-live="polite"
                sx={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  px: 0.9,
                  py: 0.35,
                  borderRadius: '999px',
                  bgcolor: 'rgba(15,17,20,0.72)',
                  color: '#fff',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  backdropFilter: 'blur(6px)',
                }}
              >
                {activeMediaIndex + 1}/{visibleGalleryItems.length}
              </Typography>
              <IconButton
                aria-label="Предыдущее изображение"
                onClick={showPreviousMedia}
                sx={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 40,
                  height: 40,
                  bgcolor: 'rgba(15,17,20,0.56)',
                  color: '#fff',
                  '&:hover': { bgcolor: 'rgba(15,17,20,0.76)' },
                }}
              >
                <ChevronLeftRoundedIcon />
              </IconButton>
              <IconButton
                aria-label="Следующее изображение"
                onClick={showNextMedia}
                sx={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 40,
                  height: 40,
                  bgcolor: 'rgba(15,17,20,0.56)',
                  color: '#fff',
                  '&:hover': { bgcolor: 'rgba(15,17,20,0.76)' },
                }}
              >
                <ChevronRightRoundedIcon />
              </IconButton>
            </>
          ) : null}
        </Box>
      ) : null}

      <Box sx={{ px: { xs: 1.5, sm: 2 }, pt: activeMedia ? 1.5 : 0.25, pb: 1.15 }}>
        <Typography
          component="h2"
          id={`feed-post-title-${post?.id}`}
          sx={{ m: 0, fontSize: { xs: '1rem', sm: '1.02rem' }, fontWeight: 800, lineHeight: 1.4, textWrap: 'pretty' }}
        >
          <Box
            component={detailView || !onOpen ? 'span' : 'button'}
            type={detailView || !onOpen ? undefined : 'button'}
            data-feed-post-open={detailView || !onOpen ? undefined : String(post?.id || '')}
            onClick={detailView || !onOpen ? undefined : openPost}
            sx={{
              display: 'inline',
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              color: 'inherit',
              font: 'inherit',
              textAlign: 'inherit',
              cursor: detailView || !onOpen ? 'inherit' : 'pointer',
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: '3px',
                borderRadius: '3px',
              },
            }}
          >
            {post?.title || 'Публикация'}
          </Box>
        </Typography>

        {contentExpanded && hasFullBody ? (
          <Box
            sx={{
              mt: 0.65,
              maxWidth: '70ch',
              fontSize: { xs: '0.95rem', sm: '0.97rem' },
              lineHeight: 1.5,
              overflowWrap: 'break-word',
              '& > :first-of-type': { mt: 0 },
              '& > :last-child': { mb: 0 },
              '& p': { my: 0.75 },
            }}
          >
            <MarkdownRenderer value={post.body} />
          </Box>
        ) : previewText ? (
          <Typography
            sx={{
              mt: 0.65,
              fontSize: { xs: '0.95rem', sm: '0.97rem' },
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              display: contentExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp: contentExpanded ? 'unset' : 3,
              WebkitBoxOrient: contentExpanded ? 'unset' : 'vertical',
              overflow: contentExpanded ? 'visible' : 'hidden',
            }}
          >
            {previewText}
          </Typography>
        ) : null}

        {canExpand && !detailView ? (
          <Button
            onClick={toggleExpanded}
            size="small"
            color="inherit"
            sx={{
              mt: 0.15,
              p: 0,
              minWidth: 0,
              minHeight: 30,
              color: 'text.secondary',
              fontWeight: 600,
              fontSize: '0.9rem',
              textTransform: 'none',
              '&:hover': { bgcolor: 'transparent', color: 'primary.main' },
            }}
          >
            {expanded ? 'Свернуть' : 'Показать ещё'}
          </Button>
        ) : null}

        {contentExpanded && otherAttachments.length > 0 ? (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
            {otherAttachments.map((attachment) => (
              <Button
                key={attachment.id}
                component="a"
                href={buildAttachmentUrl?.(post.id, attachment.id)}
                target="_blank"
                rel="noreferrer"
                variant="outlined"
                size="small"
                startIcon={<AttachFileOutlinedIcon />}
                sx={{ borderRadius: '10px', textTransform: 'none' }}
              >
                {attachment.file_name || 'Открыть файл'}
              </Button>
            ))}
          </Stack>
        ) : null}

        {post?.poll ? <FeedPoll poll={post.poll} preview={!onPollVote} onVote={(optionIds) => onPollVote?.(post, optionIds)} /> : null}

        {post?.is_ack_pending ? (
          <Button
            variant="outlined"
            color="success"
            startIcon={<TaskAltOutlinedIcon />}
            onClick={() => onAcknowledge?.(post)}
            sx={{ mt: 1, minHeight: 40, borderRadius: '10px', textTransform: 'none', fontWeight: 700 }}
          >
            Подтвердить ознакомление
          </Button>
        ) : null}

        {post?.category || post?.tags?.length ? (
          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
            {post?.category ? <Typography component="span" sx={{ px: 1, py: 0.35, borderRadius: '999px', bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', fontSize: '0.76rem', fontWeight: 700 }}>{post.category.name}</Typography> : null}
            {(post?.tags || []).map((tag) => <Typography key={tag.id || tag.slug} component="span" color="text.secondary" sx={{ fontSize: '0.78rem' }}>#{tag.name}</Typography>)}
          </Stack>
        ) : null}

        {reactionGroups.length || onReaction ? (
          <>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.5}
              useFlexGap
              flexWrap="nowrap"
              aria-label="Реакции на публикацию"
              sx={{ mt: 0.75, minWidth: 0, overflow: 'hidden' }}
            >
              {reactionGroups.map((reaction, index) => {
                const selected = viewerReaction?.id === reaction.id;
                const canReact = Boolean(onReaction);
                const accessibleAction = canReact
                  ? `${selected ? 'Снять' : 'Поставить'} реакцию «${reaction.label}». Сейчас: ${reaction.count}`
                  : `${reaction.label}: ${reaction.count}. Показать сотрудников`;
                return (
                  <Button
                    key={reaction.id}
                    color="inherit"
                    size="small"
                    aria-label={accessibleAction}
                    aria-pressed={canReact ? selected : undefined}
                    title={selected ? `${reaction.label} — ваша реакция` : reaction.label}
                    onClick={() => (canReact
                      ? onReaction(post, selected ? null : reaction.id)
                      : onOpenReactions?.(post, reaction.id))}
                    sx={{
                      display: {
                        xs: index < MOBILE_VISIBLE_REACTIONS ? 'inline-flex' : 'none',
                        sm: index < DESKTOP_VISIBLE_REACTIONS ? 'inline-flex' : 'none',
                      },
                      flex: '0 0 auto',
                      minWidth: { xs: 44, sm: 36 },
                      minHeight: { xs: 40, sm: 32 },
                      px: 0.8,
                      gap: 0.45,
                      borderRadius: '999px',
                      border: '1px solid',
                      borderColor: selected ? alpha(theme.palette.primary.main, 0.5) : 'transparent',
                      color: selected ? 'primary.main' : 'text.secondary',
                      bgcolor: selected
                        ? alpha(theme.palette.primary.main, ui.isDark ? 0.22 : 0.13)
                        : alpha(theme.palette.text.primary, ui.isDark ? 0.07 : 0.05),
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      textTransform: 'none',
                      '&:hover': {
                        borderColor: alpha(theme.palette.primary.main, 0.42),
                        bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.2 : 0.11),
                        color: 'primary.main',
                      },
                      '@media (prefers-reduced-motion: no-preference)': {
                        transition: 'color 120ms ease-out, background-color 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out',
                        '&:active': { transform: 'scale(0.96)' },
                      },
                    }}
                  >
                    <Box component="span" aria-hidden="true" sx={{ fontSize: 17, lineHeight: 1 }}>{reaction.emoji}</Box>
                    {reaction.count}
                  </Button>
                );
              })}

              {reactionGroups.length > MOBILE_VISIBLE_REACTIONS && onOpenReactions ? (
                <Button
                  color="inherit"
                  size="small"
                  aria-label={`Показать ещё ${reactionGroups.length - MOBILE_VISIBLE_REACTIONS} вида реакций`}
                  onClick={() => onOpenReactions(post, '')}
                  sx={{ display: { xs: 'inline-flex', sm: 'none' }, flex: '0 0 auto', minWidth: 44, minHeight: 40, px: 0.75, borderRadius: '999px', color: 'text.secondary', bgcolor: alpha(theme.palette.text.primary, ui.isDark ? 0.07 : 0.05), fontWeight: 700, textTransform: 'none' }}
                >
                  +{reactionGroups.length - MOBILE_VISIBLE_REACTIONS}
                </Button>
              ) : null}
              {reactionGroups.length > DESKTOP_VISIBLE_REACTIONS && onOpenReactions ? (
                <Button
                  color="inherit"
                  size="small"
                  aria-label={`Показать ещё ${reactionGroups.length - DESKTOP_VISIBLE_REACTIONS} вид реакций`}
                  onClick={() => onOpenReactions(post, '')}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' }, flex: '0 0 auto', minWidth: 36, minHeight: 32, px: 0.75, borderRadius: '999px', color: 'text.secondary', bgcolor: alpha(theme.palette.text.primary, ui.isDark ? 0.07 : 0.05), fontWeight: 700, textTransform: 'none' }}
                >
                  +{reactionGroups.length - DESKTOP_VISIBLE_REACTIONS}
                </Button>
              ) : null}

              {onReaction ? (
                <Tooltip title="Добавить реакцию">
                  <IconButton
                    aria-label="Выбрать другую реакцию"
                    aria-haspopup="menu"
                    aria-expanded={Boolean(reactionAnchor)}
                    onClick={(event) => setReactionAnchor(event.currentTarget)}
                    sx={{ flex: '0 0 auto', width: { xs: 40, sm: 32 }, height: { xs: 40, sm: 32 }, color: 'text.secondary', bgcolor: alpha(theme.palette.text.primary, ui.isDark ? 0.07 : 0.05), '&:hover': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.2 : 0.11) } }}
                  >
                    <AddReactionOutlinedIcon aria-hidden="true" sx={{ fontSize: 19 }} />
                  </IconButton>
                </Tooltip>
              ) : null}

              {reactionGroups.length && onOpenReactions ? (
                <Tooltip title="Кто отреагировал">
                  <IconButton
                    aria-label="Показать всех отреагировавших сотрудников"
                    onClick={() => onOpenReactions(post, '')}
                    sx={{ flex: '0 0 auto', width: { xs: 40, sm: 32 }, height: { xs: 40, sm: 32 }, color: 'text.secondary', '&:hover': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.16 : 0.08) } }}
                  >
                    <PeopleAltOutlinedIcon aria-hidden="true" sx={{ fontSize: 19 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>

            <Menu
              anchorEl={reactionAnchor}
              open={Boolean(reactionAnchor)}
              onClose={() => setReactionAnchor(null)}
              MenuListProps={{ 'aria-label': 'Выбор реакции на публикацию' }}
            >
              {FEED_REACTIONS.map((reaction) => (
                <MenuItem
                  key={reaction.id}
                  selected={post?.viewer_reaction === reaction.id}
                  onClick={() => {
                    setReactionAnchor(null);
                    onReaction?.(post, post?.viewer_reaction === reaction.id ? null : reaction.id);
                  }}
                >
                  <Box component="span" aria-hidden="true" sx={{ mr: 1, fontSize: 20 }}>{reaction.emoji}</Box>
                  {reaction.label}
                  {Number(post?.reaction_counts?.[reaction.id] || 0) ? ` · ${post.reaction_counts[reaction.id]}` : ''}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : null}

        <Stack
          direction="row"
          alignItems="center"
          spacing={{ xs: 1, sm: 1.5 }}
          sx={{ mt: 0.9, minHeight: 40 }}
        >
          {!onReaction && onLike ? (
            <Button
              aria-label={post?.viewer_has_liked ? 'Убрать отметку «Нравится»' : 'Поставить отметку «Нравится»'}
              aria-pressed={Boolean(post?.viewer_has_liked)}
              color="inherit"
              onClick={() => onLike(post)}
              sx={{
                ...actionButtonSx,
                color: post?.viewer_has_liked ? 'primary.main' : 'text.secondary',
                '&:hover': { color: 'error.main', bgcolor: alpha(theme.palette.error.main, ui.isDark ? 0.14 : 0.08) },
              }}
            >
              <FavoriteBorderRoundedIcon aria-hidden="true" sx={{ fontSize: '21px !important' }} />
            </Button>
          ) : null}
          <Button
            aria-label="Открыть комментарии"
            color="inherit"
            startIcon={<ChatBubbleOutlineRoundedIcon sx={{ fontSize: '20px !important' }} />}
            onClick={() => onComments?.(post)}
            sx={{
              ...actionButtonSx,
              '&:hover': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.14 : 0.08) },
            }}
          >
            {commentsCount > 0 ? commentsCount : null}
          </Button>
          <Tooltip title="Поделиться">
            <Button
              aria-label="Поделиться публикацией"
              color="inherit"
              startIcon={<ReplyRoundedIcon sx={{ fontSize: '22px !important', transform: 'scaleX(-1)' }} />}
              onClick={() => onShare?.(post)}
              sx={{
                ...actionButtonSx,
                '& .MuiButton-startIcon': { m: 0 },
                '&:hover': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.14 : 0.08) },
              }}
            />
          </Tooltip>
          {onBookmark ? <Tooltip title={post?.viewer_bookmarked ? 'Убрать из сохранённых' : 'Сохранить'}><IconButton aria-label={post?.viewer_bookmarked ? 'Убрать из сохранённых' : 'Сохранить публикацию'} aria-pressed={Boolean(post?.viewer_bookmarked)} onClick={() => onBookmark(post)} sx={{ width: 40, height: 40, color: post?.viewer_bookmarked ? 'primary.main' : 'text.secondary' }}>{post?.viewer_bookmarked ? <BookmarkRoundedIcon /> : <BookmarkBorderRoundedIcon />}</IconButton></Tooltip> : null}
          <Typography
            color="text.secondary"
            sx={{ ml: 'auto !important', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            {publishedAt}
          </Typography>
        </Stack>
      </Box>
    </Card>
  );
}
