const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function normalizeVncEndpoint(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value || value.length > 320 || CONTROL_CHARACTER_PATTERN.test(value)) return '';

  value = value.replace(/^vnc:\/\//iu, '');
  if (!value || /[@/?#\\]/u.test(value)) return '';

  const match = value.match(/^([^:]+)(?::([0-9]{1,5}))?$/u);
  if (!match) return '';
  const host = match[1].toLowerCase();
  const portText = match[2] || '';
  if (portText) {
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
  }

  const ipv4Parts = host.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => /^[0-9]{1,3}$/u.test(part))) {
    if (ipv4Parts.some((part) => Number(part) > 255)) return '';
  } else {
    if (host.length > 253) return '';
    const labels = host.split('.');
    if (labels.some((label) => !HOSTNAME_LABEL_PATTERN.test(label))) return '';
  }

  return portText ? `${host}:${portText}` : host;
}
