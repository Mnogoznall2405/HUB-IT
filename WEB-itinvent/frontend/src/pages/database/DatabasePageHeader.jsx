import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';

import { useMainLayoutShell } from '../../components/layout/MainLayoutShellContext';
import ShellNotificationsButton from '../../components/layout/ShellNotificationsButton';
import { getOfficeActionTraySx } from '../../theme/officeUiTokens';
import { DATA_MODE_CONSUMABLES, DATA_MODE_EQUIPMENT } from './equipmentModel';
import DatabaseSearchBar from './DatabaseSearchBar';

const normalizeDbId = (value) => String(value ?? '').trim();

// Header chrome of the Database page: equipment/consumables tabs, the search
// bar and the cross-session stale-data alert. On desktop the portal header is
// replaced by this single compact row (menu, title, tabs, search, base, bell).
export default function DatabasePageHeader({
  theme,
  ui,
  isMobile,
  dataMode,
  onDataModeChange,
  isConsumablesMode,
  searchScope,
  onSearchScopeChange,
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  onSearchClear,
  searchLoading,
  serverSearchDegraded,
  searchTypeNo,
  onSearchTypeChange,
  typeOptions,
  searchField,
  onSearchFieldChange,
  dataVersionStale,
  onRefreshData,
  databases = [],
  currentDb = null,
  dbName = '',
  selectedDatabaseName = '',
  onDatabaseSelectChange = null,
}) {
  const shell = useMainLayoutShell();

  const searchBar = (
    <DatabaseSearchBar
      theme={theme}
      ui={ui}
      compact={isMobile}
      embedded={!isMobile}
      isConsumablesMode={isConsumablesMode}
      searchScope={searchScope}
      onSearchScopeChange={onSearchScopeChange}
      value={searchQuery}
      onChange={onSearchChange}
      onKeyDown={onSearchKeyDown}
      onClear={onSearchClear}
      loading={searchLoading}
      degraded={serverSearchDegraded}
      typeOptions={typeOptions}
      searchTypeNo={searchTypeNo}
      onSearchTypeChange={onSearchTypeChange}
      searchField={searchField}
      onSearchFieldChange={onSearchFieldChange}
    />
  );

  const staleAlert = dataVersionStale ? (
    <Alert
      severity="info"
      sx={{ mb: isMobile ? 0.5 : 1, borderRadius: '4px', py: 0 }}
      action={(
        <Button color="inherit" size="small" onClick={onRefreshData}>
          Обновить
        </Button>
      )}
    >
      Данные были изменены в другой сессии — список может быть неактуален.
    </Alert>
  ) : null;

  if (isMobile) {
    return (
      <>
        <Paper
          elevation={0}
          sx={getOfficeActionTraySx(ui, { mb: 0.5, p: 0, borderRadius: '4px' })}
        >
          <Tabs
            value={dataMode}
            onChange={onDataModeChange}
            variant="fullWidth"
            sx={{
              minHeight: 44,
              '& .MuiTab-root': {
                minHeight: 44,
                py: 0.35,
                fontSize: '0.78rem',
                textTransform: 'none',
                fontWeight: 500,
              },
              '& .MuiTabs-indicator': { height: 2, borderRadius: 1 },
            }}
          >
            <Tab value={DATA_MODE_EQUIPMENT} label="Оборудование" />
            <Tab value={DATA_MODE_CONSUMABLES} label="Расходники" />
          </Tabs>
        </Paper>
        {searchBar}
        {staleAlert}
      </>
    );
  }

  const dbValue = normalizeDbId(dbName || currentDb?.id);
  const showDbSelect = databases.length > 0 && typeof onDatabaseSelectChange === 'function';

  return (
    <>
      <Box
        data-testid="database-desktop-header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1,
          rowGap: 0.75,
          mb: 1,
          minHeight: 44,
        }}
      >
        {shell.sidebarPinned ? null : (
          <Tooltip title="Открыть главное меню">
            <IconButton
              aria-label="Открыть главное меню"
              size="small"
              onClick={shell.openDrawer}
              sx={{ width: 36, height: 36, color: ui?.iconPrimary }}
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Typography variant="h6" component="h1" sx={{ fontWeight: 800, lineHeight: 1.25, mr: 0.5 }}>
          Инвентарь
        </Typography>
        <Tabs
          value={dataMode}
          onChange={onDataModeChange}
          sx={{
            minHeight: 36,
            flexShrink: 0,
            '& .MuiTab-root': {
              minHeight: 36,
              py: 0.25,
              px: 1.5,
              fontSize: '0.875rem',
              textTransform: 'none',
              fontWeight: 500,
            },
            '& .MuiTabs-indicator': { height: 2, borderRadius: 1 },
          }}
        >
          <Tab value={DATA_MODE_EQUIPMENT} label="Оборудование" />
          <Tab value={DATA_MODE_CONSUMABLES} label="Расходники" />
        </Tabs>

        <Box sx={{ flex: '1 1 460px', minWidth: 0, display: 'flex' }}>
          {searchBar}
        </Box>

        {showDbSelect ? (
          <FormControl size="small" sx={{ minWidth: 140, maxWidth: 220 }}>
            <Select
              value={dbValue}
              onChange={onDatabaseSelectChange}
              displayEmpty
              inputProps={{ 'aria-label': 'База данных' }}
              renderValue={() => selectedDatabaseName || currentDb?.name || 'База'}
              sx={{
                height: 36,
                borderRadius: '4px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                '& .MuiSelect-select': { py: 0, display: 'flex', alignItems: 'center' },
              }}
            >
              {databases.map((db) => (
                <MenuItem key={normalizeDbId(db.id)} value={normalizeDbId(db.id)} dense>
                  {db.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        <ShellNotificationsButton
          size="small"
          sx={{ width: 36, height: 36 }}
          iconSx={{ fontSize: 20 }}
        />
      </Box>
      {staleAlert}
    </>
  );
}
