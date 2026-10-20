import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';

import { chatCallsAPI, leaveCallOnUnload } from '../../../api/chatCalls';
import { useAuth } from '../../../contexts/AuthContext';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../../lib/chatFeature';
import {
  isDesktopMicrophoneDiagnosticsAvailable,
  requestDesktopMicrophoneDiagnosis,
} from '../../../lib/desktopBridge';
import {
  CHAT_SOCKET_CALL_INVITE_EVENT,
  CHAT_SOCKET_CALL_UPDATED_EVENT,
  CHAT_SOCKET_STATUS_EVENT,
} from '../../../lib/chatSocket';
import { buildSystemNotificationId } from '../../../lib/systemNotificationEnvelope';
import { routeSystemNotification } from '../../../lib/systemNotificationRouter';
import ActiveCallPanel from './ActiveCallPanel';
import { ChatCallsContext } from './ChatCallsContext';
import CallNoticeSnackbar from './CallNoticeSnackbar';
import IncomingCallDialog from './IncomingCallDialog';
import MicProblemDialog from './MicProblemDialog';
import { createRingtone } from './callRingtone';
import { buildDesktopMicPrompt } from './desktopMicDiagnosis';
import {
  CALL_DIAL_TIMEOUT_MS,
  CALL_INCOMING_LOCAL_TIMEOUT_MS,
  INITIAL_CALLS_STATE,
  callMediaLabel,
  callsReducer,
  buildMicPrompt,
  describeCallApiError,
  describeMediaFailure,
  normalizeCall,
} from './callsModel';
import { callLog } from './callsLog';
import { connectCallRoom, disconnectAllCallRooms } from './livekitSession';
import {
  probeMicrophone,
  readStoredDeviceId,
  storeDeviceId,
} from './micProbe';

// useNavigate throws outside a Router; this child exists only inside one.
function NavigateRegistrar({ navigateRef }) {
  const navigate = useNavigate();
  navigateRef.current = navigate;
  return null;
}

