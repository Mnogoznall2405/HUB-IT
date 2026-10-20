import { test, expect } from '@playwright/test';

// Layout of the active call window (expanded / floating / spotlight / fullscreen,
// self PiP, dragging) on the local stack (E2E_LOCAL=1). Same LiveKit stub and
// REST mocks as chat-calls.spec.js, copied rather than imported: importing that
// file would register its tests here too. Only one user is needed: the caller
// rings a peer, and the stub room adds the remote participant on connect.
// Remote tracks (screen share) and local camera are simulated on the stub room.

const U1 = process.env.E2E_USERNAME;
const P1 = process.env.E2E_PASSWORD;
const U2 = process.env.E2E_USERNAME2;

test.skip(!(U1 && P1 && U2), 'need two users: run with E2E_LOCAL=1 or set E2E_USERNAME2');

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

const MEDIA_PERMISSIONS = ['microphone', 'camera'];
const REMOTE_NAME = 'Звонящий Коллега';

async function login(page, username, password) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
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

const buildCall = (overrides = {}) => ({
  id: 'e2e-call-layout',
  conversation_id: 'e2e-conversation',
  media: 'audio',
  status: 'ringing',
  initiator_user_id: '999001',
  started_at: new Date().toISOString(),
  answered_at: null,
  ended_at: null,
  end_reason: null,
  participants: [
    { user_id: '999001', display_name: REMOTE_NAME, state: 'joined' },
  ],
  ...overrides,
});

