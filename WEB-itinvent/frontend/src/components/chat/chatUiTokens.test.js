import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { buildChatDensityTokens, buildChatUiTokens } from './chatUiTokens';

describe('chat UI density tokens', () => {
  it('uses smaller desktop controls in compact mode', () => {
    const spacious = buildChatDensityTokens();
    const compact = buildChatDensityTokens({ compactDesktop: true });

    expect(compact.mode).toBe('compact-desktop');
    expect(compact.sidebarAvatar).toBeLessThan(spacious.sidebarAvatar);
    expect(compact.sidebarSearchHeight).toBeLessThan(spacious.sidebarSearchHeight);
    expect(compact.composerCapsuleMinHeight).toBeLessThan(spacious.composerCapsuleMinHeight);
    expect(compact.composerActionSize).toBeLessThan(spacious.composerActionSize);
    expect(compact.dialogMenuItemMinHeight).toBeLessThan(spacious.dialogMenuItemMinHeight);
    expect(compact.bubbleBodyFontSize).toBe('19px');
    expect(compact.composerFontSize).toBe(compact.bubbleBodyFontSize);
  });

  it('keeps mobile primary touch targets at least 44px', () => {
    const mobile = buildChatDensityTokens({ compactMobile: true, compactDesktop: true });

    expect(mobile.mode).toBe('mobile');
    expect(mobile.touchTarget).toBeGreaterThanOrEqual(44);
    expect(mobile.sidebarActionButton).toBeGreaterThanOrEqual(44);
    expect(mobile.sidebarActionButtonMobile).toBeGreaterThanOrEqual(44);
    expect(mobile.threadHeaderAction).toBeGreaterThanOrEqual(44);
    expect(mobile.composerActionSize).toBeGreaterThanOrEqual(44);
    expect(mobile.dialogMenuItemMinHeight).toBeGreaterThanOrEqual(44);
  });

  it('attaches density to full chat ui tokens', () => {
    const theme = createTheme();
    const ui = buildChatUiTokens(theme, { compactDesktop: true });

    expect(ui.contentMaxWidth).toBe(ui.density.contentMaxWidth);
    expect(ui.density.sidebarColumnMax).toBe(340);
  });
});
