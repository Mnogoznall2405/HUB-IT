import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import * as chatApi from '../../api/chatApi';
import { formatApiError } from '../../api/formatError';
import type {
  ChatConversationSummary,
  ChatGlobalMessageSearchHit,
} from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import {
  DEFAULT_CHAT_FOLDER_KEY,
  buildFolderUnreadCounts,
  filterConversationsByFolder,
} from '../../chat/chatFolders';
import {
  countAiUnread,
  filterAiConversations,
  groupAiSidebarRowsByDate,
  isAiConversation,
  type ChatWorkspaceKey,
} from '../../chat/chatAiWorkspace';
import { filterConversationsByLocalQuery } from '../../chat/nativeChatLocalSearch';
import { ChatRenameSheet } from '../../components/chat/ChatGroupEditSheets';
import { AiConversationActionsSheet } from '../../components/chat/AiConversationActionsSheet';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { ChatConversationActionsSheet } from '../../components/chat/ChatConversationActionsSheet';
import { SwipeableConversationRow } from '../../components/chat/SwipeableConversationRow';
import { ChatFolderAssignSheet } from '../../components/chat/ChatFolderAssignSheet';
import { ChatFolderManagerSheet } from '../../components/chat/ChatFolderManagerSheet';
import { ChatFolderTabs } from '../../components/chat/ChatFolderTabs';
import { ChatWorkspaceTabs } from '../../components/chat/ChatWorkspaceTabs';
import { ChatConversationSkeleton } from '../../components/chat/ChatListSkeleton';
import { FolderSwipeHost } from '../../components/chat/FolderSwipeHost';
import { NewChatSheet } from '../../components/chat/NewChatSheet';
import { HubConnectionInline } from '../../components/layout/HubConnectionHeader';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { useInboxData } from './useInboxData';
import { useInboxFolders } from './useInboxFolders';
import { useInboxActions } from './useInboxActions';

type InboxListRow =
  | { key: string; type: 'header'; title: string }
  | { key: string; type: 'conversation'; item: ChatConversationSummary }
  | { key: string; type: 'message'; item: ChatGlobalMessageSearchHit };

