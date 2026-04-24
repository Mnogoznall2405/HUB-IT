const SW_VERSION = '2026-04-17T11:20:00+05:00';
const APP_SHELL_CACHE = 'hubit-app-shell-v2026-04-17-11';
const APP_ASSET_CACHE = 'hubit-app-assets-v2026-04-17-11';
const CHAT_MEDIA_CACHE = 'hubit-chat-media-v2026-04-17-1';
const PUSH_RUNTIME_CACHE = 'itinvent-push-runtime-v1';
const PUSH_PENDING_SYNC_URL = `${self.location.origin}/__push/pending-sync`;
const SHELL_ENTRY_URL = '/index.html';
const STATIC_ASSET_DESTINATIONS = new Set(['style', 'script', 'font', 'image', 'manifest', 'worker']);
const CHAT_MEDIA_VARIANTS = new Set(['thumb', 'preview', 'poster']);
const CHAT_MEDIA_CACHE_LIMIT = 120;
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/pwa-192.png',
  '/pwa-512.png',
  '/hubit-badge.svg',
  '/hubit-screenshot-wide.svg',
  '/hubit-screenshot-narrow.svg',
];

function extractBuildAssetUrls(html) {
  const text = String(html || '');
  const urls = new Set();
  const assetPattern = /\b(?:src|href)=["']([^"']+\/assets\/[^"']+\.(?:js|css))["']/gi;
  let match = assetPattern.exec(text);
  while (match) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (isSameOrigin(url)) {
        urls.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // Ignore malformed asset references in old shell versions.
    }
    match = assetPattern.exec(text);
  }
  return [...urls];
}

function normalizeRoute(route) {
  const target = String(route || '').trim() || '/';
  return new URL(target, self.location.origin).toString();
}

function normalizeNotificationActions(actions, fallbackRoute) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((item) => {
      const action = String(item?.action || '').trim();
      const title = String(item?.title || '').trim();
      if (!action || !title) return null;
      return {
        action,
        title,
        route: normalizeRoute(item?.route || fallbackRoute || '/'),
      };
    })
    .filter(Boolean)
    .slice(0, 2);
}

function normalizeVibratePattern(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 10000)
    .slice(0, 8);
}

