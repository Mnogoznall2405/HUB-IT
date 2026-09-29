import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../theme/fluentTokens';
import { buildFeedAttachmentUrl } from '../api/feedApi';
import { AuthenticatedImage } from './AuthenticatedImage';
import { FeedMarkdownText } from './FeedMarkdownText';
import { FeedReactionBar } from './FeedReactionBar';
import {
  formatFeedAbsoluteDate,
  formatFeedPublishedMeta,
  getFeedInitials,
  getFeedReaction,
  getFeedReactionGroups,
  isImageAttachment,
  priorityLabel,
  stripFeedMarkdown,
  stripFeedMarkdownMultiline,
  type FeedAttachment,
  type FeedPost,
  type FeedReactionId,
} from './feedFormat';

export const FeedPostCard = memo(function FeedPostCard({
  post,
  tokens,
  detailView = false,
  onOpen,
  onToggleReaction,
  onBookmark,
  onComments,
  onAcknowledge,
  onSelectReaction,
  onOpenImage,
  reactionPickerOpen = false,
}: {
  post: FeedPost;
  tokens: FluentTokens;
  detailView?: boolean;
  onOpen?: (post: FeedPost) => void;
  onToggleReaction?: (post: FeedPost) => void;
  onBookmark?: (post: FeedPost) => void;
  onComments?: (post: FeedPost) => void;
  onAcknowledge?: (post: FeedPost) => void;
  onSelectReaction?: (post: FeedPost, reactionId: FeedReactionId) => void;
  onOpenImage?: (post: FeedPost, attachment: FeedAttachment) => void;
  reactionPickerOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const authorName = post.author_full_name || post.author_username || 'Автор публикации';
  const bodyPlain = stripFeedMarkdown(post.body).trim();
  const bodyMultiline = stripFeedMarkdownMultiline(post.body).trim();
  const preview = String(post.preview || bodyPlain || '').trim();
  const body = String(post.body || '').trim();
  const publishedMeta = formatFeedPublishedMeta(post);
  const publishedAbsolute = formatFeedAbsoluteDate(post.published_at);
  const priority = priorityLabel(post.priority);
  const reactionGroups = getFeedReactionGroups(post.reaction_counts);
  const viewerReaction = getFeedReaction(post.viewer_reaction);
  const commentsCount = Math.max(0, Number(post.comments_count || 0));
  const cover = (Array.isArray(post.attachments) ? post.attachments : [])
    .filter(isImageAttachment)[0] || post.cover_attachment;
  const coverUrl = cover?.id ? buildFeedAttachmentUrl(post.id, String(cover.id)) : '';
  const collapsedText = preview;
  const expandedText = bodyMultiline || preview;
  const expandable = !detailView && Boolean(preview) && (
    expandedText.length > collapsedText.length + 8 || collapsedText.length > 110
  );
  const statusParts = [
    post.is_unread ? 'Новое' : '',
    priority || '',
    post.is_ack_pending ? 'Нужно подтвердить' : '',
  ].filter(Boolean);
  const accessibilitySummary = [
    post.title || 'Публикация',
    authorName,
    publishedMeta || publishedAbsolute,
    ...statusParts,
    reactionGroups.map((item) => `${item.label}: ${item.count}`).join(', '),
    commentsCount > 0 ? `Комментариев: ${commentsCount}` : '',
  ].filter(Boolean).join('. ');

  const content = (
    <>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: tokens.accentSoft }]}>
          <Text style={[styles.avatarText, { color: tokens.primary }]}>{getFeedInitials(authorName)}</Text>
        </View>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.author, { color: tokens.textPrimary }]}>{authorName}</Text>
          <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>
            {[publishedMeta, post.category_name].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {post.is_pinned ? (
          <MaterialCommunityIcons
            name="pin"
            size={16}
            color={tokens.warning}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
      </View>

      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>{post.title || 'Без названия'}</Text>
        {post.is_unread ? <View testID="feed-card-unread-dot" style={[styles.unreadDot, { backgroundColor: tokens.primary }]} /> : null}
      </View>

      {priority === 'Важное' ? (
        <Text style={[styles.priorityMark, { color: tokens.warning }]}>Важное</Text>
      ) : null}

      {detailView ? (
        body ? <FeedMarkdownText value={body} tokens={tokens} /> : null
      ) : collapsedText ? (
        <View>
          <Text
            numberOfLines={expanded ? undefined : 3}
            style={[styles.body, { color: tokens.textSecondary }]}
          >
            {expanded ? expandedText : collapsedText}
          </Text>
          {expandable ? (
            <Pressable
              testID="feed-card-expand"
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={expanded ? 'Свернуть текст публикации' : 'Показать текст публикации полностью'}
              onPress={() => setExpanded((value) => !value)}
              style={styles.expandToggle}
            >
              <Text style={[styles.expandLabel, { color: tokens.primary }]}>{expanded ? 'Свернуть' : 'Ещё'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {coverUrl && cover ? (
        <Pressable
          testID={`feed-post-cover-${post.id}`}
          disabled={!onOpenImage}
          accessibilityRole="button"
          accessibilityLabel={`Открыть фото на весь экран: ${cover.file_name || 'изображение'}`}
          onPress={onOpenImage ? () => onOpenImage(post, cover) : undefined}
          style={({ pressed }) => [styles.coverPressable, pressed && onOpenImage ? { opacity: 0.9 } : null]}
        >
          <AuthenticatedImage
            uri={coverUrl}
            style={[styles.cover, { backgroundColor: tokens.panelInset }]}
            resizeMode="contain"
            accessibilityLabel="Иллюстрация к публикации"
          />
        </Pressable>
      ) : null}

      {reactionGroups.length > 0 ? (
        <View style={styles.reactionSummary}>
          {reactionGroups.map((item) => (
            <View key={item.id} style={[styles.reactionPill, { backgroundColor: tokens.panelInset }]}>
              <Text style={styles.reactionPillEmoji}>{item.emoji}</Text>
              <Text style={[styles.reactionPillCount, { color: tokens.textSecondary }]}>{item.count}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Action
          tokens={tokens}
          icon="thumb-up-outline"
          activeIcon="thumb-up"
          activeEmoji={viewerReaction?.emoji}
          count={reactionGroups.reduce((sum, item) => sum + item.count, 0)}
          active={Boolean(viewerReaction)}
          label={viewerReaction ? `${viewerReaction.emoji} ${viewerReaction.label}` : 'Нравится'}
          onPress={onToggleReaction ? () => onToggleReaction(post) : undefined}
          onLongPress={onToggleReaction ? () => onToggleReaction(post) : undefined}
          testID="feed-card-action-react"
        />
        <Action
          tokens={tokens}
          icon="comment-outline"
          count={commentsCount}
          label={commentsCount > 0 ? `Комментарии ${commentsCount}` : 'Комментарии'}
          onPress={onComments || onOpen ? () => (onComments || onOpen)?.(post) : undefined}
          testID="feed-card-action-comments"
        />
        <Action
          tokens={tokens}
          icon="bookmark-outline"
          activeIcon="bookmark"
          active={Boolean(post.viewer_bookmarked)}
          label={post.viewer_bookmarked ? 'В сохранённых' : 'Сохранить'}
          onPress={onBookmark ? () => onBookmark(post) : undefined}
          testID="feed-card-action-bookmark"
        />
      </View>

      {post.is_ack_pending && onAcknowledge ? (
        <Pressable
          onPress={() => onAcknowledge(post)}
          style={({ pressed }) => [
            styles.ackButton,
            { backgroundColor: tokens.primary, opacity: pressed ? 0.88 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Подтвердить прочтение"
        >
          <Text style={[styles.ackLabel, { color: tokens.onPrimary }]}>Подтвердить прочтение</Text>
        </Pressable>
      ) : null}
    </>
  );

  const cardStyle = [styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }];

  if (detailView) {
    return (
      <View testID={`feed-post-card-${post.id}`} style={cardStyle}>
        {content}
        {reactionPickerOpen && onSelectReaction ? (
          <FeedReactionBar
            tokens={tokens}
            selectedId={post.viewer_reaction}
            onSelect={(reactionId) => onSelectReaction(post, reactionId)}
            onClose={() => onToggleReaction?.(post)}
            testIDPrefix="feed-reaction"
            accessibilityLabel="Выбрать реакцию публикации"
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.cardHost}>
      <Pressable
        testID={`feed-post-card-${post.id}`}
        onPress={onOpen ? () => onOpen(post) : undefined}
        onLongPress={onToggleReaction ? () => onToggleReaction(post) : undefined}
        delayLongPress={420}
        accessibilityRole="button"
        accessibilityLabel={accessibilitySummary}
        accessibilityHint={onToggleReaction ? 'Удерживайте, чтобы выбрать реакцию' : undefined}
        style={cardStyle}
      >
        {content}
      </Pressable>
      {reactionPickerOpen && onSelectReaction ? (
        <FeedReactionBar
          tokens={tokens}
          selectedId={post.viewer_reaction}
          onSelect={(reactionId) => onSelectReaction(post, reactionId)}
          onClose={() => onToggleReaction?.(post)}
          testIDPrefix={`feed-card-reaction-${post.id}`}
          accessibilityLabel="Выбрать реакцию публикации"
        />
      ) : null}
    </View>
  );
});

function Action({
  tokens,
  label,
  icon,
  activeIcon,
  activeEmoji,
  count,
  onPress,
  onLongPress,
  active,
  testID,
}: {
  tokens: FluentTokens;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  activeIcon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  activeEmoji?: string | null;
  count?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  active?: boolean;
  testID?: string;
}) {
  const tint = active ? tokens.primary : tokens.textSecondary;
  return (
    <Pressable
      testID={testID}
      onPress={(event) => {
        event.stopPropagation?.();
        onPress?.();
      }}
      onLongPress={onLongPress ? (event) => {
        event.stopPropagation?.();
        onLongPress();
      } : undefined}
      delayLongPress={420}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: active ? tokens.accentSoft : tokens.panelInset,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {active && activeEmoji ? (
        <Text style={styles.actionEmoji}>{activeEmoji}</Text>
      ) : (
        <MaterialCommunityIcons name={active && activeIcon ? activeIcon : icon} size={18} color={tint} />
      )}
      {Number(count || 0) > 0 ? (
        <Text style={[styles.actionCount, { color: tint }]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHost: {
    position: 'relative',
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', fontSize: 13 },
  headerText: { flex: 1, minWidth: 0 },
  author: { fontWeight: '600', fontSize: 14 },
  meta: { marginTop: 2, fontSize: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  priorityMark: { fontSize: 12, fontWeight: '600', marginTop: -4 },
  body: { fontSize: 14, lineHeight: 20 },
  expandToggle: { minHeight: 32, justifyContent: 'center', marginTop: 2 },
  expandLabel: { fontSize: 13, fontWeight: '600' },
  coverPressable: { alignSelf: 'stretch' },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12 },
  reactionSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  reactionPillEmoji: { fontSize: 14 },
  reactionPillCount: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    minHeight: 36,
    minWidth: 52,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionEmoji: { fontSize: 16 },
  actionCount: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  ackButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackLabel: { fontWeight: '700', fontSize: 14 },
});
