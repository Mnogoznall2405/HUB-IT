import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCanvasSocketClient } from '../../src/lib/taskCanvasSocket';

function Harness() {
  const client = useRef(null);
  const [status, setStatus] = useState('disconnected');
  const [revision, setRevision] = useState(0);
  useEffect(() => () => client.current?.close(), []);
  return <main>
    <button onClick={() => {
      client.current?.close();
      client.current = new TaskCanvasSocketClient({ taskId: 'audit-task', onStatus: setStatus,
        onEvent: (event) => {
          if (event.type === 'task_canvas.connected') setRevision(Number(event.payload?.revision || 0));
        } });
      client.current.connect();
    }}>Подключить канвас</button>
    <button onClick={() => client.current?.close()}>Закрыть канвас</button>
    <output aria-label="Статус соединения">{status}</output>
    <output aria-label="Ревизия">{revision}</output>
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
