import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { sanitizeComposePasteHtml } from './mailComposeHtml';

const QuillImage = Quill.import('formats/image');
class MailInlineImage extends QuillImage {
  static sanitize(value) {
    const source = String(value || '').trim();
    if (/^(?:blob:|cid:)/i.test(source)) return source;
    return super.sanitize(value);
  }
}
Quill.register(MailInlineImage, true);

const normalizeEditorHtml = (value) => String(value || '').trim();

const normalizeContentId = (value) => String(value || '')
  .trim()
  .replace(/^cid:/i, '')
  .replace(/^<+|>+$/g, '')
  .toLowerCase();

const mapInlineSources = (html, sourceMap, { toPreview = false } = {}) => {
  const source = String(html || '');
  if (!source || typeof DOMParser === 'undefined') return source;
  const entries = Object.entries(sourceMap || {}).filter(([contentId, previewSrc]) => contentId && previewSrc);
  if (entries.length === 0) return source;
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const reverse = new Map(entries.map(([contentId, previewSrc]) => [String(previewSrc), normalizeContentId(contentId)]));
  documentNode.body.querySelectorAll('img[src]').forEach((image) => {
    if (!toPreview) image.removeAttribute('data-mail-inline-selected');
    const src = String(image.getAttribute('src') || '');
    if (toPreview && src.toLowerCase().startsWith('cid:')) {
      const preview = sourceMap[normalizeContentId(src)] || sourceMap[src.slice(4)] || '';
      if (preview) image.setAttribute('src', preview);
      return;
    }
    const contentId = reverse.get(src);
    if (contentId) image.setAttribute('src', `cid:${contentId}`);
  });
  return documentNode.body.innerHTML;
};

function setQuillHtml(quill, html, sourceMap) {
  const editorHtml = sanitizeComposePasteHtml(mapInlineSources(html, sourceMap, { toPreview: true }));
  const nextHtml = String(editorHtml || '');
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
  inlineSourcesByCid = {},
  onPasteInlineImages,
  onInlineImageSelected,
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
  const inlineSourcesRef = useRef({ ...inlineSourcesByCid });
  const onPasteInlineImagesRef = useRef(onPasteInlineImages);
  const onInlineImageSelectedRef = useRef(onInlineImageSelected);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  useEffect(() => {
    inlineSourcesRef.current = { ...inlineSourcesByCid };
  }, [inlineSourcesByCid]);

  useEffect(() => {
    onPasteInlineImagesRef.current = onPasteInlineImages;
  }, [onPasteInlineImages]);

  useEffect(() => {
    onInlineImageSelectedRef.current = onInlineImageSelected;
  }, [onInlineImageSelected]);

  useImperativeHandle(ref, () => ({
    focus: () => quillRef.current?.focus?.(),
    getEditor: () => quillRef.current,
    getSemanticHtml: () => normalizeEditorHtml(mapInlineSources(
      quillRef.current?.root?.innerHTML || '',
      inlineSourcesRef.current,
    )),
    setSelectedInlineImageSize: (preset) => {
      const image = quillRef.current?.root?.querySelector?.('img[data-mail-inline-selected="true"]');
      if (!image) return false;
      image.style.removeProperty('width');
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
      if (preset === 'small') image.style.width = '320px';
      if (preset === 'medium') image.style.width = '560px';
      if (preset === 'full') image.style.width = '100%';
      image.dataset.mailInlineSize = preset;
      const nextHtml = normalizeEditorHtml(mapInlineSources(
        quillRef.current.root.innerHTML,
        inlineSourcesRef.current,
      ));
      valueRef.current = nextHtml;
      onChangeRef.current?.(nextHtml);
      return true;
    },
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
    setQuillHtml(quill, valueRef.current, inlineSourcesRef.current);

    const handleTextChange = () => {
      const nextHtml = normalizeEditorHtml(mapInlineSources(quill.root.innerHTML, inlineSourcesRef.current));
      valueRef.current = nextHtml;
      onChangeRef.current?.(nextHtml);
      if (!quill.root.querySelector('img[data-mail-inline-selected="true"]')) {
        onInlineImageSelectedRef.current?.('');
      }
    };
    const handleFocus = (event) => onFocusRef.current?.(event);
    const handleBlur = (event) => onBlurRef.current?.(event);
    const handlePaste = (event) => {
      const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && String(item.type || '').toLowerCase().startsWith('image/'))
        .map((item) => item.getAsFile?.())
        .filter(Boolean);
      if (imageFiles.length > 0) {
        event.preventDefault();
        const descriptors = onPasteInlineImagesRef.current?.(imageFiles) || [];
        const range = quill.getSelection?.(true) || { index: Math.max(0, (quill.getLength?.() || 1) - 1), length: 0 };
        let index = range.index;
        descriptors.forEach((descriptor) => {
          const contentId = normalizeContentId(descriptor?.contentId);
          const previewSrc = String(descriptor?.previewUrl || '');
          if (!contentId || !previewSrc) return;
          inlineSourcesRef.current[contentId] = previewSrc;
          quill.insertEmbed(index, 'image', previewSrc, 'user');
          index += 1;
          quill.insertText(index, '\n', 'user');
          index += 1;
        });
        quill.setSelection?.(index, 0, 'silent');
        return;
      }

      const pastedHtml = event.clipboardData?.getData?.('text/html');
      if (!pastedHtml) return;
      event.preventDefault();
      const range = quill.getSelection?.(true) || { index: 0, length: 0 };
      if (range.length > 0) quill.deleteText(range.index, range.length, 'user');
      const safeHtml = sanitizeComposePasteHtml(pastedHtml);
      quill.clipboard.dangerouslyPasteHTML(range.index, safeHtml, 'user');
    };
    const handleClick = (event) => {
      quill.root.querySelectorAll('img[data-mail-inline-selected="true"]')
        .forEach((image) => image.removeAttribute('data-mail-inline-selected'));
      const image = event.target?.closest?.('img');
      if (!image) {
        onInlineImageSelectedRef.current?.('');
        return;
      }
      image.setAttribute('data-mail-inline-selected', 'true');
      onInlineImageSelectedRef.current?.(String(image.dataset.mailInlineSize || 'original'));
    };

    quill.on('text-change', handleTextChange);
    quill.root.addEventListener('focus', handleFocus);
    quill.root.addEventListener('blur', handleBlur);
    quill.root.addEventListener('paste', handlePaste, true);
    quill.root.addEventListener('click', handleClick);

    return () => {
      quill.off('text-change', handleTextChange);
      quill.root.removeEventListener('focus', handleFocus);
      quill.root.removeEventListener('blur', handleBlur);
      quill.root.removeEventListener('paste', handlePaste, true);
      quill.root.removeEventListener('click', handleClick);
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
    setQuillHtml(quill, nextValue, inlineSourcesRef.current);
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
