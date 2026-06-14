import { alpha } from '@mui/material/styles';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

export const MAIL_UI_FONT_FAMILY = '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Roboto", Arial, sans-serif';
export const MAIL_MESSAGE_FONT_FAMILY = '"Aptos", "Calibri", "Segoe UI", Arial, sans-serif';
export const MAIL_MONO_FONT_FAMILY = '"Cascadia Mono", "Consolas", "Courier New", monospace';

export const MAIL_UI_RADII = {
  xxs: '4px',
  xs: '6px',
  sm: '8px',
  md: '10px',
  lg: '12px',
  sheet: '18px',
  round: '999px',
};

export function getMailTypographyVars() {
  return {
    '--mail-ui-font': MAIL_UI_FONT_FAMILY,
    '--mail-message-font': MAIL_MESSAGE_FONT_FAMILY,
    '--mail-mono-font': MAIL_MONO_FONT_FAMILY,
  };
}

export function getMailUiFontScopeSx(overrides = {}) {
  return {
    ...getMailTypographyVars(),
    fontFamily: 'var(--mail-ui-font)',
    '& .MuiTypography-root, & .MuiButton-root, & .MuiInputBase-root, & .MuiChip-root, & .MuiMenuItem-root, & .MuiFormLabel-root, & .MuiListItemText-primary, & .MuiListItemText-secondary': {
      fontFamily: 'var(--mail-ui-font)',
    },
    ...overrides,
  };
}

export function buildMailUiTokens(theme) {
  const office = buildOfficeUiTokens(theme);
  const primaryBase = theme.palette.primary.main;
  const neutralSelectedBg = office.isDark
    ? alpha(theme.palette.common.white, 0.07)
    : alpha(theme.palette.common.black, 0.055);
  const neutralSelectedHover = office.isDark
    ? alpha(theme.palette.common.white, 0.1)
    : alpha(theme.palette.common.black, 0.075);
  const neutralBulkSelectedBg = office.isDark
    ? alpha(theme.palette.common.white, 0.045)
    : alpha(theme.palette.common.black, 0.03);
  const neutralBulkSelectedHover = office.isDark
    ? alpha(theme.palette.common.white, 0.065)
    : alpha(theme.palette.common.black, 0.045);

  return {
    ...office,
    isDark: office.isDark,
    shellBorder: office.borderSoft,
    panelBg: office.panelBg,
    panelBorder: office.borderSoft,
    surfaceBg: office.actionBg,
    surfaceBorder: office.actionBorder,
    surfaceHover: office.actionHover,
    actionBg: office.actionBg,
    actionBorder: office.actionBorder,
    actionHover: office.actionHover,
    selectedBg: neutralSelectedBg,
    selectedHover: neutralSelectedHover,
    selectedBorder: alpha(primaryBase, office.isDark ? 0.56 : 0.32),
    bulkSelectedBg: neutralBulkSelectedBg,
    bulkSelectedHover: neutralBulkSelectedHover,
    bulkSelectedBorder: alpha(primaryBase, office.isDark ? 0.28 : 0.16),
    textPrimary: theme.palette.text.primary,
    textSecondary: office.mutedText,
    iconColor: office.iconPrimary,
    menuBg: office.panelSolid,
    shadow: office.shellShadow,
    transition: 'background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease',
    focusRing: `0 0 0 3px ${alpha(primaryBase, office.isDark ? 0.24 : 0.16)}`,
    radius: MAIL_UI_RADII,
    radiusXs: MAIL_UI_RADII.xs,
    radiusSm: MAIL_UI_RADII.sm,
    radiusMd: MAIL_UI_RADII.md,
    radiusLg: MAIL_UI_RADII.lg,
    controlRadius: MAIL_UI_RADII.md,
    iconButtonRadius: MAIL_UI_RADII.md,
    inputRadius: MAIL_UI_RADII.md,
    menuRadius: MAIL_UI_RADII.lg,
    dialogRadius: MAIL_UI_RADII.lg,
    sheetRadius: MAIL_UI_RADII.sheet,
    chipRadius: MAIL_UI_RADII.xs,
    badgeRadius: MAIL_UI_RADII.xs,
    rowMinHeight: 54,
    rowCompactMinHeight: 46,
    toolbarHeight: 44,
    mobileToolbarHeight: 46,
    bulkBarHeight: 68,
    bulkBottomBarBg: office.isDark
      ? alpha(theme.palette.background.paper, 0.96)
      : alpha(theme.palette.background.paper, 0.98),
    bulkActionSize: 48,
    sheetHandleColor: office.isDark
      ? alpha(theme.palette.common.white, 0.24)
      : alpha(theme.palette.common.black, 0.18),
    fontSizeMeta: '0.8rem',
    fontSizeFine: '0.78rem',
    fontSizeLabel: '0.82rem',
    mobilePreviewSubjectFontSize: '1.28rem',
    mobilePreviewSenderFontSize: '0.95rem',
    mobilePreviewMetaColor: office.mutedText,
    metadataEmailLinkColor: office.isDark ? '#e7c66a' : '#b45309',
    lineHeightMeta: 1.35,
    uiFontFamily: MAIL_UI_FONT_FAMILY,
    messageFontFamily: MAIL_MESSAGE_FONT_FAMILY,
    monoFontFamily: MAIL_MONO_FONT_FAMILY,
    typographyVars: getMailTypographyVars(),
  };
}

