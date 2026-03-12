import { alpha } from '@mui/material/styles';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

export function buildMailUiTokens(theme) {
  const office = buildOfficeUiTokens(theme);
  const primaryBase = theme.palette.primary.main;

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
    selectedBg: office.selectedBg,
    selectedHover: alpha(primaryBase, office.isDark ? 0.28 : 0.14),
    selectedBorder: office.selectedBorder,
    textPrimary: theme.palette.text.primary,
    textSecondary: office.mutedText,
    iconColor: office.iconPrimary,
    menuBg: office.panelSolid,
    shadow: office.shellShadow,
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
