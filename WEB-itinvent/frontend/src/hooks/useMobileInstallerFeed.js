import { useEffect, useState } from 'react';
import { loadMobileInstallerFeed } from '../lib/mobileInstallerFeed';

const IDLE_STATE = Object.freeze({ status: 'idle', feed: null, error: null });

export default function useMobileInstallerFeed({ enabled = true } = {}) {
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
    loadMobileInstallerFeed()
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
