import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../theme/fluentTokens';
import { buildFeedAttachmentUrl } from '../api/feedApi';
import { AuthenticatedImage } from './AuthenticatedImage';
import { FeedMarkdownText } from './FeedMarkdownText';
import {
  formatFeedDate,
  getFeedInitials,
  getFeedReaction,
  getFeedReactionGroups,
  isImageAttachment,
  priorityLabel,
  stripFeedMarkdown,
  type FeedPost,
} from './feedFormat';

export function FeedPostCard({
  post,
  tokens,
  detailView = false,
  onOpen,
  onToggleReaction,
  onBookmark,
  onComments,
  onAcknowledge,
}: {
  post: FeedPost;
  tokens: FluentTokens;
  detailView?: boolean;
  onOpen?: () => void;
  onToggleReaction?: () => void;
  onBookmark?: () => void;
  onComments?: () => void;
  onAcknowledge?: () => void;
}) {
  const authorName = post.author_full_name || post.author_username || 'Автор публикации';
  const preview = String(post.preview || stripFeedMarkdown(post.body) || '').trim();
  const body = String(post.body || '').trim();
  const publishedAt = formatFeedDate(post.updated_at || post.published_at);
  const priority = priorityLabel(post.priority);
  const statusLabel = post.status === 'draft'
    ? 'Черновик'
    : post.status === 'scheduled'
      ? 'Запланировано'
      : post.status === 'archived'
        ? 'Архив'
        : null;
  const reactionGroups = getFeedReactionGroups(post.reaction_counts);
  const viewerReaction = getFeedReaction(post.viewer_reaction);
  const commentsCount = Math.max(0, Number(post.comments_count || 0));
  const cover = (Array.isArray(post.attachments) ? post.attachments : [])
    .filter(isImageAttachment)[0] || post.cover_attachment;
  const coverUrl = cover?.id ? buildFeedAttachmentUrl(post.id, String(cover.id)) : '';

  const content = (
    <>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: tokens.accentSoft }]}>
          <Text style={[styles.avatarText, { color: tokens.primary }]}>{getFeedInitials(authorName)}</Text>
        </View>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.author, { color: tokens.textPrimary }]}>{authorName}</Text>
          <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>
            {[publishedAt, post.category_name].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {post.is_pinned ? <MaterialCommunityIcons name="pin" size={16} color={tokens.warning} /> : null}
      </View>

      <View style={styles.badges}>
        {statusLabel ? <Badge tokens={tokens} label={statusLabel} tone="muted" /> : null}
        {post.is_unread ? (
          <Badge tokens={tokens} label="Новое" tone="primary" />
        ) : null}
        {priority ? (
          <Badge tokens={tokens} label={priority} tone={priority === 'Важное' ? 'warning' : 'muted'} />
        ) : null}
        {post.is_ack_pending ? (
          <Badge tokens={tokens} label="Нужно подтвердить" tone="error" />
        ) : null}
      </View>

      <Text style={[styles.title, { color: tokens.textPrimary }]}>{post.title || 'Без названия'}</Text>
      {detailView ? (
        body ? <FeedMarkdownText value={body} tokens={tokens} /> : null
      ) : (
        preview ? <Text numberOfLines={4} style={[styles.body, { color: tokens.textSecondary }]}>{preview}</Text> : null
      )}

      {coverUrl ? (
        <AuthenticatedImage
          uri={coverUrl}
          style={styles.cover}
          accessibilityLabel="Иллюстрация к публикации"
        />
      ) : null}

      {reactionGroups.length > 0 ? (
        <Text style={[styles.reactionSummary, { color: tokens.textSecondary }]}>
          {reactionGroups.map((item) => `${item.emoji} ${item.count}`).join('   ')}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Action
          tokens={tokens}
          active={Boolean(viewerReaction)}
          label={viewerReaction ? `${viewerReaction.emoji} ${viewerReaction.label}` : 'Нравится'}
          onPress={onToggleReaction}
        />
        <Action
          tokens={tokens}
          label={commentsCount > 0 ? `Комментарии ${commentsCount}` : 'Комментарии'}
          onPress={onComments || onOpen}
        />
        <Action
          tokens={tokens}
          active={Boolean(post.viewer_bookmarked)}
          label={post.viewer_bookmarked ? 'В сохранённых' : 'Сохранить'}
          onPress={onBookmark}
        />
      </View>

      {post.is_ack_pending && onAcknowledge ? (
        <Pressable
          onPress={onAcknowledge}
          style={[styles.ackButton, { backgroundColor: tokens.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Подтвердить прочтение"
        >
          <Text style={styles.ackLabel}>Подтвердить прочтение</Text>
        </Pressable>
      ) : null}
    </>
  );

  if (detailView) {
    return (
      <View
        testID={`feed-post-card-${post.id}`}
        style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={`feed-post-card-${post.id}`}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={post.title || 'Публикация'}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      {content}
    </Pressable>
  );
}

function Badge({
  tokens,
  label,
  tone,
}: {
  tokens: FluentTokens;
  label: string;
  tone: 'primary' | 'warning' | 'error' | 'muted';
}) {
  const color = tone === 'primary'
    ? tokens.primary
    : tone === 'warning'
      ? tokens.warning
      : tone === 'error'
        ? tokens.error
        : tokens.textSecondary;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}18` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function Action({
  tokens,
  label,
  onPress,
  active,
}: {
  tokens: FluentTokens;
  label: string;
  onPress?: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation?.();
        onPress?.();
      }}
      disabled={!onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.actionLabel, { color: active ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '800', fontSize: 13 },
  headerText: { flex: 1, minWidth: 0 },
  author: { fontWeight: '800', fontSize: 14 },
  meta: { marginTop: 2, fontSize: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  title: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  body: { fontSize: 14, lineHeight: 20 },
  cover: { width: '100%', height: 180, borderRadius: 12 },
  reactionSummary: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 13, fontWeight: '700' },
  ackButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackLabel: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
