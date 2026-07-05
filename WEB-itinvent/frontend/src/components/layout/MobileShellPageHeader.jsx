import { memo, useMemo } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Typography,
  alpha,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { APP_BRAND_NAME } from '../../lib/appBranding';
import { useMainLayoutShell } from './MainLayoutShellContext';

const normalizeDbId = (value) => String(value ?? '').trim();

function MobileShellPageHeader({
  title = '',
  showDatabaseSelector = false,
  databases: databasesProp,
  currentDb: currentDbProp,
  dbName: dbNameProp,
  selectedDatabaseName: selectedDatabaseNameProp,
  onDatabaseChange: onDatabaseChangeProp,
  dbLoading: dbLoadingProp,
  dbLocked: dbLockedProp,
  sx = {},
}) {
  const theme = useTheme();
  const shell = useMainLayoutShell();
  const useShellDatabase = showDatabaseSelector && shell.showDatabaseSelector && databasesProp === undefined;
  const databases = useShellDatabase ? shell.databases : (databasesProp || []);
  const currentDb = useShellDatabase ? shell.currentDb : currentDbProp;
  const dbName = useShellDatabase ? normalizeDbId(shell.currentDb?.id) : normalizeDbId(dbNameProp || currentDbProp?.id);
  const selectedDatabaseName = useShellDatabase
    ? shell.currentDbName
    : (selectedDatabaseNameProp || currentDbProp?.name || 'База');
  const onDatabaseChange = useShellDatabase ? shell.onDatabaseChange : onDatabaseChangeProp;
  const dbLoading = useShellDatabase ? shell.dbLoading : Boolean(dbLoadingProp);
  const dbLocked = useShellDatabase ? shell.dbLocked : Boolean(dbLockedProp);
  const resolvedTitle = String(title || '').trim();

  const selectControl = useMemo(() => {
    if (!showDatabaseSelector) return null;
    if (dbLoading) {
      return (
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 32 }}>
          <CircularProgress size={18} />
        </Box>
      );
    }
    if (databases.length === 0) return null;

    return (
      <FormControl size="small" sx={{ flex: 1, minWidth: 0, maxWidth: 220, ml: resolvedTitle ? 0.5 : 'auto' }}>
        <Select
          value={dbName}
          onChange={onDatabaseChange}
          disabled={dbLocked}
          displayEmpty
          renderValue={() => (
            <Typography
              component="span"
              noWrap
              sx={{ display: 'block', minWidth: 0, fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.2 }}
            >
              {selectedDatabaseName}
            </Typography>
          )}
          MenuProps={{
            PaperProps: {
              sx: { maxHeight: 320 },
            },
          }}
          sx={{
            height: 32,
            borderRadius: 2,
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.10 : 0.05),
            '& .MuiSelect-select': {
              py: 0.5,
              pl: 1,
              pr: '28px !important',
              minHeight: '0 !important',
              display: 'flex',
              alignItems: 'center',
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.20 : 0.14),
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.35 : 0.28),
            },
            '& .MuiSelect-icon': {
              right: 4,
              color: theme.palette.text.secondary,
            },
          }}
        >
          {databases.map((db) => (
            <MenuItem key={normalizeDbId(db.id)} value={normalizeDbId(db.id)} dense>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
                <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
                  {db.name}
                </Typography>
                {normalizeDbId(db.id) === normalizeDbId(currentDb?.id) && (
                  <Chip label="Текущая" size="small" color="success" sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0 }} />
                )}
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }, [
    currentDb?.id,
    dbLocked,
    dbLoading,
    dbName,
    databases,
    onDatabaseChange,
    resolvedTitle,
    selectedDatabaseName,
    showDatabaseSelector,
    theme.palette.mode,
    theme.palette.primary.main,
    theme.palette.text.secondary,
  ]);

  return (
    <Box data-testid="mobile-shell-page-header" sx={{ mb: 1.5, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 800, fontSize: resolvedTitle ? '0.95rem' : '0.95rem', lineHeight: 1, flexShrink: 0 }}
        >
          {resolvedTitle || APP_BRAND_NAME}
        </Typography>
        {selectControl}
      </Box>
    </Box>
  );
}

export default memo(MobileShellPageHeader);
