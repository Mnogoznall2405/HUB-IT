import { splitQuotedHistoryHtml } from './mailQuotedHistory';

const OUTGOING_MAIL_BODY_STYLE = [
  'margin:0',
  'padding:0',
  'font-family:Aptos, Calibri, Arial, Helvetica, sans-serif',
  'font-size:11pt',
  'line-height:1.5',
].join(';');

const OUTGOING_WRAPPER_PATTERN = /^\s*<div\b[^>]*data-mail-outgoing=(['"])true\1[^>]*>([\s\S]*)<\/div>\s*$/i;
const OUTGOING_SIGNATURE_PATTERN = /^\s*<div\b[^>]*data-mail-signature=(['"])true\1[^>]*>([\s\S]*)<\/div>\s*$/i;
const SIGNATURE_LINE_BLOCK_SELECTOR = 'p, div';
const SIGNATURE_LINE_STYLE = {
  margin: '0 0 4px 0',
  lineHeight: '1.35',
};
const OUTGOING_DEFAULT_TEXT_COLOR = '#000000';
const OUTGOING_LOW_CONTRAST_ON_WHITE = 2.4;

function isEffectivelyEmptyHtml(html) {
  const normalized = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|\/?p|\/?div|\/?span|\/?font|\/?b|\/?i|\/?u|\/?strong|\/?em)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  return normalized.length === 0;
}

function normalizePreviewHtml(html) {
  const trimmed = String(html || '').trim();
  if (!trimmed) return '';
  if (isEffectivelyEmptyHtml(trimmed)) return '';
  return trimmed;
}

function unwrapOutgoingPreviewContainer(html, pattern) {
  const source = String(html || '').trim();
  if (!source) return '';
  const match = source.match(pattern);
  if (!match) return source;
  return String(match[2] || '').trim();
}

function mergeSignatureLineStyle(styleValue = '') {
  const keptDeclarations = String(styleValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((declaration) => !/^(margin|line-height)\s*:/i.test(declaration));

  keptDeclarations.push(`margin:${SIGNATURE_LINE_STYLE.margin}`);
  keptDeclarations.push(`line-height:${SIGNATURE_LINE_STYLE.lineHeight}`);

  return `${keptDeclarations.join(';')};`;
}

function parseCssColorComponent(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (raw.endsWith('%')) return Math.round((Number.parseFloat(raw) / 100) * 255);
  return Math.round(Number.parseFloat(raw));
}

function parseCssAlphaComponent(value) {
  const raw = String(value || '').trim();
  if (!raw) return 1;
  if (raw.endsWith('%')) return Math.max(0, Math.min(1, Number.parseFloat(raw) / 100));
  return Math.max(0, Math.min(1, Number.parseFloat(raw)));
}

function clampColorByte(value) {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}

function parseOutgoingCssColor(value) {
  let raw = String(value || '').trim().toLowerCase();
  raw = raw.replace(/\s*!important\s*$/i, '').trim();
  if (!raw || raw === 'transparent' || raw === 'inherit' || raw === 'initial' || raw === 'currentcolor') return null;
  if (raw === 'white') raw = '#ffffff';
  if (raw === 'black') raw = '#000000';

  const hexMatch = raw.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const expand = (part) => (part.length === 1 ? `${part}${part}` : part);
    const parts = hex.length <= 4
      ? [expand(hex[0]), expand(hex[1]), expand(hex[2]), expand(hex[3] || 'f')]
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8) || 'ff'];
    return {
      r: Number.parseInt(parts[0], 16),
      g: Number.parseInt(parts[1], 16),
      b: Number.parseInt(parts[2], 16),
      a: Number.parseInt(parts[3], 16) / 255,
    };
  }

  const rgbMatch = raw.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) return null;
  const parts = rgbMatch[1].replace(/\s*\/\s*/g, ' ').split(/[,\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  return {
    r: clampColorByte(parseCssColorComponent(parts[0])),
    g: clampColorByte(parseCssColorComponent(parts[1])),
    b: clampColorByte(parseCssColorComponent(parts[2])),
    a: parts.length >= 4 ? parseCssAlphaComponent(parts[3]) : 1,
  };
}

function srgbToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(color) {
  return (
    (0.2126 * srgbToLinear(color.r))
    + (0.7152 * srgbToLinear(color.g))
    + (0.0722 * srgbToLinear(color.b))
  );
}

function getContrastRatio(leftColor, rightColor) {
  const left = getRelativeLuminance(leftColor);
  const right = getRelativeLuminance(rightColor);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function isLowContrastOutgoingTextColor(value) {
  const color = parseOutgoingCssColor(value);
  if (!color || color.a <= 0.05) return false;
  return getContrastRatio(color, { r: 255, g: 255, b: 255, a: 1 }) < OUTGOING_LOW_CONTRAST_ON_WHITE;
}

function mergeOutgoingReadableTextStyle(styleValue = '') {
  let changed = false;
  const declarations = String(styleValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((declaration) => {
      if (!/^\s*color\s*:/i.test(declaration)) return declaration;
      const value = declaration.split(':').slice(1).join(':').trim();
      if (!isLowContrastOutgoingTextColor(value)) return declaration;
      changed = true;
      return `color:${OUTGOING_DEFAULT_TEXT_COLOR}`;
    });

  return changed ? `${declarations.join(';')};` : String(styleValue || '');
}

function normalizeOutgoingReadableTextColors(html) {
  const source = String(html || '').trim();
  if (!source || typeof DOMParser === 'undefined') return source;

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(source, 'text/html');
    documentNode.body?.querySelectorAll('[style]').forEach((node) => {
      const currentStyle = node.getAttribute('style') || '';
      const nextStyle = mergeOutgoingReadableTextStyle(currentStyle);
      if (nextStyle !== currentStyle) {
        node.setAttribute('style', nextStyle);
      }
    });
    return String(documentNode.body?.innerHTML || source).trim();
  } catch {
    return source;
  }
}

function normalizeSignatureLineSpacing(html) {
  const source = String(html || '').trim();
  if (!source || typeof DOMParser === 'undefined') return source;

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(source, 'text/html');
    documentNode.body?.querySelectorAll(SIGNATURE_LINE_BLOCK_SELECTOR).forEach((node) => {
      if (node.hasAttribute('data-mail-outgoing') || node.hasAttribute('data-mail-signature')) return;
      node.setAttribute('style', mergeSignatureLineStyle(node.getAttribute('style')));
    });
    return String(documentNode.body?.innerHTML || source).trim();
  } catch {
    return source;
  }
}

export function normalizeSignaturePreviewHtml(signatureHtml) {
  const withoutOutgoingWrapper = unwrapOutgoingPreviewContainer(signatureHtml, OUTGOING_WRAPPER_PATTERN);
  const withoutSignatureWrapper = unwrapOutgoingPreviewContainer(withoutOutgoingWrapper, OUTGOING_SIGNATURE_PATTERN);
  return normalizePreviewHtml(normalizeOutgoingReadableTextColors(normalizeSignatureLineSpacing(withoutSignatureWrapper)));
}

export function buildOutgoingMailPreviewHtml({
  primaryHtml = '',
  quotedHtml = '',
  signatureHtml = '',
} = {}) {
  const primary = normalizePreviewHtml(normalizeOutgoingReadableTextColors(primaryHtml));
  const quoted = normalizePreviewHtml(normalizeOutgoingReadableTextColors(quotedHtml));
  const signature = normalizeSignaturePreviewHtml(signatureHtml);
  const parts = [];

  if (primary) {
    parts.push(primary);
  }
  if (signature) {
    parts.push(`<div data-mail-signature="true" style="margin:${primary ? '16px' : '0'} 0 0 0;">${signature}</div>`);
  }
  if (quoted) {
    parts.push(`<div data-mail-quoted-block="true" style="margin:${primary || signature ? '16px' : '0'} 0 0 0;">${quoted}</div>`);
  }

  if (parts.length === 0) return '';
  return `<div data-mail-outgoing="true" style="${OUTGOING_MAIL_BODY_STYLE};">${parts.join('')}</div>`;
}

export function buildComposeMailPreviewHtml({
  composeBody = '',
  quotedOriginalHtml = '',
  signatureHtml = '',
} = {}) {
  const splitBody = normalizePreviewHtml(quotedOriginalHtml)
    ? {
        primaryHtml: composeBody,
        quotedHtml: quotedOriginalHtml,
      }
    : splitQuotedHistoryHtml(composeBody || '');

  return buildOutgoingMailPreviewHtml({
    primaryHtml: splitBody?.primaryHtml || composeBody,
    quotedHtml: splitBody?.quotedHtml || '',
    signatureHtml,
  });
}

export function buildSignaturePreviewHtml(signatureHtml = '') {
  const normalizedSignature = normalizeSignaturePreviewHtml(signatureHtml)
    || '<span style="color:#64748b;">Подпись не задана</span>';

  return buildOutgoingMailPreviewHtml({
    primaryHtml: '<p>Новый текст письма.</p>',
    signatureHtml: normalizedSignature,
    quotedHtml: '<div class="quoted-mail"><blockquote><p>Предыдущее сообщение.</p></blockquote></div>',
  });
}
