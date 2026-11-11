import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatFolderUnreadBadge } from '../../chat/chatFolders';
import type { ChatWorkspaceKey } from '../../chat/chatAiWorkspace';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';

const TABS: Array<{ key: ChatWorkspaceKey; label: string }> = [
  { key: 'chats', label: 'Чаты' },
  { key: 'ai', label: 'ИИ' },
];

export function ChatWorkspaceTabs({
  workspace,
  aiUnreadCount = 0,
  onChange,
}: {
  workspace: ChatWorkspaceKey;
  aiUnreadCount?: number;
  onChange: (workspace: ChatWorkspaceKey) => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  return (
    <View style={styles.tablist} accessibilityRole="tablist" accessibilityLabel="Раздел чата">
      {TABS.map((tab) => {
        const selected = workspace === tab.key;
        const badge = tab.key === 'ai' ? formatFolderUnreadBadge(aiUnreadCount) : '';
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, selected && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={badge ? `${tab.label}, непрочитанных ${badge}` : tab.label}
          >
            <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab.label}</Text>
            {badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  tablist: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 11,
  },
  tabActive: { backgroundColor: chatTokens.composerActionBg },
  tabText: { color: chatTokens.textSecondary, fontSize: 14, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
