import { describe, expect, it } from 'vitest';

import { buildChatThreadWallpaperSx } from './chatThreadWallpaper';

describe('buildChatThreadWallpaperSx', () => {
  it('returns dark wallpaper layers when theme mode is dark', () => {
    const sx = buildChatThreadWallpaperSx(
      { palette: { mode: 'dark', primary: { main: '#1976d2' } } },
      { threadBg: '#17212b' },
    );
    expect(sx.backgroundColor).toBe('#17212b');
    expect(String(sx.backgroundImage)).toContain('radial-gradient');
    expect(String(sx.backgroundImage)).toContain('%23788fa3');
  });

  it('returns light wallpaper layers when theme mode is light', () => {
    const sx = buildChatThreadWallpaperSx(
      { palette: { mode: 'light', primary: { main: '#1976d2' } } },
      { threadBg: '#e8f5d8' },
    );
    expect(sx.backgroundColor).toBe('#e8f5d8');
    // The pattern must be the top layer, otherwise the opaque gradients hide it.
    expect(String(sx.backgroundImage).trim().startsWith('url(')).toBe(true);
    expect(String(sx.backgroundImage)).toContain('%2389a36a');
  });
});
