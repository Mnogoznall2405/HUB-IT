import { createContext, useContext } from 'react';

export const ChatSidebarSizingContext = createContext({ collapsed: false, setCollapsed: null });
export const useChatSidebarSizing = () => useContext(ChatSidebarSizingContext);
