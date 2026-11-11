import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import AuthContext from '../../src/contexts/AuthContext';
import { NotificationProvider } from '../../src/contexts/NotificationContext';
import MyFilesAdminTab from '../../src/pages/account/admin/MyFilesAdminTab';
import theme from '../../src/theme';

function Harness() {
  const [user, setUser] = useState({ id: 1, username: 'admin-one', role: new URLSearchParams(location.search).has('viewer') ? 'viewer' : 'admin' });
  return <ThemeProvider theme={theme}><CssBaseline /><MemoryRouter>
    <AuthContext.Provider value={{ user, hasPermission: () => true }}><NotificationProvider>
      <button onClick={() => setUser({ id: 2, username: 'admin-two', role: 'admin' })}>Сменить администратора</button>
      <button onClick={() => setUser({ id: 3, username: 'viewer', role: 'viewer' })}>Снять роль администратора</button>
      <main style={{ padding: 12, minWidth: 0 }}><MyFilesAdminTab /></main>
    </NotificationProvider></AuthContext.Provider>
  </MemoryRouter></ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<Harness />);
