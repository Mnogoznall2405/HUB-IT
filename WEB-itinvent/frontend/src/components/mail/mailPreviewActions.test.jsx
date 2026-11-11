import { describe, expect, it, vi } from 'vitest';
import {
  buildMailPreviewActionItems,
  filterMailPreviewDesktopOverflowActions,
} from './mailPreviewActions';

describe('filterMailPreviewDesktopOverflowActions', () => {
  it('hides toolbar duplicates from the desktop overflow menu', () => {
    const items = buildMailPreviewActionItems({
      folder: 'inbox',
      readActionIcon: null,
      readActionLabel: 'Пометить как непрочитанное',
      onOpenComposeFromMessage: vi.fn(),
      onToggleReadState: vi.fn(),
      onDeleteSelectedMessage: vi.fn(),
      onArchiveSelectedMessage: vi.fn(),
      canArchive: true,
    });
    const overflow = filterMailPreviewDesktopOverflowActions(items, 'inbox');
    const ids = overflow.map((item) => item.id);

    expect(ids).not.toContain('reply');
    expect(ids).not.toContain('reply-all');
    expect(ids).not.toContain('forward');
    expect(ids).toContain('toggle-read');
    expect(ids).toContain('delete');
    expect(ids).toContain('archive');
  });
});
