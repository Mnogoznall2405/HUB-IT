import { useCallback, useState } from 'react';

export default function useMailSignatureSettings({
  mailAPI,
  activeMailboxId = '',
  mailboxInfo = null,
  resolveComposeMailboxId,
  mergeMailboxEntries,
  setMailboxInfo,
  setMailboxes,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
  onMessage,
} = {}) {
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureMailboxId, setSignatureMailboxId] = useState('');

  const openSignatureEditor = useCallback(async (mailboxIdOverride = '') => {
    const targetMailboxId = resolveComposeMailboxId?.(mailboxIdOverride || activeMailboxId) || '';
    try {
      const shouldUseActiveMailbox = !targetMailboxId || String(targetMailboxId) === String(activeMailboxId || '');
      const config = shouldUseActiveMailbox
        ? mailboxInfo
        : await mailAPI?.getMyConfig?.({ mailbox_id: targetMailboxId || undefined });
      setSignatureMailboxId(targetMailboxId);
      setSignatureHtml(String(config?.mail_signature_html || ''));
      setSignatureOpen(true);
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось загрузить подпись.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось загрузить подпись.')
          : (requestError?.response?.data?.detail || 'Не удалось загрузить подпись.');
        onError?.(detail);
      }
    }
  }, [
    activeMailboxId,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    mailAPI,
    mailboxInfo,
    onError,
    resolveComposeMailboxId,
  ]);

  const closeSignatureEditor = useCallback(() => {
    setSignatureOpen(false);
  }, []);

  const clearSignature = useCallback(() => {
    setSignatureHtml('');
  }, []);

  const handleSaveSignature = useCallback(async () => {
    const targetMailboxId = resolveComposeMailboxId?.(signatureMailboxId || activeMailboxId) || '';
    setSignatureSaving(true);
    try {
      const data = await mailAPI?.updateMyConfig?.({
        mailbox_id: targetMailboxId || undefined,
        mail_signature_html: String(signatureHtml || ''),
      });
      if (String(targetMailboxId || '') === String(activeMailboxId || '')) {
        setMailboxInfo?.(data || null);
      } else {
        setMailboxInfo?.((prev) => (
          prev
            ? { ...prev, mail_signature_html: String(data?.mail_signature_html || '') }
            : prev
        ));
      }
      setMailboxes?.((prev) => mergeMailboxEntries?.(prev, data || null) || prev);
      setSignatureOpen(false);
      onMessage?.('Подпись сохранена.');
    } catch (requestError) {
      const detail = getMailErrorDetail
        ? getMailErrorDetail(requestError, 'Не удалось сохранить подпись.')
        : (requestError?.response?.data?.detail || 'Не удалось сохранить подпись.');
      onError?.(detail);
    } finally {
      setSignatureSaving(false);
    }
  }, [
    activeMailboxId,
    getMailErrorDetail,
    mailAPI,
    mergeMailboxEntries,
    onError,
    onMessage,
    resolveComposeMailboxId,
    setMailboxInfo,
    setMailboxes,
    signatureHtml,
    signatureMailboxId,
  ]);

  return {
    signatureOpen,
    signatureSaving,
    signatureHtml,
    signatureMailboxId,
    setSignatureHtml,
    openSignatureEditor,
    closeSignatureEditor,
    clearSignature,
    handleSaveSignature,
  };
}
