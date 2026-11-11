import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import useMailMessageFileActions from '../../src/components/mail/useMailMessageFileActions';
import { downloadBlobFile } from '../../src/components/mail/mailMessageFileActions';

const unsafeLabel = '<img src=x onerror="window.auditInjected=true">';
const message = {
  id: 'print-1', subject: `Проверка </title>${unsafeLabel}`,
  sender: `Отправитель ${unsafeLabel}`, received_at: '2026-10-18',
  body_html: '<p>Содержимое письма</p>',
};

function Harness() {
  const [error, setError] = useState('');
  const actions = useMailMessageFileActions({
    selectedMessage: message,
    selectedRenderedHtml: message.body_html,
    setError,
    formatFullDate: () => `Дата ${unsafeLabel}`,
  });
  return <main>
    <button onClick={() => actions.handlePrintSelectedMessage()}>Печать письма</button>
    <button onClick={() => {
      window.__HUBIT_MOBILE_APP__ = true;
      window.ReactNativeWebView = { postMessage: (payload) => { window.auditMobilePrint = JSON.parse(payload); } };
      actions.handlePrintSelectedMessage();
    }}>Печать через приложение</button>
    <button onClick={() => downloadBlobFile(new Blob(['Тестовое вложение'], { type: 'text/plain;charset=utf-8' }), 'audit.txt', { preferOpenFallback: true })}>Открыть вложение</button>
    <p role="alert">{error}</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
