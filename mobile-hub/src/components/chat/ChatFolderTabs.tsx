import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
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
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const viewport = useRef(0);
  const offset = useRef(0);
  const layouts = useRef(new Map<string, { x: number; width: number }>());
  const revealActive = useCallback(() => {
    const layout = layouts.current.get(normalizedActiveKey);
    if (!layout || !viewport.current) return;
    let next = offset.current;
    if (layout.x < next + 8) next = Math.max(0, layout.x - 8);
    else if (layout.x + layout.width > next + viewport.current - 8) {
      next = Math.max(0, layout.x + layout.width - viewport.current + 8);
    }
    if (next !== offset.current) {
      offset.current = next;
      scrollRef.current?.scrollTo({ x: next, animated: !reduceMotion });
    }
  }, [normalizedActiveKey, reduceMotion]);
  useEffect(revealActive, [revealActive]);

  return (
    <ScrollView
      ref={scrollRef}
      testID="chat-folder-tabs"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      onLayout={(event) => { viewport.current = event.nativeEvent.layout.width; revealActive(); }}
      onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.x; }}
      scrollEventThrottle={16}
    >
      {tabs.map((tab) => {
        const active = tab.key === normalizedActiveKey;
        const unread = formatFolderUnreadBadge(Number(unreadCounts[tab.key] || 0));
        return (
          <Pressable
            key={tab.key}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              layouts.current.set(tab.key, { x, width });
              if (active) revealActive();
            }}
            onPress={() => onFolderChange(tab.key)}
            style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
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
  scroll: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: chatTokens.borderSoft },
  row: { paddingHorizontal: 8, gap: 4, alignItems: 'center' },
  tab: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  tabActive: { borderBottomColor: chatTokens.accentText },
  pressed: { opacity: 0.7 },
  label: { fontSize: 15, color: chatTokens.textSecondary, fontWeight: '500' },
  labelActive: { color: chatTokens.accentText, fontWeight: '700' },
  badge: {
    minWidth: 20,
    minHeight: 20,
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  badgeActive: { backgroundColor: chatTokens.composerActionBg },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  badgeTextActive: { color: '#fff' },
});
