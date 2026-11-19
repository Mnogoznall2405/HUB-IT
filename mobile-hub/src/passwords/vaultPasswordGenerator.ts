import * as Crypto from 'expo-crypto';

const DEFAULT_PASSWORD_LENGTH = 20;
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
const SIMILAR_CHARS = new Set('Il1O0o'.split(''));

export type VaultPasswordGeneratorOptions = {
  length?: number;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeSimilar?: boolean;
};

const DEFAULT_OPTIONS: Required<VaultPasswordGeneratorOptions> = {
  length: DEFAULT_PASSWORD_LENGTH,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeSimilar: true,
};

function buildCharacterSets(options: Required<VaultPasswordGeneratorOptions>): string[] {
  const clean = (value: string) => (
    options.excludeSimilar
      ? value.split('').filter((char) => !SIMILAR_CHARS.has(char)).join('')
      : value
  );
  return [
    options.lower ? clean(LOWER) : '',
    options.upper ? clean(UPPER) : '',
    options.digits ? clean(DIGITS) : '',
    options.symbols ? clean(SYMBOLS) : '',
  ].filter(Boolean);
}

type NextIndex = (size: number) => number | Promise<number>;

/**
 * Same algorithm as the web vault generator (Passwords.jsx): take one
 * character from every enabled set, fill the rest from their union,
 * then Fisher–Yates shuffle. `nextIndex` must return a uniform index
 * in [0, size); callers supply a crypto-backed source.
 */
export async function generateVaultPassword(
  nextIndex: NextIndex,
  options: VaultPasswordGeneratorOptions = {},
): Promise<string> {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const sets = buildCharacterSets(merged);
  if (!sets.length) {
    throw new Error('Select at least one character set');
  }
  const length = Math.max(sets.length, Math.min(128, Number(options.length ?? DEFAULT_PASSWORD_LENGTH) || DEFAULT_PASSWORD_LENGTH));
  const charset = sets.join('');
  const result: string[] = [];
  for (const set of sets) {
    result.push(set[await nextIndex(set.length)]);
  }
  while (result.length < length) {
    result.push(charset[await nextIndex(charset.length)]);
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = await nextIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.join('');
}

const RANDOM_POOL_SIZE = 64;

/** Device-crypto backed generator (expo-crypto) with the web defaults. */
export async function generateVaultPasswordWithCrypto(
  options: VaultPasswordGeneratorOptions = {},
): Promise<string> {
  let pool: Uint8Array = new Uint8Array(0);
  let cursor = 0;
  return generateVaultPassword(async (size) => {
    const max = 256 - (256 % size);
    for (;;) {
      if (cursor >= pool.length) {
        pool = await Crypto.getRandomBytesAsync(RANDOM_POOL_SIZE);
        cursor = 0;
      }
      const byte = pool[cursor];
      cursor += 1;
      if (byte < max) return byte % size;
    }
  }, options);
}
