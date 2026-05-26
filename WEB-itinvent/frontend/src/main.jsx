import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { NotificationProvider } from './contexts/NotificationContext'
import { PreferencesProvider } from './contexts/PreferencesContext'
import {
  bindPwaRuntime,
  clearPwaInstallPrompt,
  refreshPwaInstallState,
  storePwaInstallPrompt,
} from './lib/pwaInstall'
import './index.css'

const CHUNK_RELOAD_FINGERPRINT_KEY = 'itinvent_chunk_reload_fingerprint';

const buildChunkReloadFingerprint = (reason = '') => {
  const route = `${window.location.pathname}${window.location.search}`;
  const normalizedReason = String(reason || '').trim().slice(0, 240);
  return normalizedReason ? `${route}::${normalizedReason}` : route;
};

const tryRecoverChunkLoad = (reason = '') => {
  try {
    const fingerprint = buildChunkReloadFingerprint(reason);
    const previousFingerprint = String(sessionStorage.getItem(CHUNK_RELOAD_FINGERPRINT_KEY) || '').trim();
    if (previousFingerprint !== fingerprint) {
      sessionStorage.setItem(CHUNK_RELOAD_FINGERPRINT_KEY, fingerprint);
      window.location.reload();
      return true;
    }
  } catch (error) {
    console.error('Chunk reload recovery failed', error);
  }
  return false;
};

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const reason = String(event?.payload?.message || event?.payload?.path || event?.type || 'vite:preloadError');
  const recovered = tryRecoverChunkLoad(reason);
  if (!recovered) {
    console.error('Chunk preload error suppressed to avoid reload loop', event?.payload || event);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = String(reason?.message || reason || '');
  if (message.includes('Failed to fetch dynamically imported module')) {
    event.preventDefault?.();
    const recovered = tryRecoverChunkLoad(message);
    if (!recovered) {
      console.error('Dynamic import error suppressed to avoid reload loop', reason);
    }
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault?.();
  storePwaInstallPrompt(event);
});

window.addEventListener('appinstalled', () => {
  clearPwaInstallPrompt();
  refreshPwaInstallState();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        bindPwaRuntime(registration);
        return registration.update().catch(() => registration);
      })
      .catch((error) => {
        console.error('Service worker registration failed', error);
      });
    refreshPwaInstallState();
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PreferencesProvider>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </PreferencesProvider>
  </React.StrictMode>,
)
