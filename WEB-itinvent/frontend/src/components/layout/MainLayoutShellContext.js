import { createContext, useContext } from 'react';

export const MainLayoutShellContext = createContext({
  headerMode: 'default',
  drawerOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
  toggleDrawer: () => {},
  openNotifications: () => {},
  notificationsBadgeValue: 0,
  showNotificationsButton: false,
  showDatabaseSelector: false,
  databases: [],
  currentDb: null,
  currentDbName: 'База данных',
  dbLoading: false,
  dbLocked: false,
  onDatabaseChange: () => {},
});

export function useMainLayoutShell() {
  return useContext(MainLayoutShellContext);
}
