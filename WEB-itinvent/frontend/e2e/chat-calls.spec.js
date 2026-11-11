import { test, expect } from '@playwright/test';

// Chat voice/video calls UI against the local stack (E2E_LOCAL=1 seeds both
// users). The calls REST API is mocked with page.route and the chat WebSocket
// is proxied through page.routeWebSocket so the test can push
// `chat.call.*` frames. livekit-client is replaced by a small stub module, so
// the session lifecycle is exercised end to end but the real audio/video
// transport (tracks, rendering) is NOT covered here.
//
//   calls/config enabled=true  -> "Аудиозвонок"/"Видеозвонок" are in the header
//   calls/config enabled=false (or the request fails) -> no call buttons
//   start call -> 409 call_already_active / 503 calls_not_configured -> RU notice
//   microphone permission refused -> RU notice, the server is never asked to ring
//   incoming invite (delivered twice) -> one window, "Отклонить" -> POST /decline
//   accept -> panel -> mute -> hang up -> POST /leave and the room is released
//   caller: callee declines over WS -> panel closes with a message, room released
//   microphone trouble (fake getUserMedia): device fallback, retries, dialog with
//   retry / join without microphone / cancel, device menu in the panel
//   room lifecycle: an ended call releases the LiveKit room even mid-connect, a
//   new call waits for the old room to leave, chunk/connect failure -> one leave

const U1 = process.env.E2E_USERNAME;
const P1 = process.env.E2E_PASSWORD;
const U2 = process.env.E2E_USERNAME2;
const P2 = process.env.E2E_PASSWORD2;

test.skip(!(U1 && P1 && U2 && P2), 'need two users: run with E2E_LOCAL=1 or set E2E_USERNAME2/E2E_PASSWORD2');

// Fake mic/camera so getUserMedia succeeds without a prompt or real devices.
test.use({
  permissions: ['microphone', 'camera'],
  launchOptions: {
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});

const CHAT_WS_PATH = /\/api\/v1\/chat\/ws/;
const MEDIA_PERMISSIONS = ['microphone', 'camera'];

// The tab that submits the password form stops receiving mouse input in the
// test Chromium (even after reload), so the form is submitted in a helper tab
// of the same context and `page` only reuses the session.
async function login(page, username, password) {
  const loginPage = await page.context().newPage();
  await loginPage.goto('/login');
  const form = loginPage.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await loginPage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(loginPage.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
  await loginPage.close();
  await page.goto('/');
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function openDirectConversation(page, peerUsername) {
  const usersResponse = await page.request.get('/api/v1/chat/users');
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json();
  const peer = (users.items || users).find((user) => user.username === peerUsername);
  expect(peer, `peer ${peerUsername} not in chat users`).toBeTruthy();
  const direct = await page.request.post('/api/v1/chat/conversations/direct', {
    data: { peer_user_id: peer.id },
  });
  expect(direct.ok()).toBeTruthy();
  return (await direct.json()).id;
}

const jsonRoute = (route, status, body) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// Replaces navigator.mediaDevices: `sequence` is consumed by plain {audio:true}
// requests (last value repeats), `byDevice` answers exact-deviceId requests.
// An outcome is 'ok' or a DOMException name.
async function installFakeMedia(page, config) {
  await page.addInitScript((cfg) => {
    const state = {
      calls: [],
      opened: 0,
      stopped: 0,
      devices: cfg.devices || [],
      sequence: cfg.sequence || ['ok'],
      seqIndex: 0,
      byDevice: cfg.byDevice || {},
    };
    window.__media = state;
    const fail = (name) => Promise.reject(new DOMException(name, name));
    const makeStream = (deviceId) => {
      state.opened += 1;
      const track = { kind: 'audio', stop() { state.stopped += 1; }, getSettings() { return { deviceId }; } };
      return { getTracks() { return [track]; }, getAudioTracks() { return [track]; }, getVideoTracks() { return []; } };
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia(constraints) {
          const exact = constraints.audio && constraints.audio.deviceId && constraints.audio.deviceId.exact;
          state.calls.push(exact ? `exact:${exact}` : 'default');
          if (exact) {
            const outcome = state.byDevice[exact] || 'NotFoundError';
            return outcome === 'ok' ? Promise.resolve(makeStream(exact)) : fail(outcome);
          }
          const outcome = state.sequence[Math.min(state.seqIndex, state.sequence.length - 1)];
          state.seqIndex += 1;
          return outcome === 'ok' ? Promise.resolve(makeStream('default-id')) : fail(outcome);
        },
        enumerateDevices() {
          return Promise.resolve(state.devices.map((d) => ({ kind: 'audioinput', label: '', ...d })));
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
  }, config);
}

// Pretends to be the HUB-IT Desktop WebView2 host: answers the bridge handshake
// with the microphone-diagnostics capability and replies to media.microphoneDiagnose
// with `diagnosis`. Every message the page posts is kept in window.__desktopHost.posted.
async function installFakeDesktopHost(page, diagnosis) {
  await page.addInitScript((cfg) => {
    const listeners = [];
    const posted = [];
    window.__desktopHost = { posted };
    const emit = (data) => setTimeout(() => listeners.forEach((listener) => listener({ data })), 0);
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
      removeEventListener() {},
      postMessage(message) {
        posted.push(message);
        if (message.type === 'desktop.ready') {
          emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: false }, windowsUsername: null });
          emit({ type: 'desktop.capabilities', version: 1, capabilities: ['desktop-actions', 'microphone-diagnostics'] });
        } else if (message.type === 'media.microphoneDiagnose') {
          emit({
            type: 'media.microphoneDiagnosis',
            version: 1,
            requestId: message.requestId,
            status: 'completed',
            diagnosis: cfg.diagnosis,
          });
        }
      },
    };
  }, { diagnosis });
}

const desktopPosted = (page, type) => page.evaluate(
  (messageType) => window.__desktopHost.posted.filter((message) => message.type === messageType),
  type,
);

const desktopDiagnosis = (reason, overrides = {}) => ({
  reason,
  probe: reason === 'nativeCaptureOk' ? 'ok' : 'deviceInUse',
  probeHresult: reason === 'nativeCaptureOk' ? '0x00000000' : '0x8889000A',
  devices: [{ id: '{0.0.1.00000000}.{a}', name: 'Микрофон (Realtek)', state: 'active' }],
  defaultConsole: { id: '{0.0.1.00000000}.{a}', name: 'Микрофон (Realtek)', state: 'active' },
  defaultCommunications: null,
  consent: { user: 'Allow', userNonPackaged: 'Allow', machine: 'Allow', policy: null },
  apps: [{ name: 'msedgewebview2.exe', user: null, machine: null }],
  site: { microphone: 'default', camera: 'default', repaired: false },
  ...overrides,
});

const mediaState = (page) => page.evaluate(() => ({
  calls: window.__media.calls,
  opened: window.__media.opened,
  stopped: window.__media.stopped,
}));

// Mocks the calls REST surface. `handlers` may override individual routes.
async function mockCallsApi(page, {
  config = { enabled: true },
  configStatus = 200,
  onStart,
  onJoin,
  onDecline,
} = {}) {
  const requests = { start: [], join: [], decline: [], leave: [], live: null };
  // Remembers the call a successful start/join answered with, so that
  // GET .../calls/active (the client's safety-net poll) sees it as running.
  const tracking = (route) => ({
    request: () => route.request(),
    fallback: () => route.fallback(),
    fulfill: (options) => {
      try {
        const body = JSON.parse(options.body);
        if (options.status === 200 && body?.call && body?.token) requests.live = body.call;
      } catch {
        // Not JSON: nothing to remember.
      }
      return route.fulfill(options);
    },
  });
  await page.route('**/api/v1/chat/calls/config', (route) => jsonRoute(route, configStatus, config));
  await page.route('**/api/v1/chat/conversations/*/calls/active', (route) => jsonRoute(route, 200, { call: requests.live }));
  await page.route('**/api/v1/chat/conversations/*/calls', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests.start.push(route.request().postDataJSON());
    return onStart ? onStart(tracking(route)) : jsonRoute(route, 503, { code: 'calls_not_configured' });
  });
  await page.route('**/api/v1/chat/calls/*/join', async (route) => {
    requests.join.push(route.request().url());
    return onJoin ? onJoin(tracking(route)) : jsonRoute(route, 503, { code: 'calls_not_configured' });
  });
  await page.route('**/api/v1/chat/calls/*/leave', async (route) => {
    requests.leave.push(route.request().url());
    requests.live = null;
    const callId = route.request().url().split('/calls/')[1].split('/')[0];
    return jsonRoute(route, 200, { call: { id: callId, status: 'ended', end_reason: 'completed' } });
  });
  await page.route('**/api/v1/chat/calls/*/decline', async (route) => {
    requests.decline.push(route.request().url());
    if (onDecline) return onDecline(route);
    const callId = route.request().url().split('/calls/')[1].split('/')[0];
    return jsonRoute(route, 200, { call: { id: callId, status: 'ended', end_reason: 'declined' } });
  });
  return requests;
}

