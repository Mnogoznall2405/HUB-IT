import { memo } from 'react';

import DatabaseBulkActionBar from './DatabaseBulkActionBar';

function DatabaseSelectionBar(props) {
  return <DatabaseBulkActionBar variant="desktop" {...props} />;
}

export default memo(DatabaseSelectionBar);
