import { isDownloadedAttachmentSizeValid } from './nativeAttachmentDownloads';

describe('native chat attachment download validation', () => {
  it('trusts the authenticated response length instead of stale message metadata', () => {
    expect(isDownloadedAttachmentSizeValid(2048, 2048)).toBe(true);
    expect(isDownloadedAttachmentSizeValid(2048, null)).toBe(true);
    expect(isDownloadedAttachmentSizeValid(2048, 1024)).toBe(false);
  });
});
