import { createContext, useContext } from 'react';

export const MainLayoutShellContext = createContext({
  headerMode: 'default',
  drawerOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
  toggleDrawer: () => {},
});

export function useMainLayoutShell() {
  return useContext(MainLayoutShellContext);
}
