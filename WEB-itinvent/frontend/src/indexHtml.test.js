import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('index.html viewport meta', () => {
  it('enables the interactive-widget viewport behavior for mobile keyboards', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('interactive-widget=resizes-content');
    expect(html).toContain('maximum-scale=1.0');
    expect(html).toContain('user-scalable=no');
  });

  it('sets a non-white startup background before the app bundle loads', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('background: #f5f7fa');
  });
});
