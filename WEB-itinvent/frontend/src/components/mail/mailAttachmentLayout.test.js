import { describe, expect, it } from 'vitest';
import {
  MOBILE_ATTACHMENT_COMPACT_FROM,
  MOBILE_ATTACHMENT_HERO_ONLY_MAX,
  buildAttachmentCountLabel,
  buildAttachmentFilesLabel,
  buildAttachmentSummaryLine,
  getAttachmentExtensionBadge,
  shouldUseCompactAttachmentLayout,
} from './mailAttachmentLayout';

describe('mailAttachmentLayout', () => {
  it('uses hero-only layout for up to two attachments', () => {
    expect(shouldUseCompactAttachmentLayout(1)).toBe(false);
    expect(shouldUseCompactAttachmentLayout(2)).toBe(false);
    expect(shouldUseCompactAttachmentLayout(MOBILE_ATTACHMENT_HERO_ONLY_MAX)).toBe(false);
    expect(shouldUseCompactAttachmentLayout(MOBILE_ATTACHMENT_COMPACT_FROM)).toBe(true);
  });

  it('builds russian attachment labels', () => {
    expect(buildAttachmentCountLabel(1)).toBe('1 вложение');
    expect(buildAttachmentCountLabel(3)).toBe('3 вложения');
    expect(buildAttachmentFilesLabel(3)).toBe('3 файла');
    expect(buildAttachmentSummaryLine(3, '766 КБ')).toBe('3 файла, 766 КБ');
  });

  it('extracts extension badge from filename', () => {
    expect(getAttachmentExtensionBadge('report.pdf')).toBe('PDF');
    expect(getAttachmentExtensionBadge('letter.docx')).toBe('DOCX');
  });
});
