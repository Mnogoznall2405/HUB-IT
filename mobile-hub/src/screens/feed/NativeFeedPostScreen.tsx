import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { formatApiError } from '../../api/formatError';
import {
  acknowledgeFeedPost,
  createFeedComment,
  deleteFeedComment,
  deleteFeedPost,
  getFeedAnalytics,
  getFeedPost,
  listFeedReactionUsers,
  listFeedComments,
  markFeedPostRead,
  removeFeedReaction,
  setFeedBookmark,
  setFeedCommentReaction,
  setFeedReaction,
  updateFeedComment,
  voteFeedPoll,
  type FeedAnalyticsResponse,
  type FeedReactionUser,
} from '../../api/feedApi';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { usePreferences } from '../../preferences/PreferencesContext';
import {
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
  AccountStatusText,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';
import { useFluentTokens } from '../../theme/fluentTokens';
import { FeedPostCard } from '../../feed/FeedPostCard';
import { FeedCommentCard } from '../../feed/FeedCommentCard';
import {
  downloadNativeFeedAttachment,
  openNativeFeedFile,
  pickNativeFeedFiles,
} from '../../feed/nativeFeedFiles';
import {
  FEED_COMMENT_PAGE_SIZE,
  FEED_REACTIONS,
  buildFeedPostPath,
  getFeedInitials,
  getFeedReaction,
  type FeedAttachment,
  type FeedComment,
  type FeedPost,
  type FeedReactionId,
} from '../../feed/feedFormat';
import type { FeedUploadFile } from '../../api/feedApi';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { createFeedClientRequestId } from '../../feed/feedRequestId';

type NativeFeedPostSnapshot = {
  post: FeedPost;
  comments: FeedComment[];
  commentsTotal: number;
  commentsNextOffset: number | null;
  commentsSort: 'interesting' | 'newest' | 'oldest';
  replies: Record<string, FeedComment[]>;
};

export function NativeFeedPostScreen() {
  const params = useLocalSearchParams<{ postId?: string | string[] }>();
  const postId = String(Array.isArray(params.postId) ? params.postId[0] : params.postId || '').trim();
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const bottomInset = useNativeBottomNavInset();
  const allowed = hasPermission('dashboard.read');
  const canWrite = hasPermission('announcements.write');
  const canModerate = hasPermission('announcements.moderate');
  const canManage = canWrite || canModerate;

  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsNextOffset, setCommentsNextOffset] = useState<number | null>(null);
  const [commentsSort, setCommentsSort] = useState<'interesting' | 'newest' | 'oldest'>('interesting');
  const [replies, setReplies] = useState<Record<string, FeedComment[]>>({});
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set());
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentFiles, setCommentFiles] = useState<FeedUploadFile[]>([]);
  const [replyingTo, setReplyingTo] = useState<FeedComment | null>(null);
  const [editingCommentId, setEditingCommentId] = useState('');
  const [editingCommentText, setEditingCommentText] = useState('');
  const [busyCommentId, setBusyCommentId] = useState('');
  const [commentReactionPickerId, setCommentReactionPickerId] = useState('');
  const [openingAttachmentId, setOpeningAttachmentId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionDetailsOpen, setReactionDetailsOpen] = useState(false);
  const [activeReactionFilter, setActiveReactionFilter] = useState('');
  const [reactionUsers, setReactionUsers] = useState<FeedReactionUser[]>([]);
  const [reactionUsersNextOffset, setReactionUsersNextOffset] = useState<number | null>(null);
  const [reactionUsersLoading, setReactionUsersLoading] = useState(false);
  const [reactionUsersError, setReactionUsersError] = useState('');
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analytics, setAnalytics] = useState<FeedAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [pollDraftOptionIds, setPollDraftOptionIds] = useState<string[]>([]);
  const [pollVoting, setPollVoting] = useState(false);
  const commentRequestRef = useRef<{ fingerprint: string; id: string } | null>(null);

  const reactionTotal = Object.values(post?.reaction_counts || {})
    .reduce((sum, count) => sum + Math.max(0, Number(count || 0)), 0);
  const pollCanVote = !offlineMode && post?.status === 'published' && !post?.poll?.is_closed;

  useAndroidBackHandler(() => {
    goBackOrReplace('/(shell)/feed');
    return true;
  });

  const loadContent = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setCommentsLoading(true);
    setError('');
    const cached = user?.id
      ? await readNativeEntitySnapshot<NativeFeedPostSnapshot>(
        'feed-post-details',
        user.id,
        postId,
      )
      : null;
    if (cached) {
      setPost(cached.data.post);
      setComments(cached.data.comments || []);
      setCommentsTotal(cached.data.commentsTotal || 0);
      setCommentsNextOffset(cached.data.commentsNextOffset ?? null);
      setReplies(cached.data.replies || {});
      setLoading(false);
      setCommentsLoading(false);
    }
    if (offlineMode) {
      if (!cached) {
        setPost(null);
        setComments([]);
        setCommentsTotal(0);
        setCommentsNextOffset(null);
        setReplies({});
        setError('Нет подключения и сохранённой публикации. Откройте её один раз при наличии сети.');
      }
      setLoading(false);
      setCommentsLoading(false);
      return;
    }
    try {
      const [next, commentsPayload] = await Promise.all([
        getFeedPost(postId),
        listFeedComments(postId, {
          limit: FEED_COMMENT_PAGE_SIZE,
          offset: 0,
          sort: commentsSort,
        }),
      ]);
      setPost(next);
      setComments(commentsPayload.items);
      setCommentsTotal(commentsPayload.comments_total ?? commentsPayload.total);
      setCommentsNextOffset(commentsPayload.next_offset ?? null);
      setReplies({});
      setExpandedRoots(new Set());
      void markFeedPostRead(postId)
        .then((updated) => {
          if (updated) setPost((current) => (current ? { ...current, ...updated, is_unread: false } : updated));
          else setPost((current) => (current ? { ...current, is_unread: false } : current));
        })
        .catch(() => undefined);
    } catch (cause) {
      setError(formatApiError(cause, cached
        ? 'Показана сохранённая публикация. Не удалось получить обновления.'
        : 'Не удалось открыть публикацию.'));
      if (!cached) setPost(null);
    } finally {
      setLoading(false);
      setCommentsLoading(false);
    }
  }, [commentsSort, offlineMode, postId, user?.id]);

  useEffect(() => {
    if (allowed && postId) void loadContent();
  }, [allowed, loadContent, postId]);

  useEffect(() => {
    if (!user?.id || !post || loading || commentsLoading || offlineMode) return;
    void writeNativeEntitySnapshot<NativeFeedPostSnapshot>('feed-post-details', user.id, postId, {
      post,
      comments,
      commentsTotal,
      commentsNextOffset,
      commentsSort,
      replies,
    });
  }, [comments, commentsLoading, commentsNextOffset, commentsSort, commentsTotal, loading, offlineMode, post, postId, replies, user?.id]);

  useEffect(() => {
    if (reactionTotal <= 0) setReactionDetailsOpen(false);
    if (activeReactionFilter && Number(post?.reaction_counts?.[activeReactionFilter] || 0) <= 0) {
      setActiveReactionFilter('');
    }
  }, [activeReactionFilter, post?.reaction_counts, reactionTotal]);

  useEffect(() => {
    setPollDraftOptionIds((post?.poll?.viewer_option_ids || []).map(String));
  }, [post?.id, post?.poll?.viewer_option_ids]);

  useEffect(() => {
    if (!reactionDetailsOpen || !post?.id || offlineMode) return;
    let active = true;
    setReactionUsersLoading(true);
    setReactionUsersError('');
    void listFeedReactionUsers(post.id, activeReactionFilter, { limit: 30, offset: 0 })
      .then((payload) => {
        if (active) {
          setReactionUsers(payload.items);
          setReactionUsersNextOffset(payload.next_offset ?? null);
        }
      })
      .catch((cause) => {
        if (active) {
          setReactionUsers([]);
          setReactionUsersError(formatApiError(cause, 'Не удалось загрузить список реакций.'));
        }
      })
      .finally(() => {
        if (active) setReactionUsersLoading(false);
      });
    return () => { active = false; };
  }, [activeReactionFilter, offlineMode, post?.id, post?.viewer_reaction, reactionDetailsOpen]);

  useEffect(() => {
    if (!analyticsOpen || !post?.id || !canManage || post.can_manage === false || offlineMode) return;
    let active = true;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    void getFeedAnalytics(post.id, { limit: 30, offset: 0 })
      .then((payload) => {
        if (active) setAnalytics(payload);
      })
      .catch((cause) => {
        if (active) {
          setAnalytics(null);
          setAnalyticsError(formatApiError(cause, 'Не удалось загрузить статистику публикации.'));
        }
      })
      .finally(() => {
        if (active) setAnalyticsLoading(false);
      });
    return () => { active = false; };
  }, [analyticsOpen, canManage, offlineMode, post?.can_manage, post?.id]);

  const loadMoreReactionUsers = useCallback(async () => {
    if (!post?.id || reactionUsersLoading || reactionUsersNextOffset == null || offlineMode) return;
    setReactionUsersLoading(true);
    try {
      const payload = await listFeedReactionUsers(post.id, activeReactionFilter, {
        limit: 30,
        offset: reactionUsersNextOffset,
      });
      setReactionUsers((current) => {
        const known = new Set(current.map((item) => `${item.user_id}:${item.reaction_type}`));
        return [...current, ...payload.items.filter((item) => !known.has(`${item.user_id}:${item.reaction_type}`))];
      });
      setReactionUsersNextOffset(payload.next_offset ?? null);
    } catch (cause) {
      setReactionUsersError(formatApiError(cause, 'Не удалось загрузить следующую страницу реакций.'));
    } finally {
      setReactionUsersLoading(false);
    }
  }, [activeReactionFilter, offlineMode, post?.id, reactionUsersLoading, reactionUsersNextOffset]);

  const loadMoreAnalytics = useCallback(async () => {
    if (!post?.id || analyticsLoading || analytics?.next_offset == null || offlineMode) return;
    setAnalyticsLoading(true);
    try {
      const payload = await getFeedAnalytics(post.id, { limit: 30, offset: analytics.next_offset });
      setAnalytics((current) => current ? {
        ...payload,
        summary: current.summary,
        items: [...current.items, ...payload.items.filter((item) => !current.items.some((known) => known.user_id === item.user_id))],
      } : payload);
    } catch (cause) {
      setAnalyticsError(formatApiError(cause, 'Не удалось загрузить следующую страницу статистики.'));
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analytics?.next_offset, analyticsLoading, offlineMode, post?.id]);

  const loadMoreComments = useCallback(async () => {
    if (!postId || commentsLoading || commentsNextOffset == null || offlineMode) return;
    setCommentsLoading(true);
    try {
      const payload = await listFeedComments(postId, {
        limit: FEED_COMMENT_PAGE_SIZE,
        offset: commentsNextOffset,
        sort: commentsSort,
      });
      setComments((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...payload.items.filter((item) => !known.has(item.id))];
      });
      setCommentsTotal(payload.comments_total ?? commentsTotal);
      setCommentsNextOffset(payload.next_offset ?? null);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить следующую страницу комментариев.'));
    } finally {
      setCommentsLoading(false);
    }
  }, [commentsLoading, commentsNextOffset, commentsSort, commentsTotal, offlineMode, postId]);

  const loadReplies = useCallback(async (rootCommentId: string) => {
    if (!postId || loadingReplies.has(rootCommentId)) return;
    setExpandedRoots((current) => new Set(current).add(rootCommentId));
    if (Object.prototype.hasOwnProperty.call(replies, rootCommentId) || offlineMode) return;
    setLoadingReplies((current) => new Set(current).add(rootCommentId));
    try {
      const payload = await listFeedComments(postId, {
        limit: 100,
        offset: 0,
        sort: 'oldest',
        rootCommentId,
      });
      setReplies((current) => ({ ...current, [rootCommentId]: payload.items }));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить ответы.'));
    } finally {
      setLoadingReplies((current) => {
        const next = new Set(current);
        next.delete(rootCommentId);
        return next;
      });
    }
  }, [loadingReplies, offlineMode, postId, replies]);

  const patchComment = useCallback((commentId: string, patch: Partial<FeedComment>) => {
    const patchItems = (items: FeedComment[]) => items.map((item) => (
      item.id === commentId ? { ...item, ...patch } : item
    ));
    setComments(patchItems);
    setReplies((current) => Object.fromEntries(
      Object.entries(current).map(([rootId, items]) => [rootId, patchItems(items)]),
    ));
  }, []);

  const handleReaction = useCallback(async (reactionType: FeedReactionId) => {
    if (!post || offlineMode) return;
    setReactionPickerOpen(false);
    try {
      if (post.viewer_reaction === reactionType) {
        await removeFeedReaction(post.id);
        const counts = { ...(post.reaction_counts || {}) };
        counts[reactionType] = Math.max(0, Number(counts[reactionType] || 1) - 1);
        setPost({ ...post, viewer_reaction: null, reaction_counts: counts });
      } else {
        await setFeedReaction(post.id, reactionType);
        const counts = { ...(post.reaction_counts || {}) };
        if (post.viewer_reaction) {
          const prev = String(post.viewer_reaction);
          counts[prev] = Math.max(0, Number(counts[prev] || 1) - 1);
        }
        counts[reactionType] = Number(counts[reactionType] || 0) + 1;
        setPost({ ...post, viewer_reaction: reactionType, reaction_counts: counts });
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось обновить реакцию.'));
    }
  }, [offlineMode, post]);

  const handleBookmark = useCallback(async () => {
    if (!post || offlineMode) return;
    const next = !post.viewer_bookmarked;
    try {
      await setFeedBookmark(post.id, next);
      setPost({ ...post, viewer_bookmarked: next });
      setMessage(next ? 'Публикация сохранена' : 'Убрано из сохранённых');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить публикацию.'));
    }
  }, [offlineMode, post]);

  const handleAcknowledge = useCallback(async () => {
    if (!post || offlineMode) return;
    try {
      const updated = await acknowledgeFeedPost(post.id);
      setPost((current) => ({ ...(current || post), ...(updated || {}), is_ack_pending: false }));
      setMessage('Прочтение подтверждено');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось подтвердить прочтение.'));
    }
  }, [offlineMode, post]);

  const handleShare = useCallback(async () => {
    if (!post) return;
    const url = `${HUB_WEB_ORIGIN}${buildFeedPostPath(post.id)}`;
    try {
      await Share.share({
        title: String(post.title || 'Публикация HUB-IT'),
        message: `${post.title || 'Публикация HUB-IT'}\n${url}`,
        url,
      });
    } catch (cause) {
      try {
        await Clipboard.setStringAsync(url);
        setMessage('Системное меню недоступно — ссылка скопирована');
      } catch {
        setError(formatApiError(cause, 'Не удалось поделиться публикацией.'));
      }
    }
  }, [post]);

  const submitPollVote = useCallback(async (optionIds: string[]) => {
    if (!post?.poll || offlineMode) return;
    setPollVoting(true);
    try {
      const updated = await voteFeedPoll(post.id, optionIds);
      if (updated) setPost(updated);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить голос.'));
    } finally {
      setPollVoting(false);
    }
  }, [offlineMode, post]);

  const handleVote = useCallback((optionId: string) => {
    if (!post?.poll || !pollCanVote || pollVoting) return;
    if (!Boolean(post.poll.multiple ?? post.poll.allows_multiple)) {
      void submitPollVote([optionId]);
      return;
    }
    setPollDraftOptionIds((current) => (
      current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
    ));
  }, [pollCanVote, pollVoting, post?.poll, submitPollVote]);

  const handleDeletePost = useCallback(() => {
    if (!post?.id || !canModerate || offlineMode) return;
    Alert.alert('Удалить публикацию навсегда?', 'Публикация, комментарии и вложения будут удалены без возможности восстановления.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          void deleteFeedPost(post.id)
            .then(() => goBackOrReplace('/(shell)/feed'))
            .catch((cause) => setError(formatApiError(cause, 'Не удалось удалить публикацию.')));
        },
      },
    ]);
  }, [canModerate, offlineMode, post?.id]);

  const handleSendComment = useCallback(async () => {
    const body = commentText.trim();
    if (!postId || (!body && commentFiles.length === 0) || sending || offlineMode) return;
    setSending(true);
    setError('');
    try {
      const fingerprint = JSON.stringify({
        body,
        parentCommentId: replyingTo?.id || '',
        mentionedUserIds: replyingTo?.user_id ? [replyingTo.user_id] : [],
        files: commentFiles.map((file) => ({
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          uploadId: file.uploadId || '',
        })),
      });
      if (commentRequestRef.current?.fingerprint !== fingerprint) {
        commentRequestRef.current = { fingerprint, id: createFeedClientRequestId() };
      }
      const created = await createFeedComment(postId, {
        body,
        parentCommentId: replyingTo?.id || '',
        mentionedUserIds: replyingTo?.user_id ? [replyingTo.user_id] : [],
        files: commentFiles,
        clientRequestId: commentRequestRef.current.id,
      });
      commentRequestRef.current = null;
      const rootId = String(replyingTo?.root_comment_id || replyingTo?.id || '').trim();
      if (rootId) {
        if (Object.prototype.hasOwnProperty.call(replies, rootId)) {
          setReplies((current) => ({ ...current, [rootId]: [...(current[rootId] || []), created] }));
        } else {
          void loadReplies(rootId);
        }
        setComments((current) => current.map((item) => (
          item.id === rootId
            ? { ...item, reply_count: Number(item.reply_count || 0) + 1, replies_count: Number(item.reply_count || 0) + 1 }
            : item
        )));
        setExpandedRoots((current) => new Set(current).add(rootId));
      } else {
        setComments((current) => (commentsSort === 'oldest' ? [...current, created] : [created, ...current]));
      }
      setCommentsTotal((value) => value + 1);
      setPost((current) => (current ? { ...current, comments_count: Number(current.comments_count || 0) + 1 } : current));
      setCommentText('');
      setCommentFiles([]);
      setReplyingTo(null);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить комментарий.'));
    } finally {
      setSending(false);
    }
  }, [commentFiles, commentText, commentsSort, loadReplies, offlineMode, postId, replies, replyingTo, sending]);

  const startReply = useCallback((comment: FeedComment) => {
    setReplyingTo(comment);
    const username = String(comment.username || comment.author_username || '').trim();
    setCommentText(username ? `@${username}, ` : '');
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
    setCommentText('');
    setCommentFiles([]);
  }, []);

  const saveCommentEdit = useCallback(async () => {
    const body = editingCommentText.trim();
    if (!postId || !editingCommentId || !body || busyCommentId || offlineMode) return;
    setBusyCommentId(editingCommentId);
    try {
      const updated = await updateFeedComment(postId, editingCommentId, body);
      patchComment(editingCommentId, {
        body: updated.body,
        updated_at: updated.updated_at,
        can_edit: updated.can_edit,
        can_delete: updated.can_delete,
      });
      setEditingCommentId('');
      setEditingCommentText('');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить комментарий.'));
    } finally {
      setBusyCommentId('');
    }
  }, [busyCommentId, editingCommentId, editingCommentText, offlineMode, patchComment, postId]);

  const confirmDeleteComment = useCallback((comment: FeedComment) => {
    if (offlineMode) return;
    Alert.alert(
      'Удалить комментарий?',
      'Ответы останутся в обсуждении.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            setBusyCommentId(comment.id);
            void deleteFeedComment(postId, comment.id)
              .then(() => {
                patchComment(comment.id, {
                  body: 'Комментарий удалён',
                  is_deleted: true,
                  can_edit: false,
                  can_delete: false,
                  attachments: [],
                });
              })
              .catch((cause) => {
                setError(formatApiError(cause, 'Не удалось удалить комментарий.'));
              })
              .finally(() => setBusyCommentId(''));
          },
        },
      ],
    );
  }, [offlineMode, patchComment, postId]);

  const handleCommentReaction = useCallback(async (comment: FeedComment, reactionType: FeedReactionId) => {
    if (!postId || busyCommentId || offlineMode) return;
    setBusyCommentId(comment.id);
    setCommentReactionPickerId('');
    try {
      const updated = await setFeedCommentReaction(
        postId,
        comment.id,
        comment.viewer_reaction === reactionType ? null : reactionType,
      );
      patchComment(comment.id, updated);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось изменить реакцию на комментарий.'));
    } finally {
      setBusyCommentId('');
    }
  }, [busyCommentId, offlineMode, patchComment, postId]);

  const handlePickFiles = useCallback(async () => {
    if (offlineMode) return;
    try {
      const picked = await pickNativeFeedFiles();
      setCommentFiles((current) => {
        const known = new Set(current.map((item) => item.uri));
        return [...current, ...picked.filter((item) => !known.has(item.uri))];
      });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выбрать вложение.'));
    }
  }, [offlineMode]);

  const handleOpenAttachment = useCallback(async (
    attachment: FeedAttachment,
    commentId?: string,
  ) => {
    const attachmentId = String(attachment.id || '').trim();
    if (!postId || !attachmentId || openingAttachmentId) return;
    setOpeningAttachmentId(attachmentId);
    try {
      const file = await downloadNativeFeedAttachment(postId, attachment, commentId);
      await openNativeFeedFile(file, attachment.file_mime);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть вложение.'));
    } finally {
      setOpeningAttachmentId('');
    }
  }, [openingAttachmentId, postId]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Публикация" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/feed')}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нет права читать ленту.">
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  if (!postId) {
    return (
      <AccountScreenScaffold title="Публикация" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/feed')}>
        <AccountStatusText tokens={tokens} error="Не указан идентификатор публикации." />
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title={post?.title || 'Публикация'}
      tokens={tokens}
      scroll={false}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else goBackOrReplace('/(shell)/feed');
      }}
      rightAction={(
        <View style={styles.headerActions}>
          {canManage && post?.can_manage && !offlineMode ? (
            <>
              <Pressable
                testID="feed-analytics-toggle"
                onPress={() => setAnalyticsOpen((value) => !value)}
                accessibilityRole="button"
                accessibilityLabel={analyticsOpen ? 'Скрыть статистику публикации' : 'Показать статистику публикации'}
                accessibilityState={{ expanded: analyticsOpen }}
                style={styles.headerAction}
              >
                <MaterialCommunityIcons name="chart-box-outline" size={20} color={tokens.primary} />
              </Pressable>
              <Pressable
                testID="feed-edit"
                onPress={() => router.push({ pathname: '/(shell)/feed/editor', params: { postId } } as never)}
                accessibilityRole="button"
                accessibilityLabel="Редактировать публикацию"
                style={styles.headerAction}
              >
                <MaterialCommunityIcons name="pencil-outline" size={20} color={tokens.primary} />
              </Pressable>
            </>
          ) : null}
          {canModerate && post && !offlineMode ? (
            <Pressable
              testID="feed-delete"
              onPress={handleDeletePost}
              accessibilityRole="button"
              accessibilityLabel="Удалить публикацию навсегда"
              style={styles.headerAction}
            >
              <MaterialCommunityIcons name="delete-outline" size={20} color={tokens.error} />
            </Pressable>
          ) : null}
          <Pressable
            testID="feed-share"
            onPress={() => { void handleShare(); }}
            accessibilityRole="button"
            accessibilityLabel="Поделиться публикацией"
            style={styles.headerAction}
          >
            <MaterialCommunityIcons name="share-variant" size={20} color={tokens.primary} />
          </Pressable>
        </View>
      )}
    >
      {loading && !post ? (
        <AccountLoading tokens={tokens} />
      ) : !post ? (
        <AccountStatusText tokens={tokens} error={error || 'Публикация не найдена.'} />
      ) : (
        <View style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={{ gap: 12, paddingBottom: bottomInset + 88 }}
            keyboardShouldPersistTaps="handled"
          >
            <AccountStatusText tokens={tokens} error={error} message={message} />
            {offlineMode ? (
              <Text accessibilityRole="alert" style={{ color: tokens.warning }}>
                Автономная копия: сетевые действия отключены.
              </Text>
            ) : null}
            {analyticsOpen ? (
              <AccountSectionCard tokens={tokens} title="Статистика публикации">
                {analyticsLoading ? (
                  <ActivityIndicator accessibilityLabel="Загрузка статистики публикации" color={tokens.primary} />
                ) : analyticsError ? (
                  <Text accessibilityRole="alert" style={{ color: tokens.error }}>{analyticsError}</Text>
                ) : analytics ? (
                  <View style={styles.analyticsContent}>
                    <View style={styles.analyticsGrid}>
                      {([
                        ['Аудитория', analytics.summary.recipients_total],
                        ['Прочитали', analytics.summary.seen_total],
                        ['Подтвердили', analytics.summary.ack_total],
                        ['Ожидают подтверждения', analytics.summary.pending_ack_total],
                        ['Комментарии', analytics.summary.comments_total],
                        ['Участники опроса', analytics.summary.poll_total_voters],
                        ['Голоса в опросе', analytics.summary.poll_total_votes],
                      ] as Array<[string, number | undefined]>).map(([label, value]) => (
                        <View key={label} style={[styles.analyticsMetric, { backgroundColor: tokens.panelMuted }]}>
                          <Text style={{ color: tokens.textSecondary, fontSize: 11 }}>{label}</Text>
                          <Text style={{ color: tokens.textPrimary, fontSize: 20, fontWeight: '800' }}>{Number(value || 0)}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={[styles.sectionLabel, { color: tokens.textPrimary }]}>Реакции</Text>
                    <Text style={{ color: tokens.textSecondary }}>
                      {Object.entries(analytics.summary.reaction_counts || {}).map(([reactionId, count]) => {
                        const reaction = getFeedReaction(reactionId);
                        return `${reaction?.emoji || reactionId} ${count}`;
                      }).join('   ') || 'Реакций пока нет.'}
                    </Text>
                    <Text style={[styles.sectionLabel, { color: tokens.textPrimary }]}>Получатели</Text>
                    {analytics.items.map((item) => (
                      <View key={item.user_id} style={[styles.analyticsRecipient, { borderColor: tokens.borderSoft }]}>
                        <Text numberOfLines={1} style={{ color: tokens.textPrimary, flex: 1, fontWeight: '700' }}>
                          {item.full_name || item.username || `Сотрудник #${item.user_id}`}
                        </Text>
                        <Text style={{ color: tokens.textSecondary, fontSize: 11 }}>
                          {item.is_seen ? 'Прочитано' : 'Не прочитано'}
                          {item.is_acknowledged ? ' · подтверждено' : ''}
                        </Text>
                      </View>
                    ))}
                    {analytics.next_offset != null ? (
                      <Pressable
                        testID="feed-analytics-load-more"
                        accessibilityRole="button"
                        onPress={() => { void loadMoreAnalytics(); }}
                        style={[styles.detailsToggle, { borderColor: tokens.borderSoft }]}
                      >
                        <Text style={{ color: tokens.primary, fontWeight: '800' }}>Показать ещё получателей</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </AccountSectionCard>
            ) : null}
            <FeedPostCard
              post={post}
              tokens={tokens}
              detailView
              onToggleReaction={offlineMode ? undefined : () => setReactionPickerOpen((value) => !value)}
              onBookmark={offlineMode ? undefined : () => { void handleBookmark(); }}
              onAcknowledge={offlineMode ? undefined : () => { void handleAcknowledge(); }}
            />

            {reactionPickerOpen ? (
              <View style={[styles.reactionPicker, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                {FEED_REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction.id}
                    testID={`feed-reaction-${reaction.id}`}
                    onPress={() => { void handleReaction(reaction.id); }}
                    style={styles.reactionItem}
                    accessibilityRole="button"
                    accessibilityLabel={reaction.label}
                  >
                    <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {post.poll?.options?.length ? (
              <View style={[styles.pollCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <Text style={[styles.pollTitle, { color: tokens.textPrimary }]}>
                  {post.poll.question || 'Опрос'}
                </Text>
                {(post.poll.options || []).map((option) => {
                  const optionId = String(option.id || '');
                  const selected = pollDraftOptionIds.includes(optionId);
                  const votes = Math.max(0, Number(option.votes_count || 0));
                  const totalVoters = Math.max(0, Number(post.poll?.total_voters || 0));
                  const percentage = totalVoters > 0 ? Math.round((votes / totalVoters) * 100) : 0;
                  return (
                    <Pressable
                      key={optionId}
                      testID={`feed-poll-option-${optionId}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${option.text || 'Вариант'}: ${votes} голосов, ${percentage}%`}
                      accessibilityState={{ selected, disabled: !pollCanVote || pollVoting }}
                      disabled={!pollCanVote || pollVoting}
                      onPress={() => { void handleVote(optionId); }}
                      style={[
                        styles.pollOption,
                        {
                          borderColor: selected ? tokens.primary : tokens.borderSoft,
                          backgroundColor: selected ? tokens.accentSoft : tokens.panelMuted,
                        },
                      ]}
                    >
                      <View style={styles.pollOptionContent}>
                        <View style={styles.pollOptionHeading}>
                          <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>{option.text || 'Вариант'}</Text>
                          <Text style={{ color: tokens.textSecondary, fontWeight: '700' }}>{percentage}% · {votes}</Text>
                        </View>
                        <View style={[styles.pollProgressTrack, { backgroundColor: tokens.borderSoft }]}>
                          <View style={[styles.pollProgressFill, { backgroundColor: tokens.primary, width: `${Math.min(100, percentage)}%` }]} />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
                {Boolean(post.poll.multiple ?? post.poll.allows_multiple) && pollCanVote ? (
                  <Pressable
                    testID="feed-poll-submit"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: pollVoting }}
                    disabled={pollVoting}
                    onPress={() => { void submitPollVote(pollDraftOptionIds); }}
                    style={[styles.pollSubmit, { backgroundColor: tokens.primary }]}
                  >
                    {pollVoting ? <ActivityIndicator color="#fff" /> : <Text style={styles.pollSubmitText}>Сохранить выбор</Text>}
                  </Pressable>
                ) : null}
                <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
                  {Number(post.poll.total_voters || 0)} участников{post.poll.is_closed ? ' · опрос завершён' : ''}
                </Text>
              </View>
            ) : null}

            {reactionTotal > 0 ? (
              <Pressable
                testID="feed-reaction-details-toggle"
                accessibilityRole="button"
                accessibilityLabel={reactionDetailsOpen ? 'Скрыть список реакций' : `Показать список реакций: ${reactionTotal}`}
                accessibilityState={{ expanded: reactionDetailsOpen }}
                onPress={() => setReactionDetailsOpen((value) => !value)}
                style={[styles.detailsToggle, { borderColor: tokens.borderSoft }]}
              >
                <MaterialCommunityIcons name="account-multiple-outline" size={19} color={tokens.primary} />
                <Text style={{ color: tokens.primary, fontWeight: '800' }}>Кто отреагировал · {reactionTotal}</Text>
              </Pressable>
            ) : null}

            {reactionDetailsOpen ? (
              <AccountSectionCard tokens={tokens} title="Реакции">
                <View accessibilityRole="radiogroup" accessibilityLabel="Фильтр списка реакций" style={styles.reactionFilters}>
                  <Pressable
                    testID="feed-reaction-filter-all"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: !activeReactionFilter }}
                    onPress={() => setActiveReactionFilter('')}
                    style={[styles.reactionFilter, { backgroundColor: !activeReactionFilter ? tokens.accentSoft : tokens.panelMuted }]}
                  >
                    <Text style={{ color: !activeReactionFilter ? tokens.primary : tokens.textSecondary, fontWeight: '800' }}>Все · {reactionTotal}</Text>
                  </Pressable>
                  {FEED_REACTIONS.filter((reaction) => Number(post.reaction_counts?.[reaction.id] || 0) > 0).map((reaction) => (
                    <Pressable
                      key={reaction.id}
                      testID={`feed-reaction-filter-${reaction.id}`}
                      accessibilityRole="radio"
                      accessibilityLabel={`${reaction.label}: ${Number(post.reaction_counts?.[reaction.id] || 0)}`}
                      accessibilityState={{ selected: activeReactionFilter === reaction.id }}
                      onPress={() => setActiveReactionFilter(reaction.id)}
                      style={[styles.reactionFilter, { backgroundColor: activeReactionFilter === reaction.id ? tokens.accentSoft : tokens.panelMuted }]}
                    >
                      <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{reaction.emoji} {Number(post.reaction_counts?.[reaction.id] || 0)}</Text>
                    </Pressable>
                  ))}
                </View>
                {reactionUsersLoading ? (
                  <ActivityIndicator accessibilityLabel="Загрузка списка реакций" color={tokens.primary} />
                ) : reactionUsersError ? (
                  <Text accessibilityRole="alert" style={{ color: tokens.error }}>{reactionUsersError}</Text>
                ) : reactionUsers.length > 0 ? reactionUsers.map((item) => {
                  const reaction = getFeedReaction(item.reaction_type);
                  const name = item.full_name || item.username || `Сотрудник #${item.user_id}`;
                  return (
                    <View key={`${item.user_id}-${item.reaction_type}`} style={styles.reactionUser}>
                      <View style={[styles.reactionAvatar, { backgroundColor: tokens.accentSoft }]}>
                        <Text style={{ color: tokens.primary, fontSize: 12, fontWeight: '800' }}>{getFeedInitials(name)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: tokens.textPrimary, fontWeight: '700' }}>{name}</Text>
                        {item.username ? <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>@{String(item.username).replace(/^@/, '')}</Text> : null}
                      </View>
                      <Text accessibilityLabel={reaction?.label || item.reaction_type} style={{ fontSize: 22 }}>{reaction?.emoji || '•'}</Text>
                    </View>
                  );
                }) : (
                  <Text accessibilityRole="summary" style={{ color: tokens.textSecondary }}>По выбранному фильтру реакций нет.</Text>
                )}
                {reactionUsersNextOffset != null ? (
                  <Pressable
                    testID="feed-reactions-load-more"
                    accessibilityRole="button"
                    onPress={() => { void loadMoreReactionUsers(); }}
                    style={[styles.detailsToggle, { borderColor: tokens.borderSoft }]}
                  >
                    <Text style={{ color: tokens.primary, fontWeight: '800' }}>Показать ещё реакции</Text>
                  </Pressable>
                ) : null}
              </AccountSectionCard>
            ) : null}

            {Array.isArray(post.attachments) && post.attachments.length > 0 ? (
              <View style={[styles.postAttachments, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <Text style={[styles.sectionLabel, { color: tokens.textPrimary }]}>Вложения</Text>
                {post.attachments.map((attachment) => (
                  <Pressable
                    key={String(attachment.id)}
                    testID={`feed-post-attachment-${attachment.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть файл ${attachment.file_name || 'вложения'}`}
                    accessibilityState={{ disabled: Boolean(openingAttachmentId) }}
                    disabled={Boolean(openingAttachmentId)}
                    onPress={() => { void handleOpenAttachment(attachment); }}
                    style={[styles.attachmentButton, { backgroundColor: tokens.panelMuted }]}
                  >
                    <MaterialCommunityIcons name="paperclip" size={18} color={tokens.primary} />
                    <Text numberOfLines={2} style={[styles.attachmentButtonText, { color: tokens.primary }]}>
                      {attachment.file_name || 'Вложение'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.commentsHeader}>
              <Text style={[styles.commentsTitle, { color: tokens.textPrimary }]}>Комментарии ({commentsTotal})</Text>
              <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Сортировка комментариев">
                {([
                  ['interesting', 'Интересные'],
                  ['newest', 'Новые'],
                  ['oldest', 'Старые'],
                ] as const).map(([id, label]) => {
                  const selected = commentsSort === id;
                  return (
                    <Pressable
                      key={id}
                      testID={`feed-comments-sort-${id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setCommentsSort(id)}
                      style={[
                        styles.sortChip,
                        { backgroundColor: selected ? tokens.accentSoft : tokens.panelMuted },
                      ]}
                    >
                      <Text style={{ color: selected ? tokens.primary : tokens.textSecondary, fontSize: 12, fontWeight: '700' }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {commentsLoading && comments.length === 0 ? (
              <ActivityIndicator color={tokens.primary} />
            ) : comments.length === 0 ? (
              <Text style={{ color: tokens.textSecondary }}>Пока нет комментариев.</Text>
            ) : (
              comments.map((comment) => {
                const replyCount = Math.max(0, Number(comment.reply_count ?? comment.replies_count ?? 0));
                const expanded = expandedRoots.has(comment.id);
                return (
                  <View key={comment.id} style={styles.commentThread}>
                    <FeedCommentCard
                      comment={comment}
                      tokens={tokens}
                      editing={editingCommentId === comment.id}
                      editText={editingCommentId === comment.id ? editingCommentText : ''}
                      reactionPickerOpen={commentReactionPickerId === comment.id}
                      reactionsEnabled={post.reactions_enabled !== false}
                      busy={busyCommentId === comment.id}
                      onReply={() => startReply(comment)}
                      onEdit={() => {
                        setEditingCommentId(comment.id);
                        setEditingCommentText(String(comment.body || ''));
                      }}
                      onEditText={setEditingCommentText}
                      onSaveEdit={() => { void saveCommentEdit(); }}
                      onCancelEdit={() => {
                        setEditingCommentId('');
                        setEditingCommentText('');
                      }}
                      onDelete={() => confirmDeleteComment(comment)}
                      onToggleReactionPicker={() => setCommentReactionPickerId((current) => (
                        current === comment.id ? '' : comment.id
                      ))}
                      onReaction={(reactionType) => { void handleCommentReaction(comment, reactionType); }}
                      onOpenAttachment={(attachment) => { void handleOpenAttachment(attachment, comment.id); }}
                    />
                    {replyCount > 0 ? (
                      <Pressable
                        testID={`feed-comment-replies-${comment.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={expanded ? 'Скрыть ответы' : `Показать ответы: ${replyCount}`}
                        onPress={() => {
                          if (expanded) {
                            setExpandedRoots((current) => {
                              const next = new Set(current);
                              next.delete(comment.id);
                              return next;
                            });
                          } else {
                            void loadReplies(comment.id);
                          }
                        }}
                        style={styles.repliesButton}
                      >
                        <Text style={{ color: tokens.primary, fontSize: 13, fontWeight: '800' }}>
                          {expanded ? 'Скрыть ответы' : `Показать ответы · ${replyCount}`}
                        </Text>
                      </Pressable>
                    ) : null}
                    {expanded && loadingReplies.has(comment.id) ? (
                      <ActivityIndicator color={tokens.primary} />
                    ) : null}
                    {expanded ? (replies[comment.id] || []).map((reply) => (
                      <FeedCommentCard
                        key={reply.id}
                        comment={reply}
                        tokens={tokens}
                        reply
                        editing={editingCommentId === reply.id}
                        editText={editingCommentId === reply.id ? editingCommentText : ''}
                        reactionPickerOpen={commentReactionPickerId === reply.id}
                        reactionsEnabled={post.reactions_enabled !== false}
                        busy={busyCommentId === reply.id}
                        onReply={() => startReply(reply)}
                        onEdit={() => {
                          setEditingCommentId(reply.id);
                          setEditingCommentText(String(reply.body || ''));
                        }}
                        onEditText={setEditingCommentText}
                        onSaveEdit={() => { void saveCommentEdit(); }}
                        onCancelEdit={() => {
                          setEditingCommentId('');
                          setEditingCommentText('');
                        }}
                        onDelete={() => confirmDeleteComment(reply)}
                        onToggleReactionPicker={() => setCommentReactionPickerId((current) => (
                          current === reply.id ? '' : reply.id
                        ))}
                        onReaction={(reactionType) => { void handleCommentReaction(reply, reactionType); }}
                        onOpenAttachment={(attachment) => { void handleOpenAttachment(attachment, reply.id); }}
                      />
                    )) : null}
                  </View>
                );
              })
            )}
            {commentsNextOffset != null ? (
              <Pressable
                testID="feed-comments-load-more"
                accessibilityRole="button"
                accessibilityLabel="Показать ещё комментарии"
                accessibilityState={{ disabled: commentsLoading || offlineMode }}
                disabled={commentsLoading || offlineMode}
                onPress={() => { void loadMoreComments(); }}
                style={[styles.loadMoreButton, { borderColor: tokens.borderSoft }]}
              >
                {commentsLoading ? (
                  <ActivityIndicator color={tokens.primary} />
                ) : (
                  <Text style={{ color: tokens.primary, fontWeight: '800' }}>Показать ещё</Text>
                )}
              </Pressable>
            ) : null}
          </ScrollView>

          {post.comments_enabled !== false && !offlineMode ? (
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: tokens.navBg,
                  borderTopColor: tokens.borderSoft,
                  paddingBottom: Math.max(8, bottomInset ? 8 : 8),
                },
              ]}
            >
              {replyingTo ? (
                <View style={styles.replyBanner}>
                  <Text numberOfLines={1} style={{ color: tokens.textSecondary, flex: 1, fontSize: 12 }}>
                    Ответ для {replyingTo.full_name || replyingTo.author_full_name || replyingTo.username || replyingTo.author_username || 'участника'}
                  </Text>
                  <Pressable
                    testID="feed-comment-reply-cancel"
                    accessibilityRole="button"
                    accessibilityLabel="Отменить ответ"
                    onPress={cancelReply}
                    style={styles.replyCancel}
                  >
                    <MaterialCommunityIcons name="close" size={18} color={tokens.textSecondary} />
                  </Pressable>
                </View>
              ) : null}
              {commentFiles.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectedFiles}>
                  {commentFiles.map((file) => (
                    <Pressable
                      key={file.uri}
                      accessibilityRole="button"
                      accessibilityLabel={`Убрать файл ${file.name}`}
                      onPress={() => setCommentFiles((current) => current.filter((item) => item.uri !== file.uri))}
                      style={[styles.selectedFile, { backgroundColor: tokens.panelMuted }]}
                    >
                      <Text numberOfLines={1} style={{ color: tokens.textSecondary, maxWidth: 180, fontSize: 12 }}>
                        {file.name}
                      </Text>
                      <MaterialCommunityIcons name="close" size={16} color={tokens.textSecondary} />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              <View style={styles.composerRow}>
                <Pressable
                  testID="feed-comment-attach"
                  accessibilityRole="button"
                  accessibilityLabel="Прикрепить файлы"
                  onPress={() => { void handlePickFiles(); }}
                  style={styles.attachButton}
                >
                  <MaterialCommunityIcons name="paperclip" size={20} color={tokens.textSecondary} />
                </Pressable>
                <TextInput
                  testID="feed-comment-input"
                  accessibilityLabel={replyingTo ? 'Написать ответ' : 'Написать комментарий'}
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder={replyingTo ? 'Написать ответ' : 'Написать комментарий'}
                  placeholderTextColor={tokens.textTertiary}
                  maxLength={4000}
                  style={[styles.composerInput, { color: tokens.textPrimary, borderColor: tokens.borderSoft }]}
                  multiline
                />
                <Pressable
                  testID="feed-comment-send"
                  accessibilityRole="button"
                  accessibilityLabel={replyingTo ? 'Отправить ответ' : 'Отправить комментарий'}
                  accessibilityState={{ disabled: sending || (!commentText.trim() && commentFiles.length === 0) }}
                  onPress={() => { void handleSendComment(); }}
                  disabled={sending || (!commentText.trim() && commentFiles.length === 0)}
                  style={[
                    styles.sendButton,
                    {
                      backgroundColor: tokens.primary,
                      opacity: sending || (!commentText.trim() && commentFiles.length === 0) ? 0.5 : 1,
                    },
                  ]}
                >
                  {sending ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPicker: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reactionItem: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 22 },
  detailsToggle: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reactionFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reactionFilter: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionUser: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  reactionAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  analyticsContent: { gap: 10 },
  analyticsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  analyticsMetric: { minWidth: '46%', flexGrow: 1, borderRadius: 12, padding: 10, gap: 2 },
  analyticsRecipient: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pollCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  pollTitle: { fontWeight: '800', fontSize: 15 },
  pollOption: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentsTitle: { fontWeight: '800', fontSize: 16 },
  commentsHeader: { gap: 8 },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sortChip: {
    minHeight: 40,
    borderRadius: 20,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  commentThread: { gap: 6 },
  repliesButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginLeft: 20,
  },
  loadMoreButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postAttachments: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  sectionLabel: { fontSize: 15, fontWeight: '800' },
  attachmentButton: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pollOptionContent: { flex: 1, gap: 7 },
  pollOptionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pollProgressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  pollProgressFill: { height: 4, borderRadius: 2 },
  pollSubmit: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pollSubmitText: { color: '#fff', fontWeight: '800' },
  attachmentButtonText: { flex: 1, fontSize: 13, fontWeight: '700' },
  composer: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 4,
    gap: 4,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  replyBanner: {
    minHeight: 36,
    paddingLeft: 52,
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyCancel: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedFiles: { gap: 6, paddingLeft: 52, paddingRight: 4 },
  selectedFile: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
