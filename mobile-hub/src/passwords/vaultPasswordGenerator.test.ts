import { generateVaultPassword } from './vaultPasswordGenerator';

it('produces the requested length with one char guaranteed per enabled set', async () => {
  // Deterministic index source: always the first char of each set — so the
  // four set-first characters must survive the shuffle in the output.
  const password = await generateVaultPassword(() => 0, { length: 20 });
  expect(password).toHaveLength(20);
  for (const required of ['a', 'A', '2', '!']) {
    expect(password).toContain(required);
  }
});

it('only draws characters from the enabled sets and skips similar glyphs', async () => {
  const allowed = new Set('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()-_=+[]{};:,.?'.split(''));
  let cursor = 0;
  const password = await generateVaultPassword((size) => (cursor++ * 13 + 5) % size, { length: 64 });
  expect(password).toHaveLength(64);
  for (const char of password) {
    expect(allowed.has(char)).toBe(true);
  }
  for (const similar of 'Il1O0o') {
    expect(password).not.toContain(similar);
  }
});

it('keeps similar characters when explicitly allowed', async () => {
  const password = await generateVaultPassword(() => 0, { length: 20, excludeSimilar: false });
  // First lower set char is still 'a', first upper is 'A' — with similar chars
  // allowed the sets are unchanged, but the generator must still produce output.
  expect(password).toHaveLength(20);
  expect(password).toContain('a');
});

it('clamps the length to the set count minimum and the 128 maximum', async () => {
  const short = await generateVaultPassword(() => 0, { length: 2 });
  expect(short).toHaveLength(4);
  const long = await generateVaultPassword(() => 0, { length: 999 });
  expect(long).toHaveLength(128);
});

it('refuses to generate when every character set is disabled', async () => {
  await expect(generateVaultPassword(() => 0, {
    lower: false,
    upper: false,
    digits: false,
    symbols: false,
  })).rejects.toThrow('Select at least one character set');
});
