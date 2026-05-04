import { useEffect, useMemo, useState } from 'react';
import { buildRenderedMailHtml, filterVisibleMailAttachments } from './mailHtmlContent';
import { splitQuotedHistoryHtml } from './mailQuotedHistory';

const escapeMailPlainText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const mailPlainTextToHtml = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<div>${escapeMailPlainText(text).replace(/\r\n|\r|\n/g, '<br />')}</div>`;
};

export const getMessageBodyHtmlSource = (message) => {
  const bodyHtml = String(message?.body_html || '').trim();
  if (bodyHtml) return bodyHtml;
  return mailPlainTextToHtml(message?.body_text);
};

export default function useMailMessageRenderState(message, {
  revealedRemoteImagesByMessageId = {},
  colorScheme = 'light',
  formatFileSize,
  sumAttachmentSize,
  resetKey = '',
} = {}) {
  const [showQuotedHistory, setShowQuotedHistory] = useState(false);

  useEffect(() => {
    setShowQuotedHistory(false);
  }, [resetKey]);

  const allowsExternalImages = Boolean(
    message?.id && revealedRemoteImagesByMessageId?.[String(message.id)]
  );
  const allAttachments = useMemo(
    () => (Array.isArray(message?.attachments) ? message.attachments : []),
    [message?.attachments]
  );
  const bodyHtmlSource = useMemo(
    () => getMessageBodyHtmlSource(message),
    [message?.body_html, message?.body_text]
  );
  const renderResult = useMemo(
    () => buildRenderedMailHtml(
      bodyHtmlSource,
      allAttachments,
      { allowExternalImages: allowsExternalImages, colorScheme }
    ),
    [allAttachments, allowsExternalImages, bodyHtmlSource, colorScheme]
  );
  const visibleAttachments = useMemo(
    () => filterVisibleMailAttachments(allAttachments, renderResult.usedInlineAttachmentIds),
    [allAttachments, renderResult.usedInlineAttachmentIds]
  );
  const attachmentTotalSize = useMemo(() => {
    const formatter = typeof formatFileSize === 'function' ? formatFileSize : (value) => String(value || 0);
    const total = typeof sumAttachmentSize === 'function'
      ? sumAttachmentSize(visibleAttachments)
      : visibleAttachments.reduce((acc, item) => acc + Number(item?.size || 0), 0);
    return formatter(total);
  }, [formatFileSize, sumAttachmentSize, visibleAttachments]);
  const quotedHistory = useMemo(
    () => splitQuotedHistoryHtml(renderResult?.html),
    [renderResult?.html]
  );
  const hasQuotedHistory = useMemo(
    () => Boolean(quotedHistory?.hasQuotedHistory),
    [quotedHistory]
  );
  const primaryHtml = useMemo(
    () => (
      quotedHistory?.quotedHtml
        ? quotedHistory.primaryHtml
        : renderResult.html
    ),
    [quotedHistory, renderResult.html]
  );
  const quotedHtml = useMemo(
    () => String(quotedHistory?.quotedHtml || ''),
    [quotedHistory]
  );
  const usesQuoteFallback = useMemo(
    () => Boolean(hasQuotedHistory && !quotedHtml),
    [hasQuotedHistory, quotedHtml]
  );

  return {
    allowsExternalImages,
    allAttachments,
    bodyHtmlSource,
    renderResult,
    visibleAttachments,
    attachmentTotalSize,
    quotedHistory,
    hasQuotedHistory,
    primaryHtml,
    quotedHtml,
    usesQuoteFallback,
    messageHtml: primaryHtml,
    showQuotedHistory,
    setShowQuotedHistory,
    toggleQuotedHistory: () => setShowQuotedHistory((prev) => !prev),
  };
}
