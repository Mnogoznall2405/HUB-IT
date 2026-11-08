import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import AuthContext from '../../src/contexts/AuthContext';
import theme from '../../src/theme';
import MyFilesEditorWorkspace from '../../src/components/myFiles/MyFilesEditorWorkspace';
import MyFilesEditorShell from '../../src/components/myFiles/MyFilesEditorShell';

function Workspace() {
  const { fileId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  if (new URLSearchParams(window.location.search).get('single') === '1') {
    return <main style={{ display: 'flex', height: '100vh' }}><MyFilesEditorShell fileId={fileId} fileName={`${fileId}.docx`} /></main>;
  }
  return <MyFilesEditorWorkspace fileId={fileId} requestKey={location.key} onTitle={title => { document.title = title; }}
    onActiveDocumentChange={id => { if (id !== fileId) navigate(`/my-files/edit/${id}`, { replace: true }); }}
    onCloseLast={() => navigate('/closed')} />;
}

function Harness() {
  const navigate = useNavigate();
  const [user, setUser] = useState({ id: 1, username: 'first' });
  return <ThemeProvider theme={theme}><AuthContext.Provider value={{ user, hasPermission: () => true }}>
    <nav style={{ height: 30, position: 'fixed', bottom: 0, zIndex: 10, display: 'flex', maxWidth: '100%', fontSize: 10 }} aria-label="Тестовые команды Desktop">
      <button onClick={() => navigate('/my-files/edit/file-a')}>Открыть A</button>
      <button onClick={() => navigate('/my-files/edit/file-b')}>Открыть B</button>
      <button onClick={() => navigate('/my-files/edit/file-c')}>Открыть C</button>
      <button onClick={() => setUser({ id: 2, username: 'second' })}>Сменить аккаунт</button>
    </nav>
    <Routes><Route path="/my-files/edit/:fileId" element={<Workspace />} /><Route path="/closed" element={<p>Все документы закрыты</p>} /></Routes>
  </AuthContext.Provider></ThemeProvider>;
}

createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/my-files/edit/file-a']}><Harness /></MemoryRouter>);
