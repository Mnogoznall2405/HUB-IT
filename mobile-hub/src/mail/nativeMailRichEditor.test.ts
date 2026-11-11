import { runInNewContext } from 'vm';
import { MAIL_RICH_EDITOR_BRIDGE, richMailEditorDocument } from './nativeMailRichEditor';

it('preserves editable HTML and CID references while blocking executable content and network access', () => {
  const document = richMailEditorDocument('<table><tr><td><b>Текст</b></td></tr></table><img src="cid:fixture"><script>forbidden()</script>', false);
  expect(document).toContain('<table>');
  expect(document).toContain('src="cid:fixture"');
  expect(document).not.toContain('forbidden()');
  expect(document).toContain("default-src 'none'");
  expect(document).toContain("script-src 'none'");
  expect(() => richMailEditorDocument('x'.repeat(2_000_001), false)).toThrow();
});

it('restores selection for commands, publishes changes and locks editing before a send', () => {
  const listeners: Record<string, (event?: any) => void> = {};
  const range = { cloneRange: () => range };
  const selection = { rangeCount: 1, anchorNode: {}, focusNode: {}, getRangeAt: () => range, removeAllRanges: jest.fn(), addRange: jest.fn() };
  const body = { innerHTML: '<b>Текст</b>', textContent: 'Текст', contentEditable: '', focus: jest.fn(), blur: jest.fn(), contains: () => true, addEventListener: (type: string, callback: () => void) => { listeners[type] = callback; } };
  const document = { body, execCommand: jest.fn(), addEventListener: (type: string, callback: () => void) => { listeners[type] = callback; } };
  const postMessage = jest.fn();
  const window: any = { getSelection: () => selection, ReactNativeWebView: { postMessage } };
  const frames: Array<() => void> = [];
  runInNewContext(MAIL_RICH_EDITOR_BRIDGE, { document, window, requestAnimationFrame: (callback: () => void) => frames.push(callback) });
  expect(JSON.parse(postMessage.mock.calls[0][0]).type).toBe('ready');
  listeners.selectionchange();
  window.hubitMailEditor('bold');
  expect(selection.addRange).toHaveBeenCalledWith(range);
  expect(document.execCommand).toHaveBeenCalledWith('bold', false, null);
  expect(JSON.parse(postMessage.mock.calls.at(-1)![0])).toEqual({ type: 'change', html: '<b>Текст</b>', text: 'Текст' });
  document.execCommand.mockClear();
  window.hubitMailEditor('createLink', 'javascript:forbidden()');
  expect(document.execCommand).not.toHaveBeenCalled();
  window.hubitMailEditor('disabled', true);
  window.hubitMailEditor('italic');
  expect(body.contentEditable).toBe('false');
  expect(document.execCommand).not.toHaveBeenCalled();
  window.hubitMailEditor('disabled', false);
  window.hubitMailEditor('insertOrderedList');
  expect(document.execCommand).toHaveBeenCalledWith('insertOrderedList', false, null);
  listeners.compositionstart();
  window.hubitMailEditor('snapshot', 42);
  expect(body.contentEditable).toBe('false');
  postMessage.mockClear(); frames.shift()!();
  expect(postMessage).not.toHaveBeenCalled();
  body.innerHTML = '<i>Последний ввод IME</i>'; body.textContent = 'Последний ввод IME';
  listeners.compositionend(); frames.shift()!();
  expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ type: 'snapshot', id: 42, html: body.innerHTML, text: body.textContent });
});
