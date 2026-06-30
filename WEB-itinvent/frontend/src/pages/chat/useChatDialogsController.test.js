import { describe, expect, it } from 'vitest';

import { computeShouldRenderChatDialogs } from './useChatDialogsController';

describe('computeShouldRenderChatDialogs', () => {
  it('returns false when no dialog surface is open', () => {
    expect(computeShouldRenderChatDialogs({
      threadMenuAnchor: null,
      messageMenuAnchor: null,
      composerMenuAnchor: null,
      emojiAnchorEl: null,
      groupOpen: false,
      shareOpen: false,
      forwardOpen: false,
      fileDialogOpen: false,
      attachmentPreview: null,
      documentPreview: null,
      messageReadsOpen: false,
      searchOpen: false,
      isMobile: false,
      infoOpen: false,
    })).toBe(false);
  });

  it('returns true when any dialog anchor or preview is active', () => {
    expect(computeShouldRenderChatDialogs({
      composerMenuAnchor: {},
    })).toBe(true);

    expect(computeShouldRenderChatDialogs({
      fileDialogOpen: true,
    })).toBe(true);

    expect(computeShouldRenderChatDialogs({
      isMobile: true,
      infoOpen: true,
    })).toBe(true);
  });
});
