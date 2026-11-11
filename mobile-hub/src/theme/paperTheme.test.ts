import { createPaperTheme } from './paperTheme';

describe('createPaperTheme', () => {
  it('uses light native tokens for Paper surfaces', () => {
    const theme = createPaperTheme('light');

    expect(theme.dark).toBe(false);
    expect(theme.colors.background).toBe('#f3f2f1');
    expect(theme.colors.surface).toBe('#ffffff');
    expect(theme.colors.onSurface).toBe('#201f1e');
  });

  it('uses dark native tokens for Paper surfaces', () => {
    const theme = createPaperTheme('dark');

    expect(theme.dark).toBe(true);
    expect(theme.colors.background).toBe('#0f1115');
    expect(theme.colors.surface).toBe('#1f2329');
    expect(theme.colors.onSurface).toBe('#f3f2f1');
  });
});
