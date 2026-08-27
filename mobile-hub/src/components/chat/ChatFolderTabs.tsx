import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import {
  DEFAULT_CHAT_FOLDER_KEY,
  buildChatFolderTabList,
  formatFolderUnreadBadge,
  type ChatCustomFolder,
} from '../../chat/chatFolders';

export function ChatFolderTabs({
  activeFolderKey,
  customFolders = [],
  unreadCounts = {},
  onFolderChange,
}: {
  activeFolderKey: string;
  customFolders?: ChatCustomFolder[];
  unreadCounts?: Record<string, number>;
  onFolderChange: (folderKey: string) => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const tabs = buildChatFolderTabList(customFolders);
  const normalizedActiveKey = activeFolderKey || DEFAULT_CHAT_FOLDER_KEY;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === normalizedActiveKey;
        const unread = formatFolderUnreadBadge(Number(unreadCounts[tab.key] || 0));
        return (
          <Pressable
            key={tab.key}
            onPress={() => onFolderChange(tab.key)}
            style={[styles.tab, active && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={unread
              ? `Папка ${tab.label}, непрочитанных ${unread}`
              : `Папка ${tab.label}`}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
            {unread ? (
              <View style={[styles.badge, active && styles.badgeActive]}>
                <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{unread}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  scroll: { maxHeight: 52, flexGrow: 0 },
  row: { paddingHorizontal: 12, gap: 8, paddingVertical: 6, alignItems: 'center' },
  tab: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  tabActive: { backgroundColor: chatTokens.composerActionBg },
  label: { fontSize: 15, color: chatTokens.textSecondary, fontWeight: '500' },
  labelActive: { color: '#fff', fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  badgeActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  badgeTextActive: { color: '#fff' },
});
