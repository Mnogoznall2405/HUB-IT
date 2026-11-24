import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  Stack,
  Tab,
  Tabs,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
import { fsEgressAPI } from '../api/fsEgress';
import DlpOverview from '../components/dlp/DlpOverview';
import DlpHostList from '../components/dlp/DlpHostList';
import DlpHostHeader from '../components/dlp/DlpHostHeader';
import DlpActivityBlock from '../components/dlp/DlpActivityBlock';
import { TelegramDialogPanel } from '../components/dlp/TelegramDialogPanel';
import { HostFilesTable } from '../components/dlp/HostFilesTable';
import { BrowserVisitsPanel } from '../components/dlp/BrowserVisitsPanel';
import { DlpSummaryInline } from '../components/dlp/stats';
import { dayAtUtcOffset, normalizeHost } from '../components/dlp/utils';

const HOST_TABS = ['files', 'telegram', 'max', 'browser'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_SCROLL_KEY = 'dlp_hostlist_scroll';

// The overview/attention rollups are explicitly Tyumen (UTC+05) days; the
// per-host activity view resolves its own branch-local day on the server.
function todayKey() {
  return dayAtUtcOffset(Date.now(), 300);
}

export default function FileEgress() {
  const [hosts, setHosts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [attention, setAttention] = useState([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [tgChats, setTgChats] = useState([]);
  const [maxChats, setMaxChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportHtml, setReportHtml] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const loadInFlight = useRef(false);
  const [channel, setChannel] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();

  // Page state lives in the URL: back/forward and F5 keep host/tab/day.
  const selectedHost = normalizeHost(searchParams.get('host') || '');
  const rawTab = searchParams.get('tab') || 'files';
  const hostTab = HOST_TABS.includes(rawTab) ? rawTab : 'files';
  const rawDay = searchParams.get('day') || '';
  const day = DAY_RE.test(rawDay) ? rawDay : todayKey();
  // Server-resolved branch day for the open host (local_time.day); the URL
  // keeps no ?day until the user picks one explicitly.
  const [hostResolvedDay, setHostResolvedDay] = useState('');
  // One-shot category for the browser panel: set when a metric deep-links into
  // a host's filtered browser view, not kept in the URL — the panel owns its
  // filter afterwards.
  const [browserCategory, setBrowserCategory] = useState('');
  const hostSectionRef = useRef(null);
  const showHostList = useCallback(() => {
    const el = hostSectionRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const setParams = useCallback(
    (patch) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([key, value]) => {
          if (value) next.set(key, value);
          else next.delete(key);
        });
        return next;
      });
    },
    [setSearchParams],
  );

  useEffect(() => {
    setHostResolvedDay('');
  }, [selectedHost, rawDay]);

  const openHost = useCallback(
    (name) => {
      setParams({ host: name, tab: 'files', day: rawDay || '' });
      setChannel('all');
      setBrowserCategory('');
    },
    [setParams, rawDay],
  );

  // Entertainment column deep-link: open the host straight on the browser tab
  // filtered to entertainment sites.
  const openHostEntertainment = useCallback(
    (name) => {
      setParams({ host: name, tab: 'browser', day: rawDay || '' });
      setBrowserCategory('entertainment');
    },
    [setParams, rawDay],
  );

  const closeHost = useCallback(() => {
    setParams({ host: '', tab: '', day: rawDay || '' });
  }, [setParams, rawDay]);

  const setDay = useCallback((value) => setParams({ day: value }), [setParams]);
  const setHostTab = useCallback((value) => setParams({ tab: value }), [setParams]);

  // Esc on a host card works like "К списку хостов"; open dialogs/menus and
  // focused text inputs keep their own Esc semantics.
  useEffect(() => {
    if (!selectedHost) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.MuiModal-root, .MuiPopover-root')) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      closeHost();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedHost, closeHost]);

  // Host list scroll position survives the host round trip (and F5): write the
  // trailing value on scroll, restore when the list remounts.
  const scrollSaveTimer = useRef(0);
  const onListScroll = useCallback((event) => {
    const top = event.currentTarget.scrollTop;
    window.clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = window.setTimeout(() => {
      try {
        sessionStorage.setItem(LIST_SCROLL_KEY, String(Math.round(top)));
      } catch {
        // sessionStorage may be unavailable — scroll restore just skips.
      }
    }, 150);
  }, []);
  const listScrollRef = useCallback((el) => {
    if (!el) return;
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(LIST_SCROLL_KEY) || 0);
    } catch {
      saved = 0;
    }
    if (saved <= 0) return;
    el.scrollTop = saved;
    // Collapsed groups may still be mounting — re-apply after layout settles.
    requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
  }, []);

  const load = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const [hostsRes, summaryRes] = await Promise.all([
        fsEgressAPI.listDlpHosts(),
        fsEgressAPI.getDlpSummary(),
      ]);
      setHosts(Array.isArray(hostsRes.data?.hosts) ? hostsRes.data.hosts : []);
      setSummary(summaryRes.data?.summary || null);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Ошибка загрузки');
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Per-day rollup for KPI/rating/day columns — independent of the hosts list.
  useEffect(() => {
    let cancelled = false;
    setAttentionLoading(true);
    fsEgressAPI
      .getDlpAttention(day)
      .then((res) => {
        if (!cancelled) setAttention(Array.isArray(res.data?.hosts) ? res.data.hosts : []);
      })
      .catch(() => {
        if (!cancelled) setAttention([]);
      })
      .finally(() => {
        if (!cancelled) setAttentionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [day]);

  const attentionMap = useMemo(() => {
    const map = new Map();
    for (const row of attention) {
      map.set(String(row.computer_name || '').toUpperCase(), row);
    }
    return map;
  }, [attention]);

  // Chats are loaded per selected host: the global lists are capped and would
  // silently miss hosts beyond the first page.
  useEffect(() => {
    let cancelled = false;
    const host = selectedHost;
    setTgChats([]);
    setMaxChats([]);
    if (!host) return undefined;
    Promise.all([
      fsEgressAPI.listTelegramChats({ computerName: host, limit: 200 }),
      fsEgressAPI.listMaxChats({ computerName: host, limit: 200 }),
    ])
      .then(([tgRes, maxRes]) => {
        if (cancelled) return;
        setTgChats(Array.isArray(tgRes.data?.chats) ? tgRes.data.chats : []);
        setMaxChats(Array.isArray(maxRes.data?.chats) ? maxRes.data.chats : []);
      })
      .catch(() => {
        // Chat panels show their own empty state; host stats stay valid.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHost]);

  const selectedStats = useMemo(
    () => hosts.find(
      (row) => normalizeHost(row.computer_name) === selectedHost,
    ) || attentionMap.get(selectedHost.toUpperCase()) || null,
    [hosts, attentionMap, selectedHost],
  );

  const hostFileCount = selectedStats
    ? Math.max(
        0,
        (Number(selectedStats.deleted_events) || 0) - (Number(selectedStats.service_files) || 0),
      )
    : 0;

  const hostBrowserTotal = Number(selectedStats?.visits) || 0;

  const openReport = async () => {
    if (!selectedHost || reportBusy) return;
    setReportBusy(true);
    try {
      const res = await fsEgressAPI.getTelegramReport(selectedHost);
      const html = typeof res.data === 'string' ? res.data : String(res.data || '');
      setReportHtml(html);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Не удалось открыть отчёт');
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <MainLayout headerMode="integrated">
      <Dialog open={reportHtml !== null} onClose={() => setReportHtml(null)} maxWidth="lg" fullWidth>
        <DialogContent>
          <Button onClick={() => setReportHtml(null)}>Закрыть отчёт</Button>
          <Box component="iframe" title="Отчёт по переписке" sandbox="" srcDoc={reportHtml || ''}
            sx={{ width: '100%', height: '70dvh', border: 0 }} />
        </DialogContent>
      </Dialog>
      <PageShell
        fullHeight
        sx={{
          p: { xs: 0.75, md: 1 },
          minHeight: 0,
          height: {
            xs: 'calc(100dvh - var(--app-shell-top-offset, 0px) - var(--app-shell-mobile-bottom-nav-height, 0px) - 8px)',
            md: 'calc(100dvh - var(--app-shell-top-offset, var(--app-shell-header-offset)) - 8px)',
          },
        }}
      >
        <Stack spacing={0.75} sx={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
          <PageTopBar
            title="DLP"
            sx={{ mb: 0, flexShrink: 0, minHeight: 40 }}
            tabs={selectedHost ? (
              <Tabs
                value={hostTab}
                onChange={(_, value) => setHostTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  minHeight: 36,
                  minWidth: 0,
                  maxWidth: '100%',
                  '& .MuiTab-root': { minHeight: 36, textTransform: 'none' },
                }}
              >
                <Tab value="files" label={`Файлы (${hostFileCount})`} />
                <Tab value="telegram" label={`Telegram (${tgChats.length})`} />
                <Tab value="max" label={`MAX (${maxChats.length})`} />
                <Tab value="browser" label={`Браузер (${hostBrowserTotal})`} />
              </Tabs>
            ) : null}
            actions={(
              <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading} variant="outlined" sx={{ flexShrink: 0 }}>
                Обновить
              </Button>
            )}
          >
            {summary ? <DlpSummaryInline summary={summary} /> : null}
          </PageTopBar>

          {error ? <Alert severity="error" sx={{ flexShrink: 0 }}>{error}</Alert> : null}

          {loading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
              <CircularProgress />
            </Box>
          ) : !selectedHost ? (
            <Box ref={listScrollRef} onScroll={onListScroll} sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
              <Stack spacing={2} sx={{ minHeight: 'min-content' }}>
                <DlpOverview
                  day={day}
                  onDayChange={setDay}
                  attention={attention}
                  loading={attentionLoading}
                  onOpenHost={openHost}
                  onShowHosts={showHostList}
                />
                <Box ref={hostSectionRef}>
                  <DlpHostList
                    hosts={hosts}
                    attentionMap={attentionMap}
                    onOpenHost={openHost}
                    onOpenBrowser={openHostEntertainment}
                  />
                </Box>
              </Stack>
            </Box>
          ) : (
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DlpHostHeader
                host={selectedHost}
                stats={selectedStats}
                day={rawDay || hostResolvedDay}
                onDayChange={setDay}
                onBack={closeHost}
                onOpenReport={openReport}
                reportBusy={reportBusy}
              />
              <DlpActivityBlock
                computerName={selectedHost}
                day={rawDay || ''}
                onDayResolved={setHostResolvedDay}
                onOpenBrowser={() => setHostTab('browser')}
              />

              <Box sx={{ flex: 1, minHeight: 0, overflow: hostTab === 'files' || hostTab === 'browser' ? 'auto' : 'hidden' }}>
                {hostTab === 'files' ? (
                  <HostFilesTable host={selectedHost} channel={channel} onChannelChange={setChannel} />
                ) : hostTab === 'telegram' ? (
                  <TelegramDialogPanel chats={tgChats} />
                ) : hostTab === 'max' ? (
                  <TelegramDialogPanel
                    chats={maxChats}
                    getMedia={fsEgressAPI.getMaxMedia}
                    productLabel="MAX"
                    emptyHint="Откройте чат в MAX на этом ПК — probe снимет переписку и снимки окна."
                  />
                ) : (
                  <BrowserVisitsPanel
                    host={selectedHost}
                    initialDay={day}
                    initialCategory={browserCategory}
                  />
                )}
              </Box>
            </Stack>
          )}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
