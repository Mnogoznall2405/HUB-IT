import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { hubAnnouncementsAPI } from '../../api/hubAnnouncements';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { formatFeedDate, getFeedInitials } from './feedUtils';

const REACTIONS = [
  { id: 'like', emoji: '👍', label: 'Нравится' },
  { id: 'love', emoji: '❤', label: 'Любовь' },
  { id: 'laugh', emoji: '😂', label: 'Смех' },
  { id: 'wow', emoji: '😮', label: 'Удивление' },
  { id: 'sad', emoji: '😢', label: 'Грусть' },
  { id: 'angry', emoji: '😡', label: 'Возмущение' },
];

const mergeById = (current, incoming) => {
  const incomingMap = new Map(incoming.map((item) => [String(item.id), item]));
  const merged = current.map((item) => (
    incomingMap.has(String(item.id)) ? { ...item, ...incomingMap.get(String(item.id)) } : item
  ));
  const known = new Set(merged.map((item) => String(item.id)));
  incoming.forEach((item) => { if (!known.has(String(item.id))) merged.push(item); });
  return merged;
};

export default function FeedCommentsPanel({ post, user, composerInputRef, onCountChange, notifyError }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(Number(post?.comments_count || 0));
  const [nextOffset, setNextOffset] = useState(null);
  const [sort, setSort] = useState('interesting');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editId, setEditId] = useState('');
  const [editBody, setEditBody] = useState('');
  const [replies, setReplies] = useState({});
  const [expandedRoots, setExpandedRoots] = useState(new Set());
  const [busyReaction, setBusyReaction] = useState('');

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerInputRef?.current?.focus?.({ preventScroll: true });
    });
  }, [composerInputRef]);

  const loadComments = useCallback(async ({ background = false, append = false } = {}) => {
    if (!post?.id) return;
    if (!background && !append) setLoading(true);
    try {
      const offset = append ? items.length : 0;
      const payload = await hubAnnouncementsAPI.getComments(post.id, { limit: 20, offset, sort });
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems((current) => (append ? mergeById(current, nextItems) : background ? mergeById(current, nextItems) : nextItems));
      setTotal(Number(payload?.total ?? nextItems.length));
      setNextOffset(payload?.next_offset ?? null);
      onCountChange?.(post.id, Number(payload?.comments_total ?? post?.comments_count ?? payload?.total ?? 0));
    } catch (error) {
      if (!background) notifyError?.(error, 'Не удалось загрузить комментарии.');
    } finally {
      if (!background && !append) setLoading(false);
    }
  }, [items.length, notifyError, onCountChange, post?.comments_count, post?.id, sort]);

  const loadReplies = useCallback(async (rootId, { background = false } = {}) => {
    if (!post?.id || !rootId) return;
    try {
      const payload = await hubAnnouncementsAPI.getComments(post.id, {
        root_comment_id: rootId, limit: 100, sort: 'oldest',
      });
      const next = Array.isArray(payload?.items) ? payload.items : [];
      setReplies((current) => ({
        ...current,
        [rootId]: background ? mergeById(current[rootId] || [], next) : next,
      }));
    } catch (error) {
      if (!background) notifyError?.(error, 'Не удалось загрузить ответы.');
    }
  }, [notifyError, post?.id]);

  useEffect(() => {
    setItems([]);
    setReplies({});
    setExpandedRoots(new Set());
    setReplyingTo(null);
    setBody('');
    setFiles([]);
    void loadComments();
  }, [post?.id, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!post?.id) return undefined;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadComments({ background: true });
      expandedRoots.forEach((rootId) => void loadReplies(rootId, { background: true }));
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [expandedRoots, loadComments, loadReplies, post?.id]);

  useEffect(() => {
    if (loading || !window.location.hash.startsWith('#feed-comment-')) return;
    const targetId = decodeURIComponent(window.location.hash.replace('#feed-comment-', ''));
    const direct = document.getElementById(`feed-comment-${targetId}`);
    if (direct) {
      direct.scrollIntoView({ block: 'center', behavior: 'auto' });
      direct.focus({ preventScroll: true });
      return;
    }
    const rootsWithReplies = items.filter((item) => Number(item.reply_count || 0) > 0);
    Promise.all(rootsWithReplies.map((root) => hubAnnouncementsAPI.getComments(post.id, {
      root_comment_id: root.id, limit: 100, sort: 'oldest',
    }).then((payload) => [root.id, payload?.items || []])))
      .then((entries) => {
        const targetEntry = entries.find(([, children]) => children.some((child) => String(child.id) === targetId));
        if (!targetEntry) return;
        const [rootId, children] = targetEntry;
        setReplies((current) => ({ ...current, [rootId]: children }));
        setExpandedRoots((current) => new Set(current).add(rootId));
        window.requestAnimationFrame(() => {
          const element = document.getElementById(`feed-comment-${targetId}`);
          element?.scrollIntoView({ block: 'center', behavior: 'auto' });
          element?.focus({ preventScroll: true });
        });
      })
      .catch(() => undefined);
  }, [items, loading, post?.id]);

  const cancelReply = () => {
    setReplyingTo(null);
    setBody('');
    setFiles([]);
  };

  const startReply = (comment) => {
    setReplyingTo(comment);
    setBody(`@${comment.username || comment.full_name || 'user'}, `);
    focusComposer();
  };

  const submitComment = async () => {
    const text = body.trim();
    if ((!text && !files.length) || !post?.id || saving) return;
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      body: text,
      username: user?.username,
      full_name: user?.full_name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      can_edit: false,
      can_delete: false,
      pending: true,
      attachments: [],
      reaction_counts: {},
    };
    const rootId = replyingTo?.root_comment_id || replyingTo?.id || '';
    if (rootId) setReplies((current) => ({ ...current, [rootId]: [...(current[rootId] || []), optimistic] }));
    else setItems((current) => [...current, optimistic]);
    setSaving(true);
    try {
      const created = await hubAnnouncementsAPI.createComment(post.id, {
        body: text,
        parentCommentId: replyingTo?.id || '',
        mentionedUserIds: replyingTo?.user_id ? [replyingTo.user_id] : [],
        files,
      });
      if (rootId) {
        setReplies((current) => ({
          ...current,
          [rootId]: (current[rootId] || []).map((item) => (item.id === tempId ? created : item)),
        }));
        setItems((current) => current.map((item) => (
          String(item.id) === String(rootId) ? { ...item, reply_count: Number(item.reply_count || 0) + 1 } : item
        )));
        setExpandedRoots((current) => new Set(current).add(rootId));
      } else {
        setItems((current) => current.map((item) => (item.id === tempId ? created : item)));
      }
      const nextCount = Number(post?.comments_count || 0) + 1;
      onCountChange?.(post.id, nextCount);
      setTotal((current) => current + (rootId ? 0 : 1));
      cancelReply();
      focusComposer();
    } catch (error) {
      if (rootId) setReplies((current) => ({ ...current, [rootId]: (current[rootId] || []).filter((item) => item.id !== tempId) }));
      else setItems((current) => current.filter((item) => item.id !== tempId));
      notifyError?.(error, 'Не удалось отправить комментарий.');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    const text = editBody.trim();
    if (!text || !editId || saving) return;
    setSaving(true);
    try {
      const updated = await hubAnnouncementsAPI.updateComment(post.id, editId, text);
      const patchList = (list) => list.map((item) => (String(item.id) === String(editId) ? { ...item, ...updated } : item));
      setItems(patchList);
      setReplies((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, patchList(value)])));
      setEditId('');
      setEditBody('');
    } catch (error) {
      notifyError?.(error, 'Не удалось сохранить комментарий.');
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (comment) => {
    if (!window.confirm('Удалить комментарий? Ответы останутся в обсуждении.')) return;
    try {
      await hubAnnouncementsAPI.deleteComment(post.id, comment.id);
      const tombstone = (list) => list.map((item) => (
        String(item.id) === String(comment.id)
          ? { ...item, body: 'Комментарий удалён', is_deleted: true, can_edit: false, can_delete: false }
          : item
      ));
      setItems(tombstone);
      setReplies((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, tombstone(value)])));
    } catch (error) {
      notifyError?.(error, 'Не удалось удалить комментарий.');
    }
  };

  const react = async (comment, reactionType) => {
    if (busyReaction) return;
    const key = `${comment.id}:${reactionType}`;
    setBusyReaction(key);
    const nextType = comment.viewer_reaction === reactionType ? null : reactionType;
    try {
      const result = await hubAnnouncementsAPI.setCommentReaction(post.id, comment.id, nextType);
      const patchList = (list) => list.map((item) => (String(item.id) === String(comment.id) ? { ...item, ...result } : item));
      setItems(patchList);
      setReplies((current) => Object.fromEntries(Object.entries(current).map(([rootId, value]) => [rootId, patchList(value)])));
    } catch (error) {
      notifyError?.(error, 'Не удалось изменить реакцию.');
    } finally {
      setBusyReaction('');
    }
  };

  const renderComment = (comment, { reply = false } = {}) => {
    const counts = comment.reaction_counts || {};
    return (
      <Stack
        key={comment.id}
        component="article"
        id={`feed-comment-${comment.id}`}
        tabIndex={-1}
        direction="row"
        spacing={1.1}
        alignItems="flex-start"
        sx={{
          px: { xs: 1.25, sm: 2 },
          py: 1.25,
          ml: reply ? { xs: 2, sm: 5 } : 0,
          borderInlineStart: reply ? `2px solid ${alpha(theme.palette.primary.main, 0.2)}` : 0,
          scrollMarginBlock: { xs: '140px', sm: '80px' },
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
        }}
      >
        <Avatar sx={{ width: reply ? 32 : 36, height: reply ? 32 : 36, fontSize: 11, bgcolor: 'action.selected', color: 'text.primary' }}>
          {getFeedInitials(comment.full_name || comment.username)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="baseline" useFlexGap flexWrap="wrap">
            <Typography variant="body2" sx={{ fontWeight: 800 }}>{comment.full_name || comment.username || 'Пользователь'}</Typography>
            {comment.reply_to_username ? <Typography variant="caption" color="primary.main">ответил @{comment.reply_to_username}</Typography> : null}
            <Typography variant="caption" color="text.secondary">
              {comment.pending ? 'Отправка…' : formatFeedDate(comment.created_at)}{comment.updated_at !== comment.created_at ? ' · изменено' : ''}
            </Typography>
          </Stack>
          {editId === comment.id ? (
            <Stack spacing={1} sx={{ mt: 0.75 }}>
              <TextField autoFocus label="Комментарий" value={editBody} onChange={(event) => setEditBody(event.target.value)} multiline minRows={2} inputProps={{ maxLength: 4000 }} />
              <Stack direction="row" spacing={1}><Button onClick={saveEdit}>Сохранить</Button><Button color="inherit" onClick={() => setEditId('')}>Отменить</Button></Stack>
            </Stack>
          ) : <Typography color={comment.is_deleted ? 'text.secondary' : 'text.primary'} sx={{ mt: 0.3, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 1.5, fontStyle: comment.is_deleted ? 'italic' : 'normal' }}>{comment.body}</Typography>}
          {comment.attachments?.length ? (
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
              {comment.attachments.map((attachment) => <Button key={attachment.id} size="small" component="a" target="_blank" rel="noreferrer" href={hubAnnouncementsAPI.buildCommentAttachmentUrl(post.id, comment.id, attachment.id)} startIcon={<AttachFileRoundedIcon />} sx={{ textTransform: 'none' }}>{attachment.file_name}</Button>)}
            </Stack>
          ) : null}
          {!comment.pending && !comment.is_deleted ? (
            <Stack direction="row" spacing={0.4} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mt: 0.45 }}>
              <Button size="small" color="inherit" onClick={() => startReply(comment)} startIcon={<ReplyRoundedIcon />} sx={{ minHeight: 34, textTransform: 'none', color: 'text.secondary' }}>Ответить</Button>
              {REACTIONS.map((reaction) => {
                const count = Number(counts[reaction.id] || 0);
                if (!count && comment.viewer_reaction !== reaction.id) return null;
                return <Button key={reaction.id} size="small" aria-label={`${reaction.label}: ${count}`} aria-pressed={comment.viewer_reaction === reaction.id} onClick={() => react(comment, reaction.id)} disabled={busyReaction === `${comment.id}:${reaction.id}`} sx={{ minWidth: 36, minHeight: 34, px: 0.65, borderRadius: '999px', bgcolor: comment.viewer_reaction === reaction.id ? alpha(theme.palette.primary.main, 0.14) : 'transparent' }}>{reaction.emoji}{count ? ` ${count}` : ''}</Button>;
              })}
              {!comment.viewer_reaction ? <Select size="small" value="" displayEmpty aria-label="Добавить реакцию" onChange={(event) => react(comment, event.target.value)} sx={{ minWidth: 48, height: 34, borderRadius: '999px', '& .MuiSelect-select': { py: 0.5, px: 1 } }}><MenuItem value="" disabled>＋</MenuItem>{REACTIONS.map((reaction) => <MenuItem key={reaction.id} value={reaction.id}>{reaction.emoji} {reaction.label}</MenuItem>)}</Select> : null}
            </Stack>
          ) : null}
        </Box>
        {!comment.pending && editId !== comment.id ? <Stack direction="row" spacing={0.1} sx={{ flexShrink: 0 }}>{comment.can_edit ? <Tooltip title="Редактировать"><IconButton aria-label="Редактировать комментарий" size="small" onClick={() => { setEditId(comment.id); setEditBody(comment.body || ''); }}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip> : null}{comment.can_delete ? <Tooltip title="Удалить"><IconButton aria-label="Удалить комментарий" size="small" onClick={() => deleteComment(comment)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip> : null}</Stack> : null}
      </Stack>
    );
  };

  const composer = post?.comments_enabled !== false ? (
    <Box sx={{
      position: { xs: 'sticky', sm: 'static' },
      bottom: { xs: 'var(--app-shell-mobile-bottom-nav-height, 64px)', sm: 'auto' },
      zIndex: 4,
      borderTop: '1px solid',
      borderColor: alpha(theme.palette.text.primary, 0.08),
      bgcolor: ui.panelSolid,
      p: { xs: 1.25, sm: 2 },
      pb: { xs: 'max(10px, env(safe-area-inset-bottom))', sm: 2 },
      boxShadow: { xs: `0 -8px 24px ${alpha(theme.palette.common.black, ui.isDark ? 0.22 : 0.08)}`, sm: 'none' },
    }}>
      <Stack direction="row" alignItems="center" sx={{ minHeight: 32, mb: 0.5, pl: { xs: 0, sm: 5.5 }, visibility: replyingTo ? 'visible' : 'hidden' }} aria-hidden={!replyingTo}>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>Ответ для {replyingTo?.full_name || replyingTo?.username || 'пользователя'}</Typography>
        <IconButton aria-label="Отменить ответ" size="small" tabIndex={replyingTo ? 0 : -1} onClick={cancelReply} sx={{ width: 32, height: 32 }}><CloseRoundedIcon fontSize="small" /></IconButton>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <Avatar sx={{ display: { xs: 'none', sm: 'flex' }, width: 38, height: 38, mb: 0.35, bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.22 : 0.11), color: 'primary.main', fontSize: 12, fontWeight: 800 }}>{getFeedInitials(user?.full_name || user?.username)}</Avatar>
        <TextField inputRef={composerInputRef} placeholder={replyingTo ? 'Напишите ответ…' : 'Напишите комментарий…'} value={body} onChange={(event) => setBody(event.target.value)} multiline minRows={1} maxRows={6} fullWidth inputProps={{ maxLength: 4000, 'aria-label': replyingTo ? 'Написать ответ' : 'Написать комментарий' }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void submitComment(); }} sx={{ '& .MuiOutlinedInput-root': { minHeight: 44, borderRadius: '12px', bgcolor: ui.panelBg } }} />
        <input ref={fileInputRef} hidden type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt,.zip" onChange={(event) => setFiles(Array.from(event.target.files || []))} />
        <Tooltip title="Прикрепить файлы"><IconButton aria-label="Прикрепить файлы" onClick={() => fileInputRef.current?.click()} sx={{ width: 44, height: 44 }}><AttachFileRoundedIcon /></IconButton></Tooltip>
        <IconButton aria-label="Отправить комментарий" color="primary" onClick={submitComment} disabled={(!body.trim() && !files.length) || saving} sx={{ width: 44, height: 44 }}>{saving ? <CircularProgress size={20} /> : <SendRoundedIcon />}</IconButton>
      </Stack>
      {files.length ? <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.75, pl: { xs: 0, sm: 5.5 } }}>{files.map((file) => <Button key={`${file.name}-${file.size}`} size="small" color="inherit" endIcon={<CloseRoundedIcon />} onClick={() => setFiles((current) => current.filter((item) => item !== file))} sx={{ textTransform: 'none' }}>{file.name}</Button>)}</Stack> : null}
    </Box>
  ) : <Typography color="text.secondary" sx={{ p: 2, borderTop: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.08) }}>Автор отключил комментарии к этой публикации.</Typography>;

  return (
    <Paper component="section" id="feed-comments" aria-labelledby="feed-comments-title" aria-busy={loading} elevation={0} sx={{ borderRadius: { xs: 0, sm: '14px' }, bgcolor: ui.panelSolid, boxShadow: 'none', border: 0, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 1.75, sm: 2.25 }, py: 1.5 }}>
        <Typography id="feed-comments-title" component="h2" sx={{ fontSize: '1.05rem', fontWeight: 800, flex: 1 }}>Комментарии{Number(post?.comments_count || 0) > 0 ? ` · ${post.comments_count}` : ''}</Typography>
        <Select size="small" value={sort} onChange={(event) => setSort(event.target.value)} inputProps={{ 'aria-label': 'Сортировка комментариев' }} sx={{ height: 38, borderRadius: '10px', fontSize: '0.86rem' }}><MenuItem value="interesting">Интересные</MenuItem><MenuItem value="newest">Новые</MenuItem><MenuItem value="oldest">Старые</MenuItem></Select>
      </Stack>
      <Box aria-live="polite" sx={{ borderTop: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.08) }}>
        {loading ? <Stack spacing={2} sx={{ p: 2 }}>{[0, 1].map((index) => <Stack key={index} direction="row" spacing={1}><Skeleton variant="circular" width={36} height={36} /><Box sx={{ flex: 1 }}><Skeleton width="35%" /><Skeleton width={index ? '60%' : '78%'} /></Box></Stack>)}</Stack> : items.length ? <>{items.map((comment) => <Box key={comment.id}>{renderComment(comment)}{Number(comment.reply_count || 0) > 0 && !expandedRoots.has(comment.id) ? <Button onClick={() => { setExpandedRoots((current) => new Set(current).add(comment.id)); void loadReplies(comment.id); }} sx={{ ml: { xs: 5.5, sm: 8 }, mb: 0.75, minHeight: 36, textTransform: 'none' }}>Показать ответы · {comment.reply_count}</Button> : null}{expandedRoots.has(comment.id) ? (replies[comment.id] || []).map((reply) => renderComment(reply, { reply: true })) : null}</Box>)}{nextOffset !== null ? <Button fullWidth onClick={() => loadComments({ append: true })} sx={{ minHeight: 44, textTransform: 'none' }}>Показать ещё</Button> : null}</> : <Box sx={{ p: 4, textAlign: 'center' }}><Typography sx={{ fontWeight: 800 }}>Комментариев пока нет</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Начните обсуждение этой публикации.</Typography></Box>}
      </Box>
      {composer}
    </Paper>
  );
}
