/**
 * drawio (diagrams.net) integration helpers: mxfile XML checks, the compressed `#R`
 * payload the hosted viewer expects, and the embed editor postMessage protocol.
 * Viewer/editor base URLs are configurable so a self-hosted drawio can replace the
 * hosted diagrams.net endpoints without a code change.
 */
import { deflateSync, strToU8 } from 'fflate';

const DEFAULT_VIEWER_URL = 'https://viewer.diagrams.net/';
const DEFAULT_EDITOR_URL = 'https://embed.diagrams.net/';

const envUrl = (value, fallback) => {
  const text = String(value || '').trim();
  return text || fallback;
};

export const DRAWIO_VIEWER_URL = envUrl(import.meta.env?.VITE_DRAWIO_VIEWER_URL, DEFAULT_VIEWER_URL);
export const DRAWIO_EDITOR_URL = envUrl(import.meta.env?.VITE_DRAWIO_EDITOR_URL, DEFAULT_EDITOR_URL);

const CHUNK = 0x8000;

/** Same compression drawio uses for `<diagram>` bodies and `#R` links: raw-deflate of the URI-encoded XML, base64. */
export function compressDrawioXml(xml) {
  const bytes = deflateSync(strToU8(encodeURIComponent(String(xml || ''))));
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/** mxfile can carry an `<?xml ...?>` prolog/comments before the root element. */
export function looksLikeDrawioXml(text) {
  let probe = String(text || '').trimStart();
  if (!probe.startsWith('<')) return false;
  if (probe.startsWith('<?xml')) {
    const end = probe.indexOf('?>');
    if (end === -1) return false;
    probe = probe.slice(end + 2).trimStart();
  }
  return probe.startsWith('<mxfile') || probe.startsWith('<mxGraphModel');
}

/** Hosted lightbox viewer: full drawio rendering incl. stencils, pages, layers and pan/zoom. */
export function drawioViewerUrl(xml, { title = '' } = {}) {
  const base = DRAWIO_VIEWER_URL.endsWith('/') ? DRAWIO_VIEWER_URL : `${DRAWIO_VIEWER_URL}/`;
  const params = new URLSearchParams({
    lightbox: '1',
    highlight: '0000ff',
    layers: '1',
    nav: '1',
    title: title || 'Карта сети',
  });
  return `${base}?${params.toString()}#R${compressDrawioXml(xml)}`;
}

export function drawioEditorUrl(extra = {}) {
  const url = new URL(envUrl(DRAWIO_EDITOR_URL, DEFAULT_EDITOR_URL));
  const params = {
    embed: '1',
    proto: 'json',
    spin: '1',
    libraries: '1',
    saveAndExit: '1',
    noExitBtn: '0',
    ...extra,
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

export function drawioOrigin(base = DRAWIO_EDITOR_URL) {
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
}

/** JSON-protocol messages arrive as JSON strings; anything else is ignored. */
export function parseDrawioMessage(data) {
  if (typeof data !== 'string' || !data) return null;
  try {
    const message = JSON.parse(data);
    return message && typeof message === 'object' ? message : null;
  } catch {
    return null;
  }
}

/** Base64 payload of a `export`-event PNG (`data:image/png;base64,...`), or ''. */
export function drawioExportPngBase64(message) {
  const data = String(message?.data || '');
  const match = data.match(/^data:image\/png;base64,(.+)$/);
  return match ? match[1] : '';
}
