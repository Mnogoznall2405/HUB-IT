export const socketKey = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');

export const normalizeMacToken = (value) => {
  const hex = String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return '';
  return hex.match(/.{2}/g).join(':');
};

export const extractNormalizedMacs = (rawValue) => {
  const text = String(rawValue || '');
  const matches = text.match(/(?:[0-9A-Fa-f]{2}(?:[:-])){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{12}/g) || [];
  const out = [];
  for (const raw of matches) {
    const normalized = normalizeMacToken(raw);
    if (normalized && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
};

export const normalizeMacField = (rawValue) => {
  const macs = extractNormalizedMacs(rawValue);
  if (macs.length > 0) return macs.join('\n');
  return String(rawValue || '').trim();
};

export const pointSortComparator = (a, b) => {
  const aSocket = String(a?.patch_panel_port || '');
  const bSocket = String(b?.patch_panel_port || '');
  const socketCmp = aSocket.localeCompare(bSocket, 'ru', { numeric: true, sensitivity: 'base' });
  if (socketCmp !== 0) return socketCmp;
  const aPort = String(a?.port_name || '');
  const bPort = String(b?.port_name || '');
  const portCmp = aPort.localeCompare(bPort, 'ru', { numeric: true, sensitivity: 'base' });
  if (portCmp !== 0) return portCmp;
  return Number(a?.id || 0) - Number(b?.id || 0);
};

export const formatSocketPort = (pointLike) => {
  const socket = String(pointLike?.patch_panel_port || '').trim();
  const port = String(pointLike?.port_name || '').trim();
  if (port && socket) return `PORT ${port} · Розетка ${socket}`;
  if (socket) return `Розетка ${socket}`;
  if (port) return `PORT ${port}`;
  return 'Точка';
};

export const parseDownloadFilename = (contentDisposition, fallbackName = 'map-points.pdf') => {
  const source = String(contentDisposition || '');
  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // ignore malformed header
    }
  }
  const simpleMatch = source.match(/filename="([^"]+)"/i) || source.match(/filename=([^;]+)/i);
  return simpleMatch?.[1] ? String(simpleMatch[1]).trim() : String(fallbackName || 'map-points.pdf');
};

export const buildMapExportFileName = (map) => {
  const rawBase = String(map?.title || map?.file_name || 'map').replace(/\.[^.]+$/, '').trim();
  const sanitized = rawBase
    // Windows filenames cannot contain control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return `${sanitized || 'map'}-points.pdf`;
};

export const downloadBlobFile = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'file.bin');
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
};

export const mapPanelSelectMenuProps = {
  disableScrollLock: true,
  PaperProps: {
    sx: {
      maxHeight: 320,
    },
  },
};
