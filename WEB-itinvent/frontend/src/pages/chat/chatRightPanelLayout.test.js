import { describe, expect, it } from 'vitest';

import {
  CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  clampChatRightPanelWidth,
  persistChatRightPanelWidth,
  persistChatTaskPanelCollapsed,
  readStoredChatRightPanelWidth,
  readStoredChatTaskPanelCollapsed,
  resolveChatDesktopGridTemplateColumns,
  resolveWideDesktopLayout,
} from './chatRightPanelLayout';

describe('chatRightPanelLayout', () => {
  it('clamps stored panel width into the 320-400 range', () => {
    expect(clampChatRightPanelWidth(280)).toBe(320);
    expect(clampChatRightPanelWidth(620)).toBe(400);
    expect(clampChatRightPanelWidth('abc')).toBe(CHAT_RIGHT_PANEL_DEFAULT_WIDTH);
  });

  it('reads and persists width through storage', () => {
    const storage = {
      data: {},
      getItem(key) { return this.data[key] ?? null; },
      setItem(key, value) { this.data[key] = String(value); },
    };
    expect(readStoredChatRightPanelWidth(storage)).toBe(CHAT_RIGHT_PANEL_DEFAULT_WIDTH);
    expect(persistChatRightPanelWidth(360, storage)).toBe(360);
    expect(readStoredChatRightPanelWidth(storage)).toBe(360);
  });

  it('persists task panel collapsed state', () => {
    const storage = {
      data: {},
      getItem(key) { return this.data[key] ?? null; },
      setItem(key, value) { this.data[key] = String(value); },
    };
    expect(readStoredChatTaskPanelCollapsed(storage)).toBe(false);
    persistChatTaskPanelCollapsed(true, storage);
    expect(readStoredChatTaskPanelCollapsed(storage)).toBe(true);
  });

  it('uses hysteresis so a scrollbar cannot flip the wide desktop layout', () => {
    expect(resolveWideDesktopLayout({
      currentlyWide: false,
      matchesEnter: true,
      matchesExit: true,
    })).toBe(true);
    expect(resolveWideDesktopLayout({
      currentlyWide: true,
      matchesEnter: false,
      matchesExit: true,
    })).toBe(true);
    expect(resolveWideDesktopLayout({
      currentlyWide: true,
      matchesEnter: false,
      matchesExit: false,
    })).toBe(false);
  });

  it('keeps the thread column at least 500px when the right panel is persistent', () => {
    expect(resolveChatDesktopGridTemplateColumns({
      sidebarMin: 320,
      sidebarMax: 340,
      rightPanelWidth: 380,
      persistent: true,
    })).toBe('minmax(320px, 340px) minmax(500px, 1fr) 380px');
    expect(resolveChatDesktopGridTemplateColumns({ persistent: false })).toBe('minmax(320px, 340px) minmax(0, 1fr)');
  });
});
