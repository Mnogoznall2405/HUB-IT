// Document printing helpers.
//
// The preview dialog shows PDF pages as raster canvases inside a scrollable
// MUI Dialog. window.print() on that DOM prints the app shell plus whatever
// viewport fragments happen to be rendered — a "small document inside A4"
// effect with lost pages. The correct chain is to print the original PDF
// bytes through the browser's own PDF viewer: a hidden same-origin blob
// iframe whose contentWindow.print() opens the native print pipeline with
// the document's real page sizes, orientation and vector quality.
//
// Non-PDF content (text, Markdown, tables) is printed through a dedicated
// print-only HTML document in a hidden iframe — never through window.print()
// on the app DOM.

const PRINT_FRAME_TIMEOUT_MS = 120_000;
const PRINT_FRAME_LOAD_TIMEOUT_MS = 15_000;
const PRINT_READY_DELAY_MS = 400;

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const mountPrintFrame = ({ src = '', srcdoc = '', title = '' }) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  if (title) frame.title = title;
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  if (srcdoc) {
    frame.srcdoc = srcdoc;
  } else {
    frame.src = src;
  }
  document.body.appendChild(frame);
  return frame;
};

/**
 * Wait for the frame to load, then invoke print() inside it.
 * Resolves once the print dialog is dispatched; the frame itself is removed
 * on `afterprint` (or a safety timeout), so the browser keeps the document
 * snapshot while the system print dialog is open.
 */
const runIframePrint = (frame, { onCleanup } = {}) => new Promise((resolve, reject) => {
  let settled = false;
  const cleanup = () => {
    clearTimeout(loadTimer);
    clearTimeout(lifeTimer);
    onCleanup?.();
    frame.remove();
  };
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(loadTimer);
    if (error) {
      cleanup();
      reject(error);
      return;
    }
    resolve();
  };
  const reclaim = () => {
    clearTimeout(loadTimer);
    clearTimeout(lifeTimer);
    cleanup();
  };

  // The frame must load before print() can run; without a load timeout a
  // broken source would leave the promise hanging forever.
  const loadTimer = setTimeout(() => finish(new Error('print-frame-load-timeout')), PRINT_FRAME_LOAD_TIMEOUT_MS);
  // Once print() is dispatched, keep the document alive for the print dialog;
  // `afterprint` normally reclaims the frame, this timer is the fallback.
  let lifeTimer = 0;

  frame.addEventListener('load', () => {
    clearTimeout(loadTimer);
    // The PDF plugin needs a tick after 'load' before print() is usable;
    // html iframes are ready immediately but the same delay is harmless.
    setTimeout(() => {
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error('print-frame-missing');
        try {
          win.addEventListener('afterprint', reclaim, { once: true });
        } catch { /* noop */ }
        lifeTimer = setTimeout(reclaim, PRINT_FRAME_TIMEOUT_MS);
        win.focus();
        win.print();
        finish();
      } catch (error) {
        finish(error);
      }
    }, PRINT_READY_DELAY_MS);
  }, { once: true });

  frame.addEventListener('error', () => finish(new Error('print-frame-error')), { once: true });
});

/**
 * Print a PDF by its blob/object URL through the browser PDF viewer.
 * A `url` owned by the preview is NOT revoked; a `blob` gets a temporary
 * URL that is revoked when the frame is cleaned up.
 */
export const printPdfDocument = async ({ url = '', blob = null, title = 'Документ' } = {}) => {
  let printUrl = String(url || '');
  let ownedUrl = '';
  if (!printUrl && blob) {
    ownedUrl = URL.createObjectURL(blob);
    printUrl = ownedUrl;
  }
  if (!printUrl) throw new Error('print-source-missing');
  const frame = mountPrintFrame({ src: printUrl, title });
  await runIframePrint(frame, {
    onCleanup: ownedUrl
      ? () => { try { URL.revokeObjectURL(ownedUrl); } catch { /* noop */ } }
      : undefined,
  });
};

const PRINT_DOC_CSS = `
  @page { margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font: 12pt/1.5 'Segoe UI', system-ui, -apple-system, sans-serif; }
  .doc-note { color: #555; font-size: 9pt; margin: 0 0 10pt; padding-bottom: 6pt; border-bottom: 1px solid #ccc; }
  pre.text { font: 9.5pt/1.45 ui-monospace, Consolas, 'Courier New', monospace;
    white-space: pre-wrap; word-break: break-word; margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  th, td { border: 1px solid #999; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { font-weight: 700; background: #eee; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; page-break-after: avoid; }
  h1 { font-size: 20pt; border-bottom: 1px solid #bbb; padding-bottom: 4pt; }
  h2 { font-size: 16pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
  h3 { font-size: 13pt; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 8pt; }
  ul, ol { padding-left: 20pt; }
  li.task-list-item { list-style: none; margin-left: -14pt; }
  blockquote { border-left: 3pt solid #ccc; padding-left: 10pt; color: #444; margin-left: 0; }
  pre code, code { font-family: ui-monospace, Consolas, 'Courier New', monospace; font-size: 9.5pt; }
  pre { background: #f4f4f4; border: 1px solid #ddd; padding: 6pt 8pt;
    white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
  code { background: #f0f0f0; padding: 0 2pt; border-radius: 2pt; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; }
  hr { border: 0; border-top: 1px solid #bbb; margin: 12pt 0; }
  a { color: #0645ad; word-break: break-word; }
  tr, img, blockquote { page-break-inside: avoid; }
`;

/**
 * Print a standalone HTML document (already sanitized/escaped) via a hidden
 * iframe. `bodyHtml` is inserted verbatim — callers must escape/sanitize.
 */
export const printHtmlDocument = async ({
  title = 'Документ',
  bodyHtml = '',
  css = PRINT_DOC_CSS,
} = {}) => {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">`
    + `<title>${escapeHtml(title)}</title><style>${css}</style></head>`
    + `<body>${bodyHtml}</body></html>`;
  const frame = mountPrintFrame({ srcdoc: html, title });
  await runIframePrint(frame);
};

/** Plain-text print body: monospace <pre>, preserves whitespace. */
export const buildTextPrintBodyHtml = ({ text = '', truncated = false } = {}) => {
  const note = truncated
    ? '<p class="doc-note">Показана первая часть файла. Полный текст — в исходном файле.</p>'
    : '';
  return `${note}<pre class="text">${escapeHtml(text)}</pre>`;
};

/** Bounded workbook → print <table> HTML (cells are escaped). */
export const buildSheetsPrintBodyHtml = ({ sheets = [], maxRows = 500 } = {}) => {
  const parts = [];
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows.slice(0, maxRows) : [];
    if (!rows.length) continue;
    const body = rows.map((row, rowIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td';
      const cells = (Array.isArray(row) ? row : [])
        .map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`)
        .join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    const sheetTitle = sheet?.name ? `<h2>${escapeHtml(sheet.name)}</h2>` : '';
    const clipped = sheet.rows.length > maxRows
      ? `<p class="doc-note">Показаны первые ${maxRows} строк из ${sheet.rows.length}.</p>`
      : '';
    parts.push(`${sheetTitle}${clipped}<table>${body}</table>`);
  }
  return parts.join('') || '<p>Нет данных для печати.</p>';
};
