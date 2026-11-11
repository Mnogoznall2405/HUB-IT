import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const workerURL = new URL('../public/sw.js', import.meta.url);
let server;
let origin;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/sw.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(await readFile(workerURL));
    } else if (path.endsWith('.js')) {
      response.setHeader('Content-Type', 'application/javascript');
      response.end('window.editorCacheResult = "fresh-from-network";');
    } else if (path.startsWith('/onlyoffice/')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><h1>Editor fixture</h1>');
    } else if (path.endsWith('.webmanifest')) {
      response.setHeader('Content-Type', 'application/manifest+json');
      response.end('{}');
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><h1>HUB shell fixture</h1>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

async function controlledPage(page) {
  await page.goto(origin + '/harness.html');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
}

test('ONLYOFFICE bootstrap bypasses an older HUB cache and receives the current branding namespace', async ({ page }) => {
  await controlledPage(page);
  await page.evaluate(async () => {
    const source = await (await fetch('/sw.js')).text();
    const cacheName = /const APP_ASSET_CACHE = '([^']+)'/.exec(source)[1];
    const cache = await caches.open(cacheName);
    await cache.put('/onlyoffice/web-apps/apps/api/documents/api.js', new Response('window.editorCacheResult = "stale-from-hub-cache";',
      { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' } }));
  });
  await page.addScriptTag({ url: origin + '/onlyoffice/web-apps/apps/api/documents/api.js' });
  await expect.poll(() => page.evaluate(() => window.editorCacheResult)).toBe('fresh-from-network');
});

test('navigating the editor iframe cannot replace the HUB offline shell', async ({ page }) => {
  await controlledPage(page);
  await page.evaluate(async () => {
    const source = await (await fetch('/sw.js')).text();
    const cacheName = /const APP_SHELL_CACHE = '([^']+)'/.exec(source)[1];
    const cache = await caches.open(cacheName);
    await cache.put('/index.html', new Response('<h1>Saved HUB workspace</h1>', { headers: { 'Content-Type': 'text/html' } }));
    const frame = document.createElement('iframe');
    frame.src = '/onlyoffice/10.0.0-test/editor.html';
    document.body.append(frame);
  });
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Editor fixture' })).toBeVisible();
  const shell = await page.evaluate(async () => {
    const source = await (await fetch('/sw.js')).text();
    const cacheName = /const APP_SHELL_CACHE = '([^']+)'/.exec(source)[1];
    return (await (await caches.open(cacheName)).match('/index.html')).text();
  });
  expect(shell).toContain('Saved HUB workspace');
});

test('the HUB asset cache still serves its saved application files', async ({ page }) => {
  await controlledPage(page);
  await page.evaluate(async () => {
    const source = await (await fetch('/sw.js')).text();
    const cacheName = /const APP_ASSET_CACHE = '([^']+)'/.exec(source)[1];
    const cache = await caches.open(cacheName);
    await cache.put('/assets/application.js', new Response('window.editorCacheResult = "saved-hub-asset";',
      { headers: { 'Content-Type': 'application/javascript' } }));
  });
  await page.addScriptTag({ url: origin + '/assets/application.js' });
  await expect.poll(() => page.evaluate(() => window.editorCacheResult)).toBe('saved-hub-asset');
});
