import { getBottomNavHeight, officeTokens } from './officeTokens';

describe('getBottomNavHeight', () => {
  it('keeps the responsive web height at the default font scale', () => {
    expect(getBottomNavHeight(1)).toBe(officeTokens.bottomNavHeight);
  });

  it('adds vertical room for enlarged system text', () => {
    expect(getBottomNavHeight(1.25)).toBe(80);
  });

  it('caps extreme and invalid values to keep navigation usable', () => {
    expect(getBottomNavHeight(3)).toBe(83);
    expect(getBottomNavHeight(Number.NaN)).toBe(officeTokens.bottomNavHeight);
  });
});
