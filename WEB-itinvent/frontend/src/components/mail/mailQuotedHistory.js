const QUOTED_HISTORY_MARKUP_PATTERN = /<blockquote|gmail_quote|protonmail_quote|yahoo_quoted|moz-cite-prefix|quoted-mail/i;
const QUOTED_HISTORY_SELECTORS = [
  'blockquote',
  '.gmail_quote',
  '.protonmail_quote',
  '.yahoo_quoted',
  '.moz-cite-prefix',
  '.quoted-mail',
  '.mail-quoted-history',
  '[data-mail-quoted-history]',
];
const QUOTED_HISTORY_HEADER_PATTERN = /(^|\n)\s*(from|sent|date|to|subject|от|дата|кому|тема)\s*:/gim;

function isEffectivelyEmptyHtml(html) {
  const normalized = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|\/?p|\/?div|\/?span|\/?font|\/?b|\/?i|\/?u|\/?strong|\/?em)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  return normalized.length === 0;
}

function getMeaningfulTextLength(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function hasMeaningfulPrimaryContent(html) {
  if (getMeaningfulTextLength(html) > 0) return true;
  return /<(img|video|iframe|table|pre|ul|ol|li)\b/i.test(String(html || ''));
}

function normalizeHtml(html, { preserveEmpty = false } = {}) {
  const trimmed = String(html || '').trim();
  if (!trimmed) return preserveEmpty ? '<p><br></p>' : '';
  if (isEffectivelyEmptyHtml(trimmed)) {
    return preserveEmpty ? '<p><br></p>' : '';
  }
  return trimmed;
}

function resolveTopLevelSplitNode(root, node) {
  let current = node;
  while (current && current.parentElement && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current?.parentElement === root ? current : null;
}

function countQuotedHeaderMatches(text) {
  const matches = String(text || '').match(QUOTED_HISTORY_HEADER_PATTERN);
  QUOTED_HISTORY_HEADER_PATTERN.lastIndex = 0;
  return Array.isArray(matches) ? matches.length : 0;
}

function looksLikeQuotedHeaderBlock(text) {
  return countQuotedHeaderMatches(text) >= 2;
}

function findSplitNodeByText(root) {
  const topLevelChildren = Array.from(root.children);
  const directMatch = topLevelChildren
    .slice(1)
    .find((child) => looksLikeQuotedHeaderBlock(String(child.textContent || '')));
  if (directMatch) return directMatch;

  const nestedMatch = Array.from(root.querySelectorAll('div, section, article, table, tr, td, p, span'))
    .find((node) => {
      if (!looksLikeQuotedHeaderBlock(String(node.textContent || ''))) return false;
      const topLevelNode = resolveTopLevelSplitNode(root, node);
      if (!topLevelNode) return false;
      return topLevelChildren.indexOf(topLevelNode) > 0;
    });
  return nestedMatch ? resolveTopLevelSplitNode(root, nestedMatch) : null;
}

export function hasQuotedHistoryMarkup(html) {
  return QUOTED_HISTORY_MARKUP_PATTERN.test(String(html || ''));
}

export function splitQuotedHistoryHtml(html) {
  const source = String(html || '').trim();
  if (!source) {
    return {
      primaryHtml: '',
      quotedHtml: '',
      hasQuotedHistory: false,
      collapsedByDefault: false,
    };
  }

  const markupDetected = hasQuotedHistoryMarkup(source);
  if (typeof DOMParser === 'undefined') {
    return {
      primaryHtml: source,
      quotedHtml: '',
      hasQuotedHistory: false,
      collapsedByDefault: false,
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div data-mail-quoted-root="true">${source}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) {
    return {
      primaryHtml: source,
      quotedHtml: '',
      hasQuotedHistory: false,
      collapsedByDefault: false,
    };
  }

  let splitNode = resolveTopLevelSplitNode(root, root.querySelector(QUOTED_HISTORY_SELECTORS.join(',')));
  if (!splitNode) {
    splitNode = findSplitNodeByText(root);
  }

  if (!splitNode) {
    return {
      primaryHtml: source,
      quotedHtml: '',
      hasQuotedHistory: false,
      collapsedByDefault: false,
    };
  }

  const children = Array.from(root.childNodes);
  const splitIndex = children.indexOf(splitNode);
  if (splitIndex <= 0) {
    return {
      primaryHtml: source,
      quotedHtml: '',
      hasQuotedHistory: false,
      collapsedByDefault: false,
    };
  }

  const primaryContainer = doc.createElement('div');
  const quotedContainer = doc.createElement('div');

  children.forEach((child, index) => {
    const target = index < splitIndex ? primaryContainer : quotedContainer;
    target.appendChild(child.cloneNode(true));
  });

  const primaryHtml = normalizeHtml(primaryContainer.innerHTML, { preserveEmpty: true });
  const quotedHtml = normalizeHtml(quotedContainer.innerHTML);
  if (!quotedHtml || !hasMeaningfulPrimaryContent(primaryHtml)) {
    return {
      primaryHtml: source,
      quotedHtml: '',
      hasQuotedHistory: false,
      collapsedByDefault: false,
    };
  }

  return {
    primaryHtml,
    quotedHtml,
    hasQuotedHistory: true,
    collapsedByDefault: Boolean(markupDetected || quotedHtml),
  };
}

export function mergeQuotedHistoryHtml(primaryHtml = '', quotedHtml = '') {
  const primary = normalizeHtml(primaryHtml, { preserveEmpty: false });
  const quoted = normalizeHtml(quotedHtml);
  if (primary && quoted) return `${primary}${quoted}`;
  if (primary) return primary;
  if (quoted) return quoted;
  return '';
}
