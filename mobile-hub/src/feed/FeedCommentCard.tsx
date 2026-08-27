import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { FluentTokens } from '../theme/fluentTokens';
import {
  FEED_REACTIONS,
  formatFeedDate,
  getFeedInitials,
  type FeedAttachment,
  type FeedComment,
  type FeedReactionId,
} from './feedFormat';

function commentAuthor(comment: FeedComment): string {
  return comment.full_name
    || comment.author_full_name
    || comment.username
    || comment.author_username
    || 'Участник';
}

export function FeedCommentCard({
  comment,
  tokens,
  reply = false,
  editing,
  editText,
  reactionPickerOpen,
  reactionsEnabled,
  busy,
  onReply,
  onEdit,
  onEditText,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onToggleReactionPicker,
  onReaction,
  onOpenAttachment,
}: {
  comment: FeedComment;
  tokens: FluentTokens;
  reply?: boolean;
  editing: boolean;
  editText: string;
  reactionPickerOpen: boolean;
  reactionsEnabled: boolean;
  busy: boolean;
  onReply: () => void;
  onEdit: () => void;
  onEditText: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onToggleReactionPicker: () => void;
  onReaction: (reactionType: FeedReactionId) => void;
  onOpenAttachment: (attachment: FeedAttachment) => void;
}) {
  const author = commentAuthor(comment);
  const counts = comment.reaction_counts || {};
  const attachments = Array.isArray(comment.attachments) ? comment.attachments : [];
  const edited = Boolean(comment.updated_at && comment.created_at && comment.updated_at !== comment.created_at);

  return (
    <View
      testID={`feed-comment-${comment.id}`}
      accessibilityRole="summary"
      style={[
        styles.comment,
        reply ? styles.reply : null,
        {
          backgroundColor: tokens.panelSolid,
          borderColor: reply ? tokens.primary : tokens.borderSoft,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: tokens.accentSoft }]}>
          <Text style={{ color: tokens.primary, fontWeight: '800', fontSize: 11 }}>
            {getFeedInitials(author)}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={{ color: tokens.textPrimary, fontWeight: '800', fontSize: 13 }}>{author}</Text>
          <Text style={{ color: tokens.textTertiary, fontSize: 11 }}>
            {comment.reply_to_username ? `Ответ для @${comment.reply_to_username} · ` : ''}
            {formatFeedDate(comment.created_at)}{edited ? ' · изменено' : ''}
          </Text>
        </View>
        {!editing && comment.can_edit ? (
          <IconAction
            testID={`feed-comment-edit-${comment.id}`}
            icon="pencil-outline"
            label="Редактировать комментарий"
            color={tokens.textSecondary}
            onPress={onEdit}
          />
        ) : null}
        {!editing && comment.can_delete ? (
          <IconAction
            testID={`feed-comment-delete-${comment.id}`}
            icon="delete-outline"
            label="Удалить комментарий"
            color={tokens.error}
            onPress={onDelete}
          />
        ) : null}
      </View>

      {editing ? (
        <View style={styles.editBlock}>
          <TextInput
            testID={`feed-comment-edit-input-${comment.id}`}
            accessibilityLabel="Текст комментария"
            value={editText}
            onChangeText={onEditText}
            maxLength={4000}
            multiline
            autoFocus
            style={[
              styles.editInput,
              { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.panelMuted },
            ]}
          />
          <View style={styles.editActions}>
            <TextAction testID={`feed-comment-edit-cancel-${comment.id}`} label="Отмена" color={tokens.textSecondary} onPress={onCancelEdit} />
            <TextAction testID={`feed-comment-edit-save-${comment.id}`} label="Сохранить" color={tokens.primary} onPress={onSaveEdit} disabled={busy || !editText.trim()} />
          </View>
        </View>
      ) : (
        <Text
          style={{
            color: comment.is_deleted ? tokens.textSecondary : tokens.textPrimary,
            fontSize: 14,
            lineHeight: 20,
            fontStyle: comment.is_deleted ? 'italic' : 'normal',
          }}
        >
          {comment.body || (comment.is_deleted ? 'Комментарий удалён' : '')}
        </Text>
      )}

      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          {attachments.map((attachment) => (
            <Pressable
              key={String(attachment.id)}
              testID={`feed-comment-attachment-${attachment.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Открыть файл ${attachment.file_name || 'вложения'}`}
              onPress={() => onOpenAttachment(attachment)}
              style={[styles.attachment, { backgroundColor: tokens.panelMuted }]}
            >
              <MaterialCommunityIcons name="paperclip" size={18} color={tokens.primary} />
              <Text numberOfLines={2} style={[styles.attachmentText, { color: tokens.primary }]}>
                {attachment.file_name || 'Вложение'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!comment.is_deleted ? (
        <View style={styles.actions}>
          <TextAction label="Ответить" color={tokens.textSecondary} onPress={onReply} />
          {reactionsEnabled ? FEED_REACTIONS.map((reaction) => {
            const count = Math.max(0, Number(counts[reaction.id] || 0));
            const selected = comment.viewer_reaction === reaction.id;
            if (!count && !selected) return null;
            return (
              <Pressable
                key={reaction.id}
                testID={`feed-comment-reaction-${comment.id}-${reaction.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${reaction.label}: ${count}`}
                accessibilityState={{ selected, disabled: busy }}
                disabled={busy}
                onPress={() => onReaction(reaction.id)}
                style={[
                  styles.reactionChip,
                  { backgroundColor: selected ? tokens.accentSoft : tokens.panelMuted },
                ]}
              >
                <Text style={{ color: selected ? tokens.primary : tokens.textSecondary, fontWeight: '700' }}>
                  {reaction.emoji}{count ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          }) : null}
          {reactionsEnabled ? (
            <IconAction
              testID={`feed-comment-reaction-picker-${comment.id}`}
              icon={reactionPickerOpen ? 'close' : 'emoticon-plus-outline'}
              label={reactionPickerOpen ? 'Закрыть выбор реакции' : 'Добавить реакцию'}
              color={tokens.textSecondary}
              onPress={onToggleReactionPicker}
              disabled={busy}
            />
          ) : null}
        </View>
      ) : null}

      {reactionPickerOpen ? (
        <View style={[styles.reactionPicker, { backgroundColor: tokens.panelMuted }]}>
          {FEED_REACTIONS.map((reaction) => (
            <Pressable
              key={reaction.id}
              testID={`feed-comment-reaction-option-${comment.id}-${reaction.id}`}
              accessibilityRole="button"
              accessibilityLabel={reaction.label}
              accessibilityState={{ selected: comment.viewer_reaction === reaction.id }}
              onPress={() => onReaction(reaction.id)}
              style={styles.reactionOption}
            >
              <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function IconAction({
  testID,
  icon,
  label,
  color,
  onPress,
  disabled,
}: {
  testID?: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconAction, { opacity: disabled ? 0.5 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={color} />
    </Pressable>
  );
}

function TextAction({
  testID,
  label,
  color,
  onPress,
  disabled,
}: {
  testID?: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.textAction, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={{ color, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  comment: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  reply: {
    marginLeft: 20,
    borderLeftWidth: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1, minWidth: 0 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -8,
  },
  editBlock: { gap: 8 },
  editInput: {
    minHeight: 72,
    maxHeight: 150,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  textAction: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  reactionChip: {
    minWidth: 44,
    minHeight: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  reactionPicker: {
    borderRadius: 12,
    padding: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  reactionOption: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 22 },
  attachments: { gap: 6 },
  attachment: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attachmentText: { flex: 1, fontSize: 13, fontWeight: '700' },
});
