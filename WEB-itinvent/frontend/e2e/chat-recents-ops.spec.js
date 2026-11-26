import { test, expect } from '@playwright/test';

// Recents op-batch idempotency at the HTTP boundary (release-gate edge cases):
// a device that lost the response retries with the SAME op_batch_id and must
// get the current state back — no reapply, no version bump, no resurrected
// entries — even after newer batches landed in between. Two devices are two
// API calls; UI-level recents behaviour is covered by chat-stickers-v2.spec.

test.skip(process.env.E2E_LOCAL !== '1', 'writes only to the isolated local stack');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByTestId('main-layout-content')).toBeVisible();
}

async function seedStickerIds(page, count = 3) {
  const packsResponse = await page.request.get('/api/v1/chat/sticker-packs');
  expect(packsResponse.ok()).toBeTruthy();
  const packs = await packsResponse.json();
  const pack = (packs.items || []).find((item) => item.short_name === 'e2e_test_pack');
  expect(pack, 'seeded e2e_test_pack missing').toBeTruthy();
  return pack.stickers.slice(0, count).map((sticker) => sticker.id);
}

test('recents op batches: lost-response retry and overlapping batches stay consistent', async ({ page }) => {
  await login(page);
  const [s1, s2, s3] = await seedStickerIds(page);
  const run = Date.now();
  const batchA = `e2e-a-${run}`;
  const batchB = `e2e-b-${run}`;

  const putRecent = (data) => page.request.put('/api/v1/chat/stickers/recent', { data });

  // Isolation: the seeded test pack has exactly three stickers and earlier
  // specs of a serial sweep (chat-emoji-picker sends stickers as the same
  // user) leave them in this user's recents rail. Reset the rail with its own
  // batch first, so the op assertions below start from a deterministic empty
  // state regardless of what ran before in the shared stack.
  const reset = await putRecent({ ops: [{ op: 'clear' }], op_batch_id: `e2e-reset-${run}` });
  expect(reset.ok()).toBeTruthy();

  // Device A applies batch A.
  const first = await putRecent({ ops: [{ op: 'bump', sticker_id: s1 }], op_batch_id: batchA });
  expect(first.ok()).toBeTruthy();
  const applied = await first.json();
  expect(applied.version).toBeGreaterThanOrEqual(1);
  expect(applied.items.map((item) => item.id)).toContain(s1);

  // Lost-response retry of the SAME batch: same state, no version bump.
  const retry = await putRecent({ ops: [{ op: 'bump', sticker_id: s1 }], op_batch_id: batchA });
  expect(retry.ok()).toBeTruthy();
  const retried = await retry.json();
  expect(retried.version).toBe(applied.version);
  expect(retried.items.map((item) => item.id)).toEqual(applied.items.map((item) => item.id));

  // Retry with a different payload under the same batch id still returns the
  // recorded result — the id owns the batch, not the ops.
  const different = await putRecent({ ops: [{ op: 'bump', sticker_id: s2 }], op_batch_id: batchA });
  expect(different.ok()).toBeTruthy();
  const hijacked = await different.json();
  expect(hijacked.version).toBe(applied.version);
  expect(hijacked.items.map((item) => item.id)).not.toContain(s2);

  // Overlapping batch from device B: applies normally, bumps the version.
  const second = await putRecent({ ops: [{ op: 'bump', sticker_id: s2 }], op_batch_id: batchB });
  expect(second.ok()).toBeTruthy();
  const overlapped = await second.json();
  expect(overlapped.version).toBeGreaterThan(applied.version);
  expect(overlapped.items[0]?.id).toBe(s2);
  expect(overlapped.items.map((item) => item.id)).toContain(s1);

  // Late replay of batch A after the journal gained ops: current state wins,
  // A's payload never resurrects on top of B's.
  const late = await putRecent({ ops: [{ op: 'bump', sticker_id: s1 }], op_batch_id: batchA });
  expect(late.ok()).toBeTruthy();
  const lateState = await late.json();
  expect(lateState.version).toBe(overlapped.version);
  expect(lateState.items[0]?.id).toBe(s2);

  // A third overlapping batch then a real read agree on the same tail.
  const third = await putRecent({
    ops: [{ op: 'remove', sticker_id: s1 }, { op: 'bump', sticker_id: s3 }],
    op_batch_id: `e2e-c-${run}`,
  });
  expect(third.ok()).toBeTruthy();
  const finalState = await third.json();
  const list = await (await page.request.get('/api/v1/chat/stickers/recent')).json();
  expect(list.version).toBe(finalState.version);
  expect(list.items.map((item) => item.id)).toEqual(finalState.items.map((item) => item.id));
  expect(list.items.map((item) => item.id)).not.toContain(s1);
  expect(list.items[0]?.id).toBe(s3);
});
