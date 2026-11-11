import { sanitizeMailHtmlFragment } from './mailHtmlContent';

const BLOCKED_PASTE_TAGS = 'script, style, iframe, object, embed, link, meta';
const REMOTE_RESOURCE_RE = /^(?:https?:|data:)/i;
const QUILL_SIZE_STYLES = {
  'ql-size-small': '0.75em',
  'ql-size-large': '1.5em',
  'ql-size-huge': '2.5em',
};

const parseRgb = (value) => {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'black') return [0, 0, 0];
  if (source === 'white') return [255, 255, 255];
  const shortHex = source.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (shortHex) return shortHex.slice(1).map((part) => Number.parseInt(`${part}${part}`, 16));
  const hex = source.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (hex) return hex.slice(1).map((part) => Number.parseInt(part, 16));
  const rgb = source.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i);
  return rgb ? rgb.slice(1).map((part) => Number.parseFloat(part)) : null;
};

const isConflictingNeutral = (value) => {
  const rgb = parseRgb(value);
  if (!rgb) return false;
  return rgb.every((part) => part <= 24) || rgb.every((part) => part >= 235);
};

const appendStyle = (node, name, value) => {
  if (!node?.style || !value) return;
  node.style.setProperty(name, value);
};

const stripConflictingColors = (root) => {
  root.querySelectorAll('[style], [color], [bgcolor]').forEach((node) => {
    if (isConflictingNeutral(node.style?.color || node.getAttribute('color'))) {
      node.style.removeProperty('color');
      node.removeAttribute('color');
    }
    const background = node.style?.backgroundColor || node.getAttribute('bgcolor');
    if (isConflictingNeutral(background)) {
      node.style.removeProperty('background');
      node.style.removeProperty('background-color');
      node.removeAttribute('bgcolor');
    }
    if (!String(node.getAttribute('style') || '').trim()) node.removeAttribute('style');
  });
};

const blockPastedImages = (root) => {
  root.querySelectorAll('img').forEach((node) => {
    const src = String(node.getAttribute('src') || '').trim();
    if (!src || REMOTE_RESOURCE_RE.test(src)) node.remove();
  });
  root.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
  root.querySelectorAll('[style]').forEach((node) => {
    const style = String(node.getAttribute('style') || '');
    if (/url\(\s*['"]?(?:https?:|data:)/i.test(style)) {
      node.style.removeProperty('background');
      node.style.removeProperty('background-image');
    }
  });
};

const parseHtml = (html) => {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(String(html || ''), 'text/html');
};

export const sanitizeComposePasteHtml = (html) => {
  const documentNode = parseHtml(html);
  if (!documentNode?.body) return String(html || '');
  documentNode.body.querySelectorAll(BLOCKED_PASTE_TAGS).forEach((node) => node.remove());
  blockPastedImages(documentNode.body);
  stripConflictingColors(documentNode.body);
  return sanitizeMailHtmlFragment(documentNode.body.innerHTML);
};

const replaceQuillLists = (root) => {
  root.querySelectorAll('ol, ul').forEach((list) => {
    const items = Array.from(list.children).filter((node) => node.tagName === 'LI');
    if (items.length === 0 || !items.some((node) => node.hasAttribute('data-list'))) return;
    let currentList = null;
    let currentType = '';
    items.forEach((item) => {
      const type = item.getAttribute('data-list') === 'bullet' ? 'ul' : 'ol';
      if (!currentList || type !== currentType) {
        currentList = list.ownerDocument.createElement(type);
        list.parentNode.insertBefore(currentList, list);
        currentType = type;
      }
      item.removeAttribute('data-list');
      item.querySelectorAll(':scope > .ql-ui').forEach((node) => node.remove());
      currentList.appendChild(item);
    });
    list.remove();
  });
};

const inlineQuillClasses = (root) => {
  root.querySelectorAll('[class]').forEach((node) => {
    const classes = Array.from(node.classList);
    classes.forEach((className) => {
      if (QUILL_SIZE_STYLES[className]) appendStyle(node, 'font-size', QUILL_SIZE_STYLES[className]);
      if (className.startsWith('ql-align-')) appendStyle(node, 'text-align', className.slice('ql-align-'.length));
      if (className.startsWith('ql-indent-')) {
        const level = Number.parseInt(className.slice('ql-indent-'.length), 10);
        if (Number.isFinite(level) && level > 0) appendStyle(node, 'margin-left', `${level * 3}em`);
      }
      if (className === 'ql-direction-rtl') appendStyle(node, 'direction', 'rtl');
    });
    node.removeAttribute('class');
  });
};

const makeTablesPortable = (root) => {
  root.querySelectorAll('table').forEach((table) => {
    appendStyle(table, 'width', '100%');
    appendStyle(table, 'max-width', '100%');
    appendStyle(table, 'border-collapse', 'collapse');
    appendStyle(table, 'table-layout', 'auto');
  });
  root.querySelectorAll('td, th').forEach((cell) => {
    appendStyle(cell, 'border', '1px solid #cbd5e1');
    appendStyle(cell, 'padding', '6px 8px');
    appendStyle(cell, 'vertical-align', 'top');
  });
};

export const buildPortableComposeHtml = (html) => {
  const documentNode = parseHtml(html);
  if (!documentNode?.body) return String(html || '');
  documentNode.body.querySelectorAll('.ql-ui').forEach((node) => node.remove());
  replaceQuillLists(documentNode.body);
  inlineQuillClasses(documentNode.body);
  makeTablesPortable(documentNode.body);
  stripConflictingColors(documentNode.body);
  documentNode.body.querySelectorAll('img').forEach((image) => {
    const src = String(image.getAttribute('src') || '').trim();
    if (!src.toLowerCase().startsWith('cid:')) image.remove();
    else {
      appendStyle(image, 'max-width', '100%');
      appendStyle(image, 'height', 'auto');
    }
  });
  return sanitizeMailHtmlFragment(documentNode.body.innerHTML);
};
