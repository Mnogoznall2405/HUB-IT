import { describe, expect, it } from 'vitest';

import { getChatFolderPanelMotionProps } from './ChatSidebar';

describe('ChatSidebar motion helpers', () => {
  it('returns folder panel enter/exit animation props', () => {
    expect(getChatFolderPanelMotionProps(false)).toEqual({
      initial: { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -8 },
      transition: { duration: 0.24, ease: 'easeOut' },
    });
  });

  it('disables motion when reduced motion is requested', () => {
    expect(getChatFolderPanelMotionProps(true)).toEqual({
      initial: false,
      animate: { opacity: 1, y: 0 },
      exit: undefined,
      transition: { duration: 0, ease: 'easeOut' },
    });
  });
});