export function getMailSoftActionStyles(theme, tokens, color = 'inherit') {
  if (color === 'error' || color === 'success') {
    const palette = theme.palette[color];

    return {
      color: tokens.isDark ? palette.light : palette.dark,
      borderColor: alpha(palette.main, tokens.isDark ? 0.36 : 0.22),
      bgcolor: alpha(palette.main, tokens.isDark ? 0.18 : 0.08),
      '&:hover': {
        borderColor: alpha(palette.main, tokens.isDark ? 0.5 : 0.3),
        bgcolor: alpha(palette.main, tokens.isDark ? 0.28 : 0.14),
      },
    };
  }

  return {
    color: tokens.textPrimary,
    borderColor: tokens.actionBorder,
    bgcolor: tokens.actionBg,
    '&:hover': {
      borderColor: tokens.surfaceBorder,
      bgcolor: tokens.actionHover,
    },
  };
}

export function getMailMetaTextSx(tokens, overrides = {}) {
  return {
    color: tokens.textSecondary,
    fontSize: tokens.fontSizeMeta,
    lineHeight: tokens.lineHeightMeta,
    ...overrides,
  };
}

export function getMailIconButtonSx(tokens, overrides = {}) {
  return {
    width: 38,
    height: 38,
    borderRadius: tokens.iconButtonRadius || MAIL_UI_RADII.md,
    color: tokens.textPrimary,
    bgcolor: tokens.surfaceBg,
    border: '1px solid',
    borderColor: tokens.surfaceBorder,
    transition: tokens.transition,
    '&:hover': {
      bgcolor: tokens.surfaceHover,
      borderColor: tokens.panelBorder,
      transform: 'translateY(-1px)',
    },
    '&:active': {
      transform: 'translateY(0px) scale(0.98)',
    },
    '&.Mui-focusVisible': {
      boxShadow: tokens.focusRing,
    },
    ...overrides,
  };
}

export function getMailSurfaceButtonSx(tokens, overrides = {}) {
  return {
    minHeight: 38,
    borderRadius: tokens.controlRadius || MAIL_UI_RADII.md,
    textTransform: 'none',
    color: tokens.textPrimary,
    bgcolor: tokens.surfaceBg,
    border: '1px solid',
    borderColor: tokens.surfaceBorder,
    fontWeight: 700,
    transition: tokens.transition,
    '&:hover': {
      bgcolor: tokens.surfaceHover,
      borderColor: tokens.panelBorder,
    },
    '&:active': {
      transform: 'scale(0.99)',
    },
    '&.Mui-focusVisible': {
      boxShadow: tokens.focusRing,
    },
    ...overrides,
  };
}

export function getMailTextFieldSx(tokens, overrides = {}) {
  return {
    '& .MuiOutlinedInput-root': {
      borderRadius: tokens.inputRadius || MAIL_UI_RADII.md,
      bgcolor: tokens.surfaceBg,
      color: tokens.textPrimary,
      transition: tokens.transition,
      '& fieldset': {
        borderColor: tokens.surfaceBorder,
      },
      '&:hover fieldset': {
        borderColor: tokens.panelBorder,
      },
      '&.Mui-focused': {
        boxShadow: tokens.focusRing,
      },
      '&.Mui-focused fieldset': {
        borderColor: tokens.selectedBorder,
      },
    },
    ...overrides,
  };
}

export function getMailDialogPaperSx(tokens, overrides = {}) {
  return {
    ...getMailUiFontScopeSx(),
    borderRadius: tokens.dialogRadius || MAIL_UI_RADII.lg,
    border: '1px solid',
    borderColor: tokens.panelBorder || tokens.borderSoft,
    bgcolor: tokens.panelSolid,
    backgroundImage: 'none',
    boxShadow: tokens.dialogShadow || tokens.shadow,
    overflow: 'hidden',
    ...overrides,
  };
}

