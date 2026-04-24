import { alpha } from '@mui/material/styles';

export function buildChatUiTokens(theme) {
  const dark = theme.palette.mode === 'dark';
  const accent = '#3390ec';
  const accentDark = '#64b5f6';
  const activeBlue = dark ? '#2b5278' : accent;
  const ownBubble = dark ? '#2b5278' : '#d9fdd3';
  const otherBubble = dark ? '#182533' : '#ffffff';
  const darkPanel = '#17212b';
  const darkSurface = '#1f2c39';

  return {
    pageBg: dark ? '#0f1419' : '#d7e7f2',
    panelBg: dark ? darkPanel : '#ffffff',
    sidebarBg: dark ? darkPanel : '#ffffff',
    sidebarHeaderBg: dark ? alpha(darkPanel, 0.96) : alpha('#ffffff', 0.96),
    sidebarSearchBg: dark ? '#1f2c39' : '#f1f3f4',
    sidebarSearchFocusBg: dark ? '#2b3a4a' : '#ffffff',
    sidebarRowHover: dark ? alpha('#ffffff', 0.055) : alpha(accent, 0.08),
    sidebarRowPressed: dark ? alpha('#ffffff', 0.09) : alpha(accent, 0.12),
    sidebarRowActive: activeBlue,
    sidebarRowSoftActive: dark ? alpha(activeBlue, 0.54) : alpha(accent, 0.1),
    sidebarDivider: dark ? 'rgba(255,255,255,0.07)' : 'rgba(218,225,232,0.95)',

    threadBg: dark ? '#0e1621' : '#b8d4a8',
    threadTopbarBg: dark ? alpha('#17212b', 0.94) : alpha('#ffffff', 0.94),
    wallpaperPatternOpacity: dark ? 0.18 : 0.32,

    bubbleOwnBg: ownBubble,
    bubbleOwnText: dark ? '#ffffff' : '#111b21',
    bubbleOwnMetaText: dark ? 'rgba(255,255,255,0.74)' : '#5a8d44',
    bubbleOwnPreviewBg: dark ? alpha('#ffffff', 0.08) : alpha('#ffffff', 0.42),
    bubbleOwnPreviewBorder: dark ? alpha(accentDark, 0.62) : '#75a95f',
    bubbleOwnPreviewText: dark ? 'rgba(255,255,255,0.92)' : '#3d7d2b',
    bubbleOwnPreviewSubtleText: dark ? 'rgba(255,255,255,0.68)' : '#5f7f56',
    bubbleOtherBg: otherBubble,
    bubbleOtherText: dark ? '#f5f7fb' : '#111b21',
    bubbleOtherMetaText: dark ? 'rgba(255,255,255,0.52)' : '#6b7c8a',
    bubbleTailShadow: dark ? '0 1px 1px rgba(0,0,0,0.18)' : '0 1px 1px rgba(65,88,110,0.08)',

    composerBg: dark ? alpha('#17212b', 0.96) : alpha('#ffffff', 0.92),
    composerDockBg: dark ? '#1e2c3a' : '#ffffff',
    composerInputBg: dark ? '#1f2c39' : '#ffffff',
    composerActionBg: dark ? accentDark : accent,
    composerActionText: '#ffffff',
    composerActionMutedBg: dark ? '#1d2733' : '#e9eef3',

    drawerBg: dark ? darkPanel : '#ffffff',
    drawerBgStrong: dark ? '#1e2c3a' : '#f7f9fb',
    drawerBgSoft: dark ? darkSurface : '#eef3f7',
    drawerHover: dark ? alpha('#ffffff', 0.06) : alpha(accent, 0.06),

    overlayBg: dark ? 'rgba(0, 0, 0, 0.52)' : 'rgba(32,48,69,0.16)',
    borderSoft: dark ? 'rgba(255,255,255,0.08)' : 'rgba(175,186,197,0.42)',
    borderStrong: dark ? 'rgba(255,255,255,0.12)' : 'rgba(145,157,169,0.58)',
    focusRing: dark ? alpha(accentDark, 0.38) : alpha(accent, 0.3),

    textPrimary: dark ? 'rgba(255,255,255,0.92)' : '#111b21',
    textStrong: dark ? '#ffffff' : '#17212b',
    textOnAccent: '#ffffff',
    textSecondary: dark ? 'rgba(255,255,255,0.56)' : '#707579',
    searchText: dark ? 'rgba(255,255,255,0.94)' : '#17212b',
    searchPlaceholder: dark ? 'rgba(255,255,255,0.38)' : 'rgba(112,117,121,0.85)',
    sidebarSectionLabel: dark ? 'rgba(255,255,255,0.38)' : '#707579',
    sidebarActiveSubtleText: 'rgba(255,255,255,0.82)',
    sidebarDraftText: dark ? '#7dd3fc' : accent,

    servicePillBg: dark ? 'rgba(36,47,61,0.92)' : 'rgba(255,255,255,0.76)',
    servicePillText: dark ? 'rgba(255,255,255,0.72)' : '#5f6b76',

    jumpPillBg: dark ? accentDark : accent,
    jumpPillText: '#ffffff',

    headerActionBg: dark ? 'transparent' : alpha('#5f6b76', 0.06),
    headerActionActiveBg: dark ? alpha(accentDark, 0.18) : alpha(accent, 0.12),
    headerActionHoverBg: dark ? 'rgba(255,255,255,0.08)' : alpha('#5f6b76', 0.08),

    desktopShellBg: dark ? alpha(darkPanel, 0.86) : alpha('#ffffff', 0.88),
    desktopShellBorder: dark ? 'rgba(255,255,255,0.07)' : 'rgba(160,172,184,0.38)',

    contentMaxWidth: 940,
    accentSoft: dark ? alpha(accentDark, 0.16) : alpha(accent, 0.1),
    accentText: dark ? accentDark : accent,
    dangerText: dark ? '#ff8a8a' : '#d93025',
    dangerSoft: dark ? alpha('#ff8a8a', 0.14) : alpha('#d93025', 0.1),
    successText: dark ? '#7ddc8a' : '#3a8f35',
    statusSentText: dark ? 'rgba(255,255,255,0.68)' : '#6b7c8a',
    statusReadText: dark ? '#7dd3fc' : accent,
    shadowStrong: dark ? '0 18px 42px rgba(0,0,0,0.34)' : '0 16px 36px rgba(80,104,128,0.16)',
    shadowSoft: dark ? '0 2px 8px rgba(0,0,0,0.14)' : '0 1px 2px rgba(65,88,110,0.12)',
    surfaceStrong: dark ? '#242f3d' : '#ffffff',
    surfaceMuted: dark ? alpha('#ffffff', 0.045) : '#f3f5f7',
    surfaceHover: dark ? alpha('#ffffff', 0.06) : '#eef3f7',
    infoCardBg: dark ? alpha('#ffffff', 0.045) : '#f6f8fb',
    infoCardBorder: dark ? 'rgba(255,255,255,0.08)' : 'rgba(175,186,197,0.42)',
    infoCardText: dark ? 'rgba(255,255,255,0.72)' : '#5f6b76',
    filterStripBg: dark ? 'rgba(255,255,255,0.045)' : '#f7f9fb',
    filterStripBorder: dark ? 'rgba(255,255,255,0.07)' : 'rgba(183,194,205,0.52)',
    mediaBorder: dark ? alpha('#ffffff', 0.08) : 'rgba(78,99,120,0.18)',
    mediaPlaceholderBg: dark ? 'rgba(255,255,255,0.045)' : '#dfe7ec',
    fileHoverBg: dark ? alpha('#ffffff', 0.07) : '#f5f8fb',
    fileOverlayBg: dark ? alpha('#020617', 0.54) : 'rgba(19,32,45,0.52)',
    skeletonBase: dark ? alpha('#ffffff', 0.07) : alpha('#78909c', 0.14),
    skeletonWave: dark ? alpha('#ffffff', 0.12) : alpha('#ffffff', 0.52),
  };
}
