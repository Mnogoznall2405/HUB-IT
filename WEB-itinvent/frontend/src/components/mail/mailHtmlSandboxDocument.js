export const MAIL_HTML_SANDBOX_PERMISSIONS = 'allow-popups allow-popups-to-escape-sandbox allow-same-origin';

export const MAIL_HTML_SANDBOX_CSP = [
  "default-src 'none'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "style-src 'unsafe-inline'",
  "font-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const MAIL_SANDBOX_FONT = '"Aptos", "Calibri", "Segoe UI", Arial, sans-serif';
const MAIL_SANDBOX_EMPTY_HTML = '<p style="color:#999">Нет содержимого</p>';

function cssSafe(value) {
  return String(value || '').replace(/[<>]/g, '').replace(/[\n\r]/g, ' ');
}

function resolveSandboxFontFamily() {
  if (typeof document === 'undefined') return MAIL_SANDBOX_FONT;
  try {
    const fromVar = String(
      window.getComputedStyle(document.documentElement).getPropertyValue('--mail-message-font') || '',
    ).trim();
    return fromVar || MAIL_SANDBOX_FONT;
  } catch {
    return MAIL_SANDBOX_FONT;
  }
}

export function buildMailSandboxSrcDoc(html, {
  color = '#242424',
  backgroundColor = 'transparent',
  fontFamily,
  fontSize = '1rem',
  lineHeight = 1.65,
  linkColor = '#1976d2',
  collapseQuotes = false,
} = {}) {
  const bodyHtml = String(html || '').trim() || MAIL_SANDBOX_EMPTY_HTML;
  const resolvedFont = cssSafe(fontFamily || resolveSandboxFontFamily());
  const quoteCss = collapseQuotes
    ? 'blockquote,.gmail_quote,.protonmail_quote,.yahoo_quoted,.moz-cite-prefix{display:none !important;}'
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${MAIL_HTML_SANDBOX_CSP}"><style>
html,body{margin:0;padding:0;background:${cssSafe(backgroundColor)};color:${cssSafe(color)};font-family:${resolvedFont};font-size:${cssSafe(fontSize)};line-height:${cssSafe(lineHeight)};overflow-x:hidden;overflow-wrap:anywhere;word-break:break-word;}
img,video{max-width:100% !important;height:auto !important;object-fit:contain;}
a{color:${cssSafe(linkColor)};}
blockquote,.gmail_quote,[data-mail-quoted-block="true"]{margin:0.8em 0 0;padding:0.2em 0 0.2em 12px;border-left:3px solid currentColor;opacity:.84;}
[data-mail-signature="true"],.gmail_signature,#Signature{opacity:.82;}
table{max-width:100%;border-collapse:collapse;}
[data-mail-table-scroll="true"]{width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;box-sizing:border-box;}
.mail-image-placeholder{display:flex;align-items:center;justify-content:center;min-height:112px;padding:8px;border:1px dashed currentColor;opacity:.8;font-size:.9em;}
${quoteCss}
@media print{html,body{overflow:visible;background:#fff;color:#000;}}
</style></head><body>${bodyHtml}</body></html>`;
}

export function measureMailSandboxFrameHeight(iframe) {
  const doc = iframe?.contentDocument;
  if (!doc) return 0;
  const body = doc.body;
  const root = doc.documentElement;
  return Math.max(
    Number(body?.scrollHeight) || 0,
    Number(body?.offsetHeight) || 0,
    Number(root?.scrollHeight) || 0,
    32,
  );
}
