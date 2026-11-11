import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { chatDirectoryAPI } from '../api/chatDirectory';
import { chatConversationsAPI } from '../api/chatConversations';
import { buildHubitProtocolHref, canOfferDesktopHandoff, launchDesktopConversation, launchHubitProtocol } from '../lib/desktopProtocolHandoff';
import { consumePostAuthReturnPath, peekPostAuthReturnPath } from '../lib/aboutOnboarding';

export default function ChatOpen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState(null);
  const [handoffWaiting, setHandoffWaiting] = useState(false);
  const lookupRef = useRef(null);
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const values = params.getAll('email');
  const email = values.length === 1 ? values[0].trim().toLowerCase() : '';
  const valid = email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const requestKey = `${user?.id}:${email}:${attempt}`;
  const conversationRoute = resolved?.key === requestKey ? resolved.route : '';

  useEffect(() => {
    try {
      if (peekPostAuthReturnPath() === `/chat/open${location.search}${location.hash}`) consumePostAuthReturnPath();
    } catch {
      // The recipient remains in the URL even if storage is unavailable.
    }
  }, [location.search, location.hash]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setResolved(null);
    if (!valid) {
      setError('В ссылке не указан корректный рабочий e-mail сотрудника. Откройте его карточку на портале ещё раз.');
      return () => { cancelled = true; };
    }
    const key = `${user?.id}:${email}:${attempt}`;
    if (lookupRef.current?.key !== key) {
      lookupRef.current = { key, promise: chatDirectoryAPI.resolveUser({ email, strict_email: true }) };
    }
    const lookup = lookupRef.current.promise;
    const open = async () => {
      try {
        const peer = await lookup;
        if (cancelled) return;
        const id = Number(peer?.id);
        if (!Number.isSafeInteger(id) || id <= 0 || id === Number(user?.id)) {
          throw new Error('Не удалось определить сотрудника для личного диалога.');
        }
        const conversation = await chatConversationsAPI.createDirectConversation(id);
        if (cancelled) return;
        const conversationId = String(conversation?.id || '').trim();
        if (!conversationId) throw new Error('Не удалось открыть личный диалог.');
        setResolved({ key, route: `/chat?conversation=${encodeURIComponent(conversationId)}` });
      } catch (problem) {
        if (cancelled) return;
        const detail = problem?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : problem?.message || 'Не удалось открыть чат. Попробуйте ещё раз.');
      }
    };
    void open();
    return () => { cancelled = true; };
  }, [email, valid, attempt, user?.id, navigate]);

  useEffect(() => {
    if (!conversationRoute) return undefined;
    const openBrowser = () => navigate(conversationRoute, { replace: true });
    if (!canOfferDesktopHandoff()) {
      openBrowser();
      return undefined;
    }
    setHandoffWaiting(true);
    return launchDesktopConversation(conversationRoute, {
      onFallback: openBrowser,
      onHandoff: () => setHandoffWaiting(false),
    });
  }, [conversationRoute, navigate]);

  return (
    <MainLayout showDatabaseSelector={false}>
      <Box sx={{ maxWidth: 560, mx: 'auto', py: { xs: 3, sm: 6 }, px: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h5">Личный диалог</Typography>
          {error ? (
            <>
              <Alert severity="warning">{error}</Alert>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {valid && <Button variant="contained" onClick={() => setAttempt((value) => value + 1)}>Повторить</Button>}
                <Button onClick={() => navigate('/chat', { replace: true })}>К списку чатов</Button>
              </Stack>
            </>
          ) : conversationRoute ? (
            <>
              <Typography role="status">
                {handoffWaiting ? 'Открываем HUB Desktop…' : 'Продолжите в HUB Desktop или откройте диалог в браузере.'}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button variant="contained" onClick={() => {
                  // A real user gesture also permits launch when an automatic protocol request was blocked.
                  launchHubitProtocol(buildHubitProtocolHref(conversationRoute));
                }}>Открыть приложение</Button>
                <Button onClick={() => navigate(conversationRoute, { replace: true })}>Продолжить в браузере</Button>
              </Stack>
            </>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center" role="status">
              <CircularProgress size={22} />
              <Typography>Открываем чат с сотрудником…</Typography>
            </Stack>
          )}
        </Stack>
      </Box>
    </MainLayout>
  );
}
