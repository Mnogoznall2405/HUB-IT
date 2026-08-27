import {
  MAIL_UPLOAD_MAX_FILE_BYTES,
  canPreviewMailAttachment,
  validateDownloadedMailAttachment,
  validateMailUploadFiles,
} from './nativeMailFiles';

it('accepts a mail batch inside the backend 10 files / 15 MB / 25 MB contract', () => {
  expect(validateMailUploadFiles([
    { uri: 'file:///one.pdf', name: 'one.pdf', mimeType: 'application/pdf', size: 1024 },
    { uri: 'file:///two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 2048 },
  ])).toHaveLength(2);
});

it('accepts a non-empty downloaded attachment when Exchange metadata has a different size', () => {
  expect(() => validateDownloadedMailAttachment({ exists: true, size: 4097 }, 4096)).not.toThrow();
  expect(() => validateDownloadedMailAttachment({ exists: true, size: 0 }, 4096)).toThrow();
});

it('offers server PDF preview only for the Office formats supported by the backend', () => {
  expect(canPreviewMailAttachment({ name: 'report.docx' })).toBe(true);
  expect(canPreviewMailAttachment({ name: 'budget.bin', content_type: 'application/vnd.ms-excel' })).toBe(true);
  expect(canPreviewMailAttachment({ name: 'archive.zip', content_type: 'application/zip' })).toBe(false);
});

it('rejects an individual oversized or executable mail attachment', () => {
  expect(() => validateMailUploadFiles([
    { uri: 'file:///large.pdf', name: 'large.pdf', mimeType: 'application/pdf', size: MAIL_UPLOAD_MAX_FILE_BYTES + 1 },
  ])).toThrow('15 МБ');
  expect(() => validateMailUploadFiles([
    { uri: 'file:///run.exe', name: 'run.exe', mimeType: 'application/x-msdownload', size: 128 },
  ])).toThrow('нельзя отправить');
});
