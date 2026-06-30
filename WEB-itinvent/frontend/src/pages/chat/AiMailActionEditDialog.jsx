import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { mailAPI } from '../../api/client';
import { sanitizeMailHtmlFragment } from '../../components/mail/mailHtmlContent';

const splitMailRecipients = (value) => (
  String(value || '')
    .split(/[;,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
);

const joinMailRecipients = (value) => (
  Array.isArray(value) ? value.filter(Boolean).join('; ') : ''
);

const normalizeMailAttachmentRefs = (value) => (
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      message_id: String(item?.message_id || '').trim(),
      attachment_id: String(item?.attachment_id || item?.id || '').trim(),
      file_name: String(item?.file_name || item?.name || '').trim(),
      size: Number(item?.size || item?.file_size || 0) || 0,
    }))
    .filter((item) => item.message_id && item.attachment_id)
);

export default function AiMailActionEditDialog({
  open,
  actionCard,
  availableAttachments = [],
  onClose,
  onSubmit,
}) {
  const preview = actionCard?.preview && typeof actionCard.preview === 'object' ? actionCard.preview : {};
  const mail = preview.mail && typeof preview.mail === 'object' ? preview.mail : {};
  const [draft, setDraft] = useState(() => ({
    mailbox_id: String(mail.mailbox_id || ''),
    to: joinMailRecipients(mail.to),
    cc: joinMailRecipients(mail.cc),
    bcc: joinMailRecipients(mail.bcc),
    subject: String(mail.subject || ''),
    body: String(mail.body || mail.body_preview || ''),
    attachment_refs: normalizeMailAttachmentRefs(mail.attachment_refs),
  }));
  const [signatureHtml, setSignatureHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft({
      mailbox_id: String(mail.mailbox_id || ''),
      to: joinMailRecipients(mail.to),
      cc: joinMailRecipients(mail.cc),
      bcc: joinMailRecipients(mail.bcc),
      subject: String(mail.subject || ''),
      body: String(mail.body || mail.body_preview || ''),
      attachment_refs: normalizeMailAttachmentRefs(mail.attachment_refs),
    });
    setErrorText('');
  }, [open, mail.body, mail.body_preview, mail.mailbox_id, mail.subject]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    mailAPI.getMyConfig({ mailbox_id: draft.mailbox_id || undefined })
      .then((config) => {
        if (!cancelled) setSignatureHtml(String(config?.mail_signature_html || ''));
      })
      .catch(() => {
        if (!cancelled) setSignatureHtml('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.mailbox_id]);

  const selectedAttachmentKeys = useMemo(() => (
    new Set(normalizeMailAttachmentRefs(draft.attachment_refs).map((item) => `${item.message_id}:${item.attachment_id}`))
  ), [draft.attachment_refs]);
  const safeSignatureHtml = useMemo(() => sanitizeMailHtmlFragment(signatureHtml), [signatureHtml]);

  const toggleAttachment = (attachment) => {
    const ref = {
      message_id: String(attachment?.message_id || '').trim(),
      attachment_id: String(attachment?.attachment_id || attachment?.id || '').trim(),
      file_name: String(attachment?.file_name || '').trim(),
      size: Number(attachment?.file_size || attachment?.size || 0) || 0,
    };
    if (!ref.message_id || !ref.attachment_id) return;
    const key = `${ref.message_id}:${ref.attachment_id}`;
    setDraft((current) => {
      const currentRefs = normalizeMailAttachmentRefs(current.attachment_refs);
      const exists = currentRefs.some((item) => `${item.message_id}:${item.attachment_id}` === key);
      return {
        ...current,
        attachment_refs: exists
          ? currentRefs.filter((item) => `${item.message_id}:${item.attachment_id}` !== key)
          : [...currentRefs, ref].slice(0, 10),
      };
    });
  };

  const handleSubmit = async () => {
    const payload = {
      mailbox_id: draft.mailbox_id,
      to: splitMailRecipients(draft.to),
      cc: splitMailRecipients(draft.cc),
      bcc: splitMailRecipients(draft.bcc),
      subject: String(draft.subject || ''),
      body: String(draft.body || ''),
      is_html: true,
      attachment_refs: normalizeMailAttachmentRefs(draft.attachment_refs),
    };
    if (mail.reply_to_message_id) payload.reply_to_message_id = String(mail.reply_to_message_id || '');
    if (payload.to.length === 0) {
      setErrorText('Укажите хотя бы одного получателя.');
      return;
    }
    if (!payload.body.trim()) {
      setErrorText('Текст письма не должен быть пустым.');
      return;
    }
    setSending(true);
    setErrorText('');
    try {
      await onSubmit?.(payload);
    } catch (error) {
      setErrorText(error?.response?.data?.detail || error?.message || 'Не удалось отправить письмо.');
      setSending(false);
      return;
    }
    setSending(false);
  };

  return (
    <Dialog open={Boolean(open)} onClose={sending ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Редактировать письмо</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.4} sx={{ pt: 0.5 }}>
          {errorText ? <Alert severity="error">{errorText}</Alert> : null}
          <TextField size="small" label="Mailbox" value={draft.mailbox_id} onChange={(event) => setDraft((current) => ({ ...current, mailbox_id: event.target.value }))} fullWidth />
          <TextField size="small" label="Кому" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} fullWidth />
          <TextField size="small" label="Копия" value={draft.cc} onChange={(event) => setDraft((current) => ({ ...current, cc: event.target.value }))} fullWidth />
          <TextField size="small" label="Скрытая копия" value={draft.bcc} onChange={(event) => setDraft((current) => ({ ...current, bcc: event.target.value }))} fullWidth />
          <TextField size="small" label="Тема" value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} fullWidth />
          <TextField label="Текст" value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} fullWidth multiline minRows={7} />
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 800, mb: 0.5 }}>Вложения из чата</Typography>
            {availableAttachments.length > 0 ? (
              <Stack spacing={0.2}>
                {availableAttachments.slice(0, 30).map((attachment) => {
                  const key = `${attachment.message_id}:${attachment.attachment_id}`;
                  return (
                    <FormControlLabel
                      key={key}
                      control={<Checkbox size="small" checked={selectedAttachmentKeys.has(key)} onChange={() => toggleAttachment(attachment)} />}
                      label={`${attachment.file_name || 'Файл'}${attachment.file_size ? ` · ${attachment.file_size} байт` : ''}`}
                    />
                  );
                })}
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>В этой беседе нет файлов для вложения.</Typography>
            )}
          </Box>
          <Alert severity="info">Подпись будет добавлена автоматически при отправке.</Alert>
          {safeSignatureHtml ? (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, mb: 0.5, color: 'text.secondary' }}>Подпись</Typography>
              <Box sx={{ fontSize: 13, '& img': { maxWidth: '100%' } }} dangerouslySetInnerHTML={{ __html: safeSignatureHtml }} />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending} sx={{ textTransform: 'none' }}>Отмена</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={sending} sx={{ textTransform: 'none' }}>
          {sending ? 'Отправляю...' : 'Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
