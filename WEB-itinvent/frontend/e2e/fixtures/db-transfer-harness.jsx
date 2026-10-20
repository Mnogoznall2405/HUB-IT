import React from 'react';
import { createRoot } from 'react-dom/client';
import DatabaseDbTransferDialog from '../../src/pages/database/DatabaseDbTransferDialog';
import useDatabaseDbTransfer from '../../src/pages/database/useDatabaseDbTransfer';

function Harness() {
  const flow = useDatabaseDbTransfer();
  return <main>
    <button onClick={flow.openDbTransfer}>Открыть перенос</button>
    <DatabaseDbTransferDialog
      open={flow.dbTransferOpen} onClose={flow.closeDbTransfer} onSubmit={flow.submitDbTransfer}
      running={flow.dbTransferRunning} result={flow.dbTransferResult} error={flow.dbTransferError}
      items={[{ inv_no: '1001', model_name: 'Монитор' }]} currentDb="source"
      databases={[{ id: 'source', name: 'Исходная база' }, { id: 'target', name: 'Целевая база' }]}
    />
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
