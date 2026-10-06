import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  endpointTemplate, getPerfSummary, noteRealtimeEvent, noteStallCulprit, noteWork, overlappingWork, noteRequestEnd, noteRequestStart,
  resetPerfProbes, sampleHermesHeap, useRenderTiming,
} from './perfProbes';

function Probe() {
  useRenderTiming('probe');
  return <Text>x</Text>;
}

describe('perf probes (temporary)', () => {
  beforeEach(() => resetPerfProbes());

  it('keeps only the route template of a request, never ids or query', () => {
    expect(endpointTemplate('post', '/chat/conversations/8f3a-12/messages?after=99')).toBe('POST /chat/conversations/:id/messages');
    expect(endpointTemplate('get', 'https://hub.example/api/v1/me?token=secret')).toBe('GET /api/:id/me');
    expect(endpointTemplate('GET', '')).toBeNull();
  });

  it('measures request time per endpoint, counting errors and slow ones', () => {
    const ok = { method: 'get', url: '/chat/conversations?limit=50' };
    const bad = { method: 'get', url: '/chat/conversations?limit=50' };
    noteRequestStart(ok, 1000); noteRequestEnd(ok, false, 1400);
    noteRequestStart(bad, 2000); noteRequestEnd(bad, true, 3500);
    expect(getPerfSummary().endpoints['GET /chat/conversations']).toMatchObject({ count: 2, total: 2, maxMs: 1500, slow: 1, errors: 1 });
    noteRequestEnd({ method: 'get', url: '/never-started' }, false, 5000);
    expect(Object.keys(getPerfSummary().endpoints)).toEqual(['GET /chat/conversations']);
  });

  it('counts realtime events, the busiest second and fixed type names only', () => {
    noteRealtimeEvent('chat.message.created', 5_000); noteRealtimeEvent('chat.message.created', 5_400);
    noteRealtimeEvent('chat.typing', 5_900); noteRealtimeEvent('User Name <x>', 6_100);
    expect(getPerfSummary().realtime).toEqual({
      total: 4, peakPerSecond: 3, byType: { 'chat.message.created': 2, 'chat.typing': 1 },
    });
  });

  it('records a render commit per screen', async () => {
    await render(<Probe />);
    expect(getPerfSummary().renders.probe.count).toBeGreaterThanOrEqual(1);
  });

  it('tracks heap growth and GC from Hermes stats and tolerates missing stats', () => {
    sampleHermesHeap(null);
    expect(getPerfSummary().hermes.supported).toBe(false);
    sampleHermesHeap({ js_heapSize: 1000, js_numGCs: 2, js_gcTime: 10 });
    sampleHermesHeap({ js_heapSize: 3000, js_numGCs: 7, js_gcTime: 40 });
    expect(getPerfSummary().hermes).toMatchObject({
      supported: true, samples: 2, heapBytesFirst: 1000, heapBytesLast: 3000, heapBytesMax: 3000, gcCount: 5, gcTimeMs: 30,
    });
  });

  it('matches a stall with the own work that overlapped it most', () => {
    noteWork('snap-write:chat-inbox', 1_000, 1_900);
    noteWork('inbox-apply', 1_850, 1_950);
    noteWork('snap-read:mail-inbox', 5_000, 5_100);
    expect(overlappingWork(900, 2_000)).toEqual([
      { name: 'snap-write:chat-inbox', ms: 900 }, { name: 'inbox-apply', ms: 100 },
    ]);
    expect(noteStallCulprit(900, 2_000)).toBe('snap-write:chat-inbox');
    expect(noteStallCulprit(3_000, 3_500)).toBe('none');
    const summary = getPerfSummary();
    expect(summary.stallCulprits).toEqual({ 'snap-write:chat-inbox': 1, none: 1 });
    expect(summary.work['snap-write:chat-inbox']).toMatchObject({ count: 1, maxMs: 900, slow: 1 });
  });

  it('ignores work names outside the fixed pattern', () => {
    noteWork('User <b>Name</b>', 0, 10);
    expect(getPerfSummary().work).toEqual({});
  });
});