export function getMailDialogTitleSx(tokens, overrides = {}) {
  return {
    px: 2,
    py: 1.35,
    fontFamily: 'var(--mail-ui-font)',
    fontWeight: 800,
    fontSize: '1rem',
    lineHeight: 1.35,
    color: tokens.textPrimary,
    bgcolor: tokens.panelSolid,
    borderBottom: '1px solid',
    borderColor: tokens.panelBorder || tokens.borderSoft,
    ...overrides,
  };
}

export function getMailDialogContentSx(tokens, overrides = {}) {
  return {
    px: 2,
    py: 1.5,
    fontFamily: 'var(--mail-ui-font)',
    bgcolor: tokens.panelBg,
    color: tokens.textPrimary,
    borderColor: tokens.panelBorder || tokens.borderSoft,
    ...overrides,
  };
}

export function getMailDialogActionsSx(tokens, overrides = {}) {
  return {
    px: 2,
    py: 1.15,
    gap: 0.7,
    fontFamily: 'var(--mail-ui-font)',
    bgcolor: tokens.panelSolid,
    borderTop: '1px solid',
    borderColor: tokens.panelBorder || tokens.borderSoft,
    ...overrides,
  };
}

export function getMailMenuPaperSx(tokens, overrides = {}) {
  return getMailDialogPaperSx(tokens, {
    mt: 0.6,
    minWidth: 240,
    borderRadius: tokens.menuRadius || MAIL_UI_RADII.lg,
    bgcolor: tokens.menuBg,
    py: 0.35,
    '& .MuiMenuItem-root': {
      minHeight: 42,
      fontSize: '0.9rem',
    },
    '& .MuiMenuItem-root.Mui-focusVisible': {
      bgcolor: tokens.surfaceHover,
    },
    ...overrides,
  });
}

export function getMailBottomSheetPaperSx(tokens, overrides = {}) {
  return {
    ...getMailUiFontScopeSx(),
    borderTopLeftRadius: tokens.sheetRadius || MAIL_UI_RADII.sheet,
    borderTopRightRadius: tokens.sheetRadius || MAIL_UI_RADII.sheet,
    border: '1px solid',
    borderBottom: 'none',
    borderColor: tokens.panelBorder || tokens.borderSoft,
    bgcolor: tokens.panelSolid,
    backgroundImage: 'none',
    maxHeight: '86dvh',
    overflow: 'hidden',
    pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    boxShadow: tokens.dialogShadow || tokens.shadow,
    ...overrides,
  };
}

export function getMailSheetHandleSx(tokens, overrides = {}) {
  return {
    width: 40,
    height: 4,
    borderRadius: MAIL_UI_RADII.round,
    bgcolor: tokens.panelBorder || tokens.borderSoft,
    mx: 'auto',
    ...overrides,
  };
}

export function getMailMobileBottomBarSx(tokens, overrides = {}) {
  return {
    flexShrink: 0,
    minHeight: `calc(${tokens.bulkBarHeight}px + env(safe-area-inset-bottom, 0px))`,
    px: 1,
    pt: 0.45,
    pb: 'calc(0.45rem + env(safe-area-inset-bottom, 0px))',
    bgcolor: tokens.bulkBottomBarBg,
    borderTop: '1px solid',
    borderColor: tokens.panelBorder,
    boxShadow: tokens.isDark
      ? '0 -8px 24px rgba(0, 0, 0, 0.22)'
      : '0 -8px 24px rgba(15, 23, 42, 0.08)',
    ...overrides,
  };
}

export function getMailMobileBottomBarOffset(tokens, extraPx = 24) {
  return `calc(${tokens.bulkBarHeight}px + ${extraPx}px + env(safe-area-inset-bottom, 0px))`;
}

export function getMailMobilePreviewSubjectSx(tokens, overrides = {}) {
  return {
    fontWeight: 400,
    fontSize: tokens.mobilePreviewSubjectFontSize || '1.28rem',
    lineHeight: 1.28,
    color: tokens.textPrimary,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    wordBreak: 'break-word',
    ...overrides,
  };
}

export function getMailMobilePreviewSenderSx(tokens, overrides = {}) {
  return {
    fontWeight: 600,
    fontSize: tokens.mobilePreviewSenderFontSize || '0.95rem',
    lineHeight: 1.25,
    color: tokens.textPrimary,
    wordBreak: 'break-word',
    ...overrides,
  };
}

export function getMailMetadataEmailLinkSx(tokens, overrides = {}) {
  const linkColor = tokens.metadataEmailLinkColor || (tokens.isDark ? '#e7c66a' : '#b45309');
  return {
    color: linkColor,
    textDecoration: 'none',
    wordBreak: 'break-all',
    '&:hover': {
      textDecoration: 'underline',
    },
    ...overrides,
  };
}

