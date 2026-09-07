import { sanitizeNativeMailEditableHtml } from './nativeMailHtml';

export type MailRichCommand = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'createLink' | 'removeFormat' | 'undo' | 'redo';

export function richMailEditorDocument(html: string, dark: boolean): string {
  const content = sanitizeNativeMailEditableHtml(html);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>html{background:${dark ? '#1b1f26' : '#fff'};color:${dark ? '#f3f2f1' : '#242424'}}body{font:16px/1.5 sans-serif;padding:12px;margin:0;min-height:240px;overflow-wrap:anywhere;outline:none}img,table{max-width:100%}a{color:${dark ? '#8cc8ff' : '#0f6cbd'}}body:empty:before{content:'Введите сообщение';opacity:.55}</style></head><body role="textbox" aria-label="Текст письма" aria-multiline="true">${content}</body></html>`;
}

// Runs only as trusted WebView injection; HTML-supplied scripts remain blocked by CSP.
export const MAIL_RICH_EDITOR_BRIDGE = `
(function () {
  var body = document.body, selection = null, disabled = false, composing = false;
  function post(value) { window.ReactNativeWebView.postMessage(JSON.stringify(value)); }
  function publish() { post({type:'change', html:body.innerHTML, text:body.innerText || body.textContent || ''}); }
  body.contentEditable = 'true';
  body.addEventListener('compositionstart', function () { composing = true; });
  body.addEventListener('compositionend', function () { composing = false; });
  document.addEventListener('selectionchange', function () {
    var current = window.getSelection();
    if (current && current.rangeCount && body.contains(current.anchorNode) && body.contains(current.focusNode)) {
      selection = current.getRangeAt(0).cloneRange();
    }
  });
  body.addEventListener('input', function () { if (!disabled) publish(); });
  body.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('a')) event.preventDefault();
  });
  body.addEventListener('paste', function (event) {
    event.preventDefault();
    if (!disabled && event.clipboardData) document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  window.hubitMailEditor = function (command, value) {
    if (command === 'snapshot') {
      disabled = true;
      body.blur();
      body.contentEditable = 'false';
      var frames = 0;
      function capture() {
        // Wait for the IME commit. The native request times out if it never arrives.
        if (composing) { if (++frames < 180) requestAnimationFrame(capture); return; }
        post({type:'snapshot', id:value, html:body.innerHTML, text:body.innerText || body.textContent || ''});
      }
      requestAnimationFrame(capture);
      return;
    }
    if (command === 'disabled') { disabled = !!value; body.contentEditable = disabled ? 'false' : 'true'; return; }
    if (disabled || ['bold','italic','insertUnorderedList','insertOrderedList','createLink','removeFormat','undo','redo'].indexOf(command) < 0) return;
    if (command === 'createLink' && !/^(https?:|mailto:)/i.test(value || '')) return;
    body.focus();
    if (selection) { var current = window.getSelection(); current.removeAllRanges(); current.addRange(selection); }
    document.execCommand(command, false, value || null);
    publish();
  };
  post({type:'ready'});
})(); true;
`;
