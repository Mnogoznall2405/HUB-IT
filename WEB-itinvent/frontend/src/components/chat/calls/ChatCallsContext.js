import { createContext, useContext } from 'react';

const noop = () => {};
const asyncNoop = async () => false;

// Used when a component renders outside ChatCallsProvider (isolated tests,
// public routes): calls are simply unavailable, nothing else changes.
export const DISABLED_CHAT_CALLS = Object.freeze({
  enabled: false,
  session: null,
  incoming: null,
  incomingBusy: false,
  micPrompt: null,
  resolveMicPrompt: noop,
  knownCalls: {},
  roomSnapshot: null,
  notice: null,
  selfUserId: '',
  startCall: asyncNoop,
  joinCall: asyncNoop,
  acceptIncoming: asyncNoop,
  declineIncoming: noop,
  endCall: noop,
  closeSession: noop,
  refreshActiveCall: noop,
  dismissNotice: noop,
  controls: Object.freeze({
    toggleMicrophone: noop,
    toggleCamera: noop,
    toggleScreenShare: noop,
    resumeAudio: noop,
    listDevices: async () => ({ devices: [], activeId: '' }),
    selectDevice: asyncNoop,
  }),
});

export const ChatCallsContext = createContext(DISABLED_CHAT_CALLS);

export const useChatCalls = () => useContext(ChatCallsContext);
