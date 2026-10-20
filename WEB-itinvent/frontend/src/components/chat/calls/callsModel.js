// Pure model of chat calls: state machine of the single per-tab call session,
// idempotent handling of WS events and RU texts for errors. No React, no I/O.

export const CALL_DIAL_TIMEOUT_MS = 45_000;
export const CALL_INCOMING_LOCAL_TIMEOUT_MS = 50_000;

const MAX_HANDLED_CALL_IDS = 50;
const MAX_TEXT_LENGTH = 120;

export const INITIAL_CALLS_STATE = Object.freeze({
  incoming: null,
  session: null,
  knownCalls: {},
  handledIds: [],
  notice: null,
});

// Display names come from the API: drop control characters, collapse spaces.
const stripControlChars = (value) => Array.from(value)
  .map((char) => {
    const code = char.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
  })
  .join('');

const cleanText = (value, fallback = '') => {
  const text = stripControlChars(String(value ?? ''))
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  return text || fallback;
};

export function normalizeCall(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const participants = Array.isArray(raw.participants)
    ? raw.participants
      .filter((item) => item && item.user_id != null)
      .map((item) => ({
        user_id: String(item.user_id),
        display_name: cleanText(item.display_name, ''),
        state: String(item.state || '').trim(),
      }))
    : [];
  return {
    id,
    conversation_id: String(raw.conversation_id ?? '').trim(),
    media: raw.media === 'video' ? 'video' : 'audio',
    status: String(raw.status || '').trim(),
    initiator_user_id: raw.initiator_user_id == null ? '' : String(raw.initiator_user_id),
    started_at: raw.started_at || null,
    answered_at: raw.answered_at || null,
    ended_at: raw.ended_at || null,
    end_reason: raw.end_reason || null,
    participants,
  };
}

export function normalizeInitiator(raw, call) {
  const userId = String(raw?.user_id ?? call?.initiator_user_id ?? '').trim();
  const fromCall = call?.participants?.find((item) => item.user_id === userId)?.display_name;
  return {
    user_id: userId,
    display_name: cleanText(raw?.display_name, fromCall || 'Коллега'),
  };
}

export const getSelfParticipantState = (call, selfUserId) => {
  const self = String(selfUserId ?? '').trim();
  if (!self || !call) return '';
  return call.participants.find((item) => item.user_id === self)?.state || '';
};

const rememberHandled = (handledIds, callId) => {
  if (!callId || handledIds.includes(callId)) return handledIds;
  return [...handledIds, callId].slice(-MAX_HANDLED_CALL_IDS);
};

export const callMediaLabel = (media) => (media === 'video' ? 'видеозвонок' : 'аудиозвонок');

export function buildEndNotice(call, { selfUserId, wasCaller } = {}) {
  const reason = String(call?.end_reason || '').trim();
  if (reason === 'declined') {
    return { severity: 'info', text: 'Собеседник отклонил звонок.' };
  }
  if (reason === 'missed') {
    return { severity: 'info', text: wasCaller ? 'Нет ответа.' : 'Пропущенный звонок.' };
  }
  if (reason === 'cancelled') {
    return { severity: 'info', text: wasCaller ? 'Звонок отменён.' : 'Звонок отменён звонящим.' };
  }
  void selfUserId;
  return { severity: 'info', text: 'Звонок завершён.' };
}

let noticeCounter = 0;
const makeNotice = (notice) => ({ id: ++noticeCounter, severity: 'info', ...notice });

