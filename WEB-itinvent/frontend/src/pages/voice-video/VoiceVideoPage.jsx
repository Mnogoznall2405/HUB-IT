import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import MainLayout from '../../components/layout/MainLayout';
import MobileShellPageHeader from '../../components/layout/MobileShellPageHeader';
import PageShell from '../../components/layout/PageShell';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { voiceVoicesAPI } from '../../api/voiceVoices';
import { useAuth } from '../../contexts/AuthContext';
import VoiceJobsSection from './VoiceJobsSection';
import VoiceLabelingSection from './VoiceLabelingSection';
import VoiceMeetingsSection from './VoiceMeetingsSection';
import VoiceVoicesSection from './VoiceVoicesSection';
import VoiceMeetingDrawer from './VoiceMeetingDrawer';
import VoiceTrendsStrip from './VoiceTrendsStrip';
import VoiceUploadDialog from './VoiceUploadDialog';

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;
const POLL_BACKOFF_CAP = 4;
const MEETINGS_PAGE_SIZE = 20;
const MEETING_HISTORY_KEY = '__voiceMeetingEntry';
// Keep aligned with voice_server/app.py:_EXPORT_MAX_MEETINGS.
const EXPORT_MAX_MEETINGS = 20;

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const isCanceled = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';

function VoiceVideoPage() {
  const { hasPermission, user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const canRead = hasPermission('voice.read');
  const canUpload = hasPermission('voice.upload');
  const canManage = hasPermission('voice.manage');
  const currentActor =
    user?.username || user?.login || user?.email || user?.full_name || user?.id || null;

  const [tab, setTab] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [queue, setQueue] = useState(null);
  // T45: фильтр статуса на вкладке «Задачи» — чипы «Сводки» ставят его
  // и сразу переключают вкладку.
  const [jobsStatusFilter, setJobsStatusFilter] = useState('');
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
  const [exportCount, setExportCount] = useState(null);
  const [exportCountLoading, setExportCountLoading] = useState(true);
  const [exportCountError, setExportCountError] = useState(false);
  const [sectionLoading, setSectionLoading] = useState({ meetings: true, jobs: true, voices: true });
  const [errors, setErrors] = useState({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [shareError, setShareError] = useState('');
  // N11: «Назад» при открытом диалоге «Поделиться» с неотозванной ссылкой
  // показывает предупреждение внутри самого диалога (shareCloseWarning),
  // а не баннером на странице под модалкой.
  const [shareNavWarning, setShareNavWarning] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState(null);
  const [meetingLoadError, setMeetingLoadError] = useState('');
  const exportCountAbortRef = useRef(null);
  const mountedRef = useRef(true);
  // У каждого загрузчика свой AbortController: отмена запроса одной секции
  // не затрагивает другие (V23, N4).
  const jobsAbortRef = useRef(null);
  const meetingsAbortRef = useRef(null);
  const voicesAbortRef = useRef(null);
  const meetingReqRef = useRef({ id: 0, controller: null });
  const failCountRef = useRef(0);
  const tabRef = useRef(0);
  // T27: диалог «Поделиться» открыт с неотозванной ссылкой — back/жест не должен
  // молча закрывать карточку.
  const activeShareLinkRef = useRef(false);
  tabRef.current = tab;
  const selectedRef = useRef(null);
  selectedRef.current = selectedMeeting;
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

  // Возвращает контроллер для запроса секции, отменяя только предыдущий
  // запрос той же секции.
  const startSectionRequest = (abortRef) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  // Мутации с обработкой ошибок: показываем detail, возвращаем кнопку в активное состояние.
  const runAction = useCallback(async (busyKey, action) => {
    setActionBusyKey(busyKey);
    setActionError('');
    try {
      await action();
    } catch (err) {
      setActionError(extractDetail(err, 'Действие не удалось выполнить'));
    } finally {
      setActionBusyKey(null);
    }
  }, []);

  // Загрузчики возвращают: true — успех, false — ошибка, null — запрос отменён
  // (отмена не считается успехом для backoff и не трогает состояние).
  const loadJobs = useCallback(async (opts = {}) => {
    const controller = startSectionRequest(jobsAbortRef);
    const { signal } = controller;
    if (opts.busy) setSectionLoading((prev) => (prev.jobs ? prev : { ...prev, jobs: true }));
    try {
      const data = await voiceJobsAPI.listJobs({ limit: 100 }, { signal });
      if (!mountedRef.current || signal.aborted) return null;
      setJobs(data.items || []);
      setJobsLoaded(true);
      setQueue(data.queue || null);
      setErrors((prev) => (prev.jobs ? { ...prev, jobs: '' } : prev));
      return true;
    } catch (err) {
      if (!mountedRef.current || signal.aborted || isCanceled(err)) return null;
      setErrors((prev) => ({ ...prev, jobs: extractDetail(err, 'Не удалось загрузить задачи') }));
      return false;
    } finally {
      // Отменённый запрос не снимает loading нового.
      if (mountedRef.current && !signal.aborted) {
        setSectionLoading((prev) => (prev.jobs ? { ...prev, jobs: false } : prev));
      }
    }
  }, []);

  const loadMeetings = useCallback(async (opts = {}) => {
    const controller = startSectionRequest(meetingsAbortRef);
    const { signal } = controller;
    if (opts.busy) setSectionLoading((prev) => (prev.meetings ? prev : { ...prev, meetings: true }));
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
      if (!mountedRef.current || signal.aborted) return null;
      setMeetings(data.items || []);
      setMeetingsTotal(data.total || 0);
      setErrors((prev) => (prev.meetings ? { ...prev, meetings: '' } : prev));
      return true;
    } catch (err) {
      if (!mountedRef.current || signal.aborted || isCanceled(err)) return null;
      setErrors((prev) => ({ ...prev, meetings: extractDetail(err, 'Не удалось загрузить протоколы') }));
      return false;
    } finally {
      if (mountedRef.current && !signal.aborted) {
        setSectionLoading((prev) => (prev.meetings ? { ...prev, meetings: false } : prev));
      }
    }
  }, []);

  const loadExportCount = useCallback(async () => {
    exportCountAbortRef.current?.abort();
    const controller = new AbortController();
    exportCountAbortRef.current = controller;
    const { signal } = controller;
    const params = { limit: 1 };
    if (meetingsDateFrom) params.date_from = meetingsDateFrom;
    if (meetingsDateTo) params.date_to = meetingsDateTo;
    setExportCount(null);
    setExportCountError(false);
    setExportCountLoading(true);
    try {
      const data = await voiceJobsAPI.listMeetings(params, { signal });
      if (!mountedRef.current || signal.aborted) return null;
      const total = Number(data?.total);
      setExportCount(Number.isFinite(total) ? Math.max(0, total) : 0);
      return true;
    } catch (err) {
      if (!mountedRef.current || signal.aborted || isCanceled(err)) return null;
      setExportCountError(true);
      return false;
    } finally {
      if (mountedRef.current && !signal.aborted) setExportCountLoading(false);
    }
  }, [meetingsDateFrom, meetingsDateTo]);

  const loadVoices = useCallback(async (opts = {}) => {
    const controller = startSectionRequest(voicesAbortRef);
    const { signal } = controller;
    if (opts.busy) setSectionLoading((prev) => (prev.voices ? prev : { ...prev, voices: true }));
    try {
      const data = await voiceVoicesAPI.list({ signal });
      if (!mountedRef.current || signal.aborted) return null;
      setVoices(data.items || []);
      setErrors((prev) => (prev.voices ? { ...prev, voices: '' } : prev));
      return true;
    } catch (err) {
      if (!mountedRef.current || signal.aborted || isCanceled(err)) return null;
      setErrors((prev) => ({ ...prev, voices: extractDetail(err, 'Не удалось загрузить голоса') }));
      return false;
    } finally {
      if (mountedRef.current && !signal.aborted) {
        setSectionLoading((prev) => (prev.voices ? { ...prev, voices: false } : prev));
      }
    }
  }, []);

  const loadTab = useCallback(
    (tabIndex, opts) => {
      if (tabIndex === 1) return loadJobs(opts);
      if (tabIndex === 2) return loadVoices(opts);
      // «Разметка» загружает и опрашивает свой список сама.
      if (tabIndex === 3) return Promise.resolve(true);
      return loadMeetings(opts);
    },
    [loadJobs, loadMeetings, loadVoices],
  );

  const refreshMeeting = useCallback(async (base) => {
    const req = meetingReqRef.current;
    req.controller?.abort();
    const controller = new AbortController();
    req.controller = controller;
    req.id += 1;
    const reqId = req.id;
    setMeetingLoadError('');
    try {
      const detail = await voiceJobsAPI.getMeeting(base, { signal: controller.signal });
      if (!mountedRef.current || reqId !== meetingReqRef.current.id) return;
      // Не перезаписывать текущую карточку и не открывать закрытую.
      setSelectedMeeting((prev) => (prev?.base_filename === base ? detail : prev));
    } catch (err) {
      if (!mountedRef.current || reqId !== meetingReqRef.current.id || isCanceled(err)) return;
      setMeetingLoadError(
        err?.response?.status === 404
          ? 'Протокол не найден'
          : extractDetail(err, 'Не удалось загрузить протокол'),
      );
    }
  }, []);

  const openMeeting = useCallback((base) => {
    if (!base) return;
    const url = new URL(window.location.href);
    url.searchParams.set('meeting', base);
    const previousState = window.history.state;
    const historyState = previousState && typeof previousState === 'object' && !Array.isArray(previousState)
      ? previousState
      : {};
    window.history.pushState({
      ...historyState,
      meeting: base,
      [MEETING_HISTORY_KEY]: base,
    }, '', url.toString());
    setMeetingLoadError('');
    setSelectedMeeting({ base_filename: base });
    return refreshMeeting(base);
  }, [refreshMeeting]);

  const closeMeeting = useCallback(() => {
    const url = new URL(window.location.href);
    const base = url.searchParams.get('meeting');
    if (base && window.history.state?.[MEETING_HISTORY_KEY] === base) {
      window.history.back();
    } else if (base) {
      url.searchParams.delete('meeting');
      window.history.replaceState(window.history.state || {}, '', url.toString());
    }
    meetingReqRef.current.controller?.abort();
    meetingReqRef.current.id += 1;
    setSelectedMeeting(null);
    setMeetingLoadError('');
  }, []);

  useEffect(() => {
    const base = new URLSearchParams(window.location.search).get('meeting');
    if (!base || !canRead) return;
    setSelectedMeeting({ base_filename: base });
    refreshMeeting(base);
  }, [canRead, refreshMeeting]);

  useEffect(() => {
    const onPopState = () => {
      const base = new URLSearchParams(window.location.search).get('meeting');
      if (base) {
        setMeetingLoadError('');
        setSelectedMeeting({ base_filename: base });
        refreshMeeting(base);
        return;
      }
      // T27: неотозванная публичная ссылка живёт только в этом диалоге. Молча
      // закрывать карточку по «Назад»/жесту нельзя — возвращаем запись истории
      // с `meeting` и оставляем ссылку доступной для отзыва.
      if (activeShareLinkRef.current) {
        // Запись истории, в которую мы вернулись, может не содержать метку
        // встречи (deep link или replaceState) — берём её из открытой карточки.
        const activeBase = selectedRef.current?.base_filename
          || window.history.state?.[MEETING_HISTORY_KEY];
        if (!activeBase) {
          closeMeeting();
          return;
        }
        const url = new URL(window.location.href);
        url.searchParams.set('meeting', activeBase);
        window.history.pushState(
          {
            ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
            meeting: activeBase,
            [MEETING_HISTORY_KEY]: activeBase,
          },
          '',
          url.toString(),
        );
        setSelectedMeeting((current) => current || { base_filename: activeBase });
        setShareNavWarning(true);
        return;
      }
      closeMeeting();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [closeMeeting, refreshMeeting]);

  const refreshVisible = useCallback(async (opts = {}) => {
    const results = tabRef.current === 1
      ? [await loadJobs(opts)]
      : await Promise.all([loadJobs(opts), loadTab(tabRef.current, opts)]);
    // Пока идёт resume-задача, карточка обновляется вместе с polling
    // (баннер «Имена обновляются» снимается по завершении задачи).
    const selected = selectedRef.current;
    const resumeActive = (selected?.jobs || []).some(
      (j) => j.kind === 'resume' && ['queued', 'processing'].includes(j.status),
    );
    if (selected?.base_filename && resumeActive) {
      await refreshMeeting(selected.base_filename);
    }
    if (opts.refreshExportCount && tabRef.current === 0 && results[1] === true) {
      await loadExportCount();
    }
    if (results.some((r) => r === false)) return false;
    if (results.some((r) => r == null)) return null;
    return true;
  }, [loadExportCount, loadJobs, loadTab, refreshMeeting]);

  // T46: стабильные колбэки секций — открытие карточки не перерендеривает
  // список встреч и сводку (VoiceMeetingsSection/VoiceTrendsStrip — memo).
  const handleMeetingsQueryChange = useCallback((q) => {
    setMeetingsQuery(q);
    setMeetingsPage(0);
  }, []);
  const handleMeetingsUnresolvedChange = useCallback((v) => {
    setMeetingsUnresolved(v);
    setMeetingsPage(0);
  }, []);
  const handleMeetingsParticipantChange = useCallback((v) => {
    setMeetingsParticipant(v);
    setMeetingsPage(0);
  }, []);
  const handleMeetingsTagChange = useCallback((v) => {
    setMeetingsTag(v);
    setMeetingsPage(0);
  }, []);
  const handleMeetingsDateChange = useCallback((from, to) => {
    setMeetingsDateFrom(from);
    setMeetingsDateTo(to);
    setMeetingsPage(0);
  }, []);
  const handleUploadOpen = useCallback(() => setUploadOpen(true), []);
  const handleMeetingsPageChange = useCallback((p) => setMeetingsPage(p), []);
  const handleJobsFilter = useCallback((status) => {
    setJobsStatusFilter(status);
    setTab(1);
  }, []);
  const handleMeetingsExport = useCallback(async () => {
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
      // Ошибка экспорта — не ошибка списка: без «Повторить» (он перезагрузил бы список).
      setActionError(msg);
    } finally {
      setExportBusy(false);
    }
  }, [meetingsDateFrom, meetingsDateTo]);
  const handleMeetingDelete = useCallback(async (meeting) => {
    const name = meeting.base_filename;
    if (!window.confirm(`Протокол «${name}» уйдёт в корзину на 30 дней (вместе с исходником и отчётами). Продолжить?`)) return;
    await runAction(name, async () => {
      await voiceJobsAPI.deleteMeeting(name);
      if (selectedRef.current?.base_filename === name) closeMeeting();
      const loaded = await loadMeetings();
      if (loaded === true) await loadExportCount();
    });
  }, [runAction, closeMeeting, loadMeetings, loadExportCount]);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      await Promise.all([
        loadJobs(),
        loadMeetings(),
        loadVoices(),
      ]);
    })();
    voiceJobsAPI.getOptions().then(setOptions).catch(() => {});
    voiceJobsAPI.getOverview().then(setOverview).catch(() => {});
    return () => {
      mountedRef.current = false;
      jobsAbortRef.current?.abort();
      meetingsAbortRef.current?.abort();
      voicesAbortRef.current?.abort();
      exportCountAbortRef.current?.abort();
    };
  }, [loadJobs, loadMeetings, loadVoices]);

  useEffect(() => {
    loadExportCount();
  }, [loadExportCount]);

  // Meetings page/search/filter/order changes refetch the meetings page.
  const firstMeetingsParams = useRef(true);
  useEffect(() => {
    if (firstMeetingsParams.current) {
      firstMeetingsParams.current = false;
      return;
    }
    loadMeetings({ busy: true }).then((ok) => {
      if (ok === true) loadExportCount();
    });
  }, [
    meetingsPage, meetingsQuery, meetingsUnresolved, meetingsOrder,
    meetingsParticipant, meetingsTag, meetingsDateFrom, meetingsDateTo,
    loadExportCount, loadMeetings,
  ]);

  // Poll only the visible tab (+ jobs for the queue chip); pause when hidden;
  // exponential backoff on consecutive failures.
  useEffect(() => {
    let timer = null;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
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
      // Отменённый запрос (null) не считается ни успехом, ни ошибкой для backoff.
      if (ok === true) failCountRef.current = 0;
      else if (ok === false) failCountRef.current += 1;
      schedule();
    };

    const onVisibility = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        tick();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasActiveJobs, refreshVisible]);

  // Deep link: /voice?share=<token> resolves to a meeting and opens it once.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token || !canRead) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await voiceJobsAPI.resolveShareLink(token);
        if (!cancelled && rec?.base_filename) {
          await openMeeting(rec.base_filename);
        }
      } catch {
        if (!cancelled) setShareError('Ссылка недействительна или истекла');
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        window.history.replaceState({}, '', url.toString());
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, openMeeting]);

  // Повторная загрузка секции после ошибки.
  // Хук — строго до раннего return по !canRead (иначе меняется число хуков при появлении прав).
  const retrySection = useCallback(async (key) => {
    if (key === 'jobs') loadJobs({ busy: true });
    else if (key === 'voices') loadVoices({ busy: true });
    else if (await loadMeetings({ busy: true })) await loadExportCount();
  }, [loadExportCount, loadJobs, loadMeetings, loadVoices]);

  const mobileTabSx = isMobile ? { px: 0.5, minWidth: 0 } : {};
  const tabSx = { minHeight: { xs: 44, sm: 36 }, ...mobileTabSx };
  const pageTabs = [
    <Tab key="protocols" label="Протоколы" sx={tabSx} />,
    <Tab
      key="jobs"
      label={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          Задачи
          {queue && (queue.queued + queue.processing) > 0 && (
            <Chip size="small" color="primary" label={queue.queued + queue.processing} />
          )}
        </Box>
      )}
      sx={tabSx}
    />,
    <Tab key="voices" label="Голоса" sx={tabSx} />,
    ...(canManage ? [<Tab key="labeling" label="Разметка" sx={tabSx} />] : []),
  ];

  if (!canRead) {
    return (
      <MainLayout>
        <PageShell>
          <Alert severity="error">Недостаточно прав: требуется voice.read</Alert>
        </PageShell>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      {/* B6: заголовок на xs рисуется первой строкой внутри страницы, поэтому
          шелл-шапку скрываем на всех ширинах через sx у вызова. */}
      <MobileShellPageHeader title="Протоколы встреч" sx={{ display: 'none' }} />
      <PageShell
        sx={{
          gap: { xs: 0.5, sm: 1 },
          '@media (pointer: coarse)': {
            '& .MuiIconButton-root': { width: 44, height: 44 },
            '& .MuiButton-root': { minWidth: 44, minHeight: 44 },
            '& .MuiChip-clickable, & .MuiChip-deletable': { height: 44 },
          },
        }}
      >
        {selectedMeeting ? (
          <VoiceMeetingDrawer
            variant="page"
            meeting={selectedMeeting}
            open={Boolean(selectedMeeting)}
            loadError={meetingLoadError}
            onRetryLoad={() => {
              const base = selectedMeeting?.base_filename;
              if (base) refreshMeeting(base);
            }}
            onClose={closeMeeting}
            // T27: пока открыт диалог с неотозванной ссылкой, «Назад»/жест не закрывают
            // карточку молча — иначе ссылку уже нельзя отозвать из интерфейса.
            onActiveShareLinkChange={(active) => {
              activeShareLinkRef.current = Boolean(active);
              // Диалог закрыт или ссылка отозвана — предупреждение больше не нужно.
              if (!active) setShareNavWarning(false);
            }}
            shareNavWarning={shareNavWarning}
            canManage={canManage}
            canCreateTasks={hasPermission('tasks.create') || hasPermission('tasks.write')}
            voices={voices}
            onAssigned={async (base) => {
              await refreshVisible();
              await refreshMeeting(base);
            }}
          />
        ) : (
        <>
        {/* B6: на мобильном название и действия — в первой строке, вкладки —
            отдельной строкой на всю ширину; на ≥ sm вкладки и кнопки в одном ряду. */}
        {isMobile ? (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 1 }}>
              <Typography
                component="h1"
                variant="subtitle1"
                noWrap
                sx={{ fontWeight: 700, flex: '1 1 auto', minWidth: 0 }}
              >
                Протоколы встреч
              </Typography>
              <Tooltip title="Обновить">
                <IconButton
                  aria-label="Обновить"
                  onClick={() => refreshVisible({ busy: true, refreshExportCount: true })}
                  sx={{ border: '1px solid', borderColor: 'divider', flex: '0 0 auto' }}
                >
                  <RefreshOutlinedIcon />
                </IconButton>
              </Tooltip>
              {canUpload && (
                <Button
                  variant="contained"
                  startIcon={<UploadFileOutlinedIcon fontSize="small" />}
                  onClick={() => setUploadOpen(true)}
                  sx={{ minHeight: 44, whiteSpace: 'nowrap', flex: '0 0 auto' }}
                >
                  Загрузить
                </Button>
              )}
            </Box>
            <Tabs
              value={tab}
              onChange={(_e, value) => setTab(value)}
              variant="fullWidth"
              sx={{ minHeight: 44 }}
            >
              {pageTabs}
            </Tabs>
          </>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 1 }}>
            <Tabs
              value={tab}
              onChange={(_e, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ flex: '1 1 auto', minWidth: 0 }}
            >
              {pageTabs}
            </Tabs>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ flex: '0 0 auto', ml: 'auto' }}
            >
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshOutlinedIcon />}
                onClick={() => refreshVisible({ busy: true, refreshExportCount: true })}
              >
                Обновить
              </Button>
              {canUpload && (
                <Button
                  variant="contained"
                  startIcon={<UploadFileOutlinedIcon fontSize="small" />}
                  onClick={() => setUploadOpen(true)}
                  sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >
                  Загрузить
                </Button>
              )}
            </Stack>
          </Box>
        )}

        {overview && !overview.voicevideo_root_exists && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Каталог VoiceVideo не найден: {overview.voicevideo_root}
          </Alert>
        )}
        {/* Ошибки видны для всех вкладок, а не только активной: фоновая ошибка не теряется молча. */}
        {Object.entries(errors).map(([key, message]) => (message ? (
          <Alert
            key={key}
            severity="error"
            sx={{ mb: 2 }}
            action={<Button color="inherit" size="small" onClick={() => retrySection(key)}>Повторить</Button>}
          >
            {message}
          </Alert>
        ) : null))}
        {actionError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>
        )}
        {shareError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setShareError('')}>{shareError}</Alert>
        )}

        {tab === 0 && (
          <>
            {(!sectionLoading.meetings || meetings.length > 0) && (
              <VoiceTrendsStrip
                jobs={jobs}
                jobsLoaded={jobsLoaded}
                overview={overview}
                queue={queue}
                onJobsFilter={handleJobsFilter}
              />
            )}
            <VoiceMeetingsSection
            meetings={meetings}
            total={meetingsTotal}
            page={meetingsPage}
            pageSize={MEETINGS_PAGE_SIZE}
            loading={sectionLoading.meetings}
            error={errors.meetings}
            query={meetingsQuery}
            onQueryChange={handleMeetingsQueryChange}
            unresolvedOnly={meetingsUnresolved}
            onUnresolvedChange={handleMeetingsUnresolvedChange}
            order={meetingsOrder}
            onOrderChange={setMeetingsOrder}
            participant={meetingsParticipant}
            onParticipantChange={handleMeetingsParticipantChange}
            tag={meetingsTag}
            onTagChange={handleMeetingsTagChange}
            dateFrom={meetingsDateFrom}
            dateTo={meetingsDateTo}
            onDateChange={handleMeetingsDateChange}
            canUpload={canUpload}
            onUpload={handleUploadOpen}
            canManage={canManage}
            busyBase={actionBusyKey}
            jobs={jobs}
            exportBusy={exportBusy}
            exportCount={exportCount}
            exportCountLoading={exportCountLoading}
            exportCountError={exportCountError}
            exportMaxMeetings={EXPORT_MAX_MEETINGS}
            onExport={handleMeetingsExport}
            onDelete={handleMeetingDelete}
            onPageChange={handleMeetingsPageChange}
            onOpen={openMeeting}
          />
          </>
        )}
        {tab === 1 && (
          <VoiceJobsSection
            jobs={jobs}
            statusFilter={jobsStatusFilter}
            onStatusFilterChange={setJobsStatusFilter}
            canManage={canManage}
            currentActor={currentActor}
            loading={sectionLoading.jobs}
            error={errors.jobs}
            canUpload={canUpload}
            onUpload={() => setUploadOpen(true)}
            busyJobId={actionBusyKey}
            onCancel={async (job) => {
              await runAction(job.id, async () => {
                await voiceJobsAPI.cancelJob(job.id);
                await refreshVisible();
              });
            }}
            onRetry={async (job) => {
              if (!window.confirm(
                'Повторный запуск использует исходные настройки задачи без изменений. '
                + 'Если сбой был из-за неверной модели или настроек, задача упадёт снова. Продолжить?',
              )) return;
              await runAction(job.id, async () => {
                await voiceJobsAPI.retryJob(job.id);
                await refreshVisible();
              });
            }}
            onDelete={async (job) => {
              if (!window.confirm('Удалить задачу из списка? Файлы протокола не трогаются.')) return;
              await runAction(job.id, async () => {
                await voiceJobsAPI.deleteJob(job.id);
                await refreshVisible();
              });
            }}
            onOpenMeeting={async (base) => {
              setTab(0);
              await openMeeting(base);
            }}
          />
        )}
        {tab === 2 && (
          <VoiceVoicesSection
            voices={voices}
            canManage={canManage}
            loading={sectionLoading.voices}
            loadError={errors.voices}
            onChanged={() => loadVoices({ busy: true })}
          />
        )}
        {tab === 3 && canManage && <VoiceLabelingSection />}
        </>
        )}
      </PageShell>

      <VoiceUploadDialog
        open={uploadOpen}
        options={options}
        onClose={() => setUploadOpen(false)}
        onUploaded={async () => {
          setUploadOpen(false);
          setTab(1);
          await loadJobs({ busy: true });
        }}
        // Частичный сбой: только обновляем список задач, диалог и вкладка не меняются.
        onPartiallyUploaded={async () => {
          await loadJobs({ busy: true });
        }}
      />

    </MainLayout>
  );
}

export default VoiceVideoPage;
