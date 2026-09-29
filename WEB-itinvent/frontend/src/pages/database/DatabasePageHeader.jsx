import { Alert, Button, Paper, Tab, Tabs } from '@mui/material';

import { getOfficeActionTraySx } from '../../theme/officeUiTokens';
import { DATA_MODE_CONSUMABLES, DATA_MODE_EQUIPMENT } from './equipmentModel';
import DatabaseSearchBar from './DatabaseSearchBar';

// Header chrome of the Database page: equipment/consumables tabs, the search
// bar and the cross-session stale-data alert.
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
}) {
  return (
    <>
      <Paper
        elevation={0}
        sx={getOfficeActionTraySx(ui, {
          mb: isMobile ? 0.5 : 1.25,
          p: isMobile ? 0 : 0.25,
          borderRadius: '4px',
        })}
      >
        <Tabs
          value={dataMode}
          onChange={onDataModeChange}
          variant="fullWidth"
          sx={{
            minHeight: isMobile ? 44 : 40,
            '& .MuiTab-root': {
              minHeight: isMobile ? 44 : 40,
              py: 0.35,
              fontSize: isMobile ? '0.78rem' : '0.875rem',
              textTransform: 'none',
              fontWeight: 500,
            },
            '& .MuiTabs-indicator': {
              height: 2,
              borderRadius: 1,
            },
          }}
        >
          <Tab value={DATA_MODE_EQUIPMENT} label="Оборудование" />
          <Tab value={DATA_MODE_CONSUMABLES} label="Расходники" />
        </Tabs>
      </Paper>

      <DatabaseSearchBar
        theme={theme}
        ui={ui}
        compact={isMobile}
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

      {dataVersionStale && (
        <Alert
          severity="info"
          sx={{ mb: isMobile ? 0.5 : 1.25, borderRadius: '4px' }}
          action={(
            <Button
              color="inherit"
              size="small"
              onClick={onRefreshData}
            >
              Обновить
            </Button>
          )}
        >
          Данные были изменены в другой сессии — список может быть неактуален.
        </Alert>
      )}
    </>
  );
}