export default function ChatCallsProvider({ children }) {
  const { user, hasPermission } = useAuth();
  const inRouter = useInRouterContext();
  const selfUserId = user?.id != null ? String(user.id) : '';
  const featureAvailable = CHAT_FEATURE_ENABLED
    && CHAT_WS_ENABLED
    && Boolean(selfUserId)
    && hasPermission('chat.read');

  const [callsEnabled, setCallsEnabled] = useState(false);
  const [state, dispatch] = useReducer(callsReducer, INITIAL_CALLS_STATE);
  const [roomSnapshot, setRoomSnapshot] = useState(null);
  const [incomingBusy, setIncomingBusy] = useState(false);
  const [micPrompt, setMicPrompt] = useState(null);
  const micResolverRef = useRef(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const navigateRef = useRef(null);
  const roomRef = useRef(null);
  const sessionSeqRef = useRef(0);
  const busyRef = useRef(false);
  const unloadLeaveSentRef = useRef('');

  // ---- Feature flag from backend -----------------------------------------
  useEffect(() => {
    if (!featureAvailable) {
      setCallsEnabled(false);
      return undefined;
    }
    let cancelled = false;
    chatCallsAPI.getConfig()
      .then((data) => {
        if (!cancelled) setCallsEnabled(data?.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setCallsEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [featureAvailable, selfUserId]);

  // ---- WS events ---------------------------------------------------------
  useEffect(() => {
    if (!callsEnabled) return undefined;
    const handleInvite = (event) => {
      const payload = event?.detail?.payload || {};
      const call = normalizeCall(payload.call);
      if (!call) return;
      dispatch({ type: 'invite', call, initiator: payload.initiator, selfUserId });
    };
    const handleUpdated = (event) => {
      const call = normalizeCall(event?.detail?.payload?.call);
      if (!call) return;
      dispatch({ type: 'updated', call, selfUserId });
    };
    window.addEventListener(CHAT_SOCKET_CALL_INVITE_EVENT, handleInvite);
    window.addEventListener(CHAT_SOCKET_CALL_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener(CHAT_SOCKET_CALL_INVITE_EVENT, handleInvite);
      window.removeEventListener(CHAT_SOCKET_CALL_UPDATED_EVENT, handleUpdated);
    };
  }, [callsEnabled, selfUserId]);

  // ---- Release the room whenever the session is gone ----------------------
  useEffect(() => {
    if (state.session) return;
    sessionSeqRef.current += 1;
    const handle = roomRef.current;
    roomRef.current = null;
    if (handle) void handle.disconnect('session-ended');
    // Also anything that was still connecting when the session ended.
    void disconnectAllCallRooms('session-ended');
    setRoomSnapshot(null);
  }, [state.session]);

  // ---- Incoming: ringtone, local timeout, system notification --------------
  const ringingIncomingId = state.incoming && !state.session ? state.incoming.call.id : '';
  useEffect(() => {
    if (!ringingIncomingId) return undefined;
    const incoming = stateRef.current.incoming;
    const ringtone = createRingtone('incoming');
    ringtone.start();
    const timeoutId = window.setTimeout(() => {
      dispatch({ type: 'incomingDismiss', callId: ringingIncomingId });
    }, CALL_INCOMING_LOCAL_TIMEOUT_MS);

    const pageHidden = typeof document !== 'undefined'
      && (document.visibilityState !== 'visible' || (document.hasFocus && !document.hasFocus()));
    if (pageHidden && incoming) {
      const notificationId = buildSystemNotificationId('chat', `call-${ringingIncomingId}`);
      const conversationId = incoming.call.conversation_id;
      if (notificationId && conversationId) {
        routeSystemNotification({
          id: notificationId,
          channel: 'chat',
          title: `Входящий ${callMediaLabel(incoming.call.media)}`,
          body: incoming.initiator.display_name,
          route: `/chat?conversation=${encodeURIComponent(conversationId)}`,
          created_at: new Date().toISOString(),
          urgency: 'high',
        }, {
          source: 'chat-call',
          onNavigate: (target) => navigateRef.current?.(target),
          browserTag: notificationId,
        });
      }
    }
    return () => {
      window.clearTimeout(timeoutId);
      ringtone.stop();
    };
  }, [ringingIncomingId]);

  // ---- Caller: ringback + dial timeout ------------------------------------
  const dialingCallId = state.session?.role === 'caller'
    && state.session.phase !== 'error'
    && state.session.call?.status === 'ringing'
    ? state.session.call.id
    : '';
  const finishSessionRef = useRef(null);
  const syncSessionCallRef = useRef(null);
  useEffect(() => {
    if (!dialingCallId) return undefined;
    const ringtone = createRingtone('outgoing');
    ringtone.start();
    // Deadline instead of one long setTimeout: background tabs/WebView2 throttle
    // timers, and the check also runs as soon as the tab becomes visible again.
    const deadline = Number(stateRef.current.session?.attachedAt || Date.now()) + CALL_DIAL_TIMEOUT_MS;
    let fired = false;
    const check = () => {
      if (fired || Date.now() < deadline) return;
      fired = true;
      callLog('dial:timeout', { callId: dialingCallId });
      finishSessionRef.current?.({
        notice: { severity: 'info', text: 'Нет ответа.' },
        ended: true,
      });
    };
    const intervalId = window.setInterval(check, 1000);
    // The backend expires an unanswered call lazily (on the next read) and only
    // then publishes chat.call.updated: poll it as a safety net.
    const pollId = window.setInterval(() => syncSessionCallRef.current?.('dial-poll'), 10_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', check);
      ringtone.stop();
    };
  }, [dialingCallId]);

  // ---- Notice auto-hide -----------------------------------------------------
  const noticeId = state.notice?.id;
  const noticeHasAction = Boolean(state.notice?.action);
  useEffect(() => {
    if (!noticeId) return undefined;
    const timeoutId = window.setTimeout(
      () => dispatch({ type: 'noticeClear', id: noticeId }),
      noticeHasAction ? 12_000 : 6_000,
    );
    return () => window.clearTimeout(timeoutId);
  }, [noticeId, noticeHasAction]);

  // ---- Session lifecycle ----------------------------------------------------
  const finishSession = useCallback(({ notice, leave = true, ended = false } = {}) => {
    const current = stateRef.current.session;
    if (!current) return;
    const callId = current.call?.id;
    callLog('session:end', { callId, source: leave ? 'leave' : 'local' });
    dispatch({ type: 'sessionEnd', notice, ended });
    if (leave && callId) unloadLeaveSentRef.current = callId;
    if (leave && callId) {
      void chatCallsAPI.leaveCall(callId).catch(() => {});
    }
  }, []);
  finishSessionRef.current = finishSession;

  const attachRoom = useCallback(async ({ payload, call, media, mic }) => {
    dispatch({ type: 'sessionAttached', call });
    const seq = sessionSeqRef.current;
    const isCurrent = () => sessionSeqRef.current === seq && Boolean(stateRef.current.session);
    try {
      const handle = await connectCallRoom({
        url: payload.url,
        token: payload.token,
        media,
        callId: call.id,
        onCreated: (created) => {
          // Registered before connect() finishes, so a teardown mid-connect reaches it.
          if (!isCurrent()) {
            void created.disconnect('stale-session');
            return;
          }
          roomRef.current = created;
        },
        micDeviceId: mic?.deviceId || '',
        skipMicrophone: Boolean(mic?.skipped),
        initialMicIssue: mic?.skipped
          ? { errorName: mic.probe?.errorName || '', inputCount: mic.probe?.inputCount }
          : null,
        cameraDeviceId: media === 'video' ? readStoredDeviceId('videoinput') : '',
        onChange: (snapshot) => {
          if (!isCurrent()) return;
          setRoomSnapshot(snapshot);
          if (snapshot.deviceError) {
            dispatch({ type: 'notice', notice: { severity: 'warning', ...snapshot.deviceError } });
          }
          if (snapshot.connection === 'connected') dispatch({ type: 'sessionPhase', phase: 'connected' });
          else if (snapshot.connection === 'reconnecting') dispatch({ type: 'sessionPhase', phase: 'reconnecting' });
        },
        onDisconnected: ({ reason, duplicateIdentity }) => {
          if (!isCurrent()) return;
          if (duplicateIdentity) {
            finishSession({
              notice: { severity: 'warning', text: 'Вы подключились к звонку с другого устройства или вкладки.' },
              leave: false,
            });
            return;
          }
          finishSession({
            notice: {
              severity: 'warning',
              text: reason === 'ROOM_DELETED' ? 'Звонок завершён.' : 'Соединение со звонком потеряно.',
            },
          });
        },
      });
      if (!isCurrent()) {
        void handle.disconnect('stale-session');
        return false;
      }
      roomRef.current = handle;
      setRoomSnapshot(handle.getSnapshot());
      dispatch({ type: 'sessionPhase', phase: 'connected' });
      if (handle.warnings.length) {
        const failures = handle.warnings.map((item) => describeMediaFailure(item.errorName, item.device, item.inputCount));
        dispatch({
          type: 'notice',
          notice: {
            severity: 'warning',
            text: failures.map((item) => item.text).join(' '),
            detail: failures.map((item) => item.detail).filter(Boolean).join(' | '),
          },
        });
      }
      return true;
    } catch (error) {
      if (!isCurrent() || error?.stage === 'aborted') return false;
      roomRef.current = null;
      const chunk = error?.code === 'chunk_load';
      const code = `${error?.stage || 'connect'}:${error?.code || error?.name || 'Error'}`;
      dispatch({
        type: 'sessionPhase',
        phase: 'error',
        error: chunk
          ? 'Доступна новая версия портала. Обновите страницу, чтобы позвонить.'
          : 'Не удалось подключиться к серверу звонков. Проверьте сеть и повторите попытку.',
        errorDetail: `Код: ${code}`,
        errorAction: chunk ? 'reload' : '',
      });
      // Stop ringing the other side: we are not going to answer. Exactly once.
      unloadLeaveSentRef.current = call.id;
      void chatCallsAPI.leaveCall(call.id).catch(() => {});
      return false;
    }
  }, [finishSession]);

  const askMicDecision = useCallback((probe) => new Promise((resolve) => {
    micResolverRef.current?.('cancel');
    micResolverRef.current = resolve;
    const basePrompt = buildMicPrompt(probe);
    if (!isDesktopMicrophoneDiagnosticsAvailable()) {
      setMicPrompt(basePrompt);
      return;
    }
    // HUB-IT Desktop: show the dialog at once, then ask Windows for the reason.
    const pending = buildDesktopMicPrompt(basePrompt, undefined, probe?.errorName);
    setMicPrompt(pending);
    void requestDesktopMicrophoneDiagnosis().then((result) => {
      setMicPrompt((current) => (
        current === pending ? buildDesktopMicPrompt(basePrompt, result?.diagnosis || null, probe?.errorName) : current
      ));
    });
  }), []);

  const resolveMicPrompt = useCallback((decision) => {
    const resolver = micResolverRef.current;
    micResolverRef.current = null;
    setMicPrompt(null);
    resolver?.(decision);
  }, []);

  // Probe the microphone before the server rings anybody. A broken device must
  // not silently kill the call: the user may retry, join listen-only or cancel.
  const acquireMicrophone = useCallback(async () => {
    for (;;) {
      const probe = await probeMicrophone({ preferredDeviceId: readStoredDeviceId('audioinput') });
      if (probe.ok) return { cancelled: false, skipped: false, deviceId: probe.deviceId };
      const decision = await askMicDecision(probe);
      if (decision === 'retry') continue;
      if (decision === 'skip') return { cancelled: false, skipped: true, deviceId: '', probe };
      return { cancelled: true };
    }
  }, [askMicDecision]);

  const runStart = useCallback(async ({ conversationId, media, role, request, joinCallId = '' }) => {
    const mic = await acquireMicrophone();
    if (mic.cancelled) return false;
    dispatch({ type: 'sessionStarting', conversationId, media, role });
    // A room left from a previous call must be gone before the new one starts.
    await disconnectAllCallRooms(`before-${role === 'caller' ? 'start' : 'join'}`);
    let payload;
    try {
      payload = await request();
    } catch (error) {
      const info = describeCallApiError(error);
      callLog(`${role === 'caller' ? 'start' : 'join'}:response:error`, {
        conversationId,
        code: `${error?.response?.status || 0}:${info.kind}`,
      });
      dispatch({ type: 'sessionEnd' });
      if (info.kind === 'already_active' && info.call) {
        dispatch({ type: 'callSeen', conversationId, call: info.call });
        dispatch({
          type: 'notice',
          notice: {
            severity: 'info',
            text: info.text,
            action: { label: 'Присоединиться', call: info.call, media },
          },
        });
      } else {
        if (info.kind === 'gone') {
          // Apply the ended call from the body (if any) so every view of it closes.
          if (info.call?.status === 'ended') dispatch({ type: 'updated', call: info.call, selfUserId });
          dispatch({ type: 'callSeen', conversationId, call: null });
          if (joinCallId) dispatch({ type: 'incomingDismiss', callId: joinCallId });
        }
        dispatch({
          type: 'notice',
          notice: { severity: info.kind === 'network' ? 'warning' : 'error', text: info.text },
        });
      }
      return false;
    }
    const call = normalizeCall(payload?.call);
    callLog(`${role === 'caller' ? 'start' : 'join'}:response`, {
      callId: call?.id,
      conversationId,
      status: call?.status,
      media,
    });
    if (call?.status === 'ended') {
      dispatch({ type: 'sessionEnd' });
      dispatch({ type: 'updated', call, selfUserId });
      dispatch({ type: 'callSeen', conversationId, call: null });
      if (joinCallId) dispatch({ type: 'incomingDismiss', callId: joinCallId });
      dispatch({ type: 'notice', notice: { severity: 'info', text: 'Звонок уже завершён.' } });
      return false;
    }
    if (!call || !payload?.token || !payload?.url) {
      dispatch({ type: 'sessionEnd' });
      dispatch({
        type: 'notice',
        notice: { severity: 'error', text: 'Сервер вернул неполные данные звонка.' },
      });
      return false;
    }
    if (!stateRef.current.session) {
      // The user cancelled while the request was in flight.
      void chatCallsAPI.leaveCall(call.id).catch(() => {});
      return false;
    }
    return attachRoom({ payload, call, media, mic });
  }, [attachRoom, selfUserId, acquireMicrophone]);

  const startCall = useCallback(async (conversationId, media) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!callsEnabled || !normalizedConversationId) return false;
    if (stateRef.current.session || busyRef.current) return false;
    const normalizedMedia = media === 'video' ? 'video' : 'audio';
    busyRef.current = true;
    try {
      return await runStart({
        conversationId: normalizedConversationId,
        media: normalizedMedia,
        role: 'caller',
        request: () => chatCallsAPI.startCall(normalizedConversationId, normalizedMedia),
      });
    } finally {
      busyRef.current = false;
    }
  }, [callsEnabled, runStart]);

  const joinCall = useCallback(async (call, media = 'audio') => {
    const target = call?.id ? call : null;
    if (!callsEnabled || !target) return false;
    if (stateRef.current.session || busyRef.current) return false;
    const normalizedMedia = media === 'video' ? 'video' : 'audio';
    busyRef.current = true;
    setIncomingBusy(true);
    try {
      const joined = await runStart({
        conversationId: target.conversation_id,
        media: normalizedMedia,
        role: 'callee',
        request: () => chatCallsAPI.joinCall(target.id),
        joinCallId: target.id,
      });
      return joined;
    } finally {
      busyRef.current = false;
      setIncomingBusy(false);
    }
  }, [callsEnabled, runStart]);

  const acceptIncoming = useCallback(
    (media) => {
      const incoming = stateRef.current.incoming;
      if (!incoming) return Promise.resolve(false);
      return joinCall(incoming.call, media);
    },
    [joinCall],
  );

  const declineIncoming = useCallback(() => {
    const incoming = stateRef.current.incoming;
    if (!incoming) return;
    dispatch({ type: 'incomingDismiss', callId: incoming.call.id });
    void chatCallsAPI.declineCall(incoming.call.id).catch(() => {});
  }, []);

  const endCall = useCallback(() => finishSession({ leave: true }), [finishSession]);
  const closeSession = useCallback(() => finishSession({ leave: false }), [finishSession]);

  // Re-reads the call of the running session (dial safety net, WS reconnect).
  // The server is authoritative: "no active call" means ours is over.
  const syncSessionCall = useCallback(async (source) => {
    const session = stateRef.current.session;
    const current = session?.call;
    if (!current?.id || !current.conversation_id) return;
    try {
      const data = await chatCallsAPI.getActiveCall(current.conversation_id);
      const latest = stateRef.current.session?.call;
      if (!latest || latest.id !== current.id) return;
      const call = normalizeCall(data?.call);
      if (call && call.id === current.id) {
        dispatch({ type: 'updated', call, selfUserId });
        return;
      }
      callLog('session:sync:gone', { callId: current.id, source });
      dispatch({
        type: 'updated',
        call: { ...latest, status: 'ended', end_reason: latest.end_reason || null },
        selfUserId,
      });
    } catch {
      // Network trouble: the local timers still cover the session.
    }
  }, [selfUserId]);
  syncSessionCallRef.current = syncSessionCall;

  useEffect(() => {
    if (!callsEnabled) return undefined;
    const handleStatus = (event) => {
      if (String(event?.detail?.status || '') !== 'connected') return;
      // Events may have been missed while the socket was down.
      if (stateRef.current.session?.call?.id) void syncSessionCallRef.current?.('ws-reconnect');
    };
    window.addEventListener(CHAT_SOCKET_STATUS_EVENT, handleStatus);
    return () => window.removeEventListener(CHAT_SOCKET_STATUS_EVENT, handleStatus);
  }, [callsEnabled]);

  const refreshActiveCall = useCallback((conversationId) => {
    const id = String(conversationId || '').trim();
    if (!callsEnabled || !id) return;
    chatCallsAPI.getActiveCall(id)
      .then((data) => {
        dispatch({ type: 'callSeen', conversationId: id, call: normalizeCall(data?.call) });
      })
      .catch(() => {});
  }, [callsEnabled]);

  const dismissNotice = useCallback(() => dispatch({ type: 'noticeClear' }), []);

  const controls = useMemo(() => {
    const notifyMediaFailure = (error, device, inputCount) => {
      if (!error) return;
      dispatch({
        type: 'notice',
        notice: { severity: 'warning', ...describeMediaFailure(error?.name, device, inputCount) },
      });
    };
    // Mic is missing (skipped at join or failed): probe again, then attach.
    const retryMicrophone = async (handle) => {
      const probe = await probeMicrophone({ preferredDeviceId: readStoredDeviceId('audioinput') });
      if (!probe.ok) {
        handle.setMicIssue({ errorName: probe.errorName, inputCount: probe.inputCount });
        dispatch({
          type: 'notice',
          notice: { severity: 'warning', ...describeMediaFailure(probe.errorName, 'microphone', probe.inputCount) },
        });
        return;
      }
      const error = await handle.enableMicrophone(probe.deviceId);
      notifyMediaFailure(error, 'microphone');
    };
    return {
      toggleMicrophone: async () => {
        const handle = roomRef.current;
        if (!handle) return;
        const snapshot = handle.getSnapshot();
        if (snapshot.micIssue && !snapshot.micEnabled) {
          await retryMicrophone(handle);
          return;
        }
        notifyMediaFailure(await handle.setMicrophoneEnabled(!snapshot.micEnabled), 'microphone');
      },
      listDevices: async (kind) => (roomRef.current
        ? roomRef.current.listDevices(kind)
        : { devices: [], activeId: '' }),
      selectDevice: async (kind, deviceId) => {
        const handle = roomRef.current;
        if (!handle || !deviceId) return;
        const error = await handle.switchDevice(kind, deviceId);
        if (error) {
          notifyMediaFailure(error, kind === 'videoinput' ? 'camera' : 'microphone');
          return;
        }
        storeDeviceId(kind, deviceId);
      },
      toggleCamera: async () => {
        const handle = roomRef.current;
        if (!handle) return;
        notifyMediaFailure(
          await handle.setCameraEnabled(!handle.getSnapshot().cameraEnabled),
          'camera',
        );
      },
      toggleScreenShare: async () => {
        const handle = roomRef.current;
        if (!handle) return;
        const error = await handle.setScreenShareEnabled(!handle.getSnapshot().screenEnabled);
        // Closing the browser's screen picker is a normal cancel, not a failure.
        if (error && error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
          dispatch({
            type: 'notice',
            notice: { severity: 'warning', text: 'Не удалось начать демонстрацию экрана.' },
          });
        }
      },
      resumeAudio: async () => {
        await roomRef.current?.resumeAudio();
      },
    };
  }, []);

  // ---- Tab close / logout / unmount ------------------------------------------
  useEffect(() => {
    const sendLeave = () => {
      const callId = stateRef.current.session?.call?.id;
      if (!callId || unloadLeaveSentRef.current === callId) return;
      unloadLeaveSentRef.current = callId;
      leaveCallOnUnload(callId);
    };
    window.addEventListener('beforeunload', sendLeave);
    window.addEventListener('pagehide', sendLeave);
    return () => {
      window.removeEventListener('beforeunload', sendLeave);
      window.removeEventListener('pagehide', sendLeave);
    };
  }, []);

  useEffect(() => () => {
    // User switched/logged out or the provider unmounted: free tracks and room.
    micResolverRef.current?.('cancel');
    micResolverRef.current = null;
    const callId = stateRef.current.session?.call?.id;
    sessionSeqRef.current += 1;
    const handle = roomRef.current;
    roomRef.current = null;
    if (handle) void handle.disconnect('provider-unmount');
    void disconnectAllCallRooms('provider-unmount');
    if (callId) leaveCallOnUnload(callId);
    dispatch({ type: 'reset' });
  }, [selfUserId]);

  const value = useMemo(() => ({
    enabled: callsEnabled,
    session: state.session,
    incoming: state.incoming,
    incomingBusy,
    micPrompt,
    resolveMicPrompt,
    knownCalls: state.knownCalls,
    roomSnapshot,
    notice: state.notice,
    selfUserId,
    startCall,
    joinCall,
    acceptIncoming,
    declineIncoming,
    endCall,
    closeSession,
    refreshActiveCall,
    dismissNotice,
    controls,
  }), [
    callsEnabled,
    state.session,
    state.incoming,
    incomingBusy,
    micPrompt,
    resolveMicPrompt,
    state.knownCalls,
    roomSnapshot,
    state.notice,
    selfUserId,
    startCall,
    joinCall,
    acceptIncoming,
    declineIncoming,
    endCall,
    closeSession,
    refreshActiveCall,
    dismissNotice,
    controls,
  ]);

  return (
    <ChatCallsContext.Provider value={value}>
      {children}
      {inRouter ? <NavigateRegistrar navigateRef={navigateRef} /> : null}
      {callsEnabled ? (
        <>
          <IncomingCallDialog />
          <MicProblemDialog />
          <ActiveCallPanel />
          <CallNoticeSnackbar />
        </>
      ) : null}
    </ChatCallsContext.Provider>
  );
}
