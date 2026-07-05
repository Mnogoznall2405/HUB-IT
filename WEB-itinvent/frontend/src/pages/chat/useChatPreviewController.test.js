import { describe, expect, it, vi } from 'vitest';

import { revokeDocumentPreviewObjectUrl } from './useChatPreviewController';

describe('revokeDocumentPreviewObjectUrl', () => {
  it('revokes object URL when present', () => {
    const revokeObjectURL = vi.fn();
    const originalUrl = window.URL;
    window.URL = { ...originalUrl, revokeObjectURL };

    revokeDocumentPreviewObjectUrl({ objectUrl: 'blob:preview-1' });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    window.URL = originalUrl;
  });

  it('ignores missing objectUrl', () => {
    const revokeObjectURL = vi.fn();
    const originalUrl = window.URL;
    window.URL = { ...originalUrl, revokeObjectURL };

    revokeDocumentPreviewObjectUrl({ filename: 'doc.pdf' });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    window.URL = originalUrl;
  });
});
