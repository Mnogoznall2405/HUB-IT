import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import {
  buildChatDensityTokens,
  buildChatMessageBodySurfaceSx,
  buildChatThreadMessageBodyTypographySx,
  buildChatUiTokens,
  getChatBubbleBodyFontSize,
  getChatBubbleBodyLineHeight,
  getChatComposerBodyFontSize,
  getChatComposerLineHeight,
} from './chatUiTokens';

describe('chat UI density tokens', () => {
  it('uses smaller desktop controls in compact mode', () => {
    const spacious = buildChatDensityTokens();
    const compact = buildChatDensityTokens({ compactDesktop: true });

    expect(compact.mode).toBe('compact-desktop');
    expect(compact.sidebarAvatar).toBeLessThan(spacious.sidebarAvatar);
    expect(compact.sidebarSearchHeight).toBeLessThan(spacious.sidebarSearchHeight);
    expect(compact.sidebarRowMinHeight).toBe(48);
    expect(compact.sidebarAvatar).toBe(40);
    expect(compact.sidebarRowPy).toBe(4);
    expect(compact.sidebarRowMy).toBe(0);
    expect(compact.sidebarPreviewFontSize).toBe('11.5px');
    expect(compact.composerCapsuleMinHeight).toBeLessThan(spacious.composerCapsuleMinHeight);
    expect(compact.composerCapsuleMinHeight).toBe(34);
    expect(compact.composerInputSlotMinHeight).toBe(26);
    expect(compact.composerInnerPaddingY).toBe(0);
    expect(compact.composerTextareaMinHeight).toBe(19);
    expect(compact.composerActionSize).toBe(34);
    expect(compact.composerActionSize).toBeLessThan(spacious.composerActionSize);
    expect(compact.dialogMenuItemMinHeight).toBeLessThan(spacious.dialogMenuItemMinHeight);
    expect(spacious.threadHeaderTitleFontSize).toBe('16px');
    expect(spacious.bubbleBodyFontSize).toBe('16px');
    expect(spacious.composerFontSize).toBe('16px');
    expect(spacious.bubbleBodyLineHeight).toBe(1.3);
    expect(compact.threadHeaderTitleFontSize).toBe('15px');
    expect(compact.bubbleBodyFontSize).toBe('15px');
    expect(compact.composerFontSize).toBe(compact.bubbleBodyFontSize);
    expect(compact.bubbleBodyLineHeight).toBe(1.26);
    expect(compact.composerLineHeight).toBe(1.26);
    expect(compact.bubblePx).toBeLessThan(spacious.bubblePx);
    expect(compact.bubblePy).toBeLessThan(spacious.bubblePy);
    expect(compact.bubbleBodyBottomPadding).toBeLessThan(spacious.bubbleBodyBottomPadding);
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
    expect(mobile.composerFontSize).toBe('16px');
    expect(mobile.composerLineHeight).toBe(1.34);
    expect(mobile.bubbleBodyMobileFontSize).toBe('15px');
    expect(mobile.bubbleBodyLineHeight).toBe(1.34);
  });

  it('attaches density to full chat ui tokens', () => {
    const theme = createTheme();
    const ui = buildChatUiTokens(theme, { compactDesktop: true });

    expect(ui.contentMaxWidth).toBe(ui.density.contentMaxWidth);
    expect(ui.density.sidebarColumnMax).toBe(340);
  });

  it('builds thread-level message body typography overrides with explicit px', () => {
    const theme = createTheme();
    const ui = buildChatUiTokens(theme, { compactDesktop: true });
    const sx = buildChatThreadMessageBodyTypographySx(ui, false);

    expect(getChatBubbleBodyFontSize(ui, false)).toBe('15px');
    expect(getChatComposerBodyFontSize(ui, false)).toBe('15px');
    expect(getChatBubbleBodyLineHeight(ui, false)).toBe(1.26);
    expect(getChatComposerLineHeight(ui, false)).toBe(1.26);
    expect(sx['--chat-bubble-body-font-size']).toBe('15px');
    expect(sx['& [data-chat-message-body="true"]:not([data-chat-emoji-only="true"])']).toEqual({
      fontSize: '15px !important',
      lineHeight: '1.26 !important',
    });
    expect(buildChatMessageBodySurfaceSx('15px', getChatBubbleBodyLineHeight(ui, false))).toEqual({
      fontSize: '15px',
      lineHeight: 1.26,
    });
  });
});