function urlBase64ToUint8Array(base64String) {
  const normalized = String(base64String || '').trim();
  if (!normalized) return null;
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4 || 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(padded);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function arrayBufferToBase64Url(value) {
  if (!value) return '';
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function detectBrowserFamily(userAgent = '') {
  const ua = String(userAgent || '').trim();
  if (!ua) return 'unknown';
  if (/YaBrowser/i.test(ua)) return 'yandex';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/OPR\//i.test(ua)) return 'opera';
  if (/CriOS/i.test(ua) || /Chrome\//i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|YaBrowser/i.test(ua)) return 'safari';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  return 'other';
}

function serializeSubscription(subscription) {
  const json = subscription?.toJSON?.() || {};
  const p256dh = String(
    json?.keys?.p256dh
    || arrayBufferToBase64Url(subscription?.getKey?.('p256dh'))
    || '',
  ).trim();
  const auth = String(
    json?.keys?.auth
    || arrayBufferToBase64Url(subscription?.getKey?.('auth'))
    || '',
  ).trim();
  return {
    endpoint: String(subscription?.endpoint || '').trim(),
    expiration_time: json?.expirationTime ?? null,
    p256dh_key: p256dh,
    auth_key: auth,
    platform: String(self.navigator?.platform || '').trim() || 'service-worker',
    browser_family: detectBrowserFamily(self.navigator?.userAgent),
    install_mode: null,
  };
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAssetRequest(request, url) {
  if (!isSameOrigin(url)) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (STATIC_ASSET_DESTINATIONS.has(String(request.destination || '').trim())) return true;
  return url.pathname.startsWith('/assets/');
}

function isChatMediaVariantRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (!isSameOrigin(url)) return false;
  if (!/^\/api\/v1\/chat\/messages\/[^/]+\/attachments\/[^/]+\/file$/.test(url.pathname)) return false;
  if (String(url.searchParams.get('inline') || '').trim() !== '1') return false;
  return CHAT_MEDIA_VARIANTS.has(String(url.searchParams.get('variant') || '').trim());
}

function buildOfflineShellResponse() {
  return new Response(
    `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HUB-IT</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #0f1722, #163a63);
        color: #f8fafc;
        font: 16px/1.5 "Segoe UI", Arial, sans-serif;
      }
      .card {
        width: min(92vw, 520px);
        padding: 28px 24px;
        border-radius: 24px;
        background: rgba(15, 23, 34, 0.76);
        border: 1px solid rgba(148, 163, 184, 0.24);
        box-shadow: 0 20px 48px rgba(15, 23, 34, 0.28);
      }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0; color: rgba(226, 232, 240, 0.88); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>HUB-IT</h1>
      <p>Нет сети. Оболочка приложения доступна, а данные загрузятся после восстановления подключения.</p>
    </div>
  </body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

async function notifyClients(type, detail = {}) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(clients.map(async (client) => {
    try {
      client.postMessage({ type, detail });
    } catch {
      // Ignore postMessage failures for stale clients.
    }
  }));
}

async function cacheShellAssets() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await Promise.allSettled(
    APP_SHELL_URLS.map(async (url) => {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`Failed to precache ${url}: ${response.status}`);
      }
      await cache.put(url, response.clone());
      if (url === '/' || url === SHELL_ENTRY_URL) {
        await cacheBuildAssetsFromShell(response.clone());
      }
    }),
  );
}

async function cleanupOldCaches() {
  const validCaches = new Set([APP_SHELL_CACHE, APP_ASSET_CACHE, CHAT_MEDIA_CACHE, PUSH_RUNTIME_CACHE]);
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => !validCaches.has(key))
      .map((key) => caches.delete(key)),
  );
}

async function cacheShellResponse(response) {
  if (!response?.ok) return;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return;
  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.put(SHELL_ENTRY_URL, response.clone());
  await cache.put('/', response.clone());
  await cacheBuildAssetsFromShell(response.clone());
}

async function cacheBuildAssetsFromShell(response) {
  if (!response?.ok) return;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return;
  const html = await response.text();
  const assetUrls = extractBuildAssetUrls(html);
  if (!assetUrls.length) return;
  const assetCache = await caches.open(APP_ASSET_CACHE);
  await Promise.allSettled(
    assetUrls.map(async (assetUrl) => {
      const request = new Request(assetUrl, { cache: 'reload' });
      const assetResponse = await fetch(request);
      if (assetResponse?.ok) {
        await assetCache.put(request, assetResponse.clone());
      }
    }),
  );
}

async function handleNavigationRequest(request, event) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cachedResponse = (
    await cache.match(request, { ignoreSearch: true })
    || await cache.match(SHELL_ENTRY_URL, { ignoreSearch: true })
    || await cache.match('/', { ignoreSearch: true })
  );
  const networkPromise = fetch(new Request(request, { cache: 'reload' }))
    .then(async (response) => {
      await cacheShellResponse(response.clone());
      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkPromise);
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  return networkResponse || buildOfflineShellResponse();
}

async function handleStaticAssetRequest(request) {
  const cache = await caches.open(APP_ASSET_CACHE);
  const cachedResponse = await cache.match(request, { ignoreSearch: true });
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response?.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  return networkResponse || fetch(request);
}

async function trimCacheEntries(cache, limit) {
  const maxEntries = Math.max(1, Number(limit || 0));
  const keys = await cache.keys();
  const overflow = Math.max(0, keys.length - maxEntries);
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

async function handleChatMediaVariantRequest(request, event) {
  const cache = await caches.open(CHAT_MEDIA_CACHE);
  const cachedResponse = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response?.ok) {
        await cache.put(request, response.clone());
        await trimCacheEntries(cache, CHAT_MEDIA_CACHE_LIMIT);
      }
      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkPromise);
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  return networkResponse || fetch(request);
}

async function collectClientVisibilitySnapshot() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const windowClients = clients.map((client) => ({
    url: String(client?.url || '').trim(),
    visibility_state: String(client?.visibilityState || 'unknown').trim() || 'unknown',
    focused: typeof client?.focused === 'boolean' ? client.focused : null,
  }));
  const visibleCount = windowClients.filter((client) => client.visibility_state === 'visible').length;
  const focusedVisibleCount = windowClients.filter(
    (client) => client.visibility_state === 'visible' && client.focused === true,
  ).length;
  return {
    client_count: windowClients.length,
    visible_client_count: visibleCount,
    focused_visible_client_count: focusedVisibleCount,
    has_visible_client: visibleCount > 0,
    has_focused_visible_client: focusedVisibleCount > 0,
    clients: windowClients,
  };
}

async function fetchPushConfig() {
  const response = await fetch('/api/v1/settings/notifications/push-config', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`push-config:${response.status}`);
  }
  return response.json();
}

async function upsertPushSubscription(subscription) {
  const payload = serializeSubscription(subscription);
  if (!payload.endpoint || !payload.p256dh_key || !payload.auth_key) {
    throw new Error('push-subscription-incomplete');
  }
  const response = await fetch('/api/v1/settings/notifications/push-subscription', {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`push-upsert:${response.status}`);
  }
}

async function deletePushSubscription(endpoint) {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) return;
  const response = await fetch('/api/v1/settings/notifications/push-subscription', {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ endpoint: normalizedEndpoint }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`push-delete:${response.status}`);
  }
}

async function savePendingPushSync(payload = {}) {
  try {
    const cache = await caches.open(PUSH_RUNTIME_CACHE);
    await cache.put(
      PUSH_PENDING_SYNC_URL,
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  } catch {
    // Ignore cache persistence failures.
  }
}

async function readPendingPushSync() {
  try {
    const cache = await caches.open(PUSH_RUNTIME_CACHE);
    const response = await cache.match(PUSH_PENDING_SYNC_URL);
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function clearPendingPushSync() {
  try {
    const cache = await caches.open(PUSH_RUNTIME_CACHE);
    await cache.delete(PUSH_PENDING_SYNC_URL);
  } catch {
    // Ignore cleanup failures.
  }
}

async function reportPushDiagnostic(stage, detail = {}) {
  await notifyClients('itinvent:push-diagnostic', {
    stage: String(stage || '').trim() || 'unknown',
    detail: detail && typeof detail === 'object' ? detail : {},
    sw_version: SW_VERSION,
    ts: new Date().toISOString(),
  });
  try {
    await fetch('/api/v1/settings/notifications/push-debug', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        stage: String(stage || '').trim() || 'unknown',
        detail: detail && typeof detail === 'object' ? detail : {},
      }),
    });
  } catch {
    // Ignore telemetry failures; diagnostics must not break push delivery.
  }
}

async function flushPendingPushSync() {
  const pending = await readPendingPushSync();
  if (!pending || typeof pending !== 'object') return false;

  const oldEndpoint = String(pending?.old_endpoint || '').trim();
  const subscriptionPayload = pending?.subscription && typeof pending.subscription === 'object'
    ? pending.subscription
    : null;
  if (!subscriptionPayload?.endpoint || !subscriptionPayload?.p256dh_key || !subscriptionPayload?.auth_key) {
    await clearPendingPushSync();
    return false;
  }

  try {
    await Promise.allSettled([
      oldEndpoint ? deletePushSubscription(oldEndpoint) : Promise.resolve(),
      upsertPushSubscription({
        endpoint: String(subscriptionPayload.endpoint || '').trim(),
        toJSON: () => ({
          endpoint: String(subscriptionPayload.endpoint || '').trim(),
          expirationTime: subscriptionPayload.expiration_time ?? null,
          keys: {
            p256dh: String(subscriptionPayload.p256dh_key || '').trim(),
            auth: String(subscriptionPayload.auth_key || '').trim(),
          },
        }),
      }),
    ]);
    await clearPendingPushSync();
    await reportPushDiagnostic('sw_pending_sync_flushed', {
      old_endpoint_present: Boolean(oldEndpoint),
      endpoint: String(subscriptionPayload.endpoint || '').trim(),
      sw_version: SW_VERSION,
    });
    return true;
  } catch (error) {
    await reportPushDiagnostic('sw_pending_sync_flush_failed', {
      error: String(error || 'pending_sync_flush_failed'),
      sw_version: SW_VERSION,
    });
    return false;
  }
}

async function renewPushSubscription(event) {
  const oldSubscription = event?.oldSubscription || null;
  const oldEndpoint = String(oldSubscription?.endpoint || '').trim();
  const oldOptions = oldSubscription?.options || {};

  let applicationServerKey = oldOptions.applicationServerKey || null;
  let userVisibleOnly = oldOptions.userVisibleOnly !== false;

  if (!applicationServerKey) {
    const config = await fetchPushConfig();
    if (!config?.enabled || !config?.vapid_public_key) {
      return;
    }
    applicationServerKey = urlBase64ToUint8Array(config.vapid_public_key);
    userVisibleOnly = true;
  }

  const subscription = await self.registration.pushManager.subscribe({
    userVisibleOnly,
    applicationServerKey,
  });

  const serializedSubscription = serializeSubscription(subscription);
  try {
    await Promise.allSettled([
      oldEndpoint ? deletePushSubscription(oldEndpoint) : Promise.resolve(),
      upsertPushSubscription(subscription),
    ]);
    await clearPendingPushSync();
    await notifyClients('itinvent:push-subscription-updated', {
      endpoint: String(subscription?.endpoint || '').trim(),
      sw_version: SW_VERSION,
    });
    await reportPushDiagnostic('sw_pushsubscriptionchange_success', {
      old_endpoint_present: Boolean(oldEndpoint),
      new_endpoint_present: Boolean(String(subscription?.endpoint || '').trim()),
      sw_version: SW_VERSION,
    });
  } catch (error) {
    await savePendingPushSync({
      old_endpoint: oldEndpoint,
      subscription: serializedSubscription,
      sw_version: SW_VERSION,
      ts: new Date().toISOString(),
    });
    throw error;
  }
}

async function broadcastRuntimeState(reason = 'snapshot') {
  const shellCache = await caches.open(APP_SHELL_CACHE);
  const shellReady = Boolean(
    await shellCache.match(SHELL_ENTRY_URL, { ignoreSearch: true })
    || await shellCache.match('/', { ignoreSearch: true }),
  );
  await notifyClients('itinvent:sw-runtime-state', {
    version: SW_VERSION,
    reason: String(reason || 'snapshot').trim() || 'snapshot',
    offline_ready: shellReady,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await cacheShellAssets();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await cleanupOldCaches();
    await self.clients.claim();
    await flushPendingPushSync();
    await broadcastRuntimeState('activated');
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isChatMediaVariantRequest(request, url)) {
    event.respondWith(handleChatMediaVariantRequest(request, event));
    return;
  }

  if (!isSameOrigin(url) || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request, event));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data?.json?.() || {};
    } catch {
      payload = {};
    }

    const title = String(payload?.title || 'Новое уведомление').trim() || 'Новое уведомление';
    const body = String(payload?.body || 'Откройте приложение, чтобы посмотреть подробности.').trim() || 'Откройте приложение, чтобы посмотреть подробности.';
    const data = payload?.data || {};
    const route = normalizeRoute(data?.route || '/');
    const tag = String(
      payload?.tag
      || `${String(payload?.channel || 'system').trim() || 'system'}:${String(data?.message_id || data?.notification_id || '').trim()}`
    ).trim() || 'system';
    const clientSnapshot = await collectClientVisibilitySnapshot();
    const shouldForwardToVisibleClientOnly = Boolean(clientSnapshot.has_focused_visible_client);

    await reportPushDiagnostic('sw_push_received', {
      channel: String(payload?.channel || 'system').trim() || 'system',
      tag,
      route,
      conversation_id: String(data?.conversation_id || '').trim(),
      message_id: String(data?.message_id || '').trim(),
      notification_id: String(data?.notification_id || '').trim(),
      delivery_mode: shouldForwardToVisibleClientOnly ? 'foreground_focused' : 'background',
      client_count: clientSnapshot.client_count,
      visible_client_count: clientSnapshot.visible_client_count,
      focused_visible_client_count: clientSnapshot.focused_visible_client_count,
      clients: clientSnapshot.clients,
    });

    if (shouldForwardToVisibleClientOnly) {
      await notifyClients('itinvent:push-foreground-notification', {
        channel: String(payload?.channel || 'system').trim() || 'system',
        title,
        body,
        route,
        tag,
        data,
        actions: normalizeNotificationActions(payload?.actions, route),
      });
      await reportPushDiagnostic('sw_push_forwarded_to_visible_client', {
        channel: String(payload?.channel || 'system').trim() || 'system',
        tag,
        route,
        client_count: clientSnapshot.client_count,
        visible_client_count: clientSnapshot.visible_client_count,
        focused_visible_client_count: clientSnapshot.focused_visible_client_count,
      });
      return;
    }

    try {
      const notificationActions = normalizeNotificationActions(payload?.actions, route);
      const vibratePattern = normalizeVibratePattern(payload?.vibrate);
      const notificationOptions = {
        body,
        tag,
        renotify: Boolean(payload?.renotify),
        icon: String(payload?.icon || '/pwa-192.png').trim() || '/pwa-192.png',
        badge: String(payload?.badge || '/hubit-badge.svg').trim() || '/hubit-badge.svg',
        data: {
          route,
          channel: String(payload?.channel || 'system').trim() || 'system',
          conversation_id: String(data?.conversation_id || '').trim(),
          message_id: String(data?.message_id || '').trim(),
          notification_id: String(data?.notification_id || '').trim(),
          actions: notificationActions,
        },
      };
      if (vibratePattern.length) {
        notificationOptions.vibrate = vibratePattern;
      }
      if (payload?.require_interaction === true) {
        notificationOptions.requireInteraction = true;
      }
      if (typeof payload?.silent === 'boolean') {
        notificationOptions.silent = payload.silent;
      }
      const timestamp = Number(payload?.timestamp);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        notificationOptions.timestamp = timestamp;
      }
      if (notificationActions.length) {
        notificationOptions.actions = notificationActions.map(({ action, title }) => ({ action, title }));
      }

      await self.registration.showNotification(title, notificationOptions);
      await reportPushDiagnostic('sw_show_notification_success', {
        channel: String(payload?.channel || 'system').trim() || 'system',
        tag,
        route,
        delivery_mode: shouldForwardToVisibleClientOnly ? 'foreground_focused' : 'background',
        client_count: clientSnapshot.client_count,
        visible_client_count: clientSnapshot.visible_client_count,
        focused_visible_client_count: clientSnapshot.focused_visible_client_count,
        require_interaction: payload?.require_interaction === true,
        vibrate_count: vibratePattern.length,
        actions_count: notificationActions.length,
      });
    } catch (error) {
      await reportPushDiagnostic('sw_show_notification_failed', {
        channel: String(payload?.channel || 'system').trim() || 'system',
        tag,
        route,
        error: String(error || 'show_notification_failed'),
        delivery_mode: shouldForwardToVisibleClientOnly ? 'foreground_focused' : 'background',
        client_count: clientSnapshot.client_count,
        visible_client_count: clientSnapshot.visible_client_count,
        focused_visible_client_count: clientSnapshot.focused_visible_client_count,
      });
      throw error;
    }
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      await reportPushDiagnostic('sw_pushsubscriptionchange_received', {
        old_endpoint_present: Boolean(String(event?.oldSubscription?.endpoint || '').trim()),
      });
      await renewPushSubscription(event);
    } catch (error) {
      await reportPushDiagnostic('sw_pushsubscriptionchange_failed', {
        error: String(error || 'pushsubscriptionchange_failed'),
      });
      await notifyClients('itinvent:push-subscription-refresh-required', {
        error: String(error || 'pushsubscriptionchange_failed'),
      });
    }
  })());
});

self.addEventListener('message', (event) => {
  const messageType = String(event?.data?.type || '').trim();
  if (!messageType) return;

  if (messageType === 'itinvent:push-sync-drain') {
    event.waitUntil((async () => {
      const flushed = await flushPendingPushSync();
      if (flushed) {
        await notifyClients('itinvent:push-subscription-updated', {
          source: 'pending-sync-drain',
          sw_version: SW_VERSION,
        });
      }
    })());
    return;
  }

  if (messageType === 'itinvent:sw-runtime-snapshot') {
    event.waitUntil(broadcastRuntimeState('snapshot'));
    return;
  }

  if (messageType === 'itinvent:skip-waiting') {
    event.waitUntil((async () => {
      await broadcastRuntimeState('update-available');
      await self.skipWaiting();
    })());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    if (String(event.action || '').trim() === 'dismiss') {
      await reportPushDiagnostic('sw_notification_dismiss_action', {
        route: normalizeRoute(event.notification?.data?.route || '/'),
        tag: String(event.notification?.tag || '').trim(),
        channel: String(event.notification?.data?.channel || '').trim(),
      });
      return;
    }
    const actionList = Array.isArray(event.notification?.data?.actions) ? event.notification.data.actions : [];
    const matchedAction = actionList.find((item) => String(item?.action || '').trim() === String(event.action || '').trim());
    const route = normalizeRoute(matchedAction?.route || event.notification?.data?.route || '/');
    await reportPushDiagnostic('sw_notification_click', {
      route,
      tag: String(event.notification?.tag || '').trim(),
      channel: String(event.notification?.data?.channel || '').trim(),
      action: String(event.action || '').trim(),
    });
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of clientList) {
      try {
        if ('navigate' in client) {
          await client.navigate(route);
        }
        await client.focus();
        return;
      } catch {
        // Try the next client or open a new one.
      }
    }

    await self.clients.openWindow(route);
  })());
});
