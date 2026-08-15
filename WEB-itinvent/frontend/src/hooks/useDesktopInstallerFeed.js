import { useEffect, useState } from 'react';
import { loadDesktopInstallerFeed } from '../lib/desktopInstallerFeed';

const IDLE_STATE = Object.freeze({ status: 'idle', feed: null, error: null });

export default function useDesktopInstallerFeed({ enabled = true } = {}) {
  const [state, setState] = useState(() => (enabled
    ? { status: 'loading', feed: null, error: null }
    : IDLE_STATE));

  useEffect(() => {
    let active = true;
    if (!enabled) {
      setState(IDLE_STATE);
      return () => {
        active = false;
      };
    }

    setState({ status: 'loading', feed: null, error: null });
    loadDesktopInstallerFeed()
      .then((feed) => {
        if (active) setState({ status: 'ready', feed, error: null });
      })
      .catch((error) => {
        if (active) setState({ status: 'unavailable', feed: null, error });
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
