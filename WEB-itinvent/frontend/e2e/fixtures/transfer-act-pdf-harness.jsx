// Browser boundary for the production transfer hook; no production endpoints.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTransferActJob } from '../../src/pages/database/useTransferActJob';
import { TRANSFER_OPERATION_MOVE } from '../../src/pages/database/equipmentModel';

function Harness() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [submits, setSubmits] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  const workflow = useTransferActJob({
    actionModal: { open: true, type: 'transfer', invNo: '1001' },
    canDatabaseWrite: true,
    transferOperationMode: TRANSFER_OPERATION_MOVE,
    newEmployee: 'Получатель теста', newEmployeeNo: 99,
    transferBranchNo: 10, transferLocationNo: 20,
    transferResult: result, setTransferResult: setResult,
    setActionError: setError,
    fetchAllEquipment: async () => setRefreshes((value) => value + 1),
    setTransferEmailStatus: () => {}, setTransferEmailError: () => {},
  });
  return <main>
    <button onClick={async () => {
      await workflow.handleTransferActionSubmit({ targetInvNos: ['1001'] });
      setSubmits((value) => value + 1);
    }}>Перемещение с актом</button>
    <button onClick={() => workflow.pollTransferActJob('browser-pdf-job', {
      refreshEquipment: true, targetInvNos: ['1001'], pollDelayMs: 0, maxAttempts: 1,
    })}>Обновить статус</button>
    <button onClick={() => workflow.handleTransferActDownload({
      act_id: 'old-act', file_name: 'old-act.docx',
    })}>Скачать акт</button>
    <p role="alert">{error}</p>
    <output data-testid="submits">{submits}</output>
    <output data-testid="refreshes">{refreshes}</output>
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
