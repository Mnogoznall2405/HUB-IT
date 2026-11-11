import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import { NotificationProvider } from '../../src/contexts/NotificationContext';
import { PreferencesProvider } from '../../src/contexts/PreferencesContext';
import { ConfirmDialogProvider } from '../../src/components/feedback/ConfirmDialogProvider';
import KnowledgeBase from '../../src/pages/KnowledgeBase';

createRoot(document.getElementById('root')).render(
  <PreferencesProvider><NotificationProvider><ConfirmDialogProvider><AuthProvider><BrowserRouter>
    <KnowledgeBase />
  </BrowserRouter></AuthProvider></ConfirmDialogProvider></NotificationProvider></PreferencesProvider>,
);
