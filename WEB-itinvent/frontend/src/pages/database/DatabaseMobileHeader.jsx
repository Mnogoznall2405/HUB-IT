import { memo } from 'react';
import MobileShellPageHeader from '../../components/layout/MobileShellPageHeader';

function DatabaseMobileHeader({
  databases = [],
  dbName = '',
  currentDb = null,
  selectedDatabaseName = 'База',
  onDatabaseSelectChange,
}) {
  return (
    <MobileShellPageHeader
      showDatabaseSelector
      databases={databases}
      currentDb={currentDb}
      dbName={dbName}
      selectedDatabaseName={selectedDatabaseName}
      onDatabaseChange={onDatabaseSelectChange}
      databaseSelectSx={{
        height: 44,
        '& .MuiSelect-select': {
          py: 0,
          pl: 1,
          pr: '28px !important',
          minHeight: '44px !important',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
        },
      }}
    />
  );
}

export default memo(DatabaseMobileHeader);
