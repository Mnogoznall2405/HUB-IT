import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import AuthContext from '../../src/contexts/AuthContext';
import theme from '../../src/theme';
import MyFilesEditorShell from '../../src/components/myFiles/MyFilesEditorShell';
import MyFilesOfficeEditorDialog from '../../src/components/myFiles/MyFilesOfficeEditorDialog';

function Harness() {
  const [user, setUser] = useState({ id: 1, username: 'editor-one' });
  const [closed, setClosed] = useState(false);
  const [title, setTitle] = useState('План.docx');
  return <ThemeProvider theme={theme}>
    <AuthContext.Provider value={{ user, hasPermission: (permission) => !new URLSearchParams(location.search).has(`deny-${permission}`) }}>
      <button onClick={() => setUser({ id: 2, username: 'editor-two' })}>Сменить пользователя</button>
      {closed ? <p>Редактор закрыт</p> : new URLSearchParams(location.search).has('dialog') ? (
        <MyFilesOfficeEditorDialog open file={{ id: 'recovery-file', original_file_name: title }} onClose={() => setClosed(true)} />
      ) : (
        <main style={{ height: '85vh', display: 'flex', flexDirection: 'column' }}>
          <MyFilesEditorShell fileId="recovery-file" fileName={title} onTitle={setTitle} onClose={() => setClosed(true)} onDownload={() => {}} />
        </main>
      )}
    </AuthContext.Provider>
  </ThemeProvider>;
}

createRoot(document.getElementById('root')).render(<Harness />);
