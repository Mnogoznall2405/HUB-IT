import {
  getNativeMailAttachmentImageSource,
  getNativeMailAttachmentKind,
  getNativeMailAttachmentVisual,
  resolveNativeMailAttachmentMimeType,
} from './nativeMailAttachmentVisual';

it('maps common mail files to distinct semantic icons', () => {
  expect(getNativeMailAttachmentVisual({ name: 'contract.pdf' }).icon).toBe('file-pdf-box');
  expect(getNativeMailAttachmentVisual({ name: 'plan.docx' }).icon).toBe('file-word-outline');
  expect(getNativeMailAttachmentVisual({ name: 'budget.xlsx' }).icon).toBe('file-excel-outline');
  expect(getNativeMailAttachmentVisual({ name: 'slides.pptx' }).icon).toBe('file-powerpoint-outline');
  expect(getNativeMailAttachmentVisual({ name: 'archive.zip' }).icon).toBe('folder-zip-outline');
});

it('detects images by MIME type or extension and only exposes safe local/data previews', () => {
  expect(getNativeMailAttachmentKind({ name: 'photo.bin', content_type: 'image/jpeg' })).toBe('image');
  expect(getNativeMailAttachmentKind({ name: 'photo.webp' })).toBe('image');
  expect(getNativeMailAttachmentImageSource({ name: 'photo.jpg', native_preview_uri: 'file:///cache/photo.jpg' }))
    .toBe('file:///cache/photo.jpg');
  expect(getNativeMailAttachmentImageSource({ name: 'photo.png', inline_data_url: 'data:image/png;base64,aGVsbG8=' }))
    .toBe('data:image/png;base64,aGVsbG8=');
  expect(getNativeMailAttachmentImageSource({ name: 'tracker.png', inline_src: 'https://tracker.example/pixel.png' }))
    .toBe('');
});

it('uses the filename MIME for known attachments when Exchange metadata is missing or wrong', () => {
  expect(resolveNativeMailAttachmentMimeType({ name: 'report.pdf', content_type: 'application/octet-stream' }))
    .toBe('application/pdf');
  expect(resolveNativeMailAttachmentMimeType({ name: 'contract.docx', content_type: 'application/zip' }))
    .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(resolveNativeMailAttachmentMimeType({ name: 'budget.xlsx', content_type: null }))
    .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(resolveNativeMailAttachmentMimeType({ name: 'template.xltx', content_type: 'application/octet-stream' }))
    .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.template');
  expect(resolveNativeMailAttachmentMimeType({ name: 'slides.potx', content_type: 'application/zip' }))
    .toBe('application/vnd.openxmlformats-officedocument.presentationml.template');
  expect(resolveNativeMailAttachmentMimeType({ name: 'photo.jpg', content_type: 'application/octet-stream' }))
    .toBe('image/jpeg');
});

it('keeps a valid declared MIME for unknown extensions and rejects invalid MIME metadata', () => {
  expect(resolveNativeMailAttachmentMimeType({ name: 'evidence.custom', content_type: 'application/x-evidence; version=1' }))
    .toBe('application/x-evidence');
  expect(resolveNativeMailAttachmentMimeType({ name: 'evidence.bin', content_type: 'bad mime\r\ntext/plain' }))
    .toBe('application/octet-stream');
});
