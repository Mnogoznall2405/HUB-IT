import { useEffect } from 'react';

import {
  DESKTOP_WINDOW_STATE_CHANGED_EVENT,
} from '../../lib/desktopBridge';
import { pruneInboxMessagePreviews } from '../../lib/chatSocket';
import { trimSWRCache } from '../../lib/swrCache';

const BACKGROUND_CACHE_ENTRIES = 16;

const DesktopMemoryPressureBootstrap = () => {
  useEffect(() => {
    const handleWindowState = (event) => {
      if (event?.detail?.foreground !== false) return;
      trimSWRCache({ maxEntries: BACKGROUND_CACHE_ENTRIES });
      pruneInboxMessagePreviews();
    };

    window.addEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, handleWindowState);
    return () => {
      window.removeEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, handleWindowState);
    };
  }, []);

  return null;
};

export default DesktopMemoryPressureBootstrap;
