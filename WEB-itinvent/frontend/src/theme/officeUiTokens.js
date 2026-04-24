import { alpha } from '@mui/material/styles';

export function buildOfficeUiTokens(theme) {
  const isDark = theme.palette.mode === 'dark';
  const admin = theme.customAdmin || {};
  const brand = theme.palette.primary.main;

  return {
    isDark,
    brand,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    danger: theme.palette.error.main,
    pageBg: admin.pageBg || theme.palette.background.default,
    shellBg: admin.shellBg || (isDark ? '#11151b' : '#faf9f8'),
    navBg: admin.navBg || theme.palette.background.paper,
    panelBg: admin.panelMuted || (isDark ? '#1b1f26' : '#f7f6f5'),
    panelSolid: admin.surfaceRaised || theme.palette.background.paper,
    panelInset: admin.panelInset || (isDark ? '#262b31' : '#f3f2f1'),
    borderSoft: admin.borderSoft || (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(32,31,30,0.08)'),
    border: admin.border || theme.palette.divider,
    borderStrong: admin.borderStrong || (isDark ? 'rgba(255,255,255,0.18)' : 'rgba(32,31,30,0.16)'),
    textPrimary: admin.textPrimary || theme.palette.text.primary,
    textSecondary: admin.textSecondary || theme.palette.text.secondary,
    mutedText: admin.textSecondary || theme.palette.text.secondary,
    subtleText: admin.textTertiary || theme.palette.text.disabled,
    iconPrimary: admin.iconPrimary || theme.palette.text.primary,
    iconMuted: admin.iconMuted || theme.palette.text.secondary,
    actionBg: admin.actionBg || (isDark ? alpha(theme.palette.common.white, 0.04) : '#f7f6f5'),
    actionHover: admin.actionHover || (isDark ? alpha(theme.palette.common.white, 0.07) : '#f3f2f1'),
    actionBorder: admin.actionBorder || (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(32,31,30,0.10)'),
    selectedBg: admin.selectedBg || alpha(brand, isDark ? 0.22 : 0.12),
    selectedBorder: admin.selectedBorder || alpha(brand, isDark ? 0.34 : 0.22),
    headerBandBg: admin.headerBandBg || (isDark ? '#1b1f26' : '#f7f6f5'),
    headerBandBorder: admin.headerBandBorder || (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(32,31,30,0.08)'),
    emptyStateBg: admin.emptyStateBg || (isDark ? alpha(theme.palette.common.white, 0.025) : '#f8f7f6'),
    shellShadow: admin.shadowSoft || (isDark ? '0 8px 24px rgba(0,0,0,0.20)' : '0 10px 28px rgba(0,0,0,0.06)'),
    dialogShadow: admin.shadow || (isDark ? '0 24px 64px rgba(0,0,0,0.34)' : '0 20px 55px rgba(15,23,42,0.14)'),
  };
}

export function getOfficePanelSx(ui, overrides = {}) {
  return {
    bgcolor: ui.panelSolid,
    border: '1px solid',
    borderColor: ui.borderSoft,
    boxShadow: ui.shellShadow,
    ...overrides,
  };
}

export function getOfficeSubtlePanelSx(ui, overrides = {}) {
  return {
    bgcolor: ui.panelBg,
    border: '1px solid',
    borderColor: ui.borderSoft,
    boxShadow: 'none',
    ...overrides,
  };
}

export function getOfficeActionTraySx(ui, overrides = {}) {
  return {
    bgcolor: ui.panelBg,
    border: '1px solid',
    borderColor: ui.borderSoft,
    borderRadius: '14px',
    boxShadow: 'none',
    ...overrides,
  };
}

export function getOfficeHeaderBandSx(ui, overrides = {}) {
  return {
    bgcolor: ui.headerBandBg,
    borderBottom: '1px solid',
    borderColor: ui.headerBandBorder,
    ...overrides,
  };
}

export function getOfficeDialogPaperSx(ui, overrides = {}) {
  return {
    borderRadius: '18px',
    border: '1px solid',
    borderColor: ui.borderSoft,
    bgcolor: ui.panelSolid,
    boxShadow: ui.dialogShadow,
    overflow: 'hidden',
    ...overrides,
  };
}

export function getOfficeDrawerPaperSx(ui, overrides = {}) {
  return {
    bgcolor: ui.panelSolid,
    borderLeft: '1px solid',
    borderColor: ui.borderSoft,
    boxShadow: ui.dialogShadow,
    backgroundImage: 'none',
    ...overrides,
  };
}

export function getOfficeEmptyStateSx(ui, overrides = {}) {
  return {
    borderRadius: '14px',
    bgcolor: ui.emptyStateBg,
    border: '1px solid',
    borderColor: ui.borderSoft,
    ...overrides,
  };
}

export function getOfficeStickyHeaderSx(ui, overrides = {}) {
  return {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    bgcolor: ui.headerBandBg,
    borderBottom: '1px solid',
    borderColor: ui.headerBandBorder,
    ...overrides,
  };
}

export function getOfficeListRowSx(ui, theme, options = {}) {
  const {
    selected = false,
    unread = false,
    accentColor = theme.palette.primary.main,
    borderBottom = true,
    radius = 0,
    interactive = true,
    overrides = {},
  } = options;

  const selectedBg = alpha(accentColor, ui.isDark ? 0.16 : 0.08);
  const selectedHoverBg = alpha(accentColor, ui.isDark ? 0.22 : 0.12);
  const unreadBg = alpha(accentColor, ui.isDark ? 0.08 : 0.04);
  const unreadHoverBg = alpha(accentColor, ui.isDark ? 0.12 : 0.07);

  return {
    position: 'relative',
    transition: theme.transitions.create(['background-color', 'border-color', 'box-shadow', 'transform'], {
      duration: theme.transitions.duration.shorter,
    }),
    ...(borderBottom ? {
      borderBottom: '1px solid',
      borderColor: ui.borderSoft,
    } : {}),
    ...(radius ? { borderRadius: radius } : {}),
    bgcolor: selected ? selectedBg : unread ? unreadBg : 'transparent',
    ...(interactive ? {
      '&:hover': {
        bgcolor: selected ? selectedHoverBg : unread ? unreadHoverBg : ui.actionHover,
      },
    } : {}),
    '&.Mui-selected': {
      bgcolor: selectedBg,
    },
    '&.Mui-selected:hover': {
      bgcolor: selectedHoverBg,
    },
    ...overrides,
  };
}

export function getOfficeQuietActionSx(ui, theme, tone = 'neutral', overrides = {}) {
  const tones = {
    neutral: {
      color: theme.palette.text.primary,
      borderColor: ui.actionBorder,
      bgcolor: ui.actionBg,
      hoverBorderColor: ui.borderStrong,
      hoverBg: ui.actionHover,
      disabledColor: ui.subtleText,
      disabledBorderColor: ui.borderSoft,
      disabledBg: ui.actionBg,
    },
    primary: {
      color: theme.palette.primary.main,
      borderColor: ui.selectedBorder,
      bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.16 : 0.08),
      hoverBorderColor: alpha(theme.palette.primary.main, ui.isDark ? 0.42 : 0.28),
      hoverBg: alpha(theme.palette.primary.main, ui.isDark ? 0.22 : 0.12),
      disabledColor: ui.subtleText,
      disabledBorderColor: ui.borderSoft,
      disabledBg: ui.actionBg,
    },
    success: {
      color: theme.palette.success.main,
      borderColor: alpha(theme.palette.success.main, ui.isDark ? 0.32 : 0.22),
      bgcolor: alpha(theme.palette.success.main, ui.isDark ? 0.14 : 0.08),
      hoverBorderColor: alpha(theme.palette.success.main, ui.isDark ? 0.46 : 0.30),
      hoverBg: alpha(theme.palette.success.main, ui.isDark ? 0.20 : 0.12),
      disabledColor: ui.subtleText,
      disabledBorderColor: ui.borderSoft,
      disabledBg: ui.actionBg,
    },
    warning: {
      color: theme.palette.warning.main,
      borderColor: alpha(theme.palette.warning.main, ui.isDark ? 0.34 : 0.24),
      bgcolor: alpha(theme.palette.warning.main, ui.isDark ? 0.16 : 0.08),
      hoverBorderColor: alpha(theme.palette.warning.main, ui.isDark ? 0.48 : 0.32),
      hoverBg: alpha(theme.palette.warning.main, ui.isDark ? 0.22 : 0.12),
      disabledColor: ui.subtleText,
      disabledBorderColor: ui.borderSoft,
      disabledBg: ui.actionBg,
    },
    danger: {
      color: theme.palette.error.main,
      borderColor: alpha(theme.palette.error.main, ui.isDark ? 0.34 : 0.24),
      bgcolor: alpha(theme.palette.error.main, ui.isDark ? 0.14 : 0.08),
      hoverBorderColor: alpha(theme.palette.error.main, ui.isDark ? 0.48 : 0.32),
      hoverBg: alpha(theme.palette.error.main, ui.isDark ? 0.20 : 0.12),
      disabledColor: ui.subtleText,
      disabledBorderColor: ui.borderSoft,
      disabledBg: ui.actionBg,
    },
  };
  const palette = tones[tone] || tones.neutral;

  return {
    color: palette.color,
    border: '1px solid',
    borderColor: palette.borderColor,
    bgcolor: palette.bgcolor,
    boxShadow: 'none',
    '&:hover': {
      borderColor: palette.hoverBorderColor,
      bgcolor: palette.hoverBg,
      boxShadow: 'none',
    },
    '&.Mui-disabled': {
      color: palette.disabledColor,
      borderColor: palette.disabledBorderColor,
      bgcolor: palette.disabledBg,
    },
    ...overrides,
  };
}

export function getOfficeMetricBlockSx(ui, color, overrides = {}) {
  return {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '14px',
    bgcolor: alpha(color, ui.isDark ? 0.12 : 0.07),
    border: '1px solid',
    borderColor: ui.borderSoft,
    boxShadow: 'none',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 12,
      right: 12,
      height: 3,
      borderRadius: '0 0 999px 999px',
      bgcolor: alpha(color, ui.isDark ? 0.70 : 0.55),
    },
    ...overrides,
  };
}

export function getOfficePageShellSx(ui, { fullHeight = false } = {}) {
  return {
    width: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 1.2,
    bgcolor: 'transparent',
    ...(fullHeight ? {
      height: {
        xs: 'calc(100dvh - var(--app-shell-header-offset) - 32px)',
        md: 'calc(100dvh - var(--app-shell-header-offset) - 48px)',
      },
      overflow: 'hidden',
    } : {}),
  };
}
