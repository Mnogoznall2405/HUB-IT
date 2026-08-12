import { describe, expect, it } from 'vitest';
import { normalizeVncEndpoint } from './vncEndpoint';

describe('normalizeVncEndpoint', () => {
  it.each([
    ['10.20.30.40', '10.20.30.40'],
    ['10.20.30.40:5901', '10.20.30.40:5901'],
    ['VNC://ROOM-PC.zsgp.corp:5900', 'room-pc.zsgp.corp:5900'],
    ['room-pc', 'room-pc'],
  ])('accepts a bounded host and optional port', (value, expected) => {
    expect(normalizeVncEndpoint(value)).toBe(expected);
  });

  it.each([
    '256.20.30.40',
    '10.20.30.40:0',
    '10.20.30.40:65536',
    'user@room-pc',
    'room-pc?password=secret',
    'room-pc/path',
    'room-pc\nnext',
    '-room-pc',
    '',
  ])('rejects credentials, query, controls, paths and invalid endpoints', (value) => {
    expect(normalizeVncEndpoint(value)).toBe('');
  });
});
