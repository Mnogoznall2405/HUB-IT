import type { MailAttachment } from '../api/mailApi';

const MAX_MAIL_HTML_LENGTH = 2_000_000;
const MAX_INLINE_DATA_URL_LENGTH = 8_000_000;
const BLOCKED_CONTAINER_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'video', 'audio', 'svg', 'math'];
const DARK_MAIL_SURFACE = '#1b1f26';
const DARK_MAIL_SURFACE_SOFT = '#222832';
const DARK_MAIL_TEXT = '#f3f2f1';
const DARK_MAIL_LINK = '#8cc8ff';
const DARK_MAIL_MIN_TEXT_CONTRAST = 4.5;
const LIGHT_MAIL_BACKGROUND_LUMINANCE = 0.72;
const MAIL_NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000ff',
  canvas: '#ffffff',
  canvastext: '#000000',
  gray: '#808080',
  grey: '#808080',
  navy: '#000080',
  silver: '#c0c0c0',
  white: '#ffffff',
  window: '#ffffff',
  windowtext: '#000000',
};

type ParsedMailColor = { r: number; g: number; b: number; a: number };

export type PreparedNativeMailHtml = {
  document: string;
  hasBlockedExternalImages: boolean;
  usedInlineAttachmentRefs: Set<string>;
};

function normalizeContentId(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/^<+|>+$/g, '')
    .trim()
    .toLowerCase();
}

function attachmentRef(attachment: MailAttachment): string {
  return String(attachment.download_token || attachment.id || '').trim();
}

function safeInlineImageDataUrl(value: unknown): string {
  const source = String(value || '').trim();
  if (source.length > MAX_INLINE_DATA_URL_LENGTH) return '';
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(source) ? source : '';
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

export function getSafeNativeMailExternalUrl(value: unknown): string {
  const source = decodeHtmlAttribute(String(value || '').trim());
  if (!source || source.length > 8_192 || /[\u0000-\u001f\u007f]/.test(source) || /%0[ad]/i.test(source)) return '';
  try {
    const parsed = new URL(source);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol.toLowerCase()) ? source : '';
  } catch {
    return '';
  }
}

