import { describe, expect, it } from 'vitest';

import {
  parseCompatibleModelsText,
  serializeCompatibleModels,
} from './CartridgeCompatibilityDialog';

describe('cartridge compatibility text helpers', () => {
  it('serializes models with optional colors', () => {
    expect(serializeCompatibleModels([
      { model: 'CF283A', color: 'Черный' },
      { model: 'CE285A' },
      { model: '  ' },
      null,
    ])).toBe('CF283A | Черный\nCE285A');
    expect(serializeCompatibleModels(undefined)).toBe('');
  });

  it('parses model lines and strips empties', () => {
    expect(parseCompatibleModelsText(' CF283A | Черный \n\nCE285A\n| пусто')).toEqual([
      { model: 'CF283A', color: 'Черный' },
      { model: 'CE285A' },
    ]);
    expect(parseCompatibleModelsText('')).toEqual([]);
  });
});
