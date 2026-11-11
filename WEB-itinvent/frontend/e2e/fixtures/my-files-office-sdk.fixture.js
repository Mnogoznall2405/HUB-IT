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
      frame.contentWindow.postMessage({ command: 'configuration', key: config.document.key, user: config.editorConfig.user.id,
        title: config.document.title, rename: Boolean(config.events?.onRequestRename), share: Boolean(config.events?.onRequestSharingSettings),
        history: Boolean(config.events?.onRequestHistory), historyClose: Boolean(config.events?.onRequestHistoryClose),
        close: config.editorConfig.customization?.close?.visible === true }, '*');
      config.events?.onAppReady?.();
      config.events?.onDocumentReady?.();
    });
    frame.srcdoc = `<!doctype html><html lang="ru"><meta charset="UTF-8"><body>
      <div role="textbox" aria-label="Содержимое документа" contenteditable="true">Документ из HUB</div>
      <button id="submit">Отправить правки</button><button id="refresh">Запросить новую версию</button>
      <button id="failure">Ошибка редактора</button><output aria-label="Ключ документа"></output>
      <button id="meta">Переименовано соавтором</button>
      <button id="open-history">История из меню редактора</button>
      <button id="close-history">Вернуться из истории</button>
      <label>Новое имя в редакторе<input id="native-name"></label><button id="native-rename" hidden>Применить имя в редакторе</button>
      <button id="native-share" hidden>Настройки доступа в редакторе</button><button id="native-close" hidden>Закрыть из редактора</button>
      <output aria-label="Название в редакторе"></output><output aria-label="Настройки доступа в редакторе"></output>
      <nav aria-label="Версии документа"></nav><output aria-label="Показанная версия"></output>
      <output aria-label="Авторы правок"></output>
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
        document.querySelector('#open-history').onclick = () => emit('onRequestHistory');
        document.querySelector('#close-history').onclick = () => emit('onRequestHistoryClose');
        document.querySelector('#native-rename').onclick = () => emit('onRequestRename', document.querySelector('#native-name').value);
        document.querySelector('#native-share').onclick = () => emit('onRequestSharingSettings');
        document.querySelector('#native-close').onclick = () => { if (!dirty || confirm('Есть неотправленные правки. Закрыть редактор?')) emit('onRequestClose'); };
        addEventListener('message', ({ data }) => {
          if (data?.command === 'configuration') {
            document.querySelector('[aria-label="Ключ документа"]').textContent = data.key;
            document.querySelector('[aria-label="Пользователь документа"]').textContent = data.user;
            document.querySelector('[aria-label="Название в редакторе"]').textContent = data.title;
            document.querySelector('#native-rename').hidden = !data.rename;
            document.querySelector('#native-name').parentElement.hidden = !data.rename;
            document.querySelector('#native-share').hidden = !data.share;
            document.querySelector('#native-close').hidden = !data.close;
            document.querySelector('#open-history').hidden = !data.history;
            document.querySelector('#close-history').hidden = !data.historyClose;
          }
          if (data?.command === 'refreshFile') {
            document.querySelector('[aria-label="Ключ документа"]').textContent = data.config.document.key;
            document.querySelector('[aria-label="Пользователь документа"]').textContent = data.config.editorConfig.user.id;
          }
          if (data?.command === 'denyEditingRights') editor.contentEditable = 'false';
          if (data?.command === 'readonly') editor.contentEditable = 'false';
          if (data?.command === 'setSharingSettings') document.querySelector('[aria-label="Настройки доступа в редакторе"]').textContent = JSON.stringify(data.settings);
          if (data?.command === 'refreshHistory') {
            const nav = document.querySelector('nav');
            nav.replaceChildren();
            for (const version of [...(data.history.history || [])].reverse()) {
              const button = document.createElement('button');
              button.textContent = 'Версия ' + version.version + ' · ' + version.user.name;
              button.onclick = () => emit('onRequestHistoryData', version.version);
              nav.append(button);
            }
            document.querySelector('[aria-label="Авторы правок"]').textContent = (data.history.history || []).flatMap(version => version.changes || []).map(change => change.user.name).join(', ');
          }
          if (data?.command === 'setHistoryData') {
            document.querySelector('[aria-label="Показанная версия"]').textContent = data.data.version;
            emit('onDocumentReady');
          }
          if (data?.command === 'requestClose' && (!dirty || confirm('Есть неотправленные правки. Закрыть редактор?'))) emit('onRequestClose');
        });
      </script></body></html>`;
    document.getElementById(hostId).replaceWith(frame);
    this.refreshFile = (next) => frame.contentWindow.postMessage({ command: 'refreshFile', config: next }, '*');
    this.refreshHistory = history => frame.contentWindow.postMessage({ command: 'refreshHistory', history }, '*');
    this.setSharingSettings = settings => frame.contentWindow.postMessage({ command: 'setSharingSettings', settings }, '*');
    this.setHistoryData = data => {
      (window.__historyDataCalls ||= []).push(data);
      frame.contentWindow.postMessage({ command: 'setHistoryData', data }, '*');
    };
    frame.addEventListener('load', () => { if (config.document.permissions?.edit === false) frame.contentWindow.postMessage({ command: 'readonly' }, '*'); });
    this.requestClose = () => frame.contentWindow.postMessage({ command: 'requestClose' }, '*');
    this.denyEditingRights = () => frame.contentWindow.postMessage({ command: 'denyEditingRights' }, '*');
    this.destroyEditor = () => { window.removeEventListener('message', receive); frame.remove(); };
  } };
})();
