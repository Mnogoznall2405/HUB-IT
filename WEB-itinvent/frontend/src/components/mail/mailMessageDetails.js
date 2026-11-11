import { formatMailPersonWithEmail } from './mailPeople';
import { buildMailPreviewRecipients } from './mailPreviewRecipients';

export const MAIL_DETAIL_LABELS = {
  from: 'От',
  sent: 'Отправлено',
  to: 'Кому',
  cc: 'Копия',
  bcc: 'Скрытая копия',
};

export const formatMailMessageMobileDate = (isoStr) => {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const extractEmail = (person) => {
  if (!person) return '';
  if (typeof person === 'string') return person.trim();
  return String(person.email || person.address || '').trim();
};

export const buildMailMessageFromPerson = (message) => (
  message?.sender_person || {
    display: message?.sender_display,
    email: message?.sender_email || message?.sender,
    name: message?.sender_name,
  }
);

export const buildMailMessageFromLabel = (message) => (
  formatMailPersonWithEmail(buildMailMessageFromPerson(message), message?.sender || '-')
);

export const buildMailMessageSentLabel = (message, formatFullDate) => {
  if (typeof formatFullDate === 'function') {
    return formatFullDate(message?.received_at);
  }
  return String(message?.received_at || '-');
};

export const buildMailMessageToSummary = (message, maxVisible = 2) => {
  const recipients = buildMailPreviewRecipients(message).filter((item) => item.type === 'Кому');
  if (!recipients.length) return '-';
  const labels = recipients
    .slice(0, maxVisible)
    .map((item) => formatMailPersonWithEmail(item.value, '-'))
    .filter(Boolean);
  const hiddenCount = Math.max(0, recipients.length - maxVisible);
  if (hiddenCount > 0) {
    return `${labels.join('; ')} +${hiddenCount}`;
  }
  return labels.join('; ');
};

export const buildMailMessageDetailSections = (message, formatFullDate) => {
  const fromPerson = buildMailMessageFromPerson(message);
  const fromLabel = buildMailMessageFromLabel(message);
  const fromEmail = extractEmail(fromPerson) || String(message?.sender_email || message?.sender || '').trim();
  const recipients = buildMailPreviewRecipients(message);

  const sections = [
    {
      id: 'from',
      label: MAIL_DETAIL_LABELS.from,
      value: fromLabel,
      email: fromEmail,
    },
    {
      id: 'sent',
      label: MAIL_DETAIL_LABELS.sent,
      value: buildMailMessageSentLabel(message, formatFullDate),
      email: '',
    },
  ];

  const appendRecipientSection = (type, label, sectionId) => {
    const items = recipients.filter((item) => item.type === type);
    if (!items.length) return;
    sections.push({
      id: sectionId,
      label,
      items: items.map((item) => ({
        label: formatMailPersonWithEmail(item.value, '-'),
        email: extractEmail(item.value),
      })),
    });
  };

  appendRecipientSection('Кому', MAIL_DETAIL_LABELS.to, 'to');
  appendRecipientSection('Копия', MAIL_DETAIL_LABELS.cc, 'cc');
  appendRecipientSection('Скрытая копия', MAIL_DETAIL_LABELS.bcc, 'bcc');

  return sections;
};

export const buildMailRecipientSections = (message) => (
  buildMailMessageDetailSections(message).filter((section) => ['to', 'cc', 'bcc'].includes(section.id))
);
