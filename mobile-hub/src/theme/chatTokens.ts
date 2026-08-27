import { useMemo } from 'react';
import { type FluentColorScheme, useAppFluentTokens } from './fluentTokens';

/** Telegram/Nekogram-inspired roles, kept separate from the global HUB-IT theme. */
export function createChatTokens(scheme: FluentColorScheme) {
  const dark = scheme === 'dark';
  return {
    pageBg: dark ? '#0e1621' : '#e7ebf0',
    panelBg: dark ? '#17212b' : '#ffffff',
    sidebarBg: dark ? '#17212b' : '#ffffff',
    sidebarSearchBg: dark ? '#242f3d' : '#f1f3f4',
    sidebarRowActive: dark ? '#2b5278' : '#0f79bd',
    sidebarRowSoftActive: dark ? 'rgba(100, 181, 239, 0.16)' : 'rgba(51, 144, 236, 0.1)',
    sidebarDivider: dark ? 'rgba(255,255,255,0.09)' : 'rgba(218,225,232,0.88)',
    threadBg: dark ? '#0e1621' : '#dfe7eb',
    threadTopbarBg: dark ? '#17212b' : '#ffffff',
    bubbleOwnBg: dark ? '#2b5278' : '#eeffde',
    bubbleOwnText: dark ? '#f2f5f7' : '#111b21',
    bubbleOwnMetaText: dark ? '#8fc3e8' : '#5f8f4e',
    bubbleOtherBg: dark ? '#182533' : '#ffffff',
    bubbleOtherText: dark ? '#f2f5f7' : '#111b21',
    bubbleOtherMetaText: dark ? '#7f91a4' : '#7a8b97',
    bubblePressedBg: dark ? 'rgba(100, 181, 239, 0.14)' : 'rgba(51, 144, 236, 0.09)',
    composerBg: 'transparent',
    composerDockBg: dark ? '#17212b' : '#ffffff',
    composerInputBg: dark ? '#17212b' : '#ffffff',
    composerActionBg: dark ? '#2b5278' : '#0f79bd',
    composerActionText: '#ffffff',
    textPrimary: dark ? '#f2f5f7' : '#111b21',
    textSecondary: dark ? '#8f9ba8' : '#707579',
    accentText: dark ? '#64b5ef' : '#3390ec',
    statusReadText: dark ? '#64b5ef' : '#3390ec',
    borderSoft: dark ? 'rgba(255,255,255,0.12)' : 'rgba(175,186,197,0.36)',
    overlayBg: 'rgba(0,0,0,0.44)',
    datePillBg: dark ? 'rgba(23,33,43,0.9)' : 'rgba(255,255,255,0.9)',
    reactionBg: dark ? '#242f3d' : '#ffffff',
    reactionSelectedBg: dark ? '#2b5278' : '#e3f2fd',
    dangerText: dark ? '#ff7b7b' : '#d94d4d',
    warningBg: dark ? '#3a2f16' : '#fff4d6',
    warningText: dark ? '#ffd58a' : '#7a4b00',
    online: '#31b545',
  } as const;
}

export type ChatTokens = ReturnType<typeof createChatTokens>;

const CHAT_TOKENS: Record<FluentColorScheme, ChatTokens> = {
  light: createChatTokens('light'),
  dark: createChatTokens('dark'),
};

const chatStyleCache = new WeakMap<ChatTokens, WeakMap<Function, unknown>>();

export function getChatTokens(scheme: FluentColorScheme): ChatTokens {
  return CHAT_TOKENS[scheme];
}

export function useChatTokens(): ChatTokens {
  const { scheme } = useAppFluentTokens();
  return getChatTokens(scheme);
}

export function useChatStyles<T>(createStyles: (tokens: ChatTokens) => T): {
  chatTokens: ChatTokens;
  styles: T;
} {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => {
    let stylesByFactory = chatStyleCache.get(chatTokens);
    if (!stylesByFactory) {
      stylesByFactory = new WeakMap<Function, unknown>();
      chatStyleCache.set(chatTokens, stylesByFactory);
    }
    const cached = stylesByFactory.get(createStyles);
    if (cached) return cached as T;
    const created = createStyles(chatTokens);
    stylesByFactory.set(createStyles, created);
    return created;
  }, [chatTokens, createStyles]);
  return { chatTokens, styles };
}
