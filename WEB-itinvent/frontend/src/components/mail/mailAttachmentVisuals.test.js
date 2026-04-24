import { describe, expect, it } from 'vitest';
import { getMailAttachmentKind, getMailAttachmentVisual } from './mailAttachmentVisuals';

describe('mailAttachmentVisuals', () => {
  it('detects common document and media types', () => {
    expect(getMailAttachmentKind({ name: 'report.pdf', content_type: 'application/pdf' })).toBe('pdf');
    expect(getMailAttachmentKind({ name: 'letter.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('word');
    expect(getMailAttachmentKind({ name: 'table.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe('excel');
    expect(getMailAttachmentKind({ name: 'slides.pptx', content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe('powerpoint');
    expect(getMailAttachmentKind({ name: 'photo.jpg', content_type: 'image/jpeg' })).toBe('image');
    expect(getMailAttachmentKind({ name: 'archive.zip', content_type: 'application/zip' })).toBe('archive');
    expect(getMailAttachmentKind({ name: 'notes.txt', content_type: 'text/plain' })).toBe('text');
    expect(getMailAttachmentKind({ name: 'clip.mp4', content_type: 'video/mp4' })).toBe('media');
    expect(getMailAttachmentKind({ name: 'unknown.bin', content_type: 'application/octet-stream' })).toBe('generic');
  });

  it('returns outlook-like visual metadata for known attachments', () => {
    const pdfVisual = getMailAttachmentVisual({ name: 'report.pdf', content_type: 'application/pdf' });
    const imageVisual = getMailAttachmentVisual({ name: 'photo.png', content_type: 'image/png' });

    expect(pdfVisual.kind).toBe('pdf');
    expect(pdfVisual.label).toBe('PDF');
    expect(typeof pdfVisual.color).toBe('string');
    expect(pdfVisual.Icon).toBeTruthy();

    expect(imageVisual.kind).toBe('image');
    expect(imageVisual.label).toBe('Изображение');
    expect(typeof imageVisual.color).toBe('string');
    expect(imageVisual.Icon).toBeTruthy();
  });
});
