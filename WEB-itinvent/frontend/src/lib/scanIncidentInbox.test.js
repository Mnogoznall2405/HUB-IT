import { describe, expect, it } from 'vitest';
import {
  formatIncidentUncPath,
  formatSeverityLabel,
  getIncidentFileName,
  getIncidentListTitle,
  getIncidentPatternLabel,
  sortIncidentsForInbox,
} from './scanIncidentInbox';

describe('sortIncidentsForInbox', () => {
  it('orders by severity then newest created_at', () => {
    const sorted = sortIncidentsForInbox([
      { id: '1', severity: 'low', created_at: 300 },
      { id: '2', severity: 'high', created_at: 100 },
      { id: '3', severity: 'high', created_at: 200 },
      { id: '4', severity: 'medium', created_at: 400 },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['3', '2', '4', '1']);
  });
});

describe('formatSeverityLabel', () => {
  it('maps severity to Russian labels', () => {
    expect(formatSeverityLabel('high')).toBe('Высокий');
    expect(formatSeverityLabel('medium')).toBe('Средний');
    expect(formatSeverityLabel('low')).toBe('Низкий');
    expect(formatSeverityLabel('')).toBe('—');
  });
});

describe('getIncidentFileName / getIncidentListTitle', () => {
  it('prefers file name, then basename from path', () => {
    expect(getIncidentFileName({ file_name: 'scan.pdf' })).toBe('scan.pdf');
    expect(getIncidentListTitle({
      short_reason: 'secret_strict',
      file_path: 'C:\\Users\\a\\Docs\\report.docx',
    })).toBe('report.docx');
  });
});

describe('getIncidentPatternLabel', () => {
  it('maps snake_case ids through pattern options', () => {
    expect(getIncidentPatternLabel(
      { matched_patterns: [{ pattern_name: 'secret_strict' }] },
      [{ id: 'secret_strict', name: 'Секретный документ' }],
    )).toBe('Секретный документ');
    expect(getIncidentPatternLabel({ short_reason: 'Паспорт' })).toBe('Паспорт');
  });
});

describe('formatIncidentUncPath', () => {
  it('converts local drive path to admin-share UNC', () => {
    expect(formatIncidentUncPath({
      hostname: 'TMN-FIN-0002',
      file_path: 'C:\\Users\\kubarkova_id\\Downloads\\file.pdf',
    })).toBe('\\\\TMN-FIN-0002\\C$\\Users\\kubarkova_id\\Downloads\\file.pdf');
  });

  it('keeps existing UNC and falls back without hostname', () => {
    expect(formatIncidentUncPath({
      hostname: 'HOST',
      file_path: '\\\\SHARE\\folder\\a.pdf',
    })).toBe('\\\\SHARE\\folder\\a.pdf');
    expect(formatIncidentUncPath({
      file_path: 'C:\\Docs\\a.pdf',
    })).toBe('C:\\Docs\\a.pdf');
  });
});
