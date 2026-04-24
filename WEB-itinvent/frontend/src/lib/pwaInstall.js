const listeners = new Set();

let deferredInstallPrompt = null;
let currentRegistration = null;
let runtimeListenersBound = false;
let displayModeListenersBound = false;
let pendingReloadAfterUpdate = false;
let swMessageHandler = null;
let swControllerChangeHandler = null;

let runtimeState = {
  updateAvailable: false,
  serviceWorkerVersion: '',
  offlineReady: false,
  displayMode: 'browser',
  windowControlsOverlaySupported: false,
  windowControlsOverlayVisible: false,
  lastRuntimeSyncAt: '',
};

function isIosLike() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const platform = String(navigator.platform || '').toLowerCase();
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
  return /iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && maxTouchPoints > 1);
}

function isAndroidLike() {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(String(navigator.userAgent || ''));
}

function getDisplayMode() {
  if (typeof window === 'undefined') return 'browser';
  if (window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches) return 'window-controls-overlay';
  if (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true) return 'standalone';
  if (window.matchMedia?.('(display-mode: minimal-ui)')?.matches) return 'minimal-ui';
  if (window.matchMedia?.('(display-mode: fullscreen)')?.matches) return 'fullscreen';
  return 'browser';
}

function isStandalone() {
  const displayMode = getDisplayMode();
  return displayMode !== 'browser';
}

function readWindowControlsOverlayState() {
  if (typeof window === 'undefined') {
    return {
      windowControlsOverlaySupported: false,
      windowControlsOverlayVisible: false,
    };
  }
  const overlay = window.navigator?.windowControlsOverlay;
  return {
    windowControlsOverlaySupported: Boolean(overlay),
    windowControlsOverlayVisible: Boolean(overlay?.visible),
  };
}

async function detectOfflineReady() {
  if (typeof window === 'undefined' || !('caches' in window)) return false;
  const shellCandidates = ['/', '/index.html'];
  for (const candidate of shellCandidates) {
    try {
      const match = await window.caches.match(candidate, { ignoreSearch: true });
      if (match) return true;
    } catch {
      // Ignore cache read failures.
    }
  }
  return false;
}

function updateDocumentModeState(snapshot) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.pwaInstalled = snapshot.installed ? 'true' : 'false';
  root.dataset.pwaDisplayMode = snapshot.displayMode || 'browser';
  root.dataset.pwaWindowControlsOverlay = snapshot.windowControlsOverlayVisible ? 'true' : 'false';
}

function getSnapshot() {
  const ios = isIosLike();
  const android = isAndroidLike();
  const standalone = isStandalone();
  const secure = typeof window === 'undefined' ? true : Boolean(window.isSecureContext);
  const displayMode = getDisplayMode();
  return {
    ios,
    android,
    mobile: ios || android,
    secure,
    installed: standalone,
    canPrompt: Boolean(deferredInstallPrompt) && !standalone,
    requiresManualInstall: ios && !standalone,
    ...runtimeState,
    displayMode,
  };
}

function emitChange() {
  const snapshot = getSnapshot();
  updateDocumentModeState(snapshot);
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('PWA install listener failed', error);
    }
  });
}

function updateRuntimeState(patch = {}) {
  runtimeState = {
    ...runtimeState,
    ...patch,
    lastRuntimeSyncAt: new Date().toISOString(),
  };
  emitChange();
}

function requestServiceWorkerRuntimeState() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const target = currentRegistration?.active || currentRegistration?.waiting || navigator.serviceWorker.controller;
  try {
    target?.postMessage?.({ type: 'itinvent:sw-runtime-snapshot' });
  } catch {
    // Ignore snapshot request failures.
  }
}

async function syncOfflineShellState() {
  const offlineReady = await detectOfflineReady();
  updateRuntimeState({
    offlineReady,
    displayMode: getDisplayMode(),
    ...readWindowControlsOverlayState(),
  });
}

function bindDisplayModeListeners() {
  if (displayModeListenersBound || typeof window === 'undefined') return;
  displayModeListenersBound = true;

  const queries = [
    '(display-mode: browser)',
    '(display-mode: standalone)',
    '(display-mode: window-controls-overlay)',
  ];
  queries.forEach((query) => {
    const media = window.matchMedia?.(query);
    media?.addEventListener?.('change', emitChange);
  });

  const overlay = window.navigator?.windowControlsOverlay;
  overlay?.addEventListener?.('geometrychange', () => {
    updateRuntimeState(readWindowControlsOverlayState());
  });
}

function bindRuntimeListeners() {
  if (runtimeListenersBound || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  runtimeListenersBound = true;

  swMessageHandler = (event) => {
    const messageType = String(event?.data?.type || '').trim();
    if (messageType !== 'itinvent:sw-runtime-state') return;
    const detail = event?.data?.detail && typeof event.data.detail === 'object'
      ? event.data.detail
      : {};
    updateRuntimeState({
      serviceWorkerVersion: String(detail?.version || '').trim(),
      offlineReady: Boolean(detail?.offline_ready),
      updateAvailable: detail?.reason === 'update-available'
        ? true
        : detail?.reason === 'activated' || detail?.reason === 'snapshot'
          ? Boolean(currentRegistration?.waiting)
          : Boolean(runtimeState.updateAvailable),
    });
  };

  swControllerChangeHandler = () => {
    if (!pendingReloadAfterUpdate) {
      void syncOfflineShellState();
      requestServiceWorkerRuntimeState();
      return;
    }
    pendingReloadAfterUpdate = false;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('message', swMessageHandler);
  navigator.serviceWorker.addEventListener('controllerchange', swControllerChangeHandler);
}

function watchInstallingWorker(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker?.controller) {
      updateRuntimeState({ updateAvailable: true });
    }
    if (worker.state === 'activated') {
      updateRuntimeState({ updateAvailable: false });
      void syncOfflineShellState();
    }
  });
}

export function getPwaInstallState() {
  return getSnapshot();
}

export function subscribePwaInstallState(listener) {
  listeners.add(listener);
  listener(getSnapshot());
  return () => listeners.delete(listener);
}

export function storePwaInstallPrompt(event) {
  deferredInstallPrompt = event || null;
  emitChange();
}

export function clearPwaInstallPrompt() {
  deferredInstallPrompt = null;
  emitChange();
}

export async function promptPwaInstall() {
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  emitChange();
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => null);
  emitChange();
  return { outcome: String(choice?.outcome || 'unknown') };
}

export function bindPwaRuntime(registration) {
  currentRegistration = registration || currentRegistration;
  bindDisplayModeListeners();
  bindRuntimeListeners();

  if (!currentRegistration) {
    void syncOfflineShellState();
    return;
  }

  if (currentRegistration.waiting) {
    updateRuntimeState({ updateAvailable: true });
  }
  watchInstallingWorker(currentRegistration.installing);
  currentRegistration.addEventListener?.('updatefound', () => {
    watchInstallingWorker(currentRegistration.installing);
  });

  void syncOfflineShellState();
  requestServiceWorkerRuntimeState();
}

export async function applyPwaUpdate() {
  if (!currentRegistration?.waiting) return false;
  pendingReloadAfterUpdate = true;
  try {
    currentRegistration.waiting.postMessage({ type: 'itinvent:skip-waiting' });
    return true;
  } catch (error) {
    pendingReloadAfterUpdate = false;
    console.error('Failed to apply PWA update', error);
    return false;
  }
}

export function refreshPwaInstallState() {
  bindDisplayModeListeners();
  bindRuntimeListeners();
  void syncOfflineShellState();
  requestServiceWorkerRuntimeState();
  emitChange();
}
