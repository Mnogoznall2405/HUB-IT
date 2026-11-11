import { Box } from '@mui/material';
import { forwardRef, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficePageShellSx } from '../../theme/officeUiTokens';

const PageShell = forwardRef(function PageShell({ children, fullHeight = false, sx = {} }, ref) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const baseSx = useMemo(() => getOfficePageShellSx(ui, { fullHeight }), [fullHeight, ui]);

  return (
    <Box ref={ref} sx={{ ...baseSx, ...sx }}>
      {children}
    </Box>
  );
});

export default PageShell;
