import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DESKTOP_WINDOW_STATE_CHANGED_EVENT } from '../../lib/desktopBridge';
import { clearSWRCache, peekSWRCache, setSWRCache } from '../../lib/swrCache';
import DesktopMemoryPressureBootstrap from './DesktopMemoryPressureBootstrap';

describe('DesktopMemoryPressureBootstrap', () => {
  beforeEach(() => clearSWRCache());
  afterEach(() => clearSWRCache());

  it('trims cached data when the Desktop window enters background', () => {
    for (let index = 0; index < 20; index += 1) {
      setSWRCache(['desktop-memory', index], index);
    }
    render(<DesktopMemoryPressureBootstrap />);

    window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_STATE_CHANGED_EVENT, {
      detail: { foreground: false },
    }));

    expect(peekSWRCache(['desktop-memory', 3])).toBeNull();
    expect(peekSWRCache(['desktop-memory', 4])?.data).toBe(4);
    expect(peekSWRCache(['desktop-memory', 19])?.data).toBe(19);
  });
});
