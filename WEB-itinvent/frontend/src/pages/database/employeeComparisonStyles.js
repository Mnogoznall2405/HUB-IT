import { alpha } from '@mui/material/styles';

// Scoped to the employee comparison workspace; other warehouse screens keep
// their existing density and row treatment.
export const comparisonTabsSx = {
  minHeight: 38,
  flexShrink: 0,
  '& .MuiTab-root': { minHeight: 38, py: 0.5, px: 1.5, fontSize: 13, textTransform: 'none' },
};

export const comparisonPanelSx = {
  display: 'flex', flexDirection: 'column', flex: 1,
  minWidth: 0, minHeight: 0, overflow: 'hidden',
};

export const comparisonTableSx = {
  tableLayout: 'fixed',
  '& .MuiTableCell-root': { px: 1, py: '5px', fontSize: 12, lineHeight: '16px' },
  '& .MuiTableCell-head': { py: 0.75, height: 34, boxSizing: 'border-box', whiteSpace: 'nowrap' },
  '& .MuiTableBody-root .MuiTableRow-root': { height: 40 },
  '& .MuiTableSortLabel-root': { maxWidth: '100%' },
  '& .MuiTableSortLabel-icon': { width: 14, height: 14, ml: 0.25, mr: 0 },
  '& .MuiIconButton-root': { width: 28, height: 28, p: 0.5 },
  '& .MuiChip-root': { maxWidth: '100%' },
};

export const comparisonScrollSx = {
  flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto',
  borderRadius: 1, boxShadow: 'none', overscrollBehavior: 'contain',
};

export const identifierSx = { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
export const twoLineTextSx = {
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
  overflow: 'hidden', overflowWrap: 'anywhere', lineHeight: '16px',
};

export function comparisonRowSx(theme, status) {
  const palette = { match: 'success', diff: 'warning', only_hub: 'error', only_1c: 'info' }[status];
  if (!palette) return {};
  const color = theme.palette[palette].main;
  return {
    bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.09 : 0.06),
    boxShadow: `inset 3px 0 0 ${alpha(color, 0.8)}`,
    '&.MuiTableRow-hover:hover, &:hover': { bgcolor: alpha(color, 0.16) },
  };
}
