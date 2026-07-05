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
    />
  );
}

export default memo(DatabaseMobileHeader);