export function getMailQuickReplyBarSx(tokens, overrides = {}) {
  const { embedded = false, ...restOverrides } = overrides;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    px: 1.25,
    py: embedded ? 0.85 : 0.65,
    bgcolor: embedded ? 'transparent' : (tokens.isDark ? alpha(tokens.panelBg, 0.92) : alpha(tokens.panelBg, 0.98)),
    borderTop: embedded ? '1px solid' : '1px solid',
    borderColor: tokens.panelBorder,
    mt: embedded ? 1.5 : 0,
    ...restOverrides,
  };
}

export function getMailQuickReplyInputSx(tokens, overrides = {}) {
  return {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    px: 1.35,
    py: 0.75,
    borderRadius: tokens.chipRadius || MAIL_UI_RADII.round,
    bgcolor: tokens.isDark ? alpha('#ffffff', 0.06) : alpha('#000000', 0.04),
    border: '1px solid',
    borderColor: tokens.isDark ? alpha('#ffffff', 0.08) : alpha('#000000', 0.08),
    ...overrides,
  };
}

export function getMailAttachmentSummarySx(tokens, overrides = {}) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 0.75,
    mb: 0.75,
    px: 0.1,
    ...overrides,
  };
}

export function getMailAttachmentStripSx(tokens, overrides = {}) {
  return {
    display: 'flex',
    gap: 0.75,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
    pb: 0.25,
    mx: -0.15,
    px: 0.15,
    ...overrides,
  };
}

export function getMailAttachmentCompactCardSx(tokens, overrides = {}) {
  return {
    width: 132,
    minWidth: 132,
    height: 74,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    textAlign: 'left',
    p: 0.85,
    borderRadius: tokens.radiusMd,
    border: '1px solid',
    borderColor: tokens.isDark ? alpha('#ffffff', 0.08) : '#dfe3ea',
    bgcolor: tokens.isDark ? '#2a3038' : '#eef1f5',
    overflow: 'hidden',
    transition: tokens.transition,
    '&:hover': {
      bgcolor: tokens.isDark ? '#323844' : '#e4e8ee',
    },
    ...overrides,
  };
}

export function getMailAttachmentCompactBadgeSx(tokens, color, overrides = {}) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    px: 0.55,
    py: 0.1,
    borderRadius: tokens.radiusXs,
    bgcolor: color,
    color: '#fff',
    fontSize: '0.62rem',
    fontWeight: 800,
    lineHeight: 1.2,
    letterSpacing: '0.02em',
    ...overrides,
  };
}

export function getMailAttachmentIconTileSx(tokens, overrides = {}) {
  return {
    width: 48,
    height: 48,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: tokens.chipRadius || MAIL_UI_RADII.round,
    border: '1px solid',
    borderColor: tokens.isDark ? alpha('#ffffff', 0.08) : '#e7e9ee',
    bgcolor: tokens.isDark ? '#191d24' : '#f5f6f8',
    transition: tokens.transition,
    '&:hover': {
      bgcolor: tokens.isDark ? '#20252d' : '#eef1f5',
    },
    ...overrides,
  };
}

export function getMailSmartReplyChipsSx(tokens, overrides = {}) {
  const { embedded = false, ...restOverrides } = overrides;
  return {
    display: 'flex',
    gap: 0.65,
    px: 1.1,
    py: embedded ? 0.75 : 0.55,
    pb: embedded ? 1.25 : 0.55,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
    borderTop: embedded ? 'none' : '1px solid',
    borderColor: alpha(tokens.panelBorder, tokens.isDark ? 0.72 : 0.85),
    ...restOverrides,
  };
}

export function getMailMobilePreviewChromeSx(tokens, overrides = {}) {
  return {
    flexShrink: 0,
    borderBottom: '1px solid',
    borderColor: tokens.panelBorder,
    bgcolor: tokens.panelBg,
    ...overrides,
  };
}

export function getMailMobileChromeBackButtonSx(tokens, overrides = {}) {
  return {
    width: 40,
    height: 40,
    color: tokens.textPrimary,
    bgcolor: 'transparent',
    border: 'none',
    boxShadow: 'none',
    borderRadius: tokens.iconButtonRadius || MAIL_UI_RADII.md,
    transition: tokens.transition,
    '&:hover': {
      bgcolor: alpha(tokens.textPrimary, tokens.isDark ? 0.08 : 0.06),
    },
    '&.Mui-focusVisible': {
      boxShadow: tokens.focusRing,
    },
    ...overrides,
  };
}

export function getMailMobileDetailsToggleSx(tokens, overrides = {}) {
  return {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 0.55,
    px: 0.15,
    py: 0.35,
    borderRadius: tokens.radiusSm,
    textAlign: 'left',
    justifyContent: 'flex-start',
    color: tokens.textPrimary,
    transition: tokens.transition,
    '&:hover': {
      bgcolor: tokens.actionHover,
    },
    ...overrides,
  };
}
