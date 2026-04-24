import DOMPurify from 'dompurify';

const MAIL_PRESENTATION_ATTRS = [
  'style',
  'class',
  'width',
  'height',
  'align',
  'valign',
  'bgcolor',
  'cellpadding',
  'cellspacing',
  'colspan',
  'rowspan',
  'data-mail-outgoing',
  'data-mail-signature',
  'data-mail-quoted-block',
  'data-mail-table-scroll',
  'data-mail-image-state',
];
const RESPONSIVE_MAIL_MEDIA_STYLE = 'max-width:100% !important;height:auto !important;box-sizing:border-box;';
const RESPONSIVE_MAIL_TABLE_STYLE = 'border-collapse:collapse;';
const RESPONSIVE_MAIL_CELL_STYLE = 'max-width:100%;overflow-wrap:anywhere;word-break:break-word;';
const RESPONSIVE_MAIL_BLOCK_STYLE = 'max-width:100% !important;min-width:0 !important;box-sizing:border-box;';
const RESPONSIVE_MAIL_TABLE_SCROLL_STYLE = 'max-width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;box-sizing:border-box;';
const MAIL_DARK_SURFACE_COLOR = '#1b1f26';
const MAIL_DARK_SURFACE_SOFT_COLOR = '#222832';
const MAIL_DARK_TEXT_COLOR = '#f3f2f1';
const MAIL_DARK_LINK_COLOR = '#8cc8ff';
const MAIL_DARK_BORDER_COLOR = 'rgba(255,255,255,0.18)';
const MAIL_DARK_MIN_TEXT_CONTRAST = 4.5;
const MAIL_LIGHT_BACKGROUND_LUMINANCE = 0.72;
const MAIL_MIN_READABLE_FONT_SIZE_PX = 13;
const MAIL_MIN_READABLE_FONT_SIZE_PT = 10;
const MAIL_MIN_READABLE_FONT_SIZE_EM = 0.875;
const MAIL_MIN_READABLE_FONT_SIZE_PERCENT = 87.5;
const MAIL_NAMED_COLORS = {
  black: '#000000',
  blue: '#0000ff',
  navy: '#000080',
  white: '#ffffff',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
};
const MAIL_LAYOUT_NODE_SELECTOR = [
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'p',
  'blockquote',
  'center',
  'ul',
  'ol',
  'li',
].join(',');

const sanitizeIncomingMailHtml = (html) => {
  const source = String(html || '').trim();
  if (!source) return '';
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'],
    ADD_ATTR: MAIL_PRESENTATION_ATTRS,
  });
};

const normalizeInlineContentId = (value) => {
  let normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.toLowerCase().startsWith('cid:')) {
    normalized = normalized.slice(4);
  }
  normalized = normalized.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  return normalized.toLowerCase();
};

const getMailAttachmentIdentity = (attachment) => String(
  attachment?.download_token
  || attachment?.id
  || ''
).trim();

const isRemoteMailImageSrc = (value) => /^https?:\/\//i.test(String(value || '').trim());
const isIntrinsicMailImageSrc = (value) => /^(data:|blob:)/i.test(String(value || '').trim());

const createMailImagePlaceholder = (documentNode, kind) => {
  const placeholderNode = documentNode.createElement('div');
  placeholderNode.className = 'mail-image-placeholder';
  placeholderNode.setAttribute('data-mail-image-state', kind === 'blocked' ? 'blocked' : 'missing');
  placeholderNode.textContent = kind === 'blocked' ? 'Внешнее изображение скрыто' : 'Изображение недоступно';
  return placeholderNode;
};

const appendNodeStyle = (node, declarations) => {
  if (!node || !declarations) return;
  const currentStyle = String(node.getAttribute('style') || '').trim();
  const styleSeparator = currentStyle && !currentStyle.endsWith(';') ? ';' : '';
  node.setAttribute('style', `${currentStyle}${styleSeparator}${declarations}`);
};

