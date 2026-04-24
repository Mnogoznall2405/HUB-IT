const EMAIL_IN_ANGLE_BRACKETS_RE = /<([^>]+)>/;

const normalizeText = (value) => String(value || '').trim();

export function getMailPersonEmail(value) {
  if (value && typeof value === 'object') {
    const email = normalizeText(
      value.email
      || value.sender_email
      || value.address
      || value.mailbox_email
      || value.value
    ).toLowerCase();
    if (email) return email;
  }
  const text = normalizeText(value);
  if (!text) return '';
  const angleMatch = text.match(EMAIL_IN_ANGLE_BRACKETS_RE);
  if (angleMatch?.[1]) {
    return normalizeText(angleMatch[1]).toLowerCase();
  }
  return text.includes('@') ? text.toLowerCase() : '';
}

export function getMailPersonName(value) {
  if (!value || typeof value !== 'object') return '';
  return normalizeText(
    value.display
    || value.sender_display
    || value.display_name
    || value.name
    || value.sender_name
  );
}

export function getMailPersonDisplay(value, fallback = '-') {
  if (value && typeof value === 'object') {
    const display = getMailPersonName(value);
    if (display) return display;
    const email = getMailPersonEmail(value);
    if (email) return email;
  }
  const text = normalizeText(value);
  if (!text) return fallback;
  const angleMatch = text.match(EMAIL_IN_ANGLE_BRACKETS_RE);
  if (angleMatch?.[1]) {
    return normalizeText(text.replace(EMAIL_IN_ANGLE_BRACKETS_RE, '')) || normalizeText(angleMatch[1]);
  }
  return text || fallback;
}

export function formatMailPersonWithEmail(value, fallback = '-') {
  const display = getMailPersonDisplay(value, '');
  const email = getMailPersonEmail(value);
  if (display && email && display.toLowerCase() !== email.toLowerCase()) {
    return `${display} <${email}>`;
  }
  return display || email || fallback;
}

export function formatMailPeopleLine(values, fallback = '-') {
  if (!Array.isArray(values)) return fallback;
  const items = values
    .map((item) => getMailPersonDisplay(item, ''))
    .filter(Boolean);
  return items.join(', ') || fallback;
}
