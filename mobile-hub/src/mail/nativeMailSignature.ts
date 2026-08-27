const MAX_SIGNATURE_HTML_LENGTH = 200_000;
const ALLOWED_SIGNATURE_TAGS = new Set([
  'p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote',
]);
const EMPTY_SIGNATURE_TAGS = new Set(['br']);
const BLOCKED_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form'];

/**
 * Keeps a small formatting-only HTML subset for outgoing signatures.
 * All attributes are intentionally removed: signatures cannot contain remote
 * trackers, executable handlers, links or CSS that escapes the mail body.
 */
export function sanitizeMailSignatureHtml(value: unknown): string {
  let source = String(value || '').trim().slice(0, MAX_SIGNATURE_HTML_LENGTH);
  BLOCKED_WITH_CONTENT.forEach((tag) => {
    source = source.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    source = source.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  });
  source = source.replace(/<!--[\s\S]*?-->/g, '');
  source = source.replace(/<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi, (tag, rawName: string) => {
    const name = String(rawName || '').toLowerCase();
    if (!ALLOWED_SIGNATURE_TAGS.has(name)) return '';
    if (EMPTY_SIGNATURE_TAGS.has(name)) return '<br>';
    return /^<\s*\//.test(tag) ? `</${name}>` : `<${name}>`;
  });
  return source.trim();
}
