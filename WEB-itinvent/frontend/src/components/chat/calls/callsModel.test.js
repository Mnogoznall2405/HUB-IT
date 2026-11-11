import { describe, expect, it } from 'vitest';

import {
  INITIAL_CALLS_STATE,
  callsReducer,
  describeCallApiError,
  normalizeCall,
} from './callsModel';

// Pure state machine behind the call UI. E2E cannot reach these branches
// without a LiveKit server: answering from another tab, a second call while
// busy, own invite echoed back by the socket, and the 409 body shapes.

const SELF = '7';
const makeCall = (overrides = {}) => normalizeCall({
  id: 'c1',
  conversation_id: 'conv1',
  media: 'audio',
  status: 'ringing',
  initiator_user_id: 99,
  participants: [
    { user_id: 99, display_name: 'Анна', state: 'joined' },
    { user_id: 7, display_name: 'Я', state: 'invited' },
  ],
  ...overrides,
});
const invite = (state, call, extra = {}) => callsReducer(state, {
  type: 'invite',
  call,
  selfUserId: SELF,
  initiator: { user_id: 99, display_name: 'Анна' },
  ...extra,
});

describe('callsReducer', () => {
  it('ignores an invite that echoes our own outgoing call', () => {
    const own = makeCall({ initiator_user_id: 7 });
    expect(invite(INITIAL_CALLS_STATE, own).incoming).toBeNull();
  });

  it('does not stack a second window or interrupt a running session', () => {
    const first = invite(INITIAL_CALLS_STATE, makeCall());
    const second = invite(first, makeCall({ id: 'c2', conversation_id: 'conv2' }));
    expect(second.incoming.call.id).toBe('c1');

    const inCall = callsReducer(INITIAL_CALLS_STATE, {
      type: 'sessionStarting', conversationId: 'conv9', media: 'audio', role: 'caller',
    });
    expect(invite(inCall, makeCall()).incoming).toBeNull();
  });

  it('closes the incoming window when the call is answered from another tab', () => {
    const ringing = invite(INITIAL_CALLS_STATE, makeCall());
    const answeredElsewhere = makeCall({
      status: 'active',
      participants: [
        { user_id: 99, display_name: 'Анна', state: 'joined' },
        { user_id: 7, display_name: 'Я', state: 'joined' },
      ],
    });
    const next = callsReducer(ringing, { type: 'updated', call: answeredElsewhere, selfUserId: SELF });
    expect(next.incoming).toBeNull();
    expect(next.notice).toBeNull();
  });

  it('reports a missed call and refuses to resurrect it from a replayed invite', () => {
    const ringing = invite(INITIAL_CALLS_STATE, makeCall());
    const ended = makeCall({ status: 'ended', end_reason: 'missed' });
    const next = callsReducer(ringing, { type: 'updated', call: ended, selfUserId: SELF });
    expect(next.incoming).toBeNull();
    expect(next.notice.text).toContain('Анна');
    expect(invite(next, makeCall()).incoming).toBeNull();
  });
});

describe('callsReducer session phases', () => {
  it('keeps a failed session failed when late room events report "connected"', () => {
    let state = callsReducer(INITIAL_CALLS_STATE, {
      type: 'sessionStarting', conversationId: 'conv1', media: 'audio', role: 'caller',
    });
    state = callsReducer(state, { type: 'sessionAttached', call: makeCall({ initiator_user_id: 7 }) });
    state = callsReducer(state, {
      type: 'sessionPhase', phase: 'error', error: 'boom', errorDetail: 'Код: connect:X', errorAction: '',
    });
    const late = callsReducer(state, { type: 'sessionPhase', phase: 'connected' });
    expect(late.session.phase).toBe('error');
    expect(late.session.errorDetail).toBe('Код: connect:X');
  });
});

describe('describeCallApiError', () => {
  const callBody = { id: 'c1', conversation_id: 'conv1', status: 'active', participants: [] };

  it('reads call_already_active both from the top level and from detail', () => {
    const flat = describeCallApiError({ response: { status: 409, data: { code: 'call_already_active', call: callBody } } });
    const nested = describeCallApiError({
      response: { status: 409, data: { detail: { code: 'call_already_active', call: callBody } } },
    });
    expect(flat.kind).toBe('already_active');
    expect(flat.call.id).toBe('c1');
    expect(nested.kind).toBe('already_active');
    expect(nested.call.id).toBe('c1');
  });

  it('treats 409 call_ended (top level or in detail) as a finished call and keeps the ended call', () => {
    const ended = { ...callBody, status: 'ended', end_reason: 'cancelled' };
    const flat = describeCallApiError({
      response: { status: 409, data: { code: 'call_ended', detail: 'The call has ended', call: ended } },
    });
    const nested = describeCallApiError({
      response: { status: 409, data: { detail: { code: 'call_ended', call: ended } } },
    });
    [flat, nested].forEach((info) => {
      expect(info.kind).toBe('gone');
      expect(info.text).toBe('Звонок уже завершён.');
      expect(info.call.status).toBe('ended');
    });
  });

  it('does not report an unrelated 409 as a finished call', () => {
    expect(describeCallApiError({ response: { status: 409, data: { detail: 'conflict' } } }).kind).toBe('unknown');
  });
});