export function callsReducer(state, action) {
  switch (action.type) {
    case 'invite': {
      const call = action.call;
      if (!call?.id) return state;
      const selfUserId = String(action.selfUserId ?? '').trim();
      if (state.handledIds.includes(call.id)) return state;
      if (call.status !== 'ringing') return state;
      if (selfUserId && call.initiator_user_id === selfUserId) return state;
      const selfState = getSelfParticipantState(call, selfUserId);
      if (selfState && selfState !== 'invited') return state;
      const knownCalls = call.conversation_id
        ? { ...state.knownCalls, [call.conversation_id]: call }
        : state.knownCalls;
      // Reconnect / second delivery of the same invite: keep the one window.
      if (state.incoming?.call.id === call.id) {
        return state.knownCalls === knownCalls ? state : { ...state, knownCalls };
      }
      // Busy (own call or another invite already ringing): do not stack windows.
      if (state.session || state.incoming) return { ...state, knownCalls };
      return {
        ...state,
        knownCalls,
        incoming: { call, initiator: normalizeInitiator(action.initiator, call) },
      };
    }

    case 'updated': {
      const call = action.call;
      if (!call?.id) return state;
      const selfUserId = String(action.selfUserId ?? '').trim();
      const ended = call.status === 'ended';
      let { handledIds, incoming, session, notice } = state;
      const knownCalls = { ...state.knownCalls };
      if (call.conversation_id) {
        if (ended) {
          if (knownCalls[call.conversation_id]?.id === call.id) delete knownCalls[call.conversation_id];
        } else {
          knownCalls[call.conversation_id] = call;
        }
      }
      if (ended) handledIds = rememberHandled(handledIds, call.id);

      if (incoming?.call.id === call.id) {
        const selfState = getSelfParticipantState(call, selfUserId);
        if (ended) {
          incoming = null;
          if (call.end_reason === 'missed' || call.end_reason === 'cancelled') {
            notice = makeNotice({
              severity: 'info',
              text: `Пропущенный звонок: ${state.incoming.initiator.display_name}.`,
            });
          }
        } else if (selfState && selfState !== 'invited') {
          // Answered or declined from another tab/device.
          incoming = null;
        } else {
          incoming = { ...incoming, call };
        }
      }

      if (session?.call?.id === call.id) {
        if (ended) {
          notice = makeNotice(buildEndNotice(call, {
            selfUserId,
            wasCaller: session.role === 'caller',
          }));
          session = null;
        } else {
          session = { ...session, call };
        }
      }
      return { ...state, knownCalls, handledIds, incoming, session, notice };
    }

    case 'incomingDismiss': {
      if (!state.incoming || (action.callId && state.incoming.call.id !== action.callId)) return state;
      return {
        ...state,
        incoming: null,
        handledIds: rememberHandled(state.handledIds, state.incoming.call.id),
      };
    }

    case 'sessionStarting': {
      if (state.session) return state;
      return {
        ...state,
        session: {
          call: null,
          conversationId: action.conversationId,
          media: action.media,
          role: action.role,
          phase: 'starting',
          error: '',
        },
      };
    }

    case 'sessionAttached': {
      if (!state.session || !action.call?.id) return state;
      const conversationId = action.call.conversation_id;
      return {
        ...state,
        incoming: state.incoming?.call.id === action.call.id ? null : state.incoming,
        knownCalls: conversationId
          ? { ...state.knownCalls, [conversationId]: action.call }
          : state.knownCalls,
        session: {
          ...state.session,
          call: action.call,
          conversationId: conversationId || state.session.conversationId,
          phase: 'connecting',
          // Local start of dialing: the 45 s caller timeout counts from here.
          attachedAt: action.at || Date.now(),
        },
      };
    }

    case 'sessionPhase': {
      if (!state.session) return state;
      // A failed session stays failed until it is closed: late room events must
      // not flip it back to "connected".
      if (state.session.phase === 'error' && action.phase !== 'error') return state;
      const error = action.error ?? (action.phase === 'error' ? state.session.error : '');
      if (state.session.phase === action.phase && state.session.error === error) return state;
      return {
        ...state,
        session: {
          ...state.session,
          phase: action.phase,
          error,
          errorDetail: action.phase === 'error' ? (action.errorDetail || '') : '',
          errorAction: action.phase === 'error' ? (action.errorAction || '') : '',
        },
      };
    }

    case 'sessionEnd': {
      const callId = state.session?.call?.id;
      return {
        ...state,
        session: null,
        handledIds: action.ended ? rememberHandled(state.handledIds, callId) : state.handledIds,
        notice: action.notice ? makeNotice(action.notice) : state.notice,
      };
    }

    case 'callSeen': {
      const conversationId = String(action.conversationId || '').trim();
      if (!conversationId) return state;
      const call = action.call;
      const current = state.knownCalls[conversationId];
      if (!call || call.status === 'ended' || state.handledIds.includes(call.id)) {
        if (!current) return state;
        const knownCalls = { ...state.knownCalls };
        delete knownCalls[conversationId];
        return { ...state, knownCalls };
      }
      if (current?.id === call.id && current.status === call.status) return state;
      return { ...state, knownCalls: { ...state.knownCalls, [conversationId]: call } };
    }

    case 'notice':
      return { ...state, notice: makeNotice(action.notice) };

    case 'noticeClear':
      if (!state.notice || (action.id && state.notice.id !== action.id)) return state;
      return { ...state, notice: null };

    case 'reset':
      return INITIAL_CALLS_STATE;

    default:
      return state;
  }
}

// ---- Errors --------------------------------------------------------------