// Mocks the calls REST surface. A successful start remembers the call so that
// GET .../calls/active (the client's safety-net poll) keeps reporting it.
async function mockCallsApi(page, { onStart } = {}) {
  const requests = { start: [], leave: [], live: null };
  const tracking = (route) => ({
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
  await page.route('**/api/v1/chat/calls/config', (route) => jsonRoute(route, 200, { enabled: true }));
  await page.route('**/api/v1/chat/conversations/*/calls/active', (route) => jsonRoute(route, 200, { call: requests.live }));
  await page.route('**/api/v1/chat/conversations/*/calls', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests.start.push(route.request().postDataJSON());
    return onStart(tracking(route));
  });
  await page.route('**/api/v1/chat/calls/*/leave', async (route) => {
    requests.leave.push(route.request().url());
    requests.live = null;
    const callId = route.request().url().split('/calls/')[1].split('/')[0];
    return jsonRoute(route, 200, { call: { id: callId, status: 'ended', end_reason: 'completed' } });
  });
  return requests;
}

// Minimal stand-in for livekit-client: see chat-calls.spec.js for the full notes.
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

// Starts a call from the caller side with the stubbed room. The remote tile
// ("Звонящий Коллега") comes from the stub room on connect.
async function startCall(browser) {
  const context = await browser.newContext({ permissions: MEDIA_PERMISSIONS });
  // On the local host used for these runs, the page that performed the login
  // stops receiving mouse and keyboard input afterwards (chat-calls.spec.js shows
  // the same failures). A fresh page of the same context keeps the session and
  // gets input, so the flow continues there.
  const loginPage = await context.newPage();
  await login(loginPage, U1, P1);
  const page = await context.newPage();
  await loginPage.close();
  await page.goto('/dashboard');
  const conversationId = await openDirectConversation(page, U2);
  const selfUserId = await page.evaluate(() => String(JSON.parse(localStorage.getItem('user') || '{}').id || ''));
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
  await page.goto(`/chat?conversation=${conversationId}`);
  await page.getByTestId('chat-composer-textarea').waitFor();
  await page.getByRole('button', { name: 'Аудиозвонок' }).click();
  const panel = page.getByTestId('chat-call-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('chat-call-tile-remote')).toContainText(REMOTE_NAME);
  return { context, page, requests, panel, conversationId };
}

// Replaces the remote participant's screen-share publication on the stub room.
const setRemoteScreenShare = (page, on) => page.evaluate((shareOn) => {
  const room = window.__lk.rooms[window.__lk.rooms.length - 1];
  const remote = room.remoteParticipants.get('999001');
  const track = { attach: (element) => element, detach: () => [] };
  remote.getTrackPublication = (source) => {
    if (source === 'screen_share') return shareOn ? { isMuted: false, track } : null;
    if (source === 'microphone') return { isMuted: false };
    return null;
  };
  window.__lk.emit('TrackPublished');
}, on);

const isDocumentFullscreen = (page) => page.evaluate(() => Boolean(document.fullscreenElement));

test.describe('call window layout', () => {
  test('expanded window fills the viewport; Esc returns to floating and keeps the call', async ({ browser }) => {
    const { context, page, requests, panel } = await startCall(browser);
    try {
      await expect(panel).toHaveAttribute('data-call-mode', 'floating');
      await page.getByTestId('chat-call-expand').click();
      await expect(panel).toHaveAttribute('data-call-mode', 'expanded');
      const viewport = page.viewportSize();
      const box = await panel.boundingBox();
      expect(box.width).toBe(viewport.width);
      expect(box.height).toBe(viewport.height);

      await page.keyboard.press('Escape');
      await expect(panel).toHaveAttribute('data-call-mode', 'floating');
      await expect(panel).toBeVisible();
      expect(requests.leave).toHaveLength(0);
      expect(await lkCalls(page)).not.toContain('disconnect');

      // The button is the other way back.
      await page.getByTestId('chat-call-expand').click();
      await expect(panel).toHaveAttribute('data-call-mode', 'expanded');
      await page.getByRole('button', { name: 'Вернуть обычный размер' }).click();
      await expect(panel).toHaveAttribute('data-call-mode', 'floating');
      expect(requests.leave).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('a tile click spotlights it; a second click or the grid button returns the grid', async ({ browser }) => {
    const { context, page, panel } = await startCall(browser);
    try {
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();
      await page.getByTestId('chat-call-tile-remote').click();
      const spotlight = page.getByTestId('chat-call-spotlight');
      await expect(spotlight).toBeVisible();
      await expect(spotlight.getByTestId('chat-call-tile-remote')).toBeVisible();
      await expect(page.getByTestId('chat-call-grid')).toHaveCount(0);
      // The rest of the call is the strip; each tile is rendered once.
      await expect(page.getByTestId('chat-call-strip').getByTestId('chat-call-tile-local')).toHaveCount(1);
      await expect(page.getByTestId('chat-call-tile-remote')).toHaveCount(1);

      // Repeat click on the main tile returns the grid.
      await spotlight.getByTestId('chat-call-tile-remote').click();
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();
      await expect(page.getByTestId('chat-call-spotlight')).toHaveCount(0);

      await page.getByTestId('chat-call-tile-remote').click();
      await expect(page.getByTestId('chat-call-spotlight')).toBeVisible();
      await page.getByTestId('chat-call-grid-toggle').click();
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();
      await expect(panel).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('a pinned participant who leaves returns the grid', async ({ browser }) => {
    const { context, page } = await startCall(browser);
    try {
      await page.getByTestId('chat-call-tile-remote').click();
      await expect(page.getByTestId('chat-call-spotlight')).toBeVisible();
      await page.evaluate(() => {
        const room = window.__lk.rooms[window.__lk.rooms.length - 1];
        room.remoteParticipants.delete('999001');
        window.__lk.emit('ParticipantDisconnected');
      });
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();
      await expect(page.getByTestId('chat-call-spotlight')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a remote screen share is spotlighted; a manual grid survives it, a new share spotlights again', async ({ browser }) => {
    const { context, page } = await startCall(browser);
    try {
      await setRemoteScreenShare(page, true);
      const spotlight = page.getByTestId('chat-call-spotlight');
      await expect(spotlight).toBeVisible();
      await expect(spotlight).toContainText(`${REMOTE_NAME} · экран`);

      // The user chose the grid while the share runs: it stays the grid.
      await page.getByTestId('chat-call-grid-toggle').click();
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();

      await setRemoteScreenShare(page, false);
      await expect(page.getByTestId('chat-call-spotlight')).toHaveCount(0);
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();

      // A new share is spotlighted again.
      await setRemoteScreenShare(page, true);
      await expect(page.getByTestId('chat-call-spotlight')).toContainText(`${REMOTE_NAME} · экран`);
      await setRemoteScreenShare(page, false);
      await expect(page.getByTestId('chat-call-grid')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('the self camera is a PiP over the spotlight only while it has video', async ({ browser }) => {
    const { context, page } = await startCall(browser);
    try {
      await page.getByTestId('chat-call-toggle-camera').click();
      await expect.poll(() => lkCalls(page)).toContain('camera:true');
      await page.getByTestId('chat-call-tile-remote').click();
      await expect(page.getByTestId('chat-call-spotlight')).toBeVisible();
      // No video yet: no PiP, and the local tile stays in the strip as an avatar.
      await expect(page.getByTestId('chat-call-self-pip')).toHaveCount(0);
      await expect(page.getByTestId('chat-call-strip').getByTestId('chat-call-tile-local')).toHaveCount(1);

      await page.evaluate(() => {
        const room = window.__lk.rooms[window.__lk.rooms.length - 1];
        const track = { attach: (element) => element, detach: () => [] };
        room.localParticipant.getTrackPublication = (source) => (source === 'camera' ? { isMuted: false, track } : null);
        window.__lk.emit('LocalTrackPublished');
      });
      // With video the local camera is only the PiP: it is not rendered as a tile.
      await expect(page.getByTestId('chat-call-self-pip')).toBeVisible();
      await expect(page.getByTestId('chat-call-strip').getByTestId('chat-call-tile-local')).toHaveCount(0);
      await expect(page.getByTestId('chat-call-tile-local')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('the tile fullscreen button enters and leaves document fullscreen', async ({ browser }) => {
    const { context, page } = await startCall(browser);
    try {
      await page.getByTestId('chat-call-tile-remote').hover();
      await page.getByTestId('chat-call-tile-remote').getByTestId('chat-call-tile-fullscreen').click();
      await expect.poll(() => isDocumentFullscreen(page)).toBe(true);
      await expect(page.getByTestId('chat-call-panel')).toHaveAttribute('data-fullscreen', 'true');
      await expect(page.getByTestId('chat-call-spotlight').getByTestId('chat-call-tile-remote')).toBeVisible();
      // The controls stay inside the fullscreen element.
      await expect(page.getByTestId('chat-call-end')).toBeVisible();

      await page.getByTestId('chat-call-spotlight').getByTestId('chat-call-tile-fullscreen').click();
      await expect.poll(() => isDocumentFullscreen(page)).toBe(false);
      await expect(page.getByTestId('chat-call-panel')).toHaveAttribute('data-call-mode', 'floating');
    } finally {
      await context.close();
    }
  });

  test('double click on a tile enters fullscreen with that tile; the header button leaves it', async ({ browser }) => {
    const { context, page } = await startCall(browser);
    try {
      await page.getByTestId('chat-call-tile-remote').dblclick();
      await expect.poll(() => isDocumentFullscreen(page)).toBe(true);
      await expect(page.getByTestId('chat-call-spotlight').getByTestId('chat-call-tile-remote')).toBeVisible();
      await expect(page.getByTestId('chat-call-grid')).toHaveCount(0);

      await page.getByTestId('chat-call-fullscreen-exit').click();
      await expect.poll(() => isDocumentFullscreen(page)).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('the floating panel moves by its header, stays on screen and keeps the position after a reload', async ({ browser }) => {
    const { context, page, requests, panel } = await startCall(browser);
    try {
      const before = await panel.boundingBox();
      const status = panel.getByTestId('chat-call-status');
      const grip = await status.boundingBox();
      await page.mouse.move(grip.x + 10, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + 10 - 240, grip.y + grip.height / 2 - 160, { steps: 10 });
      await page.mouse.up();
      const moved = await panel.boundingBox();
      expect(moved.x).toBeLessThan(before.x - 150);
      expect(moved.y).toBeLessThan(before.y - 100);
      expect(moved.x).toBeGreaterThanOrEqual(0);
      expect(moved.y).toBeGreaterThanOrEqual(0);
      const stored = await page.evaluate(() => window.localStorage.getItem('hubit.chat.callPanel.position'));
      expect(stored).not.toBeNull();

      // End the call, reload, call again: the stored corner is used.
      await page.getByTestId('chat-call-end').click();
      await expect(panel).toBeHidden();
      await expect.poll(() => requests.leave.length).toBe(1);
      await page.reload();
      await page.getByTestId('chat-composer-textarea').waitFor();
      await page.getByRole('button', { name: 'Аудиозвонок' }).click();
      await expect(panel).toBeVisible();
      const again = await panel.boundingBox();
      expect(Math.abs(again.x - moved.x)).toBeLessThan(2);
      expect(Math.abs(again.y - moved.y)).toBeLessThan(2);
    } finally {
      await context.close();
    }
  });
});
