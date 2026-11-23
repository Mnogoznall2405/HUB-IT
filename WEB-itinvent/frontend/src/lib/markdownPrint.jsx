import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
} from '../components/documentPreview/MarkdownFileViewer';
import { escapeHtml } from './documentPrint';
import { safeMarkdownUrlTransform } from './textPreview';

/**
 * Render Markdown through the same GFM + sanitize pipeline as the on-screen
 * viewer, but to static markup for a print-only document. Interactive
 * component overrides (copy buttons, table scroll wrappers) are intentionally
 * dropped — the print stylesheet handles layout instead.
 */
export const buildMarkdownPrintBodyHtml = (value = '', { truncated = false } = {}) => {
  const markup = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      urlTransform={safeMarkdownUrlTransform}
    >
      {String(value || '')}
    </ReactMarkdown>,
  );
  const note = truncated
    ? '<p class="doc-note">Показана первая часть файла. Полный текст — в исходном файле.</p>'
    : '';
  return `${note}${markup || `<p>${escapeHtml('Пустой документ')}</p>`}`;
};
