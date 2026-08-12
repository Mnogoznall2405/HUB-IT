export const SYSTEM_NOTIFICATION_CHANNELS = Object.freeze([
  'chat',
  'mention',
  'task',
  'feed',
  'mail',
  'ticket',
  'scan',
]);

export const SYSTEM_NOTIFICATION_URGENCIES = Object.freeze([
  'low',
  'normal',
  'high',
]);

const ENVELOPE_FIELDS = Object.freeze([
  'id',
  'channel',
  'title',
  'body',
  'route',
  'created_at',
  'urgency',
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const CONTROL_CHARACTERS_PATTERN_GLOBAL = /[\u0000-\u001F\u007F-\u009F]+/gu;
const MAXIMUM_ID_LENGTH = 128;
const MAXIMUM_TITLE_LENGTH = 128;
const MAXIMUM_BODY_LENGTH = 512;
const MAXIMUM_ROUTE_LENGTH = 1024;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnvelopeFields(value) {
  const keys = Object.keys(value).sort();
  const expected = [...ENVELOPE_FIELDS].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function normalizeText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(CONTROL_CHARACTERS_PATTERN_GLOBAL, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, maximumLength - 1).trimEnd()}…`;
}

function normalizeCreatedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString();
}

export function buildSystemNotificationId(channel, sourceId) {
  const normalizedChannel = String(channel || '').trim().toLowerCase();
  if (!SYSTEM_NOTIFICATION_CHANNELS.includes(normalizedChannel)) return '';
  const normalizedSourceId = String(sourceId || '')
    .trim()
    .replace(/[^A-Za-z0-9._:-]/gu, '_');
  if (!normalizedSourceId) return '';
  return `${normalizedChannel}:${normalizedSourceId}`.slice(0, MAXIMUM_ID_LENGTH);
}

export function isSafeSystemNotificationRoute(route) {
  return typeof route === 'string'
    && route.trim() === route
    && route.length > 0
    && route.length <= MAXIMUM_ROUTE_LENGTH
    && route.startsWith('/')
    && !route.startsWith('//')
    && !route.includes('\\')
    && !CONTROL_CHARACTER_PATTERN.test(route);
}

export function createSystemNotificationEnvelope(value) {
  if (!isPlainObject(value) || !hasExactEnvelopeFields(value)) return null;

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const channel = typeof value.channel === 'string' ? value.channel.trim().toLowerCase() : '';
  const title = normalizeText(value.title, MAXIMUM_TITLE_LENGTH);
  const body = normalizeText(value.body, MAXIMUM_BODY_LENGTH);
  const route = typeof value.route === 'string' ? value.route : '';
  const createdAt = normalizeCreatedAt(value.created_at);
  const urgency = typeof value.urgency === 'string' ? value.urgency.trim().toLowerCase() : '';

  if (
    !id
    || id.length > MAXIMUM_ID_LENGTH
    || !ID_PATTERN.test(id)
    || !SYSTEM_NOTIFICATION_CHANNELS.includes(channel)
    || !title
    || !body
    || !isSafeSystemNotificationRoute(route)
    || !createdAt
    || !SYSTEM_NOTIFICATION_URGENCIES.includes(urgency)
  ) return null;

  return Object.freeze({
    id,
    channel,
    title,
    body,
    route,
    created_at: createdAt,
    urgency,
  });
}
