import { createContext, useContext, useMemo } from 'react';

const ChatPageContext = createContext(null);

export function ChatPageProvider({ controller, children }) {
  const value = useMemo(() => controller || {}, [controller]);
  return (
    <ChatPageContext.Provider value={value}>
      {children}
    </ChatPageContext.Provider>
  );
}

export function useChatPageContext() {
  const context = useContext(ChatPageContext);
  if (!context) {
    throw new Error('useChatPageContext must be used within ChatPageProvider');
  }
  return context;
}

export function useChatThreadSlice() {
  return useChatPageContext().thread || {};
}

export function useChatSidebarSlice() {
  return useChatPageContext().sidebar || {};
}

export function useChatUiSlice() {
  return useChatPageContext().ui || {};
}

export default ChatPageContext;
