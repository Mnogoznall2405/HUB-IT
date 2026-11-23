import { createContext, useContext } from 'react';

export const ChatSidebarSizingContext = createContext({ collapsed: false, compact: false, mode: 'expanded', setCollapsed: null, setMode: null });
export const useChatSidebarSizing = () => useContext(ChatSidebarSizingContext);
