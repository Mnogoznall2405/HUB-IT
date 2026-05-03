import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';

const normalizeEditorHtml = (value) => String(value || '').trim();

function setQuillHtml(quill, html) {
  const nextHtml = String(html || '');
  try {
    const delta = quill.clipboard.convert({ html: nextHtml, text: '' });
    quill.setContents(delta, 'silent');
    return;
  } catch {
    // Quill's clipboard signature changed between major versions; keep a narrow fallback.
  }
  quill.setText('', 'silent');
  if (nextHtml) {
    quill.clipboard.dangerouslyPasteHTML(0, nextHtml, 'silent');
  }
}

const MailRichTextEditor = forwardRef(function MailRichTextEditor({
  value = '',
  onChange,
  onFocus,
  onBlur,
  modules,
  placeholder = '',
  className,
  style,
}, ref) {
  const mountRef = useRef(null);
  const quillRef = useRef(null);
  const valueRef = useRef(normalizeEditorHtml(value));
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  const onBlurRef = useRef(onBlur);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  useImperativeHandle(ref, () => ({
    focus: () => quillRef.current?.focus?.(),
    getEditor: () => quillRef.current,
  }), []);

  useEffect(() => {
    if (!mountRef.current || quillRef.current) return undefined;
    const editorNode = document.createElement('div');
    mountRef.current.appendChild(editorNode);

    const quillOptions = {
      theme: 'snow',
      placeholder,
    };
    if (modules !== undefined) {
      quillOptions.modules = modules;
    }
    const quill = new Quill(editorNode, quillOptions);
    quillRef.current = quill;
    setQuillHtml(quill, valueRef.current);

    const handleTextChange = () => {
      const nextHtml = normalizeEditorHtml(quill.root.innerHTML);
      valueRef.current = nextHtml;
      onChangeRef.current?.(nextHtml);
    };
    const handleFocus = (event) => onFocusRef.current?.(event);
    const handleBlur = (event) => onBlurRef.current?.(event);

    quill.on('text-change', handleTextChange);
    quill.root.addEventListener('focus', handleFocus);
    quill.root.addEventListener('blur', handleBlur);

    return () => {
      quill.off('text-change', handleTextChange);
      quill.root.removeEventListener('focus', handleFocus);
      quill.root.removeEventListener('blur', handleBlur);
      quillRef.current = null;
      editorNode.remove();
    };
  }, []);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.root.dataset.placeholder = placeholder || '';
  }, [placeholder]);

  useEffect(() => {
    const quill = quillRef.current;
    const nextValue = normalizeEditorHtml(value);
    if (!quill || nextValue === valueRef.current) return;
    const selection = quill.getSelection?.();
    setQuillHtml(quill, nextValue);
    valueRef.current = nextValue;
    if (selection) {
      try {
        quill.setSelection(selection, 'silent');
      } catch {
        // Ignore stale selections after external HTML replacement.
      }
    }
  }, [value]);

  return <div ref={mountRef} className={className} style={style} />;
});

export default MailRichTextEditor;
