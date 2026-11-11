import { test, expect } from '@playwright/test';

test('task canvas reconnects after rate limiting and receives the current revision', async ({ page }) => {
  let connections = 0;
  await page.routeWebSocket('**/chat/task-canvas/ws*', (socket) => {
    const revision = ++connections;
    socket.send(JSON.stringify({ type: 'task_canvas.connected', payload: { connection_id: `audit-${revision}`, revision } }));
    if (revision === 1) socket.close({ code: 1008, reason: 'task canvas rate limit exceeded' });
  });
  await page.goto('/e2e/fixtures/task-canvas-reconnect-harness.html');
  await page.getByRole('button', { name: 'Подключить канвас', exact: true }).click();
  await expect(page.getByLabel('Ревизия', { exact: true })).toHaveText('2');
  await expect(page.getByLabel('Статус соединения', { exact: true })).toHaveText('connected');
  expect(connections).toBe(2);
  await page.getByRole('button', { name: 'Закрыть канвас', exact: true }).click();
});
