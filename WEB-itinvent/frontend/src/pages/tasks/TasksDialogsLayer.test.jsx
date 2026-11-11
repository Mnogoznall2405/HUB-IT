import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TasksDialogsLayer', () => {
  it('uses the modern task form for editing', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/tasks/TasksDialogsLayer.jsx'),
      'utf8',
    );

    expect(source).not.toMatch(/TasksEditDialog/);
    expect(source).toMatch(/<TasksCreateDialog\s+mode="edit"/);
  });
});
