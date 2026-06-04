import { alpha } from '@mui/material/styles';

export const CHAT_FONT_FAMILY = [
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');

export const CHAT_DEFAULT_FONT_SIZES = Object.freeze({
  desktopPrimary: '16px',
  desktopCompactPrimary: '15px',
  mobileBody: '15px',
  mobileComposer: '16px',
  meta: '13px',
  composerAux: '13px',
  sender: '16px',
  previewTitle: '15px',
  previewBody: '14px',
  headerTitleMobile: '17.5px',
  headerSubtitleMobile: '13px',
});

export const CHAT_DEFAULT_LINE_HEIGHTS = Object.freeze({
  desktopBody: 1.3,
  desktopCompactBody: 1.26,
  mobileBody: 1.34,
});

const SPACIOUS_CHAT_DENSITY = {
  mode: 'spacious',
  chatPrimaryFontSize: CHAT_DEFAULT_FONT_SIZES.desktopPrimary,
  chatPrimaryLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.desktopBody,
  touchTarget: 44,
  contentMaxWidth: 940,
  sidebarColumnMin: 320,
  sidebarColumnMax: 400,
  sidebarAvatar: 52,
  sidebarAvatarMobile: 54,
  sidebarActionButton: 36,
  sidebarActionButtonMobile: 44,
  sidebarHeaderIcon: 42,
  sidebarSearchHeight: 48,
  sidebarSearchFontSize: '16px',
  sidebarRowMinHeight: 66,
  sidebarRowPx: 12,
  sidebarRowPy: 10,
  sidebarRowMx: 6,
  sidebarRowMy: 2,
  sidebarRowRadius: 12,
  sidebarResultRowPx: 14,
  sidebarResultRowPy: 12,
  sidebarTitleFontSize: '15px',
  sidebarResultTitleFontSize: '16px',
  sidebarPreviewFontSize: '12.5px',
  sidebarSectionFontSize: '11px',
  composerDockPx: 1.1,
  composerDockPxMd: 1.6,
  composerDockPt: 0.7,
  composerDockPb: 0.7,
  composerCapsuleMinHeight: 42,
  composerCapsulePx: 10,
  composerCapsulePy: 1,
  composerInnerPaddingY: 0,
  composerInputSlotMinHeight: 30,
  composerIconButton: 30,
  composerActionSize: 42,
  composerActionIcon: 20,
  composerFontSize: CHAT_DEFAULT_FONT_SIZES.desktopPrimary,
  composerLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.desktopBody,
  composerAuxFontSize: CHAT_DEFAULT_FONT_SIZES.composerAux,
  composerTextareaMinHeight: 21,
  composerTextareaMaxHeight: 120,
  composerReplyMarginBottom: 12,
  composerReplyPadding: '12px 16px',
  composerAttachmentMarginBottom: 10,
  composerAttachmentPadding: '10px 12px',
  composerAttachmentChipHeight: 28,
  composerAttachmentActionHeight: 32,
  composerMentionMinHeight: 48,
  composerMentionAvatar: 34,
  composerMentionTitleFontSize: 14.5,
  composerMentionMetaFontSize: 12.5,
  threadHeaderAction: 34,
  threadHeaderAvatar: 42,
  threadHeaderTitleFontSize: CHAT_DEFAULT_FONT_SIZES.desktopPrimary,
  threadHeaderSubtitleFontSize: '0.82rem',
  threadHeaderPx: 1.6,
  threadHeaderPb: 0.78,
  threadScrollPxMd: 3.5,
  threadScrollPtMd: 1.8,
  threadScrollPbMd: 18,
  threadPinnedIcon: 30,
  threadPinnedClose: 32,
  dialogTitlePadding: '20px 24px 12px',
  dialogContentPadding: '16px 24px',
  dialogActionsPadding: '10px 24px 18px',
  dialogMenuItemMinHeight: 44,
  dialogMenuItemPx: 1.8,
  dialogMenuItemPy: 1,
  dialogMenuItemGap: 1.55,
  dialogMenuFontSize: '1.05rem',
  dialogMenuIconSize: 22,
  dialogForwardWidth: 'min(100vw - 24px, 560px)',
  dialogForwardHeight: 'min(calc(100dvh - 28px), 760px)',
  dialogForwardAvatar: 52,
  dialogForwardRowPx: 1.45,
  dialogForwardRowPy: 1.2,
  bubbleBodyFontSize: CHAT_DEFAULT_FONT_SIZES.desktopPrimary,
  bubbleBodyLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.desktopBody,
  bubbleBodyMobileFontSize: CHAT_DEFAULT_FONT_SIZES.mobileBody,
  bubbleBodyMobileLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.mobileBody,
  bubbleMetaFontSize: CHAT_DEFAULT_FONT_SIZES.meta,
  bubbleSenderFontSize: CHAT_DEFAULT_FONT_SIZES.sender,
  bubblePreviewTitleFontSize: CHAT_DEFAULT_FONT_SIZES.previewTitle,
  bubblePreviewBodyFontSize: CHAT_DEFAULT_FONT_SIZES.previewBody,
  bubbleBodyBottomPadding: 1.55,
  bubbleReactionBodyBottomPadding: 0.35,
  bubbleRowPt: 1.0,
  bubbleSenderRowPt: 0.35,
  bubblePx: 1.18,
  bubblePy: 0.82,
};

const COMPACT_DESKTOP_CHAT_DENSITY = {
  ...SPACIOUS_CHAT_DENSITY,
  mode: 'compact-desktop',
  chatPrimaryFontSize: CHAT_DEFAULT_FONT_SIZES.desktopCompactPrimary,
  chatPrimaryLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.desktopCompactBody,
  contentMaxWidth: 860,
  sidebarColumnMin: 280,
  sidebarColumnMax: 340,
  sidebarAvatar: 40,
  sidebarActionButton: 32,
  sidebarHeaderIcon: 36,
  sidebarSearchHeight: 38,
  sidebarSearchFontSize: '14px',
  sidebarRowMinHeight: 48,
  sidebarRowPx: 8,
  sidebarRowPy: 4,
  sidebarRowMx: 4,
  sidebarRowMy: 0,
  sidebarRowRadius: 9,
  sidebarResultRowPx: 10,
  sidebarResultRowPy: 6,
  sidebarTitleFontSize: '14px',
  sidebarResultTitleFontSize: '14px',
  sidebarPreviewFontSize: '11.5px',
  sidebarSectionFontSize: '9.5px',
  composerDockPx: 0.8,
  composerDockPxMd: 1.0,
  composerDockPt: 0.35,
  composerDockPb: 0.35,
  composerCapsuleMinHeight: 34,
  composerCapsulePx: 8,
  composerCapsulePy: 0,
  composerInnerPaddingY: 0,
  composerInputSlotMinHeight: 26,
  composerIconButton: 26,
  composerActionSize: 34,
  composerActionIcon: 18,
  composerFontSize: CHAT_DEFAULT_FONT_SIZES.desktopCompactPrimary,
  composerLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.desktopCompactBody,
  composerAuxFontSize: '12px',
  composerTextareaMinHeight: 19,
  composerTextareaMaxHeight: 104,
  composerReplyMarginBottom: 8,
  composerReplyPadding: '8px 12px',
  composerAttachmentMarginBottom: 8,
  composerAttachmentPadding: '7px 10px',
  composerAttachmentChipHeight: 24,
  composerAttachmentActionHeight: 28,
  composerMentionMinHeight: 38,
  composerMentionAvatar: 28,
  composerMentionTitleFontSize: 13,
  composerMentionMetaFontSize: 11.5,
  threadHeaderAction: 30,
  threadHeaderAvatar: 36,
  threadHeaderTitleFontSize: CHAT_DEFAULT_FONT_SIZES.desktopCompactPrimary,
  threadHeaderSubtitleFontSize: '0.74rem',
  threadHeaderPx: 1.0,
  threadHeaderPb: 0.5,
  threadScrollPxMd: 2.2,
  threadScrollPtMd: 1.0,
  threadScrollPbMd: 12,
  threadPinnedIcon: 24,
  threadPinnedClose: 28,
  dialogTitlePadding: '12px 16px 8px',
  dialogContentPadding: '12px 16px',
  dialogActionsPadding: '8px 16px 12px',
  dialogMenuItemMinHeight: 36,
  dialogMenuItemPx: 1.2,
  dialogMenuItemPy: 0.55,
  dialogMenuItemGap: 1.0,
  dialogMenuFontSize: '0.92rem',
  dialogMenuIconSize: 18,
  dialogForwardWidth: 'min(100vw - 20px, 500px)',
  dialogForwardHeight: 'min(calc(100dvh - 24px), 660px)',
  dialogForwardAvatar: 44,
  dialogForwardRowPx: 1.05,
  dialogForwardRowPy: 0.75,
  bubbleBodyFontSize: CHAT_DEFAULT_FONT_SIZES.desktopCompactPrimary,
  bubbleBodyLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.desktopCompactBody,
  bubbleMetaFontSize: '12px',
  bubbleSenderFontSize: '14px',
  bubblePreviewTitleFontSize: '13.5px',
  bubblePreviewBodyFontSize: '12.5px',
  bubbleBodyBottomPadding: 1.3,
  bubbleReactionBodyBottomPadding: 0.25,
  bubbleRowPt: 0.75,
  bubbleSenderRowPt: 0.28,
  bubblePx: 0.78,
  bubblePy: 0.5,
};

const MOBILE_CHAT_DENSITY = {
  ...SPACIOUS_CHAT_DENSITY,
  mode: 'mobile',
  sidebarActionButton: 44,
  sidebarActionButtonMobile: 44,
  sidebarSearchHeight: 48,
  composerCapsuleMinHeight: 46,
  composerActionSize: 46,
  composerAttachmentActionHeight: 44,
  composerFontSize: CHAT_DEFAULT_FONT_SIZES.mobileComposer,
  composerLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.mobileBody,
  composerTextareaMinHeight: 18,
  bubbleBodyLineHeight: CHAT_DEFAULT_LINE_HEIGHTS.mobileBody,
  bubbleBodyBottomPadding: 1.8,
  bubbleReactionBodyBottomPadding: 0.35,
  threadHeaderAction: 44,
  dialogMenuItemMinHeight: 44,
};

export function buildChatDensityTokens({ compactDesktop = false, compactMobile = false } = {}) {
  if (compactMobile) return MOBILE_CHAT_DENSITY;
  if (compactDesktop) return COMPACT_DESKTOP_CHAT_DENSITY;
  return SPACIOUS_CHAT_DENSITY;
}

export const CHAT_BUBBLE_BODY_FONT_VAR = '--chat-bubble-body-font-size';

export function getChatBubbleBodyFontSize(ui, compactMobile = false) {
  const density = ui?.density || {};
  if (compactMobile) {
    return density.bubbleBodyMobileFontSize || CHAT_DEFAULT_FONT_SIZES.mobileBody;
  }
  return density.bubbleBodyFontSize || density.chatPrimaryFontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary;
}

export function getChatBubbleBodyLineHeight(ui, compactMobile = false) {
  const density = ui?.density || {};
  if (compactMobile) {
    return density.bubbleBodyMobileLineHeight || density.bubbleBodyLineHeight || CHAT_DEFAULT_LINE_HEIGHTS.mobileBody;
  }
  return density.bubbleBodyLineHeight || density.chatPrimaryLineHeight || CHAT_DEFAULT_LINE_HEIGHTS.desktopBody;
}

export function getChatComposerBodyFontSize(ui, compactMobile = false) {
  const density = ui?.density || {};
  if (compactMobile) {
    return density.composerFontSize || CHAT_DEFAULT_FONT_SIZES.mobileComposer;
  }
  return density.composerFontSize || density.chatPrimaryFontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary;
}

export function getChatComposerLineHeight(ui, compactMobile = false) {
  const density = ui?.density || {};
  if (compactMobile) {
    return density.composerLineHeight || CHAT_DEFAULT_LINE_HEIGHTS.mobileBody;
  }
  return density.composerLineHeight || density.chatPrimaryLineHeight || CHAT_DEFAULT_LINE_HEIGHTS.desktopBody;
}

const CHAT_MESSAGE_BODY_SELECTOR = '& [data-chat-message-body="true"]:not([data-chat-emoji-only="true"])';

/** Thread-level overrides: beats MUI body1/compact theme and rem-based markdown on compact desktop. */
export function buildChatThreadMessageBodyTypographySx(ui, compactMobile = false) {
  const fontSize = getChatBubbleBodyFontSize(ui, compactMobile);
  const lineHeight = getChatBubbleBodyLineHeight(ui, compactMobile);
  return {
    [CHAT_BUBBLE_BODY_FONT_VAR]: fontSize,
    [CHAT_MESSAGE_BODY_SELECTOR]: {
      fontSize: `${fontSize} !important`,
      lineHeight: `${lineHeight} !important`,
    },
    [`${CHAT_MESSAGE_BODY_SELECTOR} [data-markdown-variant="chat"]`]: {
      fontSize: 'inherit !important',
    },
    [`${CHAT_MESSAGE_BODY_SELECTOR} .MuiTypography-root`]: {
      fontSize: 'inherit !important',
    },
    [`${CHAT_MESSAGE_BODY_SELECTOR} p, ${CHAT_MESSAGE_BODY_SELECTOR} li, ${CHAT_MESSAGE_BODY_SELECTOR} ul, ${CHAT_MESSAGE_BODY_SELECTOR} ol, ${CHAT_MESSAGE_BODY_SELECTOR} blockquote`]: {
      fontSize: 'inherit !important',
    },
  };
}

export function buildChatMessageBodySurfaceSx(fontSize, lineHeight = CHAT_DEFAULT_LINE_HEIGHTS.desktopBody) {
  const size = String(fontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary);
  return {
    fontSize: size,
    lineHeight,
  };
}

export function buildChatUiTokens(theme, options = {}) {
  const dark = theme.palette.mode === 'dark';
  const density = buildChatDensityTokens(options);
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
    bubbleOwnLinkText: dark ? 'rgba(255,255,255,0.95)' : '#3d7d2b',
    bubbleOwnLinkMuted: dark ? 'rgba(255,255,255,0.68)' : '#5f7f56',
    bubbleOwnLinkBorder: dark ? alpha('#ffffff', 0.5) : '#75a95f',
    bubbleOwnLinkBg: dark ? alpha('#ffffff', 0.08) : alpha('#ffffff', 0.42),
    bubbleOtherBg: otherBubble,
    bubbleOtherText: dark ? '#f5f7fb' : '#111b21',
    bubbleOtherLinkText: dark ? accentDark : accent,
    bubbleOtherLinkMuted: dark ? 'rgba(255,255,255,0.56)' : '#707579',
    bubbleOtherLinkBorder: dark ? accentDark : accent,
    bubbleOtherLinkBg: dark ? alpha(accentDark, 0.12) : alpha(accent, 0.06),
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

    contentMaxWidth: density.contentMaxWidth,
    density,
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

export function resolveChatBubbleLinkColors(ui, isOwn = false) {
  if (!ui) {
    return { text: '', muted: '', border: '', bg: '' };
  }
  if (isOwn) {
    return {
      text: ui.bubbleOwnLinkText,
      muted: ui.bubbleOwnLinkMuted,
      border: ui.bubbleOwnLinkBorder,
      bg: ui.bubbleOwnLinkBg,
    };
  }
  return {
    text: ui.bubbleOtherLinkText,
    muted: ui.bubbleOtherLinkMuted,
    border: ui.bubbleOtherLinkBorder,
    bg: ui.bubbleOtherLinkBg,
  };
}