export function NativeChatInboxScreen() {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const { user, offlineMode } = useAuth();
  const ownerId = Number(user?.id || 0);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const bottomInset = useNativeBottomNavInset();
  const mountedRef = useRef(true);
  const [workspace, setWorkspace] = useState<ChatWorkspaceKey>('chats');

  const folders = useInboxFolders({
    userId: ownerId,
    offlineMode,
    mountedRef,
    ownerRef,
    workspace,
  });
  const {
    activeFolderKey,
    setActiveFolderKey,
    customFolders,
    conversationIdsByFolder,
    systemUnreadCounts,
    setSystemUnreadCounts,
    folderManagerOpen,
    setFolderManagerOpen,
    folderBusy,
    assignConversation,
    setAssignConversation,
    folderSwipeActive,
    setFolderSwipeActive,
    loadFolders,
    changeFolder,
    swipeFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolderMembership,
    openFolderAssign,
  } = folders;

  const data = useInboxData({
    userId: ownerId,
    offlineMode,
    mountedRef,
    ownerRef,
    setActiveFolderKey,
    loadFolders,
    onConversationRead: useCallback(() => setSystemUnreadCounts({}), [setSystemUnreadCounts]),
  });
  const {
    items,
    setItems,
    itemsRef,
    loading,
    refreshing,
    loadingMore,
    error,
    setError,
    load,
    loadMore,
    remoteSearchItemsRef,
    typingByConversation,
    draftPreviews,
  } = data;

  const actions = useInboxActions({
    userId: ownerId,
    offlineMode,
    mountedRef,
    ownerRef,
    workspace,
    items,
    itemsRef,
    remoteSearchItemsRef,
    setItems,
    setError,
    load,
    loadMore,
    loadFolders,
  });
  const {
    search,
    setSearch,
    searchItems,
    searchMessages,
    searching,
    aiArchiveOpen,
    setAiArchiveOpen,
    newChatOpen,
    setNewChatOpen,
    users,
    bots,
    aiActionConversation,
    setAiActionConversation,
    actionConversation,
    setActionConversation,
    aiRenameConversation,
    setAiRenameConversation,
    aiBusy,
    resetAiContext,
    deleteAiConversation,
    renameAiConversation,
    applyConversationSettings,
    goConversation,
    openConversation,
    openConversationActions,
    muteConversation,
    archiveConversation,
    pinConversation,
    toggleReadConversation,
    refreshInbox,
    handleEndReached,
    openNewChat,
    searchNewChatUsers,
  } = actions;

  const changeWorkspace = useCallback((nextWorkspace: ChatWorkspaceKey) => {
    setWorkspace(nextWorkspace);
    if (nextWorkspace === 'ai') setAiArchiveOpen(false);
    setFolderSwipeActive(false);
  }, [setAiArchiveOpen, setFolderSwipeActive]);

  const leaveInbox = useCallback(() => {
    if (assignConversation) {
      setAssignConversation(null);
      return true;
    }
    if (folderManagerOpen) {
      setFolderManagerOpen(false);
      return true;
    }
    if (newChatOpen) {
      setNewChatOpen(false);
      return true;
    }
    router.replace('/(shell)/dashboard');
    return true;
  }, [assignConversation, folderManagerOpen, newChatOpen, setAssignConversation,
    setFolderManagerOpen, setNewChatOpen]);

  useAndroidBackHandler(leaveInbox);

  const unreadCounts = useMemo(
    () => buildFolderUnreadCounts(items, customFolders, conversationIdsByFolder, systemUnreadCounts),
    [conversationIdsByFolder, customFolders, items, systemUnreadCounts],
  );

  const aiUnreadCount = useMemo(() => countAiUnread(items), [items]);

  const filtered = useMemo(() => {
    if (workspace === 'ai') {
      return filterAiConversations(items, { archived: aiArchiveOpen, query: search });
    }
    const query = search.trim();
    const source = query
      ? (searchItems ?? filterConversationsByLocalQuery(items, query))
      : items;
    const scoped = query
      ? source
      : filterConversationsByFolder(source, activeFolderKey, conversationIdsByFolder);
    return [...scoped].sort((left, right) => {
      const leftPinned = left.is_pinned ? 1 : 0;
      const rightPinned = right.is_pinned ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      const leftTime = new Date(left.last_message_at || 0).getTime();
      const rightTime = new Date(right.last_message_at || 0).getTime();
      return rightTime - leftTime;
    });
  }, [
    activeFolderKey,
    aiArchiveOpen,
    conversationIdsByFolder,
    items,
    search,
    searchItems,
    workspace,
  ]);

  const listRows = useMemo<InboxListRow[]>(() => {
    if (workspace === 'ai') {
      return groupAiSidebarRowsByDate(filtered).flatMap((group) => ([
        { key: `h-${group.key}`, type: 'header' as const, title: group.label },
        ...group.items.map((item) => ({ key: `c-${item.id}`, type: 'conversation' as const, item })),
      ]));
    }
    if (!search.trim()) {
      return filtered.map((item) => ({ key: `c-${item.id}`, type: 'conversation', item }));
    }
    const rows: InboxListRow[] = [];
    if (filtered.length) {
      rows.push({ key: 'h-dialogs', type: 'header', title: 'Диалоги' });
      filtered.forEach((item) => rows.push({ key: `c-${item.id}`, type: 'conversation', item }));
    }
    if (searchMessages.length) {
      rows.push({ key: 'h-messages', type: 'header', title: 'Сообщения' });
      searchMessages.forEach((item) => {
        rows.push({
          key: `m-${item.conversation_id}-${item.message_id}`,
          type: 'message',
          item,
        });
      });
    }
    return rows;
  }, [filtered, search, searchMessages, workspace]);

  const listContentStyle = useMemo(() => ({ paddingBottom: bottomInset }), [bottomInset]);

  const renderInboxRow = useCallback(({ item }: ListRenderItemInfo<InboxListRow>) => {
    if (item.type === 'header') {
      return <Text style={styles.sectionTitle}>{item.title}</Text>;
    }
    if (item.type === 'message') {
      return (
        <Pressable
          onPress={() => goConversation(item.item.conversation_id, item.item.message_id)}
          style={({ pressed }) => [styles.messageHit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Сообщение в ${item.item.conversation_title}`}
        >
          <Text style={styles.messageHitTitle} numberOfLines={1}>{item.item.conversation_title}</Text>
          <Text style={styles.messageHitPreview} numberOfLines={2}>
            {[item.item.sender_name, item.item.preview].filter(Boolean).join(': ')}
          </Text>
        </Pressable>
      );
    }
    return (
      <SwipeableConversationRow
        item={item.item}
        onPress={openConversation}
        onLongPress={openConversationActions}
        onMute={muteConversation}
        onArchive={archiveConversation}
        onRead={toggleReadConversation}
        onPin={pinConversation}
        typingText={typingByConversation[item.item.id] || undefined}
        draftText={draftPreviews.get(item.item.id) || undefined}
      />
    );
  }, [
    archiveConversation,
    draftPreviews,
    goConversation,
    muteConversation,
    openConversation,
    openConversationActions,
    pinConversation,
    styles,
    toggleReadConversation,
    typingByConversation,
  ]);

  const emptyLabel = workspace === 'ai'
    ? (search.trim()
      ? 'По вашему запросу AI-диалоги не найдены.'
      : (aiArchiveOpen
        ? 'В архиве пока нет AI-диалогов.'
        : 'Нажмите «Новый AI-чат» и выберите помощника.'))
    : (search.trim() || activeFolderKey !== DEFAULT_CHAT_FOLDER_KEY
      ? 'По заданным условиям диалогов нет'
      : 'Диалогов пока нет');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.keyboard} {...chatKeyboardAvoidingProps()}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          onPress={() => router.replace('/(shell)/dashboard')}
          accessibilityLabel="Вернуться в HUB-IT"
        />
        <Pressable style={styles.headerTitleBlock} disabled={workspace !== 'chats'} accessibilityRole="button" accessibilityLabel={workspace === 'chats' ? 'Управление папками' : 'ИИ'} onPress={() => setFolderManagerOpen(true)}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {workspace === 'ai' ? (aiArchiveOpen ? 'ИИ · Архив' : 'ИИ') : 'Чат ▾'}
          </Text>
          <HubConnectionInline showHub />
        </Pressable>

        <IconButton icon="tray-arrow-up" accessibilityLabel="Очередь отправки" onPress={() => router.push('/(shell)/chat/outbox')} />
        <IconButton
          icon="message-plus-outline"
          iconColor={chatTokens.composerActionBg}
          onPress={() => void openNewChat()}
          accessibilityLabel={workspace === 'ai' ? 'Новый AI-чат' : 'Создать диалог'}
        />
      </View>

      <ChatWorkspaceTabs
        workspace={workspace}
        aiUnreadCount={aiUnreadCount}
        onChange={changeWorkspace}
      />

      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск диалогов и сообщений'}
          placeholderTextColor={chatTokens.textSecondary}
          style={styles.search}
          accessibilityLabel={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск чатов'}
          returnKeyType="search"
        />
        {workspace === 'ai' ? (
          <Pressable
            onPress={() => setAiArchiveOpen((current) => !current)}
            style={[styles.unreadToggle, aiArchiveOpen && styles.unreadToggleActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: aiArchiveOpen }}
            accessibilityLabel="Архив ИИ"
          >
            <Text style={[styles.unreadToggleText, aiArchiveOpen && styles.unreadToggleTextActive]}>
              Архив
            </Text>
          </Pressable>
        ) : null}
      </View>
      {workspace === 'chats' ? (
          <ChatFolderTabs
            activeFolderKey={activeFolderKey}
            customFolders={customFolders}
            unreadCounts={unreadCounts}
            onFolderChange={changeFolder}
          />
      ) : null}

      {loading ? (
        <View style={[styles.center, { paddingBottom: bottomInset }]} accessibilityLiveRegion="polite">
          <ChatConversationSkeleton />
        </View>
      ) : error && items.length === 0 ? (
        <View style={[styles.center, { paddingBottom: bottomInset }]} accessibilityLiveRegion="assertive">
          <Text style={styles.errorTitle}>Не удалось открыть чат</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            onPress={() => void load('initial')}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <FolderSwipeHost
          enabled={workspace === 'chats'}
          capture
          onSwipeFolder={swipeFolder}
          onSwipeEngage={setFolderSwipeActive}
        >
        <FlatList
          testID="native-chat-inbox-list"
          data={listRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={listContentStyle}
          renderItem={renderInboxRow}
          refreshControl={folderSwipeActive ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshInbox}
              tintColor={chatTokens.composerActionBg}
              colors={[chatTokens.composerActionBg]}
            />
          )}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.35}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <Text style={styles.empty}>
              {searching ? 'Ищем диалоги и сообщения…' : emptyLabel}
            </Text>
          )}
          ListFooterComponent={loadingMore && !searchItems ? (
            <ActivityIndicator style={styles.moreLoader} color={chatTokens.composerActionBg} />
          ) : null}
        />
        </FolderSwipeHost>
      )}

      <ChatFolderManagerSheet
        visible={folderManagerOpen}
        folders={customFolders}
        busy={folderBusy}
        onClose={() => setFolderManagerOpen(false)}
        onCreate={(name) => void createFolder(name)}
        onRename={(folderId, name) => void renameFolder(folderId, name)}
        onDelete={deleteFolder}
      />
      <ChatFolderAssignSheet
        conversation={assignConversation}
        folders={customFolders}
        conversationIdsByFolder={conversationIdsByFolder}
        onClose={() => setAssignConversation(null)}
        onToggle={(folderId, included) => void toggleFolderMembership(folderId, included)}
      />
      <ChatConversationActionsSheet
        conversation={actionConversation}
        onClose={() => setActionConversation(null)}
        onTogglePin={(item) => {
          setActionConversation(null);
          void applyConversationSettings(item, { is_pinned: !Boolean(item.is_pinned) });
        }}
        onToggleMute={(item, mutedUntil) => {
          setActionConversation(null);
          void applyConversationSettings(
            item,
            mutedUntil === undefined
              ? { is_muted: !Boolean(item.is_muted) }
              : { is_muted: true, muted_until: mutedUntil },
          );
        }}
        onToggleArchive={(item) => {
          setActionConversation(null);
          void applyConversationSettings(item, { is_archived: !Boolean(item.is_archived) });
        }}
        onFolders={(item) => {
          setActionConversation(null);
          openFolderAssign(item);
        }}
      />
      <AiConversationActionsSheet
        conversation={aiActionConversation}
        onClose={() => setAiActionConversation(null)}
        onRename={(item) => {
          setAiActionConversation(null);
          setAiRenameConversation(item);
        }}
        onResetContext={(item) => {
          setAiActionConversation(null);
          resetAiContext(item);
        }}
        onDelete={(item) => {
          setAiActionConversation(null);
          deleteAiConversation(item);
        }}
      />
      <ChatRenameSheet
        visible={Boolean(aiRenameConversation)}
        initialTitle={aiRenameConversation?.title || ''}
        busy={aiBusy}
        heading="Название диалога"
        inputLabel="Новое название диалога"
        onClose={() => setAiRenameConversation(null)}
        onSave={(nextTitle) => void renameAiConversation(nextTitle)}
      />
      <NewChatSheet
        visible={newChatOpen}
        users={users}
        bots={bots}
        variant={workspace === 'ai' ? 'ai' : 'chats'}
        onClose={() => setNewChatOpen(false)}
        onGeneralAi={async () => {
          try {
            const conversation = await chatApi.createAiConversation();
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось открыть AI-диалог', formatApiError(cause));
          }
        }}
        onDirect={async (userId) => {
          try {
            const conversation = await chatApi.createDirectConversation(userId);
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось создать диалог', formatApiError(cause));
          }
        }}
        onSearchUsers={searchNewChatUsers}
        onGroup={async (title, memberIds) => {
          try {
            const conversation = await chatApi.createGroupConversation(title, memberIds);
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось создать группу', formatApiError(cause));
          }
        }}
        onBot={async (botId) => {
          try {
            const conversation = await chatApi.openAiBot(botId);
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось открыть AI-диалог', formatApiError(cause));
          }
        }}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: chatTokens.sidebarBg },
  keyboard: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    backgroundColor: chatTokens.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  headerTitleBlock: { flex: 1, minWidth: 0, justifyContent: 'center' },
  headerTitle: { fontSize: 20, lineHeight: 24, fontWeight: '700', color: chatTokens.textPrimary },
  searchWrap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, gap: 8 },
  search: {
    minHeight: 44,
    backgroundColor: chatTokens.sidebarSearchBg,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: chatTokens.textPrimary,
  },
  unreadToggle: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  unreadToggleActive: { backgroundColor: chatTokens.composerActionBg },
  unreadToggleText: { color: chatTokens.textSecondary, fontSize: 13, fontWeight: '600' },
  unreadToggleTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorTitle: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateText: { color: chatTokens.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: {
    minWidth: 120,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: chatTokens.composerActionBg,
  },
  retryText: { color: chatTokens.composerActionText, fontSize: 15, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  empty: { textAlign: 'center', marginTop: 48, color: chatTokens.textSecondary, fontSize: 15 },
  moreLoader: { marginVertical: 16 },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    color: chatTokens.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  messageHit: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: chatTokens.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  messageHitTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  messageHitPreview: { color: chatTokens.textSecondary, fontSize: 14, marginTop: 2, lineHeight: 18 },
});
