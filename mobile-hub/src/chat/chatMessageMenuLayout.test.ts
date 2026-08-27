import { isUsableChatMenuAnchor, placeMessageActionMenu } from './chatMessageMenuLayout';

describe('native chat message menu placement', () => {
  it('places the menu above a lower-thread bubble and clamps it to the screen', () => {
    expect(placeMessageActionMenu({
      anchor: { x: 40, y: 520, width: 180, height: 64 },
      viewport: { width: 360, height: 720 },
      menu: { width: 280, height: 320 },
      align: 'start',
    })).toEqual({
      top: 192,
      left: 40,
      placement: 'above',
    });
    expect(placeMessageActionMenu({
      anchor: { x: 220, y: 40, width: 120, height: 48 },
      viewport: { width: 360, height: 720 },
      menu: { width: 280, height: 320 },
      align: 'end',
    })).toEqual({
      top: 96,
      left: 60,
      placement: 'below',
    });
  });

  it('falls back to a centered card when the bubble was not measured', () => {
    expect(isUsableChatMenuAnchor({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
    expect(placeMessageActionMenu({
      viewport: { width: 360, height: 720 },
      menu: { width: 300, height: 360 },
    })).toEqual({
      top: 180,
      left: 30,
      placement: 'center',
    });
  });
});