export function describeCallApiError(error) {
  const status = Number(error?.response?.status || 0);
  const data = error?.response?.data;
  const detail = data && typeof data.detail === 'object' && data.detail ? data.detail : null;
  const code = String(data?.code || detail?.code || '').trim();
  const rawCall = data?.call || detail?.call || null;

  if (status === 409 && code === 'call_already_active') {
    return {
      kind: 'already_active',
      call: normalizeCall(rawCall),
      text: 'В этом чате уже идёт звонок.',
    };
  }
  if (status === 503 || code === 'calls_not_configured') {
    return { kind: 'not_configured', text: 'Звонки пока не настроены на сервере. Обратитесь к администратору.' };
  }
  if (status === 403) {
    return { kind: 'forbidden', text: 'Нет доступа к звонкам в этом чате.' };
  }
  // Backend answers join/leave of a finished call with 409 {code: call_ended, call}.
  if (code === 'call_ended' || status === 404 || status === 410) {
    return { kind: 'gone', call: normalizeCall(rawCall), text: 'Звонок уже завершён.' };
  }
  if (status === 401) {
    return { kind: 'auth', text: 'Сессия истекла. Войдите заново.' };
  }
  if (!status) {
    return { kind: 'network', text: 'Не удалось связаться с сервером. Проверьте подключение.' };
  }
  return { kind: 'unknown', text: 'Не удалось выполнить действие со звонком. Попробуйте ещё раз.' };
}

const DENIED_NAMES = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);
const MISSING_NAMES = new Set(['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError']);
const BUSY_NAMES = new Set(['NotReadableError', 'AbortError', 'TrackStartError']);

export const isMediaDeniedError = (name) => DENIED_NAMES.has(String(name || ''));

function mediaErrorText(name, device) {
  const isCamera = device === 'camera';
  if (DENIED_NAMES.has(name)) {
    return isCamera
      ? 'Нет доступа к камере. Нажмите значок замка рядом с адресом и разрешите камеру. В HUB-IT Desktop: Параметры Windows → Конфиденциальность → Камера → разрешить классическим приложениям.'
      : 'Нет доступа к микрофону. Нажмите значок замка рядом с адресом и разрешите микрофон. В HUB-IT Desktop: Параметры Windows → Конфиденциальность → Микрофон → разрешить классическим приложениям.';
  }
  if (MISSING_NAMES.has(name)) {
    return isCamera
      ? 'Камера не найдена. Проверьте, что камера подключена и включена в Параметрах Windows → Конфиденциальность → Камера.'
      : 'Микрофон не найден. Проверьте, что наушники с микрофоном подключены и выбраны в Windows устройством ввода (Параметры → Система → Звук → Ввод). Наушники без микрофона не подходят.';
  }
  if (BUSY_NAMES.has(name)) {
    return isCamera
      ? 'Камера занята или заблокирована системой. Закройте программы, которые её используют (Teams, Zoom, другая вкладка браузера) и проверьте Параметры Windows → Конфиденциальность → Камера.'
      : 'Микрофон занят или заблокирован системой. Закройте программы, которые его используют (Teams, Zoom, Telegram, другая вкладка браузера) и проверьте Параметры Windows → Конфиденциальность → Микрофон.';
  }
  if (name === 'InsecureContextError') {
    return 'Звонки работают только по защищённому соединению (HTTPS).';
  }
  return isCamera ? 'Не удалось включить камеру.' : 'Не удалось включить микрофон.';
}

// Small grey line under the message: lets a screenshot carry the diagnosis.
export function buildMediaDetail(errorName, inputCount) {
  const parts = [];
  const name = String(errorName || '').trim();
  if (name) parts.push(`Код: ${name}`);
  if (Number.isFinite(inputCount)) parts.push(`Найдено устройств ввода: ${inputCount}`);
  return parts.join(' · ');
}

export function describeMediaFailure(errorName, device = 'microphone', inputCount = undefined) {
  const name = String(errorName || '').trim();
  return {
    text: mediaErrorText(name, device),
    detail: buildMediaDetail(name, inputCount),
  };
}

export function describeMediaError(error, device = 'microphone') {
  return mediaErrorText(String(error?.name || '').trim(), device);
}

// Dialog shown when the microphone cannot be opened before a call is placed/accepted.
export function buildMicPrompt(probe) {
  const name = String(probe?.errorName || '').trim();
  const { text, detail } = describeMediaFailure(name, 'microphone', probe?.inputCount);
  const blocked = DENIED_NAMES.has(name) || name === 'InsecureContextError';
  return { errorName: name, text, detail, canSkip: !blocked };
}

// ---- Formatting ------------------------------------------------------------

export function formatCallDuration(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(totalMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function getInitials(name) {
  const parts = cleanText(name).split(' ').filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.slice(0, 2).map((part) => Array.from(part)[0] || '');
  return letters.join('').toUpperCase() || '?';
}

export const sanitizeDisplayName = (value, fallback = 'Участник') => cleanText(value, fallback);