const parseCssColorComponent = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (raw.endsWith('%')) {
    return Math.round((Number.parseFloat(raw) / 100) * 255);
  }
  return Math.round(Number.parseFloat(raw));
};

const parseCssAlphaComponent = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 1;
  if (raw.endsWith('%')) {
    return Math.max(0, Math.min(1, Number.parseFloat(raw) / 100));
  }
  return Math.max(0, Math.min(1, Number.parseFloat(raw)));
};

const clampColorByte = (value) => Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));

const parseCssColor = (value) => {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'transparent' || raw === 'inherit' || raw === 'initial' || raw === 'currentcolor') {
    return null;
  }
  raw = MAIL_NAMED_COLORS[raw] || raw;

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
};

const srgbToLinear = (value) => {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const getRelativeLuminance = (color) => (
  (0.2126 * srgbToLinear(color.r))
  + (0.7152 * srgbToLinear(color.g))
  + (0.0722 * srgbToLinear(color.b))
);

const getContrastRatio = (leftColor, rightColor) => {
  const left = getRelativeLuminance(leftColor);
  const right = getRelativeLuminance(rightColor);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
};

const getCssHue = ({ r, g, b }) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  if (max === red) return (60 * (((green - blue) / delta) % 6) + 360) % 360;
  if (max === green) return 60 * (((blue - red) / delta) + 2);
  return 60 * (((red - green) / delta) + 4);
};

const isBlueLikeColor = (color) => {
  const hue = getCssHue(color);
  return hue >= 185 && hue <= 255 && color.b >= color.r && color.b >= color.g;
};

const setNodeStyleProperty = (node, property, value) => {
  if (!node?.style || !value) return;
  const priority = node.style.getPropertyPriority(property);
  node.style.setProperty(property, value, priority || undefined);
};

const getReadableMailFontSize = (rawValue) => {
  const raw = String(rawValue || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'xx-small' || raw === 'x-small') return `${MAIL_MIN_READABLE_FONT_SIZE_PX}px`;
  const match = raw.match(/^(-?\d*\.?\d+)(px|pt|rem|em|%)$/i);
  if (!match) return '';
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return '';
  if (unit === 'px' && value < MAIL_MIN_READABLE_FONT_SIZE_PX) {
    return `${MAIL_MIN_READABLE_FONT_SIZE_PX}px`;
  }
  if (unit === 'pt' && value < MAIL_MIN_READABLE_FONT_SIZE_PT) {
    return `${MAIL_MIN_READABLE_FONT_SIZE_PT}pt`;
  }
  if ((unit === 'em' || unit === 'rem') && value < MAIL_MIN_READABLE_FONT_SIZE_EM) {
    return `${MAIL_MIN_READABLE_FONT_SIZE_EM}${unit}`;
  }
  if (unit === '%' && value < MAIL_MIN_READABLE_FONT_SIZE_PERCENT) {
    return `${MAIL_MIN_READABLE_FONT_SIZE_PERCENT}%`;
  }
  return '';
};

const normalizeReadableMailTypography = (documentNode) => {
  documentNode.body?.querySelectorAll('[style]').forEach((node) => {
    const readableFontSize = getReadableMailFontSize(node.style.getPropertyValue('font-size'));
    if (readableFontSize) {
      setNodeStyleProperty(node, 'font-size', readableFontSize);
    }
  });
};

const getDarkAdaptedTextColor = (rawColor, { link = false } = {}) => {
  const color = parseCssColor(rawColor);
  if (!color || color.a <= 0.05) return '';
  const darkSurface = parseCssColor(MAIL_DARK_SURFACE_COLOR);
  const contrast = getContrastRatio(color, darkSurface);
  if (link || isBlueLikeColor(color)) {
    return contrast < 5.2 ? MAIL_DARK_LINK_COLOR : '';
  }
  if (contrast < MAIL_DARK_MIN_TEXT_CONTRAST || getRelativeLuminance(color) < 0.34) {
    return MAIL_DARK_TEXT_COLOR;
  }
  return '';
};

