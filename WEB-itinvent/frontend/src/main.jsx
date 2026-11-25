import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RootErrorBoundary from './components/feedback/RootErrorBoundary'
import { NotificationProvider } from './contexts/NotificationContext'
import { ConfirmDialogProvider } from './components/feedback/ConfirmDialogProvider'
import { PreferencesProvider } from './contexts/PreferencesContext'
import {
  bindPwaRuntime,
  clearPwaInstallPrompt,
  refreshPwaInstallState,
  storePwaInstallPrompt,
} from './lib/pwaInstall'
import { tryRecoverChunkLoad } from './lib/routeChunkRecovery'
import { initializeDesktopBridge } from './lib/desktopBridge'
import './index.css'

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
      .then(async (registration) => {
        bindPwaRuntime(registration);
        try {
          await registration.update();
        } catch {
          // Ignore update probe failures; registration is still usable.
        }
        // Do not auto skipWaiting here: silent claim without reload breaks
        // lazy route opens (especially /chat from push) on mobile PWA.
        return registration;
      })
      .catch((error) => {
        console.error('Service worker registration failed', error);
      });
    refreshPwaInstallState();
  });
}

const startApplication = async () => {
  await initializeDesktopBridge();

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <PreferencesProvider>
          <NotificationProvider>
            <ConfirmDialogProvider>
              <App />
            </ConfirmDialogProvider>
          </NotificationProvider>
        </PreferencesProvider>
      </RootErrorBoundary>
    </React.StrictMode>,
  );
};

void startApplication();
