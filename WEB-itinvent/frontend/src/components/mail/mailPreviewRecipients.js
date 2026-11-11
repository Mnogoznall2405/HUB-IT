import { formatMailPersonWithEmail } from './mailPeople';

export const buildMailPreviewRecipients = (selectedMessage) => ([
  ...(Array.isArray(selectedMessage?.to_people) ? selectedMessage.to_people : (Array.isArray(selectedMessage?.to) ? selectedMessage.to : []))
    .map((value) => ({ type: 'Кому', value })),
  ...(Array.isArray(selectedMessage?.cc_people) ? selectedMessage.cc_people : (Array.isArray(selectedMessage?.cc) ? selectedMessage.cc : []))
    .map((value) => ({ type: 'Копия', value })),
  ...(Array.isArray(selectedMessage?.bcc_people) ? selectedMessage.bcc_people : (Array.isArray(selectedMessage?.bcc) ? selectedMessage.bcc : []))
    .map((value) => ({ type: 'Скрытая копия', value })),
]).filter((item) => String(formatMailPersonWithEmail(item.value, '') || '').trim());

export const getMailPreviewRecipientCount = (selectedMessage) => (
  buildMailPreviewRecipients(selectedMessage).length
);
