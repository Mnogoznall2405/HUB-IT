import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Tab,
  Tabs,
} from '@mui/material';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import MainLayout from '../../components/layout/MainLayout';
import MobileShellPageHeader from '../../components/layout/MobileShellPageHeader';
import PageShell from '../../components/layout/PageShell';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { voiceVoicesAPI } from '../../api/voiceVoices';
import { useAuth } from '../../contexts/AuthContext';
import VoiceJobsSection from './VoiceJobsSection';
import VoiceMeetingsSection from './VoiceMeetingsSection';
import VoiceVoicesSection from './VoiceVoicesSection';
import VoiceMeetingDrawer from './VoiceMeetingDrawer';
import VoiceTrendsStrip from './VoiceTrendsStrip';
import VoiceUploadDialog from './VoiceUploadDialog';

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;
const POLL_BACKOFF_CAP = 4;
const MEETINGS_PAGE_SIZE = 20;

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const isCanceled = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';

function VoiceVideoPage() {
  const { hasPermission, user } = useAuth();
  const canRead = hasPermission('voice.read');
  const canUpload = hasPermission('voice.upload');
  const canManage = hasPermission('voice.manage');
  const currentActor =
    user?.username || user?.login || user?.email || user?.full_name || user?.id || null;

  const [tab, setTab] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [queue, setQueue] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [meetingsTotal, setMeetingsTotal] = useState(0);
  const [meetingsPage, setMeetingsPage] = useState(0);
  const [meetingsQuery, setMeetingsQuery] = useState('');
  const [meetingsUnresolved, setMeetingsUnresolved] = useState(false);
  const [meetingsOrder, setMeetingsOrder] = useState('desc');
  const [meetingsParticipant, setMeetingsParticipant] = useState('');
  const [meetingsTag, setMeetingsTag] = useState('');
  const [meetingsDateFrom, setMeetingsDateFrom] = useState('');
  const [meetingsDateTo, setMeetingsDateTo] = useState('');
  const [voices, setVoices] = useState([]);
  const [options, setOptions] = useState(null);
  const [overview, setOverview] = useState(null);
  const [sectionLoading, setSectionLoading] = useState({ meetings: true, jobs: true, voices: true });
  const [errors, setErrors] = useState({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const failCountRef = useRef(0);
  const tabRef = useRef(0);
  tabRef.current = tab;
  const meetingsParamsRef = useRef({});
  meetingsParamsRef.current = {
    page: meetingsPage, q: meetingsQuery, unresolved: meetingsUnresolved, order: meetingsOrder,
    participant: meetingsParticipant, tag: meetingsTag,
    dateFrom: meetingsDateFrom, dateTo: meetingsDateTo,
  };

  const hasActiveJobs = useMemo(
    () => jobs.some((job) => ['queued', 'processing'].includes(job.status)),
    [jobs],
  );

  const freshSignal = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  }, []);

  const loadJobs = useCallback(async (signal) => {
    try {
      const data = await voiceJobsAPI.listJobs({ limit: 100 }, { signal });
      if (!mountedRef.current) return true;
      setJobs(data.items || []);
      setQueue(data.queue || null);
      setErrors((prev) => (prev.jobs ? { ...prev, jobs: '' } : prev));
      return true;
    } catch (err) {
      if (isCanceled(err) || !mountedRef.current) return true;
      setErrors((prev) => ({ ...prev, jobs: extractDetail(err, 'Не удалось загрузить задачи') }));
      return false;
    } finally {
      if (mountedRef.current) setSectionLoading((prev) => (prev.jobs ? { ...prev, jobs: false } : prev));
    }
  }, []);

  const loadMeetings = useCallback(async (signal) => {
    try {
      const {
        page, q, unresolved, order, participant, tag, dateFrom, dateTo,
      } = meetingsParamsRef.current;
      const data = await voiceJobsAPI.listMeetings(
        {
          limit: MEETINGS_PAGE_SIZE,
          offset: page * MEETINGS_PAGE_SIZE,
          ...(q ? { q } : {}),
          ...(unresolved ? { unresolved: true } : {}),
          ...(participant ? { participant } : {}),
          ...(tag ? { tag } : {}),
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
          order,
        },
        { signal },
      );
      if (!mountedRef.current) return true;
      setMeetings(data.items || []);
      setMeetingsTotal(data.total || 0);
      setErrors((prev) => (prev.meetings ? { ...prev, meetings: '' } : prev));
      return true;
    } catch (err) {
      if (isCanceled(err) || !mountedRef.current) return true;
      setErrors((prev) => ({ ...prev, meetings: extractDetail(err, 'Не удалось загрузить протоколы') }));
      return false;
    } finally {
      if (mountedRef.current) setSectionLoading((prev) => (prev.meetings ? { ...prev, meetings: false } : prev));
    }
  }, []);

  const loadVoices = useCallback(async (signal) => {
    try {
      const data = await voiceVoicesAPI.list({ signal });
      if (!mountedRef.current) return true;
      setVoices(data.items || []);
      setErrors((prev) => (prev.voices ? { ...prev, voices: '' } : prev));
      return true;
    } catch (err) {
      if (isCanceled(err) || !mountedRef.current) return true;
      setErrors((prev) => ({ ...prev, voices: extractDetail(err, 'Не удалось загрузить голоса') }));
      return false;
    } finally {
      if (mountedRef.current) setSectionLoading((prev) => (prev.voices ? { ...prev, voices: false } : prev));
    }
  }, []);

  const loadTab = useCallback(
    (tabIndex, signal) => {
      if (tabIndex === 1) return loadJobs(signal);
      if (tabIndex === 2) return loadVoices(signal);
      return loadMeetings(signal);
    },
    [loadJobs, loadMeetings, loadVoices],
  );

  const refreshVisible = useCallback(async () => {
    const signal = freshSignal();
    const results = tabRef.current === 1
      ? [await loadJobs(signal)]
      : await Promise.all([loadJobs(signal), loadTab(tabRef.current, signal)]);
    return results.every(Boolean);
  }, [freshSignal, loadJobs, loadTab]);

  useEffect(() => {
    mountedRef.current = true;
    const signal = freshSignal();
    (async () => {
      await Promise.all([
        loadJobs(signal),
        loadMeetings(signal),
        loadVoices(signal),
      ]);
    })();
    voiceJobsAPI.getOptions().then(setOptions).catch(() => {});
    voiceJobsAPI.getOverview().then(setOverview).catch(() => {});
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [freshSignal, loadJobs, loadMeetings, loadVoices]);

  // Meetings page/search/filter/order changes refetch the meetings page.
  const firstMeetingsParams = useRef(true);
  useEffect(() => {
    if (firstMeetingsParams.current) {
      firstMeetingsParams.current = false;
      return;
    }
    loadMeetings(freshSignal());
  }, [
    meetingsPage, meetingsQuery, meetingsUnresolved, meetingsOrder,
    meetingsParticipant, meetingsTag, meetingsDateFrom, meetingsDateTo,
    loadMeetings, freshSignal,
  ]);

  // Poll only the visible tab (+ jobs for the queue chip); pause when hidden;
  // exponential backoff on consecutive failures.
  useEffect(() => {
    let timer = null;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const base = hasActiveJobs ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      const factor = Math.min(2 ** failCountRef.current, POLL_BACKOFF_CAP);
      timer = setTimeout(tick, base * factor);
    };

    const tick = async () => {
      if (stopped) return;
      if (document.hidden) {
        schedule();
        return;
      }
      const ok = await refreshVisible();
      failCountRef.current = ok ? 0 : failCountRef.current + 1;
      schedule();
    };

    const onVisibility = () => {
      if (!document.hidden) tick();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasActiveJobs, refreshVisible]);

  const refreshMeeting = useCallback(async (base) => {
    try {
      const detail = await voiceJobsAPI.getMeeting(base);
      if (mountedRef.current) setSelectedMeeting(detail);
    } catch {
      /* drawer shows stale data until next refresh */
    }
  }, []);

  // Deep link: /voice?share=<token> resolves to a meeting and opens it once.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token || !canRead) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await voiceJobsAPI.resolveShareLink(token);
        if (!cancelled && rec?.base_filename) {
          setSelectedMeeting({ base_filename: rec.base_filename });
          await refreshMeeting(rec.base_filename);
        }
      } catch {
        /* invalid/expired link — just ignore */
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        window.history.replaceState({}, '', url.toString());
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  if (!canRead) {
    return (
      <MainLayout>
        <PageShell>
          <Alert severity="error">Недостаточно прав: требуется voice.read</Alert>
        </PageShell>
      </MainLayout>
    );
  }

  const activeError =
    (tab === 0 && errors.meetings) ||
    (tab === 1 && errors.jobs) ||
    (tab === 2 && errors.voices) ||
    '';

  return (
    <MainLayout>
      <MobileShellPageHeader title="Протоколы встреч" />
      <PageShell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Tabs
            value={tab}
            onChange={(_e, value) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ flex: 1, minWidth: 0 }}
          >
            <Tab label="Протоколы" />
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  Задачи
                  {queue && (queue.queued + queue.processing) > 0 && (
                    <Chip size="small" color="primary" label={queue.queued + queue.processing} />
                  )}
                </Box>
              }
            />
            <Tab label="Голоса" />
          </Tabs>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshOutlinedIcon />}
            onClick={() => refreshVisible()}
          >
            Обновить
          </Button>
          {canUpload && (
            <Button
              variant="contained"
              startIcon={<UploadFileOutlinedIcon />}
              onClick={() => setUploadOpen(true)}
              sx={{ minHeight: 44 }}
            >
              Загрузить
            </Button>
          )}
        </Box>

        {overview && !overview.voicevideo_root_exists && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Каталог VoiceVideo не найден: {overview.voicevideo_root}
          </Alert>
        )}
        {activeError && <Alert severity="error" sx={{ mb: 2 }}>{activeError}</Alert>}

        {tab === 0 && (
          <>
            {!sectionLoading.meetings && (
              <VoiceTrendsStrip jobs={jobs} overview={overview} queue={queue} />
            )}
            <VoiceMeetingsSection
            meetings={meetings}
            total={meetingsTotal}
            page={meetingsPage}
            pageSize={MEETINGS_PAGE_SIZE}
            loading={sectionLoading.meetings}
            query={meetingsQuery}
            onQueryChange={(q) => {
              setMeetingsQuery(q);
              setMeetingsPage(0);
            }}
            unresolvedOnly={meetingsUnresolved}
            onUnresolvedChange={(v) => {
              setMeetingsUnresolved(v);
              setMeetingsPage(0);
            }}
            order={meetingsOrder}
            onOrderChange={setMeetingsOrder}
            participant={meetingsParticipant}
            onParticipantChange={(v) => { setMeetingsParticipant(v); setMeetingsPage(0); }}
            tag={meetingsTag}
            onTagChange={(v) => { setMeetingsTag(v); setMeetingsPage(0); }}
            dateFrom={meetingsDateFrom}
            dateTo={meetingsDateTo}
            onDateChange={(from, to) => { setMeetingsDateFrom(from); setMeetingsDateTo(to); setMeetingsPage(0); }}
            canUpload={canUpload}
            onUpload={() => setUploadOpen(true)}
            canManage={canManage}
            exportBusy={exportBusy}
            onExport={async () => {
              setExportBusy(true);
              try {
                const resp = await voiceJobsAPI.exportReportsZip({
                  dateFrom: meetingsDateFrom, dateTo: meetingsDateTo,
                });
                const blob = resp?.data;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `voice_protocols_${meetingsDateFrom || 'all'}_${meetingsDateTo || 'all'}.zip`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch (e) {
                let msg = 'Не удалось собрать архив';
                const data = e?.response?.data;
                if (data instanceof Blob) {
                  try {
                    const parsed = JSON.parse(await data.text());
                    msg = parsed?.detail || msg;
                  } catch { /* keep generic message */ }
                } else if (data?.detail) {
                  msg = data.detail;
                }
                setErrors((prev) => ({ ...prev, meetings: msg }));
              } finally {
                setExportBusy(false);
              }
            }}
            onDelete={async (meeting) => {
              const name = meeting.base_filename;
              if (!window.confirm(`Протокол «${name}» уйдёт в корзину на 30 дней (вместе с исходником и отчётами). Продолжить?`)) return;
              await voiceJobsAPI.deleteMeeting(name);
              if (selectedMeeting?.base_filename === name) setSelectedMeeting(null);
              await loadMeetings(freshSignal());
            }}
            onPageChange={(p) => setMeetingsPage(p)}
            onOpen={async (base) => {
              setSelectedMeeting({ base_filename: base });
              await refreshMeeting(base);
            }}
          />
          </>
        )}
        {tab === 1 && (
          <VoiceJobsSection
            jobs={jobs}
            canManage={canManage}
            currentActor={currentActor}
            loading={sectionLoading.jobs}
            canUpload={canUpload}
            onUpload={() => setUploadOpen(true)}
            onCancel={async (job) => {
              await voiceJobsAPI.cancelJob(job.id);
              await refreshVisible();
            }}
            onRetry={async (job) => {
              if (!window.confirm(
                'Повторный запуск использует исходные настройки задачи без изменений. '
                + 'Если сбой был из-за неверной модели или настроек, задача упадёт снова. Продолжить?',
              )) return;
              await voiceJobsAPI.retryJob(job.id);
              await refreshVisible();
            }}
            onDelete={async (job) => {
              if (!window.confirm('Удалить задачу из списка? Файлы протокола не трогаются.')) return;
              await voiceJobsAPI.deleteJob(job.id);
              await refreshVisible();
            }}
            onOpenMeeting={async (base) => {
              setTab(0);
              setSelectedMeeting({ base_filename: base });
              await refreshMeeting(base);
            }}
          />
        )}
        {tab === 2 && (
          <VoiceVoicesSection
            voices={voices}
            canManage={canManage}
            onChanged={() => loadVoices(freshSignal())}
          />
        )}
      </PageShell>

      <VoiceUploadDialog
        open={uploadOpen}
        options={options}
        onClose={() => setUploadOpen(false)}
        onUploaded={async () => {
          setUploadOpen(false);
          setTab(1);
          await loadJobs(freshSignal());
        }}
      />

      <VoiceMeetingDrawer
        meeting={selectedMeeting}
        open={Boolean(selectedMeeting)}
        onClose={() => setSelectedMeeting(null)}
        canManage={canManage}
        canCreateTasks={hasPermission('tasks.create') || hasPermission('tasks.write')}
        voices={voices}
        onAssigned={async (base) => {
          await refreshVisible();
          await refreshMeeting(base);
        }}
      />
    </MainLayout>
  );
}

export default VoiceVideoPage;