const getDarkAdaptedBackgroundColor = (rawColor) => {
  const color = parseCssColor(rawColor);
  if (!color || color.a <= 0.05) return '';
  if (getRelativeLuminance(color) >= MAIL_LIGHT_BACKGROUND_LUMINANCE) {
    return MAIL_DARK_SURFACE_SOFT_COLOR;
  }
  return '';
};

const normalizeDarkMailElementColors = (node) => {
  if (!node?.style) return;
  const isLink = String(node.tagName || '').toUpperCase() === 'A';
  const styleColor = node.style.getPropertyValue('color');
  const adaptedColor = styleColor
    ? getDarkAdaptedTextColor(styleColor, { link: isLink })
    : (isLink ? MAIL_DARK_LINK_COLOR : '');
  if (adaptedColor) {
    setNodeStyleProperty(node, 'color', adaptedColor);
  }

  ['background-color', 'background'].forEach((property) => {
    const adaptedBackground = getDarkAdaptedBackgroundColor(node.style.getPropertyValue(property));
    if (adaptedBackground) {
      setNodeStyleProperty(node, 'background-color', adaptedBackground);
    }
  });

  const attrBgcolor = String(node.getAttribute?.('bgcolor') || '').trim();
  const adaptedAttrBackground = getDarkAdaptedBackgroundColor(attrBgcolor);
  if (adaptedAttrBackground) {
    node.setAttribute('bgcolor', adaptedAttrBackground);
    setNodeStyleProperty(node, 'background-color', adaptedAttrBackground);
  }

  [
    'border-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
  ].forEach((property) => {
    const color = parseCssColor(node.style.getPropertyValue(property));
    if (!color) return;
    const contrast = getContrastRatio(color, parseCssColor(MAIL_DARK_SURFACE_COLOR));
    if (contrast < 1.7 || getRelativeLuminance(color) >= MAIL_LIGHT_BACKGROUND_LUMINANCE) {
      setNodeStyleProperty(node, property, MAIL_DARK_BORDER_COLOR);
    }
  });
};

const normalizeDarkMailColors = (documentNode) => {
  documentNode.body?.querySelectorAll('*').forEach((node) => {
    normalizeDarkMailElementColors(node);
  });
};

const wrapMailTableForScroll = (documentNode, tableNode) => {
  const parentElement = tableNode?.parentElement;
  if (!parentElement) return;
  if (String(parentElement.getAttribute('data-mail-table-scroll') || '').trim() === 'true') return;
  if (parentElement.closest('table')) return;
  const wrapperNode = documentNode.createElement('div');
  wrapperNode.className = 'mail-table-scroll';
  wrapperNode.setAttribute('data-mail-table-scroll', 'true');
  wrapperNode.setAttribute('style', RESPONSIVE_MAIL_TABLE_SCROLL_STYLE);
  parentElement.insertBefore(wrapperNode, tableNode);
  wrapperNode.appendChild(tableNode);
};

const normalizeRenderedMailLayout = (documentNode) => {
  documentNode.querySelectorAll(MAIL_LAYOUT_NODE_SELECTOR).forEach((layoutNode) => {
    appendNodeStyle(layoutNode, RESPONSIVE_MAIL_BLOCK_STYLE);
  });

  documentNode.querySelectorAll('img, video, iframe').forEach((mediaNode) => {
    if (mediaNode.tagName !== 'IFRAME') {
      mediaNode.removeAttribute('height');
    }
    appendNodeStyle(mediaNode, RESPONSIVE_MAIL_MEDIA_STYLE);
  });

  documentNode.querySelectorAll('table').forEach((tableNode) => {
    appendNodeStyle(tableNode, RESPONSIVE_MAIL_TABLE_STYLE);
    wrapMailTableForScroll(documentNode, tableNode);
  });

  documentNode.querySelectorAll('td, th').forEach((cellNode) => {
    appendNodeStyle(cellNode, RESPONSIVE_MAIL_CELL_STYLE);
  });
};

