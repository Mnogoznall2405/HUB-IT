export const MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
export const MAIL_ATTACHMENT_CONTEXT_MISSING_CODE = 'MAIL_ATTACHMENT_CONTEXT_MISSING';

export const createEmptyAttachmentPreview = () => ({
  open: false,
  loading: false,
  error: '',
  filename: '',
  contentType: '',
  kind: 'unsupported',
  objectUrl: '',
  textContent: '',
  textTruncated: false,
  tooLargeForPreview: false,
  blob: null,
});

export const parseDownloadFilename = (contentDisposition, fallbackName = 'attachment.bin') => {
  const source = String(contentDisposition || '');
  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // Keep the regular filename fallback for malformed encoded names.
    }
  }
  const simpleMatch = source.match(/filename="([^"]+)"/i) || source.match(/filename=([^;]+)/i);
  return simpleMatch?.[1] ? String(simpleMatch[1]).trim() : String(fallbackName || 'attachment.bin');
};

export const buildMessageSourceDownloadPayload = ({ response, message }) => {
  const headers = response?.headers || {};
  const filename = parseDownloadFilename(
    headers['content-disposition'],
    `${message?.subject || 'message'}.eml`,
  );
  const contentType = headers['content-type'] || 'message/rfc822';
  const blob = response?.data instanceof Blob
    ? response.data
    : new Blob([response?.data], { type: contentType });
  return { blob, filename };
};

export const buildAttachmentRequestContext = ({
  messageOrId,
  attachment,
  fallbackMessage = null,
  resolveMailboxId,
} = {}) => {
  const message = messageOrId && typeof messageOrId === 'object'
    ? messageOrId
    : (fallbackMessage && typeof fallbackMessage === 'object' ? fallbackMessage : null);
  const messageId = String(
    (messageOrId && typeof messageOrId === 'object' ? messageOrId?.id : messageOrId)
    || message?.id
    || ''
  ).trim();
  const attachmentRef = String(attachment?.download_token || attachment?.id || attachment?.attachment_ref || '').trim();
  const mailboxId = typeof resolveMailboxId === 'function' ? resolveMailboxId(message) : '';
  return { messageId, attachmentRef, mailboxId };
};

export const buildAttachmentContextError = ({ attachment, messageId, mailboxId }) => {
  const defaultAttachmentName = '\u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0435';
  const attachmentName = String(attachment?.name || defaultAttachmentName).trim() || defaultAttachmentName;
  const error = new Error(
    !messageId
      ? '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u043f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u044f \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f.'
      : `\u0412\u043b\u043e\u0436\u0435\u043d\u0438\u0435 "${attachmentName}" \u043f\u0440\u0438\u0448\u043b\u043e \u0431\u0435\u0437 \u0438\u0434\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0442\u043e\u0440\u0430 \u0434\u043b\u044f \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u044f.`
  );
  error.code = MAIL_ATTACHMENT_CONTEXT_MISSING_CODE;
  error.attachment = {
    name: attachmentName,
    content_type: String(attachment?.content_type || '').trim(),
    size: Number(attachment?.size || 0),
    id: String(attachment?.id || '').trim(),
    download_token: String(attachment?.download_token || '').trim(),
    mailbox_id: String(mailboxId || '').trim(),
    message_id: String(messageId || '').trim(),
  };
  return error;
};

export const buildAttachmentDownloadKey = ({ messageId, attachmentRef, mailboxId }) => (
  `${messageId}::${attachmentRef}::${mailboxId || ''}`
);

export const buildAttachmentBlobPayload = ({ response, attachment }) => {
  const headers = response?.headers || {};
  const contentType = String(headers['content-type'] || attachment?.content_type || 'application/octet-stream');
  const filename = parseDownloadFilename(headers['content-disposition'], attachment?.name || 'attachment.bin');
  const blob = response?.data instanceof Blob
    ? response.data
    : new Blob([response?.data], { type: contentType });
  return { blob, filename, contentType };
};

const readBlobText = async (blob) => {
  if (!blob) return '';
  if (typeof blob.text === 'function') return blob.text();
  if (typeof blob.arrayBuffer === 'function' && typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(await blob.arrayBuffer());
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob payload.'));
      reader.readAsText(blob);
    });
  }
  if (typeof Response !== 'undefined') {
    return new Response(blob).text();
  }
  return '';
};

export const buildAttachmentPreviewState = async ({
  response,
  attachment,
  createObjectUrl,
  maxTextPreviewBytes = MAX_TEXT_PREVIEW_BYTES,
  maxPreviewFileBytes = MAX_PREVIEW_FILE_BYTES,
} = {}) => {
  const { blob, filename, contentType } = buildAttachmentBlobPayload({ response, attachment });
  const kind = contentType.includes('pdf') ? 'pdf' : (contentType.startsWith('image/') ? 'image' : 'text');
  let objectUrl = '';
  let textContent = '';
  let textTruncated = false;

  if ((kind === 'image' || kind === 'pdf') && typeof createObjectUrl === 'function') {
    objectUrl = createObjectUrl(blob);
  }
  if (kind === 'text') {
    const chunk = blob.slice(0, maxTextPreviewBytes);
    textContent = await readBlobText(chunk);
    textTruncated = blob.size > maxTextPreviewBytes;
  }

  return {
    open: true,
    loading: false,
    error: '',
    filename,
    contentType,
    kind,
    objectUrl,
    textContent,
    textTruncated,
    tooLargeForPreview: blob.size > maxPreviewFileBytes,
    blob,
  };
};

export const shouldPreferBlobOpenFallback = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const displayModeStandalone = typeof window.matchMedia === 'function'
    ? Boolean(window.matchMedia('(display-mode: standalone)').matches)
    : false;
  const iosStandalone = Boolean(window.navigator?.standalone);
  const userAgent = String(window.navigator?.userAgent || '');
  const isiOS = /iPad|iPhone|iPod/.test(userAgent)
    || (window.navigator?.platform === 'MacIntel' && Number(window.navigator?.maxTouchPoints || 0) > 1);
  return Boolean((displayModeStandalone || iosStandalone) && isiOS);
};

export const downloadBlobFile = (blob, filename, { preferOpenFallback = false } = {}) => {
  const url = window.URL.createObjectURL(blob);
  const useOpenFallback = Boolean(preferOpenFallback) && shouldPreferBlobOpenFallback();
  if (useOpenFallback) {
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (popup) {
      window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 60_000);
      return;
    }
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'attachment.bin');
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
};

export const buildPrintMailDocumentHtml = ({
  subject,
  senderLine,
  dateLine,
  html,
}) => `
      <html>
        <head>
          <title>${String(subject || '\u041f\u0438\u0441\u044c\u043c\u043e')}</title>
          <style>
            body { font-family: Aptos, Calibri, "Segoe UI", Arial, sans-serif; margin: 24px; line-height: 1.5; color: #111827; }
            h1 { font-size: 20px; margin-bottom: 8px; }
            .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
            img { max-width: 100%; }
            blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #cbd5e1; color: #475569; }
          </style>
        </head>
        <body>
          <h1>${String(subject || '(\u0431\u0435\u0437 \u0442\u0435\u043c\u044b)')}</h1>
          <div class="meta">\u041e\u0442: ${senderLine}<br/>\u0414\u0430\u0442\u0430: ${dateLine}</div>
          <div>${html}</div>
        </body>
      </html>
    `;
