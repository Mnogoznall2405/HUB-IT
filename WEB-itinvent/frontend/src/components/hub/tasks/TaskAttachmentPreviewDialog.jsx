import { useCallback, useEffect, useRef, useState } from 'react';
import { hubTaskFilesAPI } from '../../../api/hubTaskFiles';
import MailAttachmentPreviewDialog from '../../mail/MailAttachmentPreviewDialog';
import {
  MAX_PREVIEW_FILE_BYTES,
  buildAttachmentBlobPayload,
  buildAttachmentPreviewState,
  createEmptyAttachmentPreview,
  downloadBlobFile,
  isOfficePreviewableAttachment,
} from '../../mail/mailMessageFileActions';
import { buildOfficeAttachmentPreviewState } from '../../mail/officeAttachmentPreview';
import { waitForAttachmentPreview } from '../../documentPreview/asyncAttachmentPreview';

const taskPreviewAPI = {
  getAttachmentPreview: (taskId, attachmentId, { signal } = {}) => (
    hubTaskFilesAPI.getTaskAttachmentPreview({ taskId, attachmentId, signal })
  ),
  downloadAttachment: (taskId, attachmentId, { signal } = {}) => (
    hubTaskFilesAPI.downloadTaskAttachment({ taskId, attachmentId, signal })
  ),
  downloadAttachmentPreviewPdf: (taskId, attachmentId, { signal } = {}) => (
    hubTaskFilesAPI.downloadTaskAttachmentPreviewPdf({ taskId, attachmentId, signal })
  ),
};

export const mapTaskAttachmentForPreview = (attachment = {}) => ({
  id: String(attachment?.id || '').trim(),
  name: String(attachment?.file_name || attachment?.name || 'attachment.bin').trim() || 'attachment.bin',
  content_type: String(attachment?.file_mime || attachment?.mime_type || attachment?.content_type || '').trim(),
  size: Number(attachment?.file_size ?? attachment?.size ?? 0),
});

export const buildTaskAttachmentPreviewState = async ({
  taskId,
  attachment,
  signal,
  createObjectUrl = (blob) => window.URL.createObjectURL(blob),
} = {}) => {
  const mapped = mapTaskAttachmentForPreview(attachment);
  const attachmentId = mapped.id;
  const downloadContext = { taskId, attachmentId, attachment };
  if (!String(taskId || '').trim() || !attachmentId) {
    throw new Error('Не удалось определить файл задачи для предпросмотра.');
  }

  if (isOfficePreviewableAttachment(mapped)) {
    const previewMetadata = await waitForAttachmentPreview({
      previewAPI: taskPreviewAPI,
      parentId: taskId,
      attachmentId,
      signal,
    });
    const previewState = await buildOfficeAttachmentPreviewState({
      mailAPI: taskPreviewAPI,
      messageId: taskId,
      attachmentRef: attachmentId,
      mailboxId: '',
      attachment: mapped,
      filename: mapped.name,
      contentType: mapped.content_type,
      previewMetadata,
      signal,
      createObjectUrl,
    });
    return { ...createEmptyAttachmentPreview(), ...previewState, downloadContext };
  }

  const response = await taskPreviewAPI.downloadAttachment(taskId, attachmentId, { signal });
  const previewState = await buildAttachmentPreviewState({
    response,
    attachment: mapped,
    createObjectUrl,
  });
  return { ...createEmptyAttachmentPreview(), ...previewState, downloadContext };
};

const fallbackFormatFileSize = (value) => {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

const revokePreviewObjectUrl = (preview) => {
  const objectUrl = String(preview?.objectUrl || '');
  if (objectUrl.startsWith('blob:')) window.URL.revokeObjectURL(objectUrl);
};

export function useTaskAttachmentPreview() {
  const [attachmentPreview, setAttachmentPreview] = useState(createEmptyAttachmentPreview);
  const abortRef = useRef(null);
  const previewRef = useRef(attachmentPreview);

  useEffect(() => {
    previewRef.current = attachmentPreview;
  }, [attachmentPreview]);

  const closePreview = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    revokePreviewObjectUrl(previewRef.current);
    setAttachmentPreview(createEmptyAttachmentPreview());
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    revokePreviewObjectUrl(previewRef.current);
  }, []);

  const openPreview = useCallback(async (task, attachment) => {
    const taskId = String(task?.id || task || '').trim();
    const mapped = mapTaskAttachmentForPreview(attachment);
    abortRef.current?.abort();
    revokePreviewObjectUrl(previewRef.current);
    const controller = new AbortController();
    abortRef.current = controller;
    setAttachmentPreview({
      ...createEmptyAttachmentPreview(),
      open: true,
      loading: true,
      filename: mapped.name,
      contentType: mapped.content_type,
      kind: isOfficePreviewableAttachment(mapped) ? 'office_pdf' : 'unsupported',
      downloadContext: { taskId, attachmentId: mapped.id, attachment },
    });
    try {
      const nextPreview = await buildTaskAttachmentPreviewState({
        taskId,
        attachment,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setAttachmentPreview(nextPreview);
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setAttachmentPreview((current) => ({
        ...current,
        open: true,
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Не удалось открыть предпросмотр файла.',
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const downloadOriginal = useCallback(async () => {
    const preview = previewRef.current;
    if (preview?.blob) {
      downloadBlobFile(preview.blob, preview.filename || 'attachment.bin');
      return;
    }
    const context = preview?.downloadContext;
    if (!context?.taskId || !context?.attachmentId) return;
    const response = await hubTaskFilesAPI.downloadTaskAttachment({
      taskId: context.taskId,
      attachmentId: context.attachmentId,
    });
    const mapped = mapTaskAttachmentForPreview(context.attachment);
    const payload = buildAttachmentBlobPayload({ response, attachment: mapped });
    downloadBlobFile(payload.blob, payload.filename || mapped.name);
  }, []);

  const downloadPreviewPdf = useCallback(() => {
    const preview = previewRef.current;
    if (!preview?.previewBlob) return;
    downloadBlobFile(preview.previewBlob, preview.pdfFilename || `${preview.filename || 'preview'}.pdf`);
  }, []);

  return {
    attachmentPreview,
    openPreview,
    closePreview,
    downloadOriginal,
    downloadPreviewPdf,
  };
}

export default function TaskAttachmentPreviewDialog({ preview, formatFileSize }) {
  return (
    <MailAttachmentPreviewDialog
      attachmentPreview={preview.attachmentPreview}
      onClose={preview.closePreview}
      onDownload={() => void preview.downloadOriginal()}
      onDownloadPreviewPdf={preview.downloadPreviewPdf}
      formatFileSize={formatFileSize || fallbackFormatFileSize}
      maxPreviewFileBytes={MAX_PREVIEW_FILE_BYTES}
    />
  );
}
