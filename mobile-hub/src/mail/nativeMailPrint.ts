import type { MailMessageDetail } from '../api/mailApi';
import { prepareNativeMailHtml } from './nativeMailHtml';
import { mailDateLabel, mailPreviewSender, mailSubject } from './nativeMailModel';

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainBodyHtml(message: MailMessageDetail): string {
  const body = String(message.body_text || message.body_preview || '').trim();
  return `<p>${escapeHtml(body || 'В письме нет содержимого.').replace(/\r?\n/g, '<br>')}</p>`;
}

export function buildNativeMailPrintHtml(message: MailMessageDetail): string {
  const prepared = prepareNativeMailHtml(
    String(message.body_html || '').trim() || plainBodyHtml(message),
    message.attachments || [],
    { allowExternalImages: false, dark: false },
  );
  const recipients = (message.to || []).map(String).filter(Boolean).join(', ');
  const header = `<section class="mail-print-header"><h1>${escapeHtml(mailSubject(message))}</h1><p><strong>От:</strong> ${escapeHtml(mailPreviewSender(message))}</p>${recipients ? `<p><strong>Кому:</strong> ${escapeHtml(recipients)}</p>` : ''}<p><strong>Дата:</strong> ${escapeHtml(mailDateLabel(message.received_at))}</p></section>`;
  return prepared.document
    .replace('</style>', '.mail-print-header{padding-bottom:16px;margin-bottom:20px;border-bottom:1px solid #d7d7d7}.mail-print-header h1{font-size:22px;line-height:1.3;margin:0 0 12px}.mail-print-header p{margin:3px 0;font-size:13px}</style>')
    .replace('<body>', `<body>${header}`);
}