// Proxies the chat socket to the real backend and exposes the page-side
// socket so the test can inject server frames.
async function interceptChatSocket(page) {
  const box = { ws: null };
  await page.routeWebSocket(CHAT_WS_PATH, (ws) => {
    ws.connectToServer();
    box.ws = ws;
  });
  return box;
}

const buildCall = (overrides = {}) => ({
  id: 'e2e-call-1',
  conversation_id: 'e2e-conversation',
  media: 'audio',
  status: 'ringing',
  initiator_user_id: '999001',
  started_at: new Date().toISOString(),
  answered_at: null,
  ended_at: null,
  end_reason: null,
  participants: [
    { user_id: '999001', display_name: 'Звонящий Коллега', state: 'joined' },
  ],
  ...overrides,
});

// Minimal stand-in for livekit-client: enough surface for livekitSession.js.
// The dev server serves the pre-bundled dependency as
// /node_modules/.vite/deps/livekit-client.js, which is replaced wholesale
// (so this stub works against `vite dev`, not against a built bundle).
const LIVEKIT_STUB = `
export const RoomEvent = new Proxy({}, { get: (_, key) => String(key) });
export const Track = {
  Kind: { Audio: 'audio', Video: 'video' },
  Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
};
export const ConnectionState = {
  Connected: 'connected', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting',
  Disconnected: 'disconnected', Connecting: 'connecting',
};
export const DisconnectReason = { DUPLICATE_IDENTITY: 4, 4: 'DUPLICATE_IDENTITY' };
export class Room {
  constructor() {
    this.handlers = {};
    this.state = 'disconnected';
    this.canPlaybackAudio = true;
    this.remoteParticipants = new Map();
    this.localParticipant = {
      identity: 'local', name: '', isSpeaking: false,
      isMicrophoneEnabled: false, isCameraEnabled: false, isScreenShareEnabled: false,
      getTrackPublication: () => null,
      async setMicrophoneEnabled(v, opts) {
        // __lkConfig.hangMic: getUserMedia/publish never settles (seen on production).
        if (v && (window.__lkConfig || {}).hangMic) return new Promise(() => {});
        this.isMicrophoneEnabled = v;
        window.__lk.calls.push(['mic', v]);
        if (v) window.__lk.micOpts.push(opts || null);
      },
      async setCameraEnabled(v) { this.isCameraEnabled = v; window.__lk.calls.push(['camera', v]); },
      async setScreenShareEnabled(v) { this.isScreenShareEnabled = v; window.__lk.calls.push(['screen', v]); },
    };
    this.active = {};
    window.__lk = window.__lk || { calls: [], micOpts: [], rooms: [] };
    window.__lk.rooms.push(this);
    window.__lk.emit = (event) => window.__lk.rooms.forEach((room) => (room.handlers[event] || []).forEach((fn) => fn()));
  }
  static async getLocalDevices(kind) {
    return ((window.__media && window.__media.devices) || []).filter((d) => (d.kind || 'audioinput') === kind);
  }
  getActiveDevice(kind) { return this.active[kind]; }
  async switchActiveDevice(kind, id) {
    this.active[kind] = id;
    window.__lk.calls.push(['switch', kind + ':' + id]);
    return true;
  }
  on(event, fn) { (this.handlers[event] ||= []).push(fn); return this; }
  async connect(url, token) {
    window.__lk.calls.push(['connect', url, token]);
    if ((window.__lkConfig || {}).failConnect) {
      const error = new Error('could not establish signal connection');
      error.name = 'ConnectionError';
      error.reason = 1;
      throw error;
    }
    this.state = 'connected';
    window.__lk.open = (window.__lk.open || 0) + 1;
    window.__lk.maxOpen = Math.max(window.__lk.maxOpen || 0, window.__lk.open);
    this.remoteParticipants.set('999001', {
      identity: '999001', name: 'Звонящий Коллега', isSpeaking: true,
      getTrackPublication: (source) => (source === 'microphone' ? { isMuted: false } : null),
    });
  }
  async disconnect() {
    if (this.state === 'disconnected') return;
    window.__lk.calls.push(['disconnect:start']);
    const delay = (window.__lkConfig || {}).disconnectDelayMs || 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.state = 'disconnected';
    window.__lk.open -= 1;
    window.__lk.calls.push(['disconnect']);
  }
  async startAudio() {}
}
`;

