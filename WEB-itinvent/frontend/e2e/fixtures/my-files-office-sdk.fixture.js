// An external editor boundary for local E2E: editable iframe and the documented DocsAPI events/commands.
// It does not emulate document conversion, storage or the actual ONLYOFFICE collaboration transport.
(() => {
  let serial = 0;
  window.DocsAPI = { DocEditor: function DocEditor(hostId, config) {
    const frame = document.createElement('iframe');
    frame.title = 'Документ для проверки восстановления';
    frame.dataset.editorInstance = String(++serial);
    frame.style.cssText = 'width:100%;height:100%;border:0';
    const receive = (event) => {
      if (event.source !== frame.contentWindow || event.data?.officeFixture !== true) return;
      config.events?.[event.data.event]?.({ data: event.data.data });
    };
    window.addEventListener('message', receive);
    frame.addEventListener('load', () => {
      frame.contentWindow.postMessage({ command: 'configuration', key: config.document.key, user: config.editorConfig.user.id }, '*');
      config.events?.onAppReady?.();
      config.events?.onDocumentReady?.();
    });
    frame.srcdoc = `<!doctype html><html lang="ru"><meta charset="UTF-8"><body>
      <div role="textbox" aria-label="Содержимое документа" contenteditable="true">Документ из HUB</div>
      <button id="submit">Отправить правки</button><button id="refresh">Запросить новую версию</button>
      <button id="failure">Ошибка редактора</button><output aria-label="Ключ документа"></output>
      <button id="meta">Переименовано соавтором</button>
      <output aria-label="Пользователь документа"></output>
      <script>
        let dirty = false;
        const emit = (event, data) => parent.postMessage({ officeFixture: true, event, data }, '*');
        const editor = document.querySelector('[role="textbox"]');
        editor.addEventListener('input', () => { dirty = true; emit('onDocumentStateChange', true); });
        document.querySelector('#submit').onclick = () => { dirty = false; emit('onDocumentStateChange', false); };
        document.querySelector('#refresh').onclick = () => emit('onRequestRefreshFile');
        document.querySelector('#failure').onclick = () => emit('onError', { errorCode: -1 });
        document.querySelector('#meta').onclick = () => emit('onMetaChange', { title: 'Имя от соавтора.docx' });
        addEventListener('message', ({ data }) => {
          if (data?.command === 'configuration') {
            document.querySelector('[aria-label="Ключ документа"]').textContent = data.key;
            document.querySelector('[aria-label="Пользователь документа"]').textContent = data.user;
          }
          if (data?.command === 'refreshFile') {
            document.querySelector('[aria-label="Ключ документа"]').textContent = data.config.document.key;
            document.querySelector('[aria-label="Пользователь документа"]').textContent = data.config.editorConfig.user.id;
          }
          if (data?.command === 'denyEditingRights') editor.contentEditable = 'false';
          if (data?.command === 'requestClose' && (!dirty || confirm('Есть неотправленные правки. Закрыть редактор?'))) emit('onRequestClose');
        });
      </script></body></html>`;
    document.getElementById(hostId).replaceWith(frame);
    this.refreshFile = (next) => frame.contentWindow.postMessage({ command: 'refreshFile', config: next }, '*');
    this.requestClose = () => frame.contentWindow.postMessage({ command: 'requestClose' }, '*');
    this.denyEditingRights = () => frame.contentWindow.postMessage({ command: 'denyEditingRights' }, '*');
    this.destroyEditor = () => { window.removeEventListener('message', receive); frame.remove(); };
  } };
})();
