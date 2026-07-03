import { describe, expect, it } from 'vitest';
import {
  ACCESS_LEVEL_META,
  buildAccessLookup,
  buildMatrixRows,
  buildSparseAccessMap,
  getAccessLevelMeta,
  getSparseAccessLevel,
  splitFolderPath,
} from './groupsAccessUtils';

describe('groupsAccessUtils', () => {
  it('splits folder path into breadcrumb segments', () => {
    expect(splitFolderPath('Resources / Common / Finance')).toEqual(['Resources', 'Common', 'Finance']);
  });

  it('builds matrix rows with access cells', () => {
    const groups = [
      { dn: 'CN=A,OU=Groups,DC=corp', cn: 'A' },
      { dn: 'CN=B,OU=Groups,DC=corp', cn: 'B' },
    ];
    const users = [
      {
        login: 'ivanov',
        display_name: 'Иванов',
        access: [
          { group_dn: 'CN=A,OU=Groups,DC=corp', access_level: 'read' },
        ],
      },
    ];

    const rows = buildMatrixRows({ users, groups });
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(['read', '']);
  });

  it('returns known access level meta', () => {
    expect(getAccessLevelMeta('write').short).toBe('W');
    expect(ACCESS_LEVEL_META.read.label).toBe('Чтение');
    expect(buildAccessLookup([]).size).toBe(0);
  });

  it('builds sparse access map for virtual matrix', () => {
    const map = buildSparseAccessMap([
      ['ivanov', 'CN=A', 'read'],
      ['ivanov', 'CN=B', 'write'],
    ]);
    expect(getSparseAccessLevel(map, 'ivanov', 'CN=A')).toBe('read');
    expect(getSparseAccessLevel(map, 'ivanov', 'CN=Z')).toBe('');
  });
});