export const buildRenderedMailHtml = (html, attachments = [], { allowExternalImages = false, colorScheme = 'light' } = {}) => {
  const source = String(html || '').trim();
  const usedInlineAttachmentIds = new Set();
  let hasBlockedExternalImages = false;
  if (!source) {
    return { html: '', usedInlineAttachmentIds, hasBlockedExternalImages };
  }
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const fallbackHtml = sanitizeIncomingMailHtml(source);
  if (typeof DOMParser === 'undefined') {
    return { html: fallbackHtml, usedInlineAttachmentIds, hasBlockedExternalImages };
  }
  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(source, 'text/html');
    const attachmentsByContentId = new Map();
    safeAttachments.forEach((attachment) => {
      const contentId = normalizeInlineContentId(attachment?.content_id);
      const inlineDataUrl = String(attachment?.inline_data_url || '').trim();
      const inlineSrc = String(attachment?.inline_src || '').trim();
      const resolvedSrc = inlineDataUrl || inlineSrc;
      if (!contentId || !resolvedSrc) return;
      attachmentsByContentId.set(contentId, {
        ...attachment,
        resolved_inline_src: resolvedSrc,
      });
    });
    documentNode.querySelectorAll('img[src]').forEach((imageNode) => {
      const rawSrc = String(imageNode.getAttribute('src') || '').trim();
      if (!rawSrc) {
        imageNode.replaceWith(createMailImagePlaceholder(documentNode, 'missing'));
        return;
      }
      if (rawSrc.toLowerCase().startsWith('cid:')) {
        const contentId = normalizeInlineContentId(rawSrc);
        const attachment = contentId ? attachmentsByContentId.get(contentId) : null;
        if (!attachment?.resolved_inline_src) {
          imageNode.replaceWith(createMailImagePlaceholder(documentNode, 'missing'));
          return;
        }
        imageNode.setAttribute('src', String(attachment.resolved_inline_src));
        imageNode.setAttribute('loading', 'lazy');
        imageNode.setAttribute('decoding', 'async');
        const attachmentIdentity = getMailAttachmentIdentity(attachment);
        if (attachmentIdentity) {
          usedInlineAttachmentIds.add(attachmentIdentity);
        }
        return;
      }
      if (isIntrinsicMailImageSrc(rawSrc)) {
        imageNode.setAttribute('loading', 'lazy');
        imageNode.setAttribute('decoding', 'async');
        return;
      }
      if (isRemoteMailImageSrc(rawSrc)) {
        if (allowExternalImages) {
          imageNode.setAttribute('loading', 'lazy');
          imageNode.setAttribute('decoding', 'async');
          return;
        }
        hasBlockedExternalImages = true;
        imageNode.replaceWith(createMailImagePlaceholder(documentNode, 'blocked'));
        return;
      }
      imageNode.replaceWith(createMailImagePlaceholder(documentNode, 'missing'));
    });
    normalizeRenderedMailLayout(documentNode);
    normalizeReadableMailTypography(documentNode);
    if (colorScheme === 'dark') {
      normalizeDarkMailColors(documentNode);
    }
    return {
      html: sanitizeIncomingMailHtml(documentNode.body?.innerHTML || source),
      usedInlineAttachmentIds,
      hasBlockedExternalImages,
    };
  } catch {
    return { html: fallbackHtml, usedInlineAttachmentIds, hasBlockedExternalImages };
  }
};

export const filterVisibleMailAttachments = (attachments, usedInlineAttachmentIds) => {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  if (!(usedInlineAttachmentIds instanceof Set) || usedInlineAttachmentIds.size === 0) {
    return safeAttachments;
  }
  return safeAttachments.filter((attachment) => {
    const attachmentIdentity = getMailAttachmentIdentity(attachment);
    return !attachmentIdentity || !usedInlineAttachmentIds.has(attachmentIdentity);
  });
};
