import { useMemo } from 'react';
import {
  Box,
  CircularProgress,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { useMainLayoutShell } from './MainLayoutShellContext';
import ShellNotificationsButton from './ShellNotificationsButton';

const normalizeDbId = (value) => String(value ?? '').trim();

// Single compact top row of a desktop page that runs with headerMode="integrated"
// (the portal AppBar is hidden): menu, title, page tabs, page controls, base select,
// bell. Same layout as the Database page header. On phones the portal controls are
// left out (the mobile shell owns them) and only the page's own title/controls remain.
export default function PageTopBar({
  title = '',
  tabs = null,
  children = null,
  actions = null,
  testId = 'page-top-bar',
  sx = {},
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const shell = useMainLayoutShell();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  const showDbSelect = !isPhone && shell.showDatabaseSelector && (shell.dbLoading || shell.databases.length > 0);

  return (
    <Box
      component="header"
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1,
        rowGap: 0.75,
        mb: 1,
        minHeight: 44,
        ...sx,
      }}
    >
      {isPhone || shell.sidebarPinned ? null : (
        <Tooltip title="Открыть главное меню">
          <IconButton
            aria-label="Открыть главное меню"
            aria-expanded={shell.drawerOpen}
            size="small"
            onClick={shell.openDrawer}
            sx={{ width: 36, height: 36, color: ui.iconPrimary }}
          >
            <MenuIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {title ? (
        <Typography variant="h6" component="h1" sx={{ fontWeight: 800, lineHeight: 1.25, mr: 0.5 }}>
          {title}
        </Typography>
      ) : null}
      {tabs}
      <Box sx={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', columnGap: 1 }}>
        {children}
      </Box>
      {actions}
      {showDbSelect ? (
        shell.dbLoading ? (
          <CircularProgress size={20} aria-label="Загрузка баз данных" />
        ) : (
          <FormControl size="small" sx={{ minWidth: 140, maxWidth: 220 }}>
            <Select
              value={normalizeDbId(shell.currentDb?.id)}
              onChange={shell.onDatabaseChange}
              disabled={shell.dbLocked}
              displayEmpty
              inputProps={{ 'aria-label': 'База данных' }}
              renderValue={() => shell.currentDbName || 'База'}
              sx={{
                height: 36,
                borderRadius: '4px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                '& .MuiSelect-select': { py: 0, display: 'flex', alignItems: 'center' },
              }}
            >
              {shell.databases.map((db) => (
                <MenuItem key={normalizeDbId(db.id)} value={normalizeDbId(db.id)} dense>
                  {db.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )
      ) : null}
      {isPhone ? null : (
        <ShellNotificationsButton
          size="small"
          sx={{ width: 36, height: 36 }}
          iconSx={{ fontSize: 20 }}
        />
      )}
    </Box>
  );
}