function removeAttribute(tag: string, attribute: string): string {
  const quoted = new RegExp(`\\s${attribute}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'gi');
  const unquoted = new RegExp(`\\s${attribute}\\s*=\\s*[^\\s>]+`, 'gi');
  return tag.replace(quoted, '').replace(unquoted, '');
}

function readAttribute(tag: string, attribute: string): string {
  const quoted = tag.match(new RegExp(`\\s${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  if (quoted) return String(quoted[2] || '').trim();
  const unquoted = tag.match(new RegExp(`\\s${attribute}\\s*=\\s*([^\\s>]+)`, 'i'));
  return String(unquoted?.[1] || '').trim();
}

function setAttribute(tag: string, attribute: string, value: string): string {
  const without = removeAttribute(tag, attribute);
  return without.replace(/\s*\/?\s*>$/, (ending) => ` ${attribute}="${escapeAttribute(value)}"${ending.includes('/') ? ' /' : ''}>`);
}

function imagePlaceholder(kind: 'blocked' | 'missing'): string {
  const label = kind === 'blocked' ? 'Внешнее изображение скрыто' : 'Изображение недоступно';
  return `<span class="mail-image-placeholder" data-image-state="${kind}">${label}</span>`;
}

function stripDangerousMarkup(source: string): string {
  let html = source;
  BLOCKED_CONTAINER_TAGS.forEach((tag) => {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    html = html.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  });
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<(?:meta|link|base|input|button|textarea|select|option)\b[^>]*>/gi, '')
    .replace(/\s(?:on[a-z0-9_-]+|srcdoc|nonce)\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(/\s(?:on[a-z0-9_-]+|srcdoc|nonce)\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(?:action|formaction)\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(/\s(?:action|formaction)\s*=\s*[^\s>]+/gi, '')
    .replace(/<[a-z][^>]*>/gi, (tag) => {
      const anchor = /^<a\b/i.test(tag);
      const safeHref = anchor ? getSafeNativeMailExternalUrl(readAttribute(tag, 'href')) : '';
      let normalized = removeAttribute(removeAttribute(tag, 'href'), 'target');
      normalized = removeAttribute(normalized, 'rel');
      if (!safeHref) return normalized;
      normalized = setAttribute(normalized, 'href', safeHref);
      return setAttribute(normalized, 'rel', 'noopener noreferrer');
    });
  return html;
}

function clampMailColorByte(value: number): number {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}

function parseMailColorComponent(value: string): number {
  const source = value.trim();
  return clampMailColorByte(source.endsWith('%')
    ? (Number.parseFloat(source) / 100) * 255
    : Number.parseFloat(source));
}

function parseMailAlpha(value: string | undefined): number {
  const source = String(value || '').trim();
  if (!source) return 1;
  const parsed = source.endsWith('%') ? Number.parseFloat(source) / 100 : Number.parseFloat(source);
  return Math.max(0, Math.min(1, Number.isFinite(parsed) ? parsed : 1));
}

function parseMailCssColor(value: unknown): ParsedMailColor | null {
  let source = String(value || '').trim().toLowerCase().replace(/\s*!important\s*$/, '');
  if (!source || ['transparent', 'inherit', 'initial', 'currentcolor'].includes(source)) return null;
  source = MAIL_NAMED_COLORS[source] || source;

  const hex = source.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const parts = hex.length <= 4
      ? [...hex].map((part) => `${part}${part}`)
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8) || 'ff'];
    return {
      r: Number.parseInt(parts[0], 16),
      g: Number.parseInt(parts[1], 16),
      b: Number.parseInt(parts[2], 16),
      a: Number.parseInt(parts[3] || 'ff', 16) / 255,
    };
  }

  const rgb = source.match(/^rgba?\((.+)\)$/i)?.[1]
    ?.replace(/\s*\/\s*/g, ' ')
    .split(/[,\s]+/)
    .filter(Boolean);
  if (rgb && rgb.length >= 3) {
    return {
      r: parseMailColorComponent(rgb[0]),
      g: parseMailColorComponent(rgb[1]),
      b: parseMailColorComponent(rgb[2]),
      a: parseMailAlpha(rgb[3]),
    };
  }

  const hsl = source.match(/^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?\s*[, ]+\s*(\d+(?:\.\d+)?)%\s*[, ]+\s*(\d+(?:\.\d+)?)%(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/i);
  if (!hsl) return null;
  const hue = ((Number.parseFloat(hsl[1]) % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(1, Number.parseFloat(hsl[2]) / 100));
  const lightness = Math.max(0, Math.min(1, Number.parseFloat(hsl[3]) / 100));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const channels = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return {
    r: clampMailColorByte((channels[0] + offset) * 255),
    g: clampMailColorByte((channels[1] + offset) * 255),
    b: clampMailColorByte((channels[2] + offset) * 255),
    a: parseMailAlpha(hsl[4]),
  };
}

function mailRelativeLuminance(color: ParsedMailColor): number {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function mailContrastRatio(first: ParsedMailColor, second: ParsedMailColor): number {
  const firstLuminance = mailRelativeLuminance(first);
  const secondLuminance = mailRelativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function shouldAdaptDarkMailText(value: unknown): boolean {
  const color = parseMailCssColor(value);
  const surface = parseMailCssColor(DARK_MAIL_SURFACE);
  if (!color || !surface || color.a <= 0.05) return false;
  return mailContrastRatio(color, surface) < DARK_MAIL_MIN_TEXT_CONTRAST
    || mailRelativeLuminance(color) < 0.34;
}

function shouldAdaptDarkMailBackground(value: unknown): boolean {
  const color = parseMailCssColor(value);
  return Boolean(color && color.a > 0.05 && mailRelativeLuminance(color) >= LIGHT_MAIL_BACKGROUND_LUMINANCE);
}

function normalizeDarkMailColors(html: string, foreground: string, background: string): string {
  const declarationsNormalized = html.replace(
    /((?:^|[;{"'])\s*)(color|background-color|background)\s*:\s*([^;}"']+)/gi,
    (match, prefix: string, property: string, rawValue: string) => {
      const isText = property.toLowerCase() === 'color';
      if (isText ? !shouldAdaptDarkMailText(rawValue) : !shouldAdaptDarkMailBackground(rawValue)) return match;
      const important = /!important/i.test(rawValue) ? ' !important' : '';
      const replacement = isText ? foreground : background;
      return `${prefix}${property}:${replacement}${important}`;
    },
  );
  return declarationsNormalized.replace(/<[a-z][^>]*>/gi, (tag) => {
    let normalized = tag;
    const color = readAttribute(normalized, 'color');
    const backgroundColor = readAttribute(normalized, 'bgcolor');
    if (shouldAdaptDarkMailText(color)) normalized = removeAttribute(normalized, 'color');
    if (shouldAdaptDarkMailBackground(backgroundColor)) normalized = setAttribute(normalized, 'bgcolor', background);
    return normalized;
  });
}

function stripRemoteCssResources(html: string, allowExternalImages: boolean): { html: string; blocked: boolean } {
  if (allowExternalImages) return { html, blocked: false };
  let blocked = false;
  const next = html
    .replace(/@import\s+(?:url\()?\s*["']?https?:\/\/[^;)}]+["']?\s*\)?\s*;?/gi, () => {
      blocked = true;
      return '';
    })
    .replace(/url\(\s*(["']?)https?:\/\/[^)'"\s]+\1\s*\)/gi, () => {
      blocked = true;
      return 'none';
    });
  return { html: next, blocked };
}

export function sanitizeNativeMailEditableHtml(value: string): string {
  if (value.length > MAX_MAIL_HTML_LENGTH) throw new Error('Письмо слишком большое для редактора.');
  return stripDangerousMarkup(value)
    .replace(/\scontenteditable\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function prepareNativeMailHtml(
  rawHtml: unknown,
  attachments: MailAttachment[] = [],
  { allowExternalImages = false, dark = false }: { allowExternalImages?: boolean; dark?: boolean } = {},
): PreparedNativeMailHtml {
  const source = String(rawHtml || '').trim().slice(0, MAX_MAIL_HTML_LENGTH);
  const inlineByCid = new Map<string, { dataUrl: string; ref: string }>();
  attachments.forEach((attachment) => {
    const contentId = normalizeContentId(attachment.content_id);
    const dataUrl = safeInlineImageDataUrl(attachment.inline_data_url || attachment.inline_src);
    if (contentId && dataUrl) inlineByCid.set(contentId, { dataUrl, ref: attachmentRef(attachment) });
  });

  const usedInlineAttachmentRefs = new Set<string>();
  let hasBlockedExternalImages = false;
  let html = stripDangerousMarkup(source);
  const cssResult = stripRemoteCssResources(html, allowExternalImages);
  html = cssResult.html;
  hasBlockedExternalImages = cssResult.blocked;

  html = html.replace(/<img\b[^>]*>/gi, (imageTag) => {
    let tag = removeAttribute(removeAttribute(imageTag, 'srcset'), 'poster');
    const src = readAttribute(tag, 'src');
    if (!src) return imagePlaceholder('missing');
    if (/^cid:/i.test(src)) {
      const inline = inlineByCid.get(normalizeContentId(src));
      if (!inline) return imagePlaceholder('missing');
      if (inline.ref) usedInlineAttachmentRefs.add(inline.ref);
      tag = setAttribute(tag, 'src', inline.dataUrl);
      return setAttribute(tag, 'alt', readAttribute(tag, 'alt') || 'Встроенное изображение');
    }
    if (/^data:image\//i.test(src) && safeInlineImageDataUrl(src)) {
      return setAttribute(tag, 'alt', readAttribute(tag, 'alt') || 'Изображение из письма');
    }
    if (/^https?:\/\//i.test(src)) {
      if (allowExternalImages) return setAttribute(tag, 'alt', readAttribute(tag, 'alt') || 'Внешнее изображение');
      hasBlockedExternalImages = true;
      return imagePlaceholder('blocked');
    }
    return imagePlaceholder('missing');
  });

  const foreground = dark ? DARK_MAIL_TEXT : '#242424';
  const background = dark ? DARK_MAIL_SURFACE : '#ffffff';
  const secondary = dark ? '#b8b8b8' : '#616161';
  const border = dark ? '#454545' : '#d7d7d7';
  const link = dark ? DARK_MAIL_LINK : '#0f6cbd';
  const linkPriority = dark ? '!important' : '';
  const nestedLinkRule = dark ? `a *{color:${link}!important}` : '';
  const imageSources = allowExternalImages ? 'data: https: http:' : 'data:';
  if (dark) html = normalizeDarkMailColors(html, foreground, DARK_MAIL_SURFACE_SOFT);
  const csp = [
    "default-src 'none'",
    `img-src ${imageSources}`,
    "style-src 'unsafe-inline'",
    "script-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "navigate-to 'none'",
  ].join('; ');
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;padding:0;background:${background};color:${foreground};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:16px;line-height:1.55;overflow-wrap:anywhere;word-break:break-word}body{padding:12px}*{max-width:100%;box-sizing:border-box}p{margin:0 0 1em}img{height:auto;display:block}table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}td,th{overflow-wrap:anywhere}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}a{color:${link}${linkPriority};text-decoration:underline;text-decoration-thickness:from-font;text-underline-position:from-font}${nestedLinkRule}.mail-image-placeholder{display:block;padding:12px;margin:8px 0;border:1px dashed ${border};border-radius:8px;color:${secondary};font-size:13px}</style></head><body>${html || '<p>В письме нет содержимого.</p>'}</body></html>`;
  return { document, hasBlockedExternalImages, usedInlineAttachmentRefs };
}

export function shouldAllowMailDocumentNavigation(url: unknown): boolean {
  const normalized = String(url || '').trim().toLowerCase();
  return normalized === 'about:blank' || normalized.startsWith('data:text/html');
}