async function configureLiveKitStub(page, config) {
  await page.addInitScript((cfg) => { window.__lkConfig = cfg; }, config);
}

async function stubLiveKit(page) {
  await page.route('**/node_modules/.vite/deps/livekit-client.js*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: LIVEKIT_STUB,
  }));
}

const lkCalls = (page) => page.evaluate(
  () => (window.__lk?.calls || []).map((entry) => (entry[1] === undefined ? entry[0] : `${entry[0]}:${entry[1]}`)),
);

test.describe('call buttons', () => {
  let context;
  let page;
  let conversationId;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
    page = await context.newPage();
    await login(page, U1, P1);
    conversationId = await openDirectConversation(page, U2);
    // Pre-dismiss the mail session prompt so it doesn't block role queries in tests
    await page.evaluate(() => {
      const user = JSON.parse(window.localStorage?.getItem('user') || '{}');
      const login = String(user?.username || '').trim().toLowerCase();
      if (login) {
        const choicesMap = { [login]: 'disabled' };
        window.localStorage?.setItem('hubit.mail.device-choice', JSON.stringify(choicesMap));
        // Dispatch the event so MailSessionPrompt picks up the change immediately
        window.dispatchEvent(new Event('hubit:mail-session-changed'));
      }
    });
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('are shown in the conversation header when calls are enabled', async () => {
    await mockCallsApi(page, { config: { enabled: true } });
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByTestId('chat-composer-textarea').waitFor();
    await expect(page.getByRole('button', { name: 'Аудиозвонок' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Видеозвонок' })).toBeVisible();
  });

  test('are hidden when calls are disabled', async () => {
    await mockCallsApi(page, { config: { enabled: false } });
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByTestId('chat-composer-textarea').waitFor();
    await expect(page.getByRole('button', { name: 'Действия чата' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Аудиозвонок' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Видеозвонок' })).toHaveCount(0);
  });

  test('are hidden and the chat keeps working when the config request fails', async () => {
    await mockCallsApi(page, { configStatus: 500, config: { detail: 'boom' } });
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByTestId('chat-composer-textarea').waitFor();
    await expect(page.getByRole('button', { name: 'Действия чата' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Аудиозвонок' })).toHaveCount(0);
  });

  test('server refusal 503 is explained to the user', async () => {
    const requests = await mockCallsApi(page, {
      onStart: (route) => jsonRoute(route, 503, { code: 'calls_not_configured' }),
    });
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByRole('button', { name: 'Аудиозвонок' }).click();
    await expect(page.getByTestId('chat-call-notice')).toContainText('Звонки пока не настроены');
    await expect(page.getByTestId('chat-call-panel')).toHaveCount(0);
    expect(requests.start).toEqual([{ media: 'audio' }]);
  });

  test('409 call_already_active offers to join the running call', async () => {
    const requests = await mockCallsApi(page, {
      onStart: (route) => jsonRoute(route, 409, {
        code: 'call_already_active',
        call: buildCall({ conversation_id: conversationId, status: 'active' }),
      }),
    });
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByRole('button', { name: 'Видеозвонок' }).click();
    await expect(page.getByTestId('chat-call-notice')).toContainText('уже идёт звонок');
    await expect(page.getByTestId('chat-call-notice-join')).toBeVisible();
    await expect(page.getByTestId('chat-call-panel')).toHaveCount(0);
    expect(requests.start).toEqual([{ media: 'video' }]);
  });

  test('a refused microphone permission explains how to allow it and never reaches the server', async () => {
    await installFakeMedia(page, { devices: [], sequence: ['NotAllowedError'] });
    const requests = await mockCallsApi(page);
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByRole('button', { name: 'Аудиозвонок' }).click();
    const dialog = page.getByTestId('chat-call-mic-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('chat-call-mic-text')).toContainText('Нет доступа к микрофону');
    await expect(page.getByTestId('chat-call-mic-text')).toContainText('значок замка');
    await expect(page.getByTestId('chat-call-mic-text')).toContainText('Параметры Windows');
    await expect(page.getByTestId('chat-call-mic-detail')).toContainText('NotAllowedError');
    await expect(page.getByTestId('chat-call-mic-retry')).toBeVisible();
    await expect(page.getByTestId('chat-call-mic-skip')).toHaveCount(0);
    // A refusal is final for this attempt: no device brute force.
    expect((await mediaState(page)).calls).toEqual(['default']);
    await page.getByTestId('chat-call-mic-cancel').click();
    await expect(dialog).toBeHidden();
    expect(requests.start).toHaveLength(0);
  });
});

test.describe('incoming call', () => {
  async function openIncomingScenario(browser, viewport, apiOverrides = {}, prepare = null) {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext({ permissions: MEDIA_PERMISSIONS, viewport });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);
    const conversationId = await openDirectConversation(pageA, U2);
    const selfUserId = await pageB.evaluate(() => String(JSON.parse(localStorage.getItem('user') || '{}').id || ''));
    expect(selfUserId).not.toBe('');
    const requests = await mockCallsApi(pageB, apiOverrides);
    if (prepare) await prepare(pageB);
    const socket = await interceptChatSocket(pageB);
    await pageB.goto('/chat');
    await expect.poll(() => Boolean(socket.ws), { message: 'chat websocket was not opened' }).toBe(true);
    // Let the bootstrap socket settle (snapshot) before pushing call frames.
    await pageB.getByTestId('chat-sidebar-list-scroll').waitFor();
    const call = buildCall({
      conversation_id: conversationId,
      participants: [
        { user_id: '999001', display_name: 'Звонящий Коллега', state: 'joined' },
        { user_id: selfUserId, display_name: 'Я', state: 'invited' },
      ],
    });
    const sendInvite = () => socket.ws.send(JSON.stringify({
      type: 'chat.call.invite',
      conversation_id: conversationId,
      payload: { call, initiator: { user_id: '999001', display_name: 'Звонящий Коллега' } },
    }));
    const sendUpdate = (next) => socket.ws.send(JSON.stringify({
      type: 'chat.call.updated',
      conversation_id: conversationId,
      payload: { call: { ...call, ...next } },
    }));
    return { contextA, contextB, pageB, requests, call, sendInvite, sendUpdate };
  }

  test('decline closes the window, calls /decline once and a replayed invite does not reopen it', async ({ browser }) => {
    const { contextA, contextB, pageB, requests, call, sendInvite } = await openIncomingScenario(browser);
    try {
      sendInvite();
      const dialog = pageB.getByTestId('chat-call-incoming-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Звонящий Коллега');
      await expect(dialog).toContainText('Входящий аудиозвонок');

      // Reconnect/replay of the same invite must not stack a second window.
      sendInvite();
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toHaveCount(1);

      await pageB.getByTestId('chat-call-decline').click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => requests.decline.length).toBe(1);
      expect(requests.decline[0]).toContain(`/chat/calls/${call.id}/decline`);

      // Replay after the decision: still closed.
      sendInvite();
      await pageB.waitForTimeout(500);
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toHaveCount(0);
      expect(requests.decline).toHaveLength(1);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('the window closes by itself when the caller gives up', async ({ browser }) => {
    const { contextA, contextB, pageB, sendInvite, sendUpdate } = await openIncomingScenario(browser);
    try {
      sendInvite();
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toBeVisible();
      sendUpdate({ status: 'ended', end_reason: 'cancelled', ended_at: new Date().toISOString() });
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toBeHidden();
      await expect(pageB.getByTestId('chat-call-notice')).toContainText('Пропущенный звонок');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  const joinOfEndedCall = {
    // What the real backend answers.
    'HTTP 409 call_ended': (route, call) => jsonRoute(route, 409, {
      code: 'call_ended',
      detail: 'The call has ended',
      call: { ...call, status: 'ended', end_reason: 'cancelled' },
    }),
    // Still supported for other deployments/proxies.
    'HTTP 410': (route) => jsonRoute(route, 410, { detail: 'call_already_ended' }),
  };

  for (const [label, answer] of Object.entries(joinOfEndedCall)) {
    test(`accepting a call that is already over (${label}) explains it and closes the window`, async ({ browser }) => {
      await acceptEndedCall(browser, answer);
    });
  }

  async function acceptEndedCall(browser, answer) {
    let callRef = null;
    const { contextA, contextB, pageB, requests, call, sendInvite } = await openIncomingScenario(browser, undefined, {
      onJoin: (route) => answer(route, callRef),
    });
    callRef = call;
    try {
      sendInvite();
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toBeVisible();
      await pageB.getByTestId('chat-call-accept-audio').click();
      await expect(pageB.getByTestId('chat-call-notice')).toContainText('Звонок уже завершён');
      await expect.poll(() => requests.join.length).toBe(1);
      expect(requests.join[0]).toContain(`/chat/calls/${call.id}/join`);
      await expect(pageB.getByTestId('chat-call-panel')).toHaveCount(0);
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  }

  test('callee without a working microphone can still answer listen-only', async ({ browser }) => {
    let joined = null;
    const { contextA, contextB, pageB, requests, call, sendInvite } = await openIncomingScenario(
      browser,
      undefined,
      {
        onJoin: (route) => jsonRoute(route, 200, {
          call: { ...joined, status: 'active', answered_at: new Date().toISOString() },
          token: 'stub-token',
          url: 'wss://livekit.invalid',
        }),
      },
      async (page) => {
        await stubLiveKit(page);
        await installFakeMedia(page, { devices: [], sequence: ['NotReadableError'] });
      },
    );
    joined = call;
    try {
      sendInvite();
      await pageB.getByTestId('chat-call-accept-audio').click();
      const dialog = pageB.getByTestId('chat-call-mic-dialog');
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(pageB.getByTestId('chat-call-mic-detail')).toContainText('NotReadableError');
      // The incoming window is still there under the dialog; nothing was sent yet.
      expect(requests.join).toHaveLength(0);
      await pageB.getByTestId('chat-call-mic-skip').click();
      await expect(pageB.getByTestId('chat-call-panel')).toBeVisible();
      await expect(pageB.getByTestId('chat-call-no-mic')).toBeVisible();
      expect(requests.join).toHaveLength(1);
      expect(requests.join[0]).toContain(`/chat/calls/${call.id}/join`);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('fits a phone screen and keeps all three actions reachable', async ({ browser }) => {
    const viewport = { width: 375, height: 740 };
    const { contextA, contextB, pageB, sendInvite } = await openIncomingScenario(browser, viewport);
    try {
      sendInvite();
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toBeVisible();
      for (const testId of ['chat-call-accept-audio', 'chat-call-accept-video', 'chat-call-decline']) {
        const box = await pageB.getByTestId(testId).boundingBox();
        expect(box, testId).toBeTruthy();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

test.describe('call session with stubbed LiveKit', () => {
  const joinedCall = (conversationId, selfUserId) => buildCall({
    conversation_id: conversationId,
    status: 'active',
    answered_at: new Date().toISOString(),
    participants: [
      { user_id: '999001', display_name: 'Звонящий Коллега', state: 'joined' },
      { user_id: selfUserId, display_name: 'Я', state: 'joined' },
    ],
  });
  const readSelfUserId = (page) => page.evaluate(
    () => String(JSON.parse(localStorage.getItem('user') || '{}').id || ''),
  );

  test('accept opens the panel, mute reaches the room, hang up leaves the call and frees the room', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    try {
      await login(pageA, U1, P1);
      await login(pageB, U2, P2);
      const conversationId = await openDirectConversation(pageA, U2);
      const selfUserId = await readSelfUserId(pageB);
      const requests = await mockCallsApi(pageB, {
        onJoin: (route) => jsonRoute(route, 200, {
          call: joinedCall(conversationId, selfUserId),
          token: 'stub-token',
          url: 'wss://livekit.invalid',
        }),
      });
      await stubLiveKit(pageB);
      const socket = await interceptChatSocket(pageB);
      await pageB.goto('/chat');
      await expect.poll(() => Boolean(socket.ws), { message: 'chat websocket was not opened' }).toBe(true);
      await pageB.getByTestId('chat-sidebar-list-scroll').waitFor();

      socket.ws.send(JSON.stringify({
        type: 'chat.call.invite',
        conversation_id: conversationId,
        payload: {
          call: buildCall({
            conversation_id: conversationId,
            participants: [
              { user_id: '999001', display_name: 'Звонящий Коллега', state: 'joined' },
              { user_id: selfUserId, display_name: 'Я', state: 'invited' },
            ],
          }),
          initiator: { user_id: '999001', display_name: 'Звонящий Коллега' },
        },
      }));
      await pageB.getByTestId('chat-call-accept-audio').click();

      const panel = pageB.getByTestId('chat-call-panel');
      await expect(panel).toBeVisible();
      await expect(pageB.getByTestId('chat-call-incoming-dialog')).toHaveCount(0);
      await expect(pageB.getByTestId('chat-call-tile-remote')).toContainText('Звонящий Коллега');
      await expect(pageB.getByTestId('chat-call-tile-local')).toContainText('Вы');
      await expect(pageB.getByTestId('chat-call-status')).toHaveText(/^\d{2}:\d{2}$/);
      expect(await lkCalls(pageB)).toEqual(expect.arrayContaining(['connect:wss://livekit.invalid', 'mic:true']));
      expect(requests.join).toHaveLength(1);

      await pageB.getByTestId('chat-call-toggle-mic').click();
      await expect.poll(() => lkCalls(pageB)).toContain('mic:false');

      await pageB.getByTestId('chat-call-end').click();
      await expect(panel).toBeHidden();
      await expect.poll(() => requests.leave.length).toBe(1);
      expect(requests.leave[0]).toContain('/chat/calls/e2e-call-1/leave');
      await expect.poll(() => lkCalls(pageB)).toContain('disconnect');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('caller: the callee declining ends the session with a message and frees the room', async ({ browser }) => {
    const context = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
    const page = await context.newPage();
    try {
      await login(page, U1, P1);
      const conversationId = await openDirectConversation(page, U2);
      const selfUserId = await readSelfUserId(page);
      const ringing = buildCall({
        conversation_id: conversationId,
        initiator_user_id: selfUserId,
        participants: [
          { user_id: selfUserId, display_name: 'Я', state: 'joined' },
          { user_id: '999002', display_name: 'Собеседник', state: 'invited' },
        ],
      });
      const requests = await mockCallsApi(page, {
        onStart: (route) => jsonRoute(route, 200, { call: ringing, token: 'stub-token', url: 'wss://livekit.invalid' }),
      });
      await stubLiveKit(page);
      const socket = await interceptChatSocket(page);
      await page.goto(`/chat?conversation=${conversationId}`);
      await expect.poll(() => Boolean(socket.ws), { message: 'chat websocket was not opened' }).toBe(true);

      await page.getByRole('button', { name: 'Видеозвонок' }).click();
      await expect(page.getByTestId('chat-call-panel')).toBeVisible();
      await expect(page.getByTestId('chat-call-status')).toHaveText('Вызываем…');
      await expect(page.getByTestId('chat-call-tile-pending')).toContainText('Собеседник');
      expect(requests.start).toEqual([{ media: 'video' }]);
      await expect.poll(() => lkCalls(page)).toContain('camera:true');
      // While a call is running a second one cannot be started.
      const blocked = page.getByRole('button', { name: 'Звонок уже идёт' });
      await expect(blocked).toHaveCount(2);
      await expect(blocked.first()).toBeDisabled();

      socket.ws.send(JSON.stringify({
        type: 'chat.call.updated',
        conversation_id: conversationId,
        payload: { call: { ...ringing, status: 'ended', end_reason: 'declined', ended_at: new Date().toISOString() } },
      }));
      await expect(page.getByTestId('chat-call-panel')).toBeHidden();
      await expect(page.getByTestId('chat-call-notice')).toContainText('отклонил');
      await expect.poll(() => lkCalls(page)).toContain('disconnect');
      // The server already closed the call: the client must not "leave" it again.
      expect(requests.leave).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('caller: nobody answers within the dial timeout -> the client leaves the call itself', async ({ browser }) => {
    const context = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
    const page = await context.newPage();
    try {
      await login(page, U1, P1);
      const conversationId = await openDirectConversation(page, U2);
      const selfUserId = await readSelfUserId(page);
      const ringing = buildCall({
        conversation_id: conversationId,
        initiator_user_id: selfUserId,
        participants: [
          { user_id: selfUserId, display_name: 'Я', state: 'joined' },
          { user_id: '999002', display_name: 'Собеседник', state: 'invited' },
        ],
      });
      const requests = await mockCallsApi(page, {
        onStart: (route) => jsonRoute(route, 200, { call: ringing, token: 'stub-token', url: 'wss://livekit.invalid' }),
      });
      await stubLiveKit(page);
      await page.clock.install();
      await page.goto(`/chat?conversation=${conversationId}`);

      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-status')).toHaveText('Вызываем…');
      expect(requests.leave).toHaveLength(0);

      await page.clock.fastForward(46_000);
      await expect(page.getByTestId('chat-call-panel')).toBeHidden();
      await expect(page.getByTestId('chat-call-notice')).toContainText('Нет ответа');
      await expect.poll(() => requests.leave.length).toBe(1);
      await expect.poll(() => lkCalls(page)).toContain('disconnect');
    } finally {
      await context.close();
    }
  });
});

test.describe('microphone problems and devices', () => {
  const PANEL = 'chat-call-panel';
  const readSelfUserId = (page) => page.evaluate(
    () => String(JSON.parse(localStorage.getItem('user') || '{}').id || ''),
  );

  // Caller page with stubbed LiveKit and a fake microphone, ready to press "Аудиозвонок".
  async function setupCaller(browser, media, { desktopDiagnosis: diagnosis } = {}) {
    const context = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
    const page = await context.newPage();
    await login(page, U1, P1);
    const conversationId = await openDirectConversation(page, U2);
    const selfUserId = await readSelfUserId(page);
    const ringing = buildCall({
      conversation_id: conversationId,
      initiator_user_id: selfUserId,
      participants: [
        { user_id: selfUserId, display_name: 'Я', state: 'joined' },
        { user_id: '999002', display_name: 'Собеседник', state: 'invited' },
      ],
    });
    const requests = await mockCallsApi(page, {
      onStart: (route) => jsonRoute(route, 200, { call: ringing, token: 'stub-token', url: 'wss://livekit.invalid' }),
    });
    await stubLiveKit(page);
    await installFakeMedia(page, media);
    if (diagnosis) await installFakeDesktopHost(page, diagnosis);
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.getByTestId('chat-composer-textarea').waitFor();
    // Desktop shell asks once whether to enable mail in this window; the modal
    // hides the page from role queries until it is answered.
    if (diagnosis) await page.getByRole('button', { name: 'Не включать' }).click();
    return { context, page, requests, conversationId };
  }

  test('a dead default microphone falls back to the first working device and the call starts on it', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, {
      devices: [{ deviceId: 'd1', label: 'Broken' }, { deviceId: 'd2', label: 'Headset' }],
      sequence: ['NotFoundError'],
      byDevice: { d1: 'NotFoundError', d2: 'ok' },
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId(PANEL)).toBeVisible();
      await expect(page.getByTestId('chat-call-mic-dialog')).toHaveCount(0);
      expect(requests.start).toHaveLength(1);
      const media = await mediaState(page);
      expect(media.calls).toEqual(['default', 'exact:d1', 'exact:d2']);
      // Every probe stream was released, and the room opened the probed device.
      expect(media.stopped).toBe(media.opened);
      expect(await page.evaluate(() => window.__lk.micOpts)).toEqual([{ deviceId: 'd2' }]);
    } finally {
      await context.close();
    }
  });

  test('a device that is still being released is retried and the call starts', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, {
      devices: [{ deviceId: 'd1', label: 'Bluetooth headset' }],
      sequence: ['NotReadableError', 'NotReadableError', 'ok'],
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId(PANEL)).toBeVisible();
      await expect(page.getByTestId('chat-call-mic-dialog')).toHaveCount(0);
      expect(requests.start).toHaveLength(1);
      expect((await mediaState(page)).calls).toEqual(['default', 'default', 'default']);
    } finally {
      await context.close();
    }
  });

  test('no microphone: retry keeps asking, "Войти без микрофона" joins listen-only and the mic can be attached later', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, { devices: [], sequence: ['NotFoundError'] });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      const dialog = page.getByTestId('chat-call-mic-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('Микрофон не найден');
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('Наушники без микрофона не подходят');
      await expect(page.getByTestId('chat-call-mic-detail')).toContainText('Код: NotFoundError');
      await expect(page.getByTestId('chat-call-mic-detail')).toContainText('Найдено устройств ввода: 0');
      expect(requests.start).toHaveLength(0);

      // Retry while the device is still missing: the dialog comes back.
      const before = (await mediaState(page)).calls.length;
      await page.getByTestId('chat-call-mic-retry').click();
      await expect.poll(async () => (await mediaState(page)).calls.length).toBeGreaterThan(before);
      await expect(dialog).toBeVisible();
      expect(requests.start).toHaveLength(0);

      await page.getByTestId('chat-call-mic-skip').click();
      await expect(page.getByTestId(PANEL)).toBeVisible();
      expect(requests.start).toHaveLength(1);
      await expect(page.getByTestId('chat-call-no-mic')).toBeVisible();
      const micButton = page.getByTestId('chat-call-toggle-mic');
      await expect(micButton).toHaveAttribute('aria-label', 'Нет микрофона. Нажмите, чтобы подключить');
      expect(await lkCalls(page)).not.toContain('mic:true');

      // Plug a microphone in and press the button: it attaches without redialing.
      await page.evaluate(() => {
        window.__media.sequence = ['ok'];
        window.__media.seqIndex = 0;
      });
      await micButton.click();
      await expect(micButton).toHaveAttribute('aria-label', 'Выключить микрофон');
      await expect(page.getByTestId('chat-call-no-mic')).toHaveCount(0);
      await expect.poll(() => lkCalls(page)).toContain('mic:true');
      expect(requests.start).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test('cancel in the microphone dialog sends nothing to the server', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, {
      devices: [],
      sequence: ['NotReadableError'],
    });
    try {
      await page.getByRole('button', { name: 'Видеозвонок' }).click();
      const dialog = page.getByTestId('chat-call-mic-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('занят или заблокирован системой');
      await expect(page.getByTestId('chat-call-mic-detail')).toContainText('NotReadableError');
      await page.getByTestId('chat-call-mic-cancel').click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId(PANEL)).toHaveCount(0);
      expect(requests.start).toHaveLength(0);
      expect(await lkCalls(page)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('device menu: lists inputs, follows hot-plug, switches the device and remembers the choice', async ({ browser }) => {
    const { context, page } = await setupCaller(browser, {
      devices: [{ deviceId: 'd1', label: 'Laptop mic' }, { deviceId: 'd2', label: 'USB headset' }],
      sequence: ['ok'],
      byDevice: { d1: 'ok', d2: 'ok', d3: 'ok' },
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId(PANEL)).toBeVisible();

      await page.getByTestId('chat-call-mic-device-menu').click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Laptop mic' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'USB headset' })).toBeVisible();

      // A headset plugged in while the menu is open shows up without reopening.
      await page.evaluate(() => {
        window.__media.devices.push({ deviceId: 'd3', label: 'Bluetooth buds' });
        window.__lk.emit('MediaDevicesChanged');
      });
      await expect(menu.getByRole('menuitem', { name: 'Bluetooth buds' })).toBeVisible();

      await menu.getByRole('menuitem', { name: 'USB headset' }).click();
      await expect.poll(() => lkCalls(page)).toContain('switch:audioinput:d2');
      expect(await page.evaluate(() => localStorage.getItem('hubit_chat_call_device_audioinput'))).toBe('d2');

      // The next call starts on the remembered device first.
      await page.reload();
      await page.getByTestId('chat-composer-textarea').waitFor();
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId(PANEL)).toBeVisible();
      expect((await mediaState(page)).calls[0]).toBe('exact:d2');
      expect(await page.evaluate(() => window.__lk.micOpts)).toEqual([{ deviceId: 'd2' }]);
    } finally {
      await context.close();
    }
  });

  const BUSY_EVERYWHERE = {
    devices: [{ deviceId: 'd1', label: 'Mic 1' }, { deviceId: 'd2', label: 'Mic 2' }, { deviceId: 'd3', label: 'Mic 3' }],
    sequence: ['NotReadableError'],
    byDevice: { d1: 'NotReadableError', d2: 'NotReadableError', d3: 'NotReadableError' },
  };

  test('HUB-IT Desktop: exclusive mode is named, sound settings open and the call goes on without a microphone', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, BUSY_EVERYWHERE, {
      desktopDiagnosis: desktopDiagnosis('exclusiveInUse'),
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      const dialog = page.getByTestId('chat-call-mic-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('HUB-IT нужен доступ к микрофону')).toBeVisible();
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('занят в монопольном режиме');
      await expect(page.getByTestId('chat-call-mic-detail')).toContainText('Микрофон (Realtek)');
      await expect(page.getByTestId('chat-call-mic-detail')).toContainText('0x8889000A');
      await expect(page.getByTestId('chat-call-mic-open-privacy')).toHaveCount(0);
      expect(await desktopPosted(page, 'media.microphoneDiagnose')).toHaveLength(1);
      expect(requests.start).toHaveLength(0);

      await page.getByTestId('chat-call-mic-open-sound').click();
      await expect.poll(() => desktopPosted(page, 'media.openSettings'))
        .toEqual([{ type: 'media.openSettings', version: 1, kind: 'sound' }]);
      await expect(dialog).toBeVisible();

      await page.getByTestId('chat-call-mic-skip').click();
      await expect(page.getByTestId(PANEL)).toBeVisible();
      expect(requests.start).toHaveLength(1);
      await expect(page.getByTestId('chat-call-no-mic')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('HUB-IT Desktop: Windows opens the microphone natively -> WebView2 / security software is named', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, BUSY_EVERYWHERE, {
      desktopDiagnosis: desktopDiagnosis('nativeCaptureOk'),
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('msedgewebview2.exe');
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('антивирус');
      await page.getByTestId('chat-call-mic-cancel').click();
      await expect(page.getByTestId('chat-call-mic-dialog')).toBeHidden();
      expect(requests.start).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('HUB-IT Desktop: per-app Windows refusal offers privacy settings and retry recovers', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, BUSY_EVERYWHERE, {
      desktopDiagnosis: desktopDiagnosis('appConsentDenied', {
        apps: [{ name: 'msedgewebview2.exe', user: 'Deny', machine: null }],
      }),
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-mic-text')).toContainText('Windows запретил HUB-IT доступ к микрофону');
      await page.getByTestId('chat-call-mic-open-privacy').click();
      await expect.poll(() => desktopPosted(page, 'media.openSettings'))
        .toEqual([{ type: 'media.openSettings', version: 1, kind: 'privacy-microphone' }]);

      // The user allowed the microphone in Windows: "Повторить" now starts the call.
      await page.evaluate(() => {
        window.__media.sequence = ['ok'];
        window.__media.seqIndex = 0;
      });
      await page.getByTestId('chat-call-mic-retry').click();
      await expect(page.getByTestId(PANEL)).toBeVisible();
      expect(requests.start).toHaveLength(1);
      await expect(page.getByTestId('chat-call-no-mic')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe('LiveKit room lifecycle', () => {
  const readSelfUserId = (page) => page.evaluate(
    () => String(JSON.parse(localStorage.getItem('user') || '{}').id || ''),
  );

  async function setupCaller(browser, { stub = true, lkConfig = {} } = {}) {
    const context = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
    const page = await context.newPage();
    await login(page, U1, P1);
    const conversationId = await openDirectConversation(page, U2);
    const selfUserId = await readSelfUserId(page);
    const ringing = buildCall({
      id: 'e2e-call-a',
      conversation_id: conversationId,
      initiator_user_id: selfUserId,
      participants: [
        { user_id: selfUserId, display_name: 'Я', state: 'joined' },
        { user_id: '999002', display_name: 'Собеседник', state: 'invited' },
      ],
    });
    const requests = await mockCallsApi(page, {
      onStart: (route) => jsonRoute(route, 200, { call: ringing, token: 'stub-token', url: 'wss://livekit.invalid' }),
      onJoin: (route) => jsonRoute(route, 200, {
        call: buildCall({
          id: 'e2e-call-b',
          conversation_id: conversationId,
          status: 'active',
          answered_at: new Date().toISOString(),
          participants: [
            { user_id: '999001', display_name: 'Звонящий Коллега', state: 'joined' },
            { user_id: selfUserId, display_name: 'Я', state: 'joined' },
          ],
        }),
        token: 'stub-token-b',
        url: 'wss://livekit-b.invalid',
      }),
    });
    if (stub) {
      await configureLiveKitStub(page, lkConfig);
      await stubLiveKit(page);
    }
    const socket = await interceptChatSocket(page);
    await page.goto(`/chat?conversation=${conversationId}`);
    await expect.poll(() => Boolean(socket.ws), { message: 'chat websocket was not opened' }).toBe(true);
    await page.getByTestId('chat-composer-textarea').waitFor();
    const sendFrame = (type, payload) => socket.ws.send(JSON.stringify({ type, conversation_id: conversationId, payload }));
    return { context, page, requests, conversationId, selfUserId, ringing, sendFrame };
  }

  test('an ended call (missed) releases the room even while the microphone is still opening', async ({ browser }) => {
    const { context, page, requests, ringing, sendFrame } = await setupCaller(browser, { lkConfig: { hangMic: true } });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-panel')).toBeVisible();
      await expect.poll(() => lkCalls(page)).toContain('connect:wss://livekit.invalid');
      // The local track never finishes publishing (hung device): the session is half-built.
      expect(await lkCalls(page)).not.toContain('mic:true');

      sendFrame('chat.call.updated', {
        call: { ...ringing, status: 'ended', end_reason: 'missed', ended_at: new Date().toISOString() },
      });
      await expect(page.getByTestId('chat-call-panel')).toBeHidden();
      await expect.poll(() => lkCalls(page)).toContain('disconnect');
      expect(await page.evaluate(() => window.__lk.open)).toBe(0);
      // The server already ended it: no extra leave.
      expect(requests.leave).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('accepting a new call first waits until the previous room has left', async ({ browser }) => {
    const { context, page, requests, ringing, selfUserId, conversationId, sendFrame } = await setupCaller(browser, {
      lkConfig: { disconnectDelayMs: 1500 },
    });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-status')).toHaveText('Вызываем…');

      // Call A is over on the server, and right away call B rings in.
      sendFrame('chat.call.updated', {
        call: { ...ringing, status: 'ended', end_reason: 'missed', ended_at: new Date().toISOString() },
      });
      sendFrame('chat.call.invite', {
        call: buildCall({
          id: 'e2e-call-b',
          conversation_id: conversationId,
          participants: [
            { user_id: '999001', display_name: 'Звонящий Коллега', state: 'joined' },
            { user_id: selfUserId, display_name: 'Я', state: 'invited' },
          ],
        }),
        initiator: { user_id: '999001', display_name: 'Звонящий Коллега' },
      });
      await page.getByTestId('chat-call-accept-audio').click();
      await expect(page.getByTestId('chat-call-panel')).toBeVisible();
      await expect.poll(() => lkCalls(page)).toContain('connect:wss://livekit-b.invalid');

      const calls = await lkCalls(page);
      const oldLeft = calls.indexOf('disconnect');
      const newConnect = calls.indexOf('connect:wss://livekit-b.invalid');
      expect(oldLeft, calls.join(', ')).toBeGreaterThan(-1);
      expect(oldLeft, calls.join(', ')).toBeLessThan(newConnect);
      // Never two rooms at the same time.
      expect(await page.evaluate(() => window.__lk.maxOpen)).toBe(1);
      expect(requests.join).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test('livekit-client chunk that fails to load: "new version" message with reload, one leave', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, { stub: false });
    try {
      // Stale SPA after a redeploy: the hashed SDK chunk is gone.
      await page.route('**/node_modules/.vite/deps/livekit-client.js*', (route) => route.fulfill({ status: 404, body: '' }));
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-error')).toContainText('Доступна новая версия портала');
      await expect(page.getByTestId('chat-call-error-detail')).toContainText('Код: import:chunk_load');
      await expect(page.getByTestId('chat-call-reload')).toBeVisible();
      await expect.poll(() => requests.leave.length).toBe(1);
      expect(requests.leave[0]).toContain('/chat/calls/e2e-call-a/leave');

      await page.getByTestId('chat-call-end').click();
      await expect(page.getByTestId('chat-call-panel')).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(requests.leave).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test('room.connect failure: error with code, one leave, no hanging session', async ({ browser }) => {
    const { context, page, requests } = await setupCaller(browser, { lkConfig: { failConnect: true } });
    try {
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(page.getByTestId('chat-call-error')).toContainText('Не удалось подключиться к серверу звонков');
      await expect(page.getByTestId('chat-call-error-detail')).toContainText('Код: connect:ConnectionError:1');
      await expect(page.getByTestId('chat-call-reload')).toHaveCount(0);
      await expect.poll(() => requests.leave.length).toBe(1);
      expect(await page.evaluate(() => window.__lk.open || 0)).toBe(0);
      await page.getByTestId('chat-call-end').click();
      await expect(page.getByTestId('chat-call-panel')).toHaveCount(0);
      expect(requests.leave).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
});
