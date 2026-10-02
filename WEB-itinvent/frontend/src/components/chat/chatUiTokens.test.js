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
    expect(compact.composerCapsuleMinHeight).toBe(44);
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
    expect(compact.bubblePx).toBe(1.18);
    expect(compact.bubblePy).toBe(0.82);
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

  it('uses the Telegram night palette with readable text, time and ticks on the blue bubble (Д2-1)', () => {
    const parse = (value) => {
      const text = String(value);
      if (text.startsWith('#')) {
        const hex = text.length === 4 ? text.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : text;
        return { rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), alpha: 1 };
      }
      const match = text.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: match[4] === undefined ? 1 : Number(match[4]) };
    };
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (foreground, background) => {
      const bg = parse(background);
      const fg = parse(foreground);
      const mixed = fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha));
      const [hi, lo] = [luminance(mixed), luminance(bg.rgb)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    };

    const dark = buildChatUiTokens(createTheme({ palette: { mode: 'dark' } }));
    expect(dark.bubbleOwnBg).toBe('#2b5278');
    expect(dark.bubbleOtherBg).toBe('#182533');
    expect(dark.sidebarBg ?? dark.drawerBg).toBe('#17212b');
    expect(dark.threadBg).toBe('#0e1621');
    expect(contrast(dark.bubbleOwnText, dark.bubbleOwnBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.bubbleOwnMetaText, dark.bubbleOwnBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.statusSentText, dark.bubbleOwnBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.statusReadText, dark.bubbleOwnBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.bubbleOtherText, dark.bubbleOtherBg)).toBeGreaterThanOrEqual(7);
    expect(contrast(dark.bubbleOtherMetaText, dark.bubbleOtherBg)).toBeGreaterThanOrEqual(4.5);

    const light = buildChatUiTokens(createTheme({ palette: { mode: 'light' } }));
    expect(light.bubbleOwnBg).toBe('#effdde');
    expect(light.bubbleOtherBg).toBe('#ffffff');
  });

  it('keeps the removed purple accent out of every token (Д2-1)', () => {
    ['light', 'dark'].forEach((mode) => {
      const serialized = JSON.stringify(buildChatUiTokens(createTheme({ palette: { mode } }))).toLowerCase();
      expect(serialized).not.toContain('8774e1');
    });
  });
});
