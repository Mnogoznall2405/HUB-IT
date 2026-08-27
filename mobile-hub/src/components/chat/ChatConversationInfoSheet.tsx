import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as chatApi from '../../api/chatApi';
import type { ChatAiBot, ChatConversationAttachment, ChatConversationSummary, ChatMember } from '../../api/types';
import { isAiConversation } from '../../chat/chatAiWorkspace';
import { isSandboxAiBot } from '../../chat/chatAiSandbox';
import { ChatOpenCodePanel } from './ChatOpenCodePanel';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  CHAT_GALLERY_TABS,
  chatGalleryEmptyLabel,
  chatGalleryItemLabel,
  type ChatGalleryKind,
} from '../../chat/chatConversationGallery';
import { pickChatAttachmentPreviewUrl } from '../../chat/chatMedia';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';
import { formatChatPresenceText, isChatPresenceOnline } from '../../chat/chatTyping';
import { ChatPersonProfileFields } from './ChatParticipantProfileSheet';
import { PresenceAvatar } from './PresenceAvatar';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';

type SettingKey = 'is_muted' | 'is_pinned' | 'is_archived';

export function ChatConversationInfoSheet({
  visible,
  conversation,
  currentUserId,
  busy = false,
  onClose,
  onToggleSetting,
  onRename,
  onResetAiContext,
  onDeleteAi,
  aiBot,
  onAddMembers,
  onMemberPress,
  onMemberManage,
  onLeave,
  onOpenAttachment,
}: {
  visible: boolean;
  conversation: ChatConversationSummary | null;
  currentUserId?: number;
  busy?: boolean;
  onClose: () => void;
  onToggleSetting: (key: SettingKey, value: boolean) => void;
  onRename?: () => void;
  onResetAiContext?: () => void;
  onDeleteAi?: () => void;
  aiBot?: ChatAiBot | null;
  onAddMembers?: () => void;
  onMemberPress?: (member: ChatMember) => void;
  onMemberManage?: (member: ChatMember) => void;
  onLeave?: () => void;
  onOpenAttachment?: (attachment: ChatConversationAttachment, items: ChatConversationAttachment[]) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [galleryKind, setGalleryKind] = useState<ChatGalleryKind>('image');
  const [gallery, setGallery] = useState<ChatConversationAttachment[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryLoadingMore, setGalleryLoadingMore] = useState(false);
  const [galleryHasMore, setGalleryHasMore] = useState(false);
  const [galleryCursor, setGalleryCursor] = useState<string | null>(null);
  const members = conversation?.members || conversation?.member_preview || [];
  const isGroup = conversation?.kind === 'group' || conversation?.is_group;
  const isAi = isAiConversation(conversation);
  const role = conversation?.viewer_member_role || members.find(
    (member) => member.user.id === currentUserId,
  )?.member_role;
  const canManage = role === 'owner' || role === 'moderator';

  const loadGallery = useCallback(async (
    conversationId: string,
    kind: ChatGalleryKind,
    beforeAttachmentId?: string | null,
  ) => {
    const page = await chatApi.getConversationAttachments(conversationId, {
      kind,
      limit: 24,
      beforeAttachmentId: beforeAttachmentId || undefined,
    });
    return page;
  }, []);

  useEffect(() => {
    if (!visible || !conversation?.id) {
      setGallery([]);
      setGalleryHasMore(false);
      setGalleryCursor(null);
      setGalleryKind('image');
      return undefined;
    }
    let active = true;
    setGallery([]);
    setGalleryLoading(true);
    void loadGallery(conversation.id, galleryKind)
      .then((page) => {
        if (!active) return;
        setGallery(page.items);
        setGalleryHasMore(page.has_more);
        setGalleryCursor(page.next_before_attachment_id);
      })
      .catch(() => {
        if (!active) return;
        setGallery([]);
        setGalleryHasMore(false);
        setGalleryCursor(null);
      })
      .finally(() => {
        if (active) setGalleryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversation?.id, galleryKind, loadGallery, visible]);

  const loadMoreGallery = async () => {
    if (!conversation?.id || !galleryHasMore || galleryLoadingMore) return;
    setGalleryLoadingMore(true);
    try {
      const page = await loadGallery(conversation.id, galleryKind, galleryCursor);
      setGallery((current) => [...current, ...page.items]);
      setGalleryHasMore(page.has_more);
      setGalleryCursor(page.next_before_attachment_id);
    } catch {
      setGalleryHasMore(false);
    } finally {
      setGalleryLoadingMore(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть информацию о чате"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.profile}>
              <PresenceAvatar
                label={conversation?.title || 'Чат'}
                avatarUrl={conversation?.avatar_url || conversation?.direct_peer?.avatar_url}
                size={72}
                online={!isGroup && isChatPresenceOnline(conversation?.direct_peer?.presence)}
              />
              <Text style={styles.title}>{conversation?.title || 'Чат'}</Text>
              <Text style={styles.subtitle}>
                {isGroup
                  ? `${conversation?.member_count || members.length} участников · ${conversation?.online_member_count || 0} онлайн`
                  : formatChatPresenceText(conversation?.direct_peer?.presence)}
              </Text>
            </View>

            {!isGroup && conversation?.direct_peer ? (
              <View style={styles.section}>
                <ChatPersonProfileFields user={conversation.direct_peer} />
              </View>
            ) : null}

            <View style={styles.section}>
              <SettingRow
                icon={conversation?.is_muted ? 'bell-off-outline' : 'bell-outline'}
                label="Уведомления"
                value={!conversation?.is_muted}
                disabled={busy}
                onPress={() => onToggleSetting('is_muted', !conversation?.is_muted)}
              />
              <SettingRow
                icon="pin-outline"
                label="Закрепить диалог"
                value={Boolean(conversation?.is_pinned)}
                disabled={busy}
                onPress={() => onToggleSetting('is_pinned', !conversation?.is_pinned)}
              />
              <SettingRow
                icon="archive-outline"
                label="Архивировать"
                value={Boolean(conversation?.is_archived)}
                disabled={busy}
                onPress={() => onToggleSetting('is_archived', !conversation?.is_archived)}
              />
            </View>

            {isGroup ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Участники</Text>
                  {canManage && onAddMembers ? (
                    <Pressable
                      onPress={onAddMembers}
                      disabled={busy}
                      style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Добавить участников"
                    >
                      <MaterialCommunityIcons name="account-plus-outline" size={21} color={chatTokens.accentText} />
                      <Text style={styles.smallActionText}>Добавить</Text>
                    </Pressable>
                  ) : null}
                </View>
                {members.map((member) => {
                  const label = member.user.full_name || member.user.username;
                  const canOpenActions = Boolean(
                    canManage
                    && onMemberManage
                    && member.user.id !== currentUserId,
                  );
                  return (
                    <View key={member.user.id} style={styles.memberRow}>
                      <Pressable
                        onPress={() => onMemberPress?.(member)}
                        disabled={busy}
                        style={({ pressed }) => [styles.memberMain, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Открыть карточку ${label}`}
                      >
                        <PresenceAvatar
                          label={label}
                          avatarUrl={member.user.avatar_url}
                          size={42}
                          online={isChatPresenceOnline(member.user.presence)}
                        />
                        <View style={styles.memberText}>
                          <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
                          <Text style={styles.memberMeta} numberOfLines={1}>
                            {member.user.job_title || member.user.department
                              || (isChatPresenceOnline(member.user.presence) ? 'В сети' : `@${member.user.username}`)}
                          </Text>
                        </View>
                        <Text style={styles.memberRole}>{roleLabel(member.member_role)}</Text>
                      </Pressable>
                      {canOpenActions ? (
                        <Pressable
                          onPress={() => onMemberManage?.(member)}
                          disabled={busy}
                          style={({ pressed }) => [styles.memberMenu, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Действия участника ${label}`}
                        >
                          <MaterialCommunityIcons name="dots-vertical" size={22} color={chatTokens.textSecondary} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
                {!members.length ? <Text style={styles.empty}>Список участников недоступен</Text> : null}
              </View>
            ) : null}

            {isAi && onRename ? (
              <ActionRow icon="pencil-outline" label="Переименовать" onPress={onRename} disabled={busy} />
            ) : null}
            {isAi && onResetAiContext ? (
              <ActionRow icon="backup-restore" label="Сбросить контекст" onPress={onResetAiContext} disabled={busy} />
            ) : null}
            {isAi && onDeleteAi ? (
              <ActionRow icon="delete-outline" label="Удалить чат" onPress={onDeleteAi} disabled={busy} danger />
            ) : null}
            {isAi && isSandboxAiBot(aiBot) ? (
              <ChatOpenCodePanel conversationId={conversation?.id} visible={visible} />
            ) : null}
            {isGroup && canManage && onRename ? (
              <ActionRow icon="pencil-outline" label="Изменить название" onPress={onRename} disabled={busy} />
            ) : null}
            {isGroup && onLeave ? (
              <ActionRow icon="exit-to-app" label="Покинуть группу" onPress={onLeave} disabled={busy} danger />
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Медиа</Text>
              </View>
              <View style={styles.galleryTabs}>
                {CHAT_GALLERY_TABS.map((tab) => {
                  const selected = tab.key === galleryKind;
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => setGalleryKind(tab.key)}
                      style={[styles.galleryTab, selected && styles.galleryTabActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Галерея ${tab.label}`}
                    >
                      <Text style={[styles.galleryTabText, selected && styles.galleryTabTextActive]}>
                        {tab.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {galleryLoading ? (
                <ActivityIndicator style={styles.galleryLoader} color={chatTokens.composerActionBg} />
              ) : gallery.length ? (
                <>
                  <View style={styles.gallery}>
                    {gallery.map((attachment) => {
                      const previewUrl = resolveAttachmentUrl(pickChatAttachmentPreviewUrl(attachment));
                      const isFile = galleryKind === 'file';
                      return (
                        <Pressable
                          key={attachment.id}
                          onPress={() => onOpenAttachment?.(attachment, gallery)}
                          style={isFile ? styles.galleryFile : styles.galleryItem}
                          accessibilityRole="button"
                          accessibilityLabel={chatGalleryItemLabel(attachment)}
                        >
                          {previewUrl && !isFile ? (
                            <ChatAuthenticatedImage
                              uri={previewUrl}
                              style={styles.galleryImage}
                              accessible={false}
                            />
                          ) : (
                            <View style={isFile ? styles.galleryFileInner : styles.galleryFallback}>
                              <Text style={styles.galleryFileName} numberOfLines={2}>
                                {attachment.file_name || 'Файл'}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                  {galleryHasMore ? (
                    <Pressable
                      onPress={() => void loadMoreGallery()}
                      disabled={galleryLoadingMore}
                      style={({ pressed }) => [styles.galleryMore, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Загрузить ещё медиа"
                    >
                      {galleryLoadingMore ? (
                        <ActivityIndicator color={chatTokens.composerActionBg} />
                      ) : (
                        <Text style={styles.galleryMoreText}>Ещё</Text>
                      )}
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={styles.empty}>{chatGalleryEmptyLabel(galleryKind)}</Text>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function roleLabel(role?: string): string {
  if (role === 'owner') return 'Владелец';
  if (role === 'moderator') return 'Администратор';
  return 'Участник';
}

function SettingRow({ icon, label, value, disabled, onPress }: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
    >
      <MaterialCommunityIcons name={icon} size={23} color={chatTokens.accentText} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function ActionRow({ icon, label, onPress, disabled, danger = false }: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <MaterialCommunityIcons name={icon} size={23} color={danger ? chatTokens.dangerText : chatTokens.accentText} />
      <Text style={[styles.rowLabel, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: chatTokens.overlayBg },
  sheet: {
    maxHeight: '92%',
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: chatTokens.panelBg,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, marginTop: 8, borderRadius: 2, backgroundColor: chatTokens.borderSoft },
  content: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 },
  profile: { alignItems: 'center', paddingVertical: 10 },
  title: { marginTop: 10, color: chatTokens.textPrimary, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  subtitle: { marginTop: 3, color: chatTokens.textSecondary, fontSize: 14 },
  section: { marginTop: 12, overflow: 'hidden', borderRadius: 16, backgroundColor: chatTokens.sidebarSearchBg },
  sectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  sectionTitle: { flex: 1, color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14 },
  rowLabel: { flex: 1, color: chatTokens.textPrimary, fontSize: 16 },
  toggle: { width: 42, height: 24, padding: 2, borderRadius: 12, backgroundColor: chatTokens.borderSoft },
  toggleOn: { backgroundColor: chatTokens.composerActionBg },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: chatTokens.panelBg },
  toggleThumbOn: { alignSelf: 'flex-end' },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  memberMain: { flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12 },
  memberMenu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  memberText: { flex: 1, minWidth: 0 },
  memberName: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '600' },
  memberMeta: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 12 },
  memberRole: { maxWidth: 104, color: chatTokens.accentText, fontSize: 12, textAlign: 'right' },
  smallAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  smallActionText: { color: chatTokens.accentText, fontSize: 14, fontWeight: '600' },
  actionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: chatTokens.sidebarSearchBg },
  danger: { color: chatTokens.dangerText },
  empty: { padding: 16, color: chatTokens.textSecondary, textAlign: 'center' },
  galleryTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  galleryTab: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  galleryTabActive: { backgroundColor: chatTokens.composerActionBg },
  galleryTabText: { color: chatTokens.textSecondary, fontSize: 14, fontWeight: '600' },
  galleryTabTextActive: { color: '#fff' },
  galleryLoader: { marginVertical: 16 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingBottom: 10, gap: 6 },
  galleryItem: { width: '31%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: chatTokens.borderSoft },
  galleryImage: { width: '100%', height: '100%' },
  galleryFallback: { flex: 1, backgroundColor: chatTokens.borderSoft },
  galleryFile: {
    width: '100%',
    minHeight: 44,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: chatTokens.panelBg,
  },
  galleryFileInner: { flex: 1, justifyContent: 'center' },
  galleryFileName: { color: chatTokens.textPrimary, fontSize: 14 },
  galleryMore: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  galleryMoreText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
