import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import AddressBookEntryDetail from '../components/addressBook/AddressBookEntryDetail';
import AddressBookEntryList from '../components/addressBook/AddressBookEntryList';
import AddressBookEntrySheet from '../components/addressBook/AddressBookEntrySheet';
import AddressBookMobileToolbar from '../components/addressBook/AddressBookMobileToolbar';
import {
  formatDateTime,
  getEntryKey,
  hideScrollbarSx,
  normalizeText,
} from '../components/addressBook/addressBookUtils';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { isValidEmailRecipient } from '../components/mail/mailComposeState';
import { addressBookAPI } from '../api/addressBook';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { openAddressBookChat } from '../lib/addressBookChat';
import { CHAT_FEATURE_ENABLED } from '../lib/chatFeature';
import { isPhoneDeepLinkReady, openTelegramChat } from '../lib/messengerLinks';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 50;

const useDebouncedValue = (value, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const AddressBook = () => {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const canUseChat = CHAT_FEATURE_ENABLED && hasPermission('chat.read') && hasPermission('chat.write');
  const searchInputRef = useRef(null);
  const pageShellRef = useRef(null);

  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [selectedEntryKey, setSelectedEntryKey] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [maxHelpAnchorEl, setMaxHelpAnchorEl] = useState(null);
  const [maxHelpPhone, setMaxHelpPhone] = useState('');
  const [chatBusyEntryKey, setChatBusyEntryKey] = useState('');
  const debouncedQuery = useDebouncedValue(query);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await addressBookAPI.getStatus());
    } catch (err) {
      console.error('Failed to load address book status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadItems = useCallback(async (nextQuery) => {
    setLoading(true);
    setError('');
    try {
      const data = await addressBookAPI.search({ q: nextQuery, limit: SEARCH_LIMIT });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
      setStatus((prev) => ({
        ...(prev || {}),
        updated_at: data?.updated_at || prev?.updated_at || '',
        last_error: data?.last_error || prev?.last_error || '',
      }));
    } catch (err) {
      console.error('Failed to search address book:', err);
      setError('Не удалось загрузить адресную книгу.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(debouncedQuery);
  }, [debouncedQuery, loadItems]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!isMobile) return undefined;

    const logLayout = (trigger) => {
      const main = document.querySelector('[data-testid="main-layout-content"]');
      const pageShell = pageShellRef.current;
      const listScroll = document.querySelector('[data-testid="address-book-entry-list-scroll"]');
      const bottomNav = document.querySelector('[data-testid="main-layout-mobile-bottom-nav"]');
      const shellRoot = document.querySelector('[data-testid="main-layout-shell"]');
      const mainStyles = main ? window.getComputedStyle(main) : null;
      const pageShellStyles = pageShell ? window.getComputedStyle(pageShell) : null;
      const listScrollStyles = listScroll ? window.getComputedStyle(listScroll) : null;
      const mainRect = main?.getBoundingClientRect();
      const pageShellRect = pageShell?.getBoundingClientRect();
      const listScrollRect = listScroll?.getBoundingClientRect();
      const bottomNavRect = bottomNav?.getBoundingClientRect();
      const cssVarNavHeight = shellRoot
        ? window.getComputedStyle(shellRoot).getPropertyValue('--app-shell-mobile-bottom-nav-height').trim()
        : '';
      const mainPbPx = mainStyles ? Number.parseFloat(mainStyles.paddingBottom) || 0 : 0;
      const pageShellPbPx = pageShellStyles ? Number.parseFloat(pageShellStyles.paddingBottom) || 0 : 0;
      const listBottom = listScrollRect?.bottom ?? 0;
      const navTop = bottomNavRect?.top ?? window.innerHeight;
      const gapPx = Math.round((navTop - listBottom) * 100) / 100;
      const hasHorizontalOverflow = Boolean(
        main && main.scrollWidth > main.clientWidth + 1,
      ) || Boolean(
        pageShell && pageShell.scrollWidth > pageShell.clientWidth + 1,
      );

      const hypotheses = [];
      if (mainPbPx > 0 && pageShellPbPx > 0) hypotheses.push('A');
      if (pageShellStyles?.height?.includes('calc(') && gapPx > 4) hypotheses.push('B');
      if (hasHorizontalOverflow || listScrollStyles?.overflowX === 'scroll') hypotheses.push('C');
      if (cssVarNavHeight && bottomNavRect && Math.abs(bottomNavRect.height - Number.parseFloat(cssVarNavHeight)) > 6) {
        hypotheses.push('D');
      }
      if (gapPx > 4) hypotheses.push('E');

      // #region agent log
      fetch('http://127.0.0.1:7567/ingest/0dd98d48-9716-48e2-8a2d-050e49aa7cea', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '891634',
        },
        body: JSON.stringify({
          sessionId: '891634',
          runId: 'post-fix',
          hypothesisId: hypotheses.join(',') || 'none',
          location: 'AddressBook.jsx:layoutMeasure',
          message: 'address-book mobile layout metrics',
          data: {
            trigger,
            mainPb: mainStyles?.paddingBottom ?? null,
            mainPbPx,
            pageShellPb: pageShellStyles?.paddingBottom ?? null,
            pageShellPbPx,
            pageShellHeight: pageShellStyles?.height ?? null,
            pageShellRectHeight: pageShellRect?.height ?? null,
            mainClientHeight: main?.clientHeight ?? null,
            mainContentHeight: mainRect ? mainRect.height - mainPbPx - (Number.parseFloat(mainStyles?.paddingTop) || 0) : null,
            listScrollBottom: listBottom,
            bottomNavTop: navTop,
            gapPx,
            cssVarNavHeight,
            bottomNavHeight: bottomNavRect?.height ?? null,
            viewportHeight: window.innerHeight,
            hasHorizontalOverflow,
            listFlex: listScroll?.parentElement ? window.getComputedStyle(listScroll.parentElement).flex : null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    };

    const handleMeasure = () => logLayout('measure');
    const rafId = window.requestAnimationFrame(handleMeasure);
    window.addEventListener('resize', handleMeasure);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleMeasure);
    };
  }, [isMobile, items.length, loading]);

  useEffect(() => {
    if (isMobile || items.length === 0) return;
    const keys = items.map((item, index) => getEntryKey(item, index));
    if (!keys.includes(selectedEntryKey)) {
      setSelectedEntryKey(keys[0]);
    }
  }, [isMobile, items, selectedEntryKey]);

  const selectedItem = useMemo(() => {
    const index = items.findIndex((item, idx) => getEntryKey(item, idx) === selectedEntryKey);
    return index >= 0 ? items[index] : null;
  }, [items, selectedEntryKey]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError('');
    try {
      const nextStatus = await addressBookAPI.sync();
      setStatus(nextStatus);
      await loadItems(debouncedQuery);
    } catch (err) {
      console.error('Failed to sync address book:', err);
      setError('Не удалось обновить адресную книгу из 1С.');
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }, [debouncedQuery, loadItems, loadStatus]);

  const handleCopy = useCallback(async (value) => {
    const text = normalizeText(value);
    if (!text) return;
    const isEmail = isValidEmailRecipient(text);
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(isEmail ? 'E-mail скопирован' : 'Номер скопирован', {
        source: 'address-book-copy',
        dedupeMode: 'none',
        durationMs: 1800,
      });
    } catch {
      notifyWarning(isEmail ? 'Не удалось скопировать e-mail' : 'Не удалось скопировать номер', {
        source: 'address-book-copy',
        dedupeMode: 'none',
      });
    }
  }, [notifySuccess, notifyWarning]);

  const handleOpenTelegram = useCallback((phoneDigits) => {
    const opened = openTelegramChat(phoneDigits);
    if (!opened) {
      notifyWarning('Номер не подходит для Telegram', { source: 'address-book-telegram', dedupeMode: 'none' });
    }
  }, [notifyWarning]);

  const handleOpenMax = useCallback(async (phoneDigits, anchorEl) => {
    const digits = normalizeText(phoneDigits);
    if (!isPhoneDeepLinkReady(digits)) {
      notifyWarning('Номер не подходит для MAX', { source: 'address-book-max', dedupeMode: 'none' });
      return;
    }
    const formatted = `+${digits}`;
    try {
      await navigator.clipboard.writeText(formatted);
      setMaxHelpPhone(formatted);
      setMaxHelpAnchorEl(anchorEl || null);
      notifySuccess('Номер скопирован для MAX', { source: 'address-book-max', dedupeMode: 'none', durationMs: 1800 });
    } catch {
      notifyWarning('Не удалось скопировать номер', { source: 'address-book-max', dedupeMode: 'none' });
    }
  }, [notifySuccess, notifyWarning]);

  const handleOpenChat = useCallback(async (item, index = 0) => {
    const entryKey = getEntryKey(item, index);
    setChatBusyEntryKey(entryKey);
    try {
      await openAddressBookChat({ entry: item, navigate });
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status === 404) {
        notifyWarning(
          error?.response?.data?.detail || 'Сотрудник не найден в HUB-чате. Возможно, у него нет учётной записи.',
          { source: 'address-book-chat', dedupeMode: 'none' },
        );
      } else {
        notifyApiError(error, 'Не удалось открыть корпоративный чат.', { dedupeMode: 'none' });
      }
    } finally {
      setChatBusyEntryKey('');
    }
  }, [navigate, notifyApiError, notifyWarning]);

  const handleComposeEmail = useCallback((email) => {
    const recipient = normalizeText(email);
    if (!isValidEmailRecipient(recipient)) {
      notifyWarning('Некорректный e-mail', { source: 'address-book-email', dedupeMode: 'none' });
      return;
    }
    navigate(`/mail?folder=inbox&compose_to=${encodeURIComponent(recipient)}`);
  }, [navigate, notifyWarning]);

  const handleSelectEntry = useCallback((item, index) => {
    const key = getEntryKey(item, index);
    setSelectedEntryKey(key);
    if (isMobile) {
      setMobileSheetOpen(true);
    }
  }, [isMobile]);

  const handleListSelect = useCallback((item, index) => {
    handleSelectEntry(item, index);
  }, [handleSelectEntry]);

  const panelSx = useMemo(() => getOfficePanelSx(ui), [ui]);
  const countLabel = total > SEARCH_LIMIT ? `Найдено ${total}, показано ${SEARCH_LIMIT}` : `Найдено ${total}`;

  return (
    <MainLayout showDatabaseSelector={false}>
      <PageShell
        ref={pageShellRef}
        fullHeight
        sx={{ gap: { xs: 0.75, sm: 2 } }}
      >
        {isMobile ? (
          <AddressBookMobileToolbar
            total={total}
            searchLimit={SEARCH_LIMIT}
            query={query}
            searchInputRef={searchInputRef}
            onQueryChange={(event) => setQuery(event.target.value)}
            onClearQuery={() => setQuery('')}
            isAdmin={isAdmin}
            syncing={syncing}
            statusUpdatedAt={status?.updated_at}
            onSync={handleSync}
          />
        ) : (
          <>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ xs: 'stretch', md: 'center' }}
              justifyContent="space-between"
              spacing={1.5}
              sx={{ flexShrink: 0 }}
            >
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  Адресная книга
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {countLabel}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={`Обновлено: ${formatDateTime(status?.updated_at)}`}
                  size="small"
                  variant="outlined"
                />
                {isAdmin ? (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    Обновить
                  </Button>
                ) : null}
              </Stack>
            </Stack>

            <Paper sx={{ ...panelSx, p: 1.5, flexShrink: 0 }}>
              <TextField
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                fullWidth
                placeholder="ФИО, должность, подразделение, город, телефон или e-mail"
                size="small"
                inputRef={searchInputRef}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: query ? (
                    <InputAdornment position="end">
                      <Tooltip title="Очистить поиск">
                        <IconButton
                          aria-label="Очистить поиск"
                          edge="end"
                          size="small"
                          onClick={() => setQuery('')}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : null,
                }}
                inputProps={{ 'data-testid': 'address-book-search-input' }}
              />
            </Paper>
          </>
        )}

        {error ? <Alert severity="error">{error}</Alert> : null}
        {status?.last_error ? <Alert severity="warning">Последняя синхронизация завершилась ошибкой: {status.last_error}</Alert> : null}
        {statusLoading && isAdmin ? <Alert severity="info">Статус синхронизации обновляется...</Alert> : null}

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Grid
            container
            spacing={{ xs: 0, sm: 2 }}
            sx={{
              flex: 1,
              minHeight: 0,
              height: '100%',
            }}
          >
            <Grid
              item
              xs={12}
              sm={5}
              md={4}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                height: '100%',
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  WebkitOverflowScrolling: 'touch',
                  ...hideScrollbarSx,
                }}
                data-testid="address-book-entry-list-scroll"
              >
                <AddressBookEntryList
                  items={items}
                  selectedEntryKey={selectedEntryKey}
                  loading={loading}
                  query={query}
                  enableTelLinks={isMobile}
                  onSelect={handleListSelect}
                  onOpenTelegram={handleOpenTelegram}
                  onComposeEmail={handleComposeEmail}
                  onOpenChat={handleOpenChat}
                  showChatAction={canUseChat}
                  chatBusyEntryKey={chatBusyEntryKey}
                />
              </Box>
            </Grid>

            {!isMobile ? (
              <Grid
                item
                sm={7}
                md={8}
                sx={{
                  display: { xs: 'none', sm: 'flex' },
                  flexDirection: 'column',
                  minHeight: 0,
                  height: '100%',
                }}
              >
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                    ...hideScrollbarSx,
                  }}
                  data-testid="address-book-entry-detail-scroll"
                >
                  <AddressBookEntryDetail
                    item={selectedItem}
                    query={query}
                    enableTelLinks={false}
                    onCopy={handleCopy}
                    onOpenTelegram={handleOpenTelegram}
                    onOpenMax={handleOpenMax}
                    onComposeEmail={handleComposeEmail}
                    onOpenChat={(item) => handleOpenChat(item, items.findIndex((entry, idx) => getEntryKey(entry, idx) === selectedEntryKey))}
                    showChatAction={canUseChat}
                    chatBusy={Boolean(chatBusyEntryKey)}
                  />
                </Box>
              </Grid>
            ) : null}
          </Grid>
        </Box>

        <AddressBookEntrySheet
          open={mobileSheetOpen && Boolean(selectedItem)}
          item={selectedItem}
          query={query}
          enableTelLinks={isMobile}
          onClose={() => setMobileSheetOpen(false)}
          onCopy={handleCopy}
          onOpenTelegram={handleOpenTelegram}
          onOpenMax={handleOpenMax}
          onComposeEmail={handleComposeEmail}
          onOpenChat={(item) => handleOpenChat(item, items.findIndex((entry, idx) => getEntryKey(entry, idx) === selectedEntryKey))}
          showChatAction={canUseChat}
          chatBusy={Boolean(chatBusyEntryKey)}
        />

        <Popover
          open={Boolean(maxHelpAnchorEl)}
          anchorEl={maxHelpAnchorEl}
          onClose={() => setMaxHelpAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Box sx={{ p: 2, maxWidth: 280 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Как найти контакт в MAX
            </Typography>
            <Stack component="ol" spacing={0.75} sx={{ m: 0, pl: 2.25 }}>
              <Typography component="li" variant="body2">Откройте приложение MAX</Typography>
              <Typography component="li" variant="body2">Нажмите поиск</Typography>
              <Typography component="li" variant="body2">
                Вставьте скопированный номер{maxHelpPhone ? `: ${maxHelpPhone}` : ''}
              </Typography>
            </Stack>
          </Box>
        </Popover>
      </PageShell>
    </MainLayout>
  );
};

export default AddressBook;
