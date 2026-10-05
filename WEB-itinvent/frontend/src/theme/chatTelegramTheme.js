import { alpha } from '@mui/material/styles';

/**
 * Фаза Д1/Д2: токены «как Telegram Web A» для страницы чата.
 * Ограничены колонкой списка бесед (ChatSidebar) и каркасом страницы — общие
 * chatUiTokens и лента/композитор/пузыри остаются пакетам Д3–Д5.
 */
export const CHAT_TELEGRAM_SIDEBAR_LAYOUT = Object.freeze({
  defaultWidth: 420,
  // Д2-5 (п. 5): список сужается до ~260 px в узком окне, как в Telegram Desktop.
  minWidth: 260,
  maxWidth: 520,
  railWidth: 72,
  threadMinWidth: 360,
  rowHeight: 58,
  avatarSize: 42,
  searchHeight: 42,
  searchRadius: 22,
  unreadBadgeSize: 22,
  folderTabIndicatorHeight: 3,
  folderTabFontSize: 15,
});

export const CHAT_TELEGRAM_COLORS = Object.freeze({
  light: {
    accent: '#3390ec',
    sidebarBg: '#ffffff',
    surfaceMuted: '#f4f4f5',
    secondaryText: '#707579',
    mutedBadge: '#c4c9cc',
    readCheck: '#4fae4e',
    rowHover: '#f4f4f5',
    divider: 'rgba(0,0,0,0.06)',
    searchPlaceholder: 'rgba(112,117,121,0.8)',
  },
  dark: {
    // Д2-1 (раздел 29): ночная палитра Telegram Desktop, фиолетовый убран.
    accent: '#5288c1',
    accentText: '#64b5ef',
    sidebarBg: '#17212b',
    surfaceMuted: '#0e1621',
    secondaryText: '#aaaaaa',
    mutedBadge: '#3e454a',
    // На синих собственных пузырях галочки остаются светлыми.
    readCheck: 'rgba(255,255,255,0.86)',
    rowHover: 'rgba(255,255,255,0.06)',
    divider: 'rgba(255,255,255,0.07)',
    searchPlaceholder: 'rgba(255,255,255,0.45)',
  },
});

/** Телеграм-палитра круглых аватаров (Web A): цвет определяется id беседы. */
export const CHAT_TELEGRAM_AVATAR_COLORS = Object.freeze([
  '#cc5049',
  '#d67722',
  '#955cdb',
  '#40a920',
  '#42a9c9',
  '#368ad1',
  '#c7508b',
]);

export function resolveChatTelegramAvatarColor(seed) {
  const text = String(seed || '').trim();
  if (!text) return CHAT_TELEGRAM_AVATAR_COLORS[5];
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return CHAT_TELEGRAM_AVATAR_COLORS[hash % CHAT_TELEGRAM_AVATAR_COLORS.length];
}

/**
 * Возвращает копию ui-токенов чата с переопределёнными ключами сайдбара.
 * Остальные ключи (лента, пузыри, композитор, диалоги) сохраняются как есть.
 */
export function applyChatTelegramSidebarTokens(ui, theme) {
  const dark = theme?.palette?.mode === 'dark';
  const colors = dark ? CHAT_TELEGRAM_COLORS.dark : CHAT_TELEGRAM_COLORS.light;
  const accent = colors.accent;
  const accentText = colors.accentText || accent;
  const density = {
    ...(ui?.density || {}),
    sidebarAvatar: CHAT_TELEGRAM_SIDEBAR_LAYOUT.avatarSize,
    sidebarAvatarMobile: CHAT_TELEGRAM_SIDEBAR_LAYOUT.avatarSize,
    sidebarSearchHeight: CHAT_TELEGRAM_SIDEBAR_LAYOUT.searchHeight,
    sidebarSearchFontSize: '14px',
    sidebarRowMinHeight: CHAT_TELEGRAM_SIDEBAR_LAYOUT.rowHeight,
    sidebarRowPx: 9,
    sidebarRowPy: 9,
    sidebarRowMx: 8,
    sidebarRowMy: 1,
    sidebarRowRadius: 10,
    sidebarResultRowPx: 9,
    sidebarResultRowPy: 9,
    sidebarTitleFontSize: '16px',
    sidebarResultTitleFontSize: '16px',
    sidebarPreviewFontSize: '15px',
    sidebarSectionFontSize: '12px',
    sidebarUnreadBadge: CHAT_TELEGRAM_SIDEBAR_LAYOUT.unreadBadgeSize,
  };

  return {
    ...(ui || {}),
    density,
    sidebarBg: colors.sidebarBg,
    sidebarHeaderBg: alpha(colors.sidebarBg, 0.94),
    sidebarSearchBg: colors.surfaceMuted,
    sidebarSearchFocusBg: colors.surfaceMuted,
    sidebarRowHover: colors.rowHover,
    sidebarRowActive: accent,
    // В Telegram непрочитанная строка не заливается: акцент на бейдже и времени.
    sidebarRowUnread: 'transparent',
    sidebarRowUnreadBorder: 'transparent',
    sidebarUnreadIndicator: accent,
    sidebarUnreadText: accentText,
    sidebarDivider: colors.divider,
    unreadBadgeBg: accent,
    unreadBadgeText: '#ffffff',
    unreadActiveBadgeBg: '#ffffff',
    unreadActiveBadgeText: accent,
    unreadMutedBadgeBg: colors.mutedBadge,
    unreadMutedBadgeText: '#ffffff',
    // Активная папка — акцентный текст + полоса 3px (не пилюля).
    folderTabActiveBg: accent,
    folderTabActiveText: accentText,
    folderTabActiveBadgeBg: accent,
    folderTabActiveBadgeText: '#ffffff',
    // Сегмент «Чаты / ИИ» остаётся залитым — свои токены, чтобы не смешиваться с underline-вкладками.
    workspaceTabActiveBg: accent,
    workspaceTabActiveText: '#ffffff',
    workspaceTabActiveBadgeBg: '#ffffff',
    workspaceTabActiveBadgeText: accent,
    textSecondary: colors.secondaryText,
    accentText,
    accentSoft: alpha(accent, dark ? 0.2 : 0.1),
    sidebarSectionLabel: colors.secondaryText,
    sidebarActiveSubtleText: 'rgba(255,255,255,0.82)',
    sidebarDraftText: accentText,
    statusReadText: colors.readCheck,
    focusRing: alpha(accent, 0.32),
    filterStripBg: colors.surfaceMuted,
    headerActionBg: 'transparent',
    searchPlaceholder: colors.searchPlaceholder,
    // Плавающая кнопка «новый чат» внизу справа колонки списка.
    composeFabBg: accent,
    composeFabText: '#ffffff',
    composeFabShadow: dark ? '0 6px 16px rgba(0,0,0,0.4)' : '0 6px 16px rgba(51,144,236,0.4)',
    skeletonBase: dark ? alpha('#ffffff', 0.08) : alpha('#5f6b76', 0.12),
    skeletonWave: dark ? alpha('#ffffff', 0.14) : alpha('#ffffff', 0.55),
  };
}
