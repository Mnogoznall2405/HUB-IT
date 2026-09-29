import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PlayCircleOutlineOutlinedIcon from '@mui/icons-material/PlayCircleOutlineOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { hubTaskSupportAPI } from '../../api/hubTaskSupport';
import { stashMailComposePrefill } from '../../lib/mailComposePrefill';
import { AudioPlayButton, useSingleAudio } from './useSingleAudio.jsx';
import VoiceAssignmentsTab from './VoiceAssignmentsTab';
import { pickMergedPart, speakerMediaSrc } from './mediaParts.js';

const displayName = (base) => String(base || '').replace(/^j[0-9a-f]{12}_/, '');
const fmtTime = (s) => {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const sec = Math.floor(n % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

const SpeakerAssignRow = React.memo(function SpeakerAssignRow({
  speaker, voices, value, onChange, mediaSrcFor, audioPlayingSrc, onAudioToggle,
  allUsers = [],
}) {
  const options = useMemo(() => {
    const voiceNames = (voices || []).map((v) => v.name);
    const userNames = (allUsers || []).map((u) => u.full_name || u.username).filter(Boolean);
    return [...new Set([...voiceNames, ...userNames])];
  }, [voices, allUsers]);
  const listenSrc = speaker.has_sample
    ? voiceJobsAPI.speakerSampleUrl(speaker.base, speaker.speaker)
    : mediaSrcFor?.(speaker.speaker, speaker.first_segment_start);
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
      <Chip size="small" variant="outlined" label={speaker.speaker} sx={{ minWidth: 110 }} />
      {listenSrc && (
        <AudioPlayButton
          src={listenSrc}
          playing={audioPlayingSrc === listenSrc}
          onToggle={onAudioToggle}
          title={speaker.has_sample
            ? 'Прослушать фрагмент голоса'
            : 'Отдельный фрагмент не вырезан — играет запись с первой реплики этого участника'}
        />
      )}
      {speaker.suggested_name && (
        <Tooltip title={`Уверенность: ${speaker.confidence || '—'}, distance ${speaker.distance ?? '—'}`}>
          <Chip
            size="small"
            color="info"
            variant="outlined"
            label={`похоже на ${speaker.suggested_name}`}
            onClick={() => onChange(speaker.suggested_name)}
          />
        </Tooltip>
      )}
      <Autocomplete
        freeSolo
        size="small"
        options={options}
        value={value}
        onChange={(_e, v) => onChange(v || '')}
        onInputChange={(_e, v) => onChange(v || '')}
        sx={{ minWidth: 260, flex: 1 }}
        renderInput={(params) => (
          <TextField {...params} label="Кто это?" placeholder="Выберите из списка или впишите имя" />
        )}
      />
    </Stack>
  );
});

function VoiceMeetingDrawer({ meeting, open, onClose, canManage, canCreateTasks = false, voices, onAssigned }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [tab, setTab] = useState(0);
  const [assignments, setAssignments] = useState({});
  const [enrollNew, setEnrollNew] = useState({});
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMsg, setAssignMsg] = useState('');
  const [transcript, setTranscript] = useState(null);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptLimit, setTranscriptLimit] = useState(200);
  const [topics, setTopics] = useState([]);
  const [metaTags, setMetaTags] = useState([]);
  const [metaProject, setMetaProject] = useState('');
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaMsg, setMetaMsg] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTtl, setShareTtl] = useState(72);
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState('');
  const [viewReport, setViewReport] = useState(null);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [assignmentsCount, setAssignmentsCount] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [transcriptSpeaker, setTranscriptSpeaker] = useState('');
  const mediaRef = useRef(null);
  const speakerAudio = useSingleAudio();

  const base = meeting?.base_filename;
  const speakers = meeting?.speakers || {};
  const unresolved = speakers.unresolved || [];
  const mediaParts = meeting?.media_parts || [];
  const knownVoiceNames = useMemo(() => new Set((voices || []).map((v) => v.name)), [voices]);

  // Media src for a speaker: direct media, or the matching part of a merged
  // meeting (P{n}_ prefix picks merged_from[n-1]; otherwise the part whose
  // time window contains the speaker's first segment).
  const mediaSrcFor = (label, start) => speakerMediaSrc({
    label,
    start,
    hasMedia: meeting?.has_media,
    base,
    parts: mediaParts,
    mediaUrl: voiceJobsAPI.mediaUrl,
  });

  const primaryMediaSrc = meeting?.has_media
    ? voiceJobsAPI.mediaUrl(base)
    : (mediaParts.find((p) => p.has_media) ? voiceJobsAPI.mediaUrl(mediaParts.find((p) => p.has_media).base) : null);

  const seekMedia = (t) => {
    const el = mediaRef.current;
    const target = Number(t);
    if (!el || !Number.isFinite(target)) return;
    if (meeting?.has_media) {
      el.currentTime = target;
      el.play?.();
      return;
    }
    const picked = pickMergedPart(mediaParts, target);
    if (!picked) return;
    const { part, local } = picked;
    const url = voiceJobsAPI.mediaUrl(part.base);
    if (!el.src.includes(`/meetings/${encodeURIComponent(part.base)}/media`)) {
      const expected = new URL(url, window.location.href).href;
      el.src = url;
      el.addEventListener('loadedmetadata', () => {
        // Guard: another seek may have swapped src before this fired.
        if (el.src !== expected) return;
        el.currentTime = local;
        el.play?.();
      }, { once: true });
    } else {
      el.currentTime = local;
      el.play?.();
    }
  };

  useEffect(() => {
    hubTaskSupportAPI.getAssignees({ q: '', limit: 200 })
      .then((data) => setAllUsers(data.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setAssignments({});
    setEnrollNew({});
    setAssignMsg('');
    setTranscript(null);
    setTranscriptLimit(200);
    setTopics([]);
    setAssignmentsCount(null);
    setMetaTags(meeting?.web_meta?.tags || []);
    setMetaProject(meeting?.web_meta?.project || '');
    setMetaMsg('');
    setTab(0);
    setTranscriptQuery('');
    setTranscriptSpeaker('');
  }, [base, meeting?.web_meta?.tags, meeting?.web_meta?.project]);

  useEffect(() => {
    if (tab === 1 && base && !transcript && !transcriptBusy) {
      setTranscriptBusy(true);
      voiceJobsAPI.getTranscript(base, { limit: 5000 })
        .then((data) => setTranscript(data))
        .catch(() => setTranscript({ segments: [], total: 0, error: true }))
        .finally(() => setTranscriptBusy(false));
      voiceJobsAPI.getTopics(base)
        .then((data) => setTopics(data.items || []))
        .catch(() => setTopics([]));
    }
  }, [tab, base, transcript, transcriptBusy]);

  const submitAssignments = async () => {
    const cleaned = Object.fromEntries(
      Object.entries(assignments).filter(([, v]) => String(v || '').trim()),
    );
    if (!Object.keys(cleaned).length) return;
    setAssignBusy(true);
    setAssignMsg('');
    try {
      const enroll = Object.entries(cleaned)
        .filter(([speaker, name]) => enrollNew[speaker] && !knownVoiceNames.has(name))
        .map(([, name]) => name);
      await voiceJobsAPI.assignSpeakers(base, cleaned, enroll);
      setAssignMsg('Задача на переименование поставлена в очередь. Отчёты обновятся после завершения.');
      setAssignments({});
      onAssigned?.(base);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setAssignMsg(typeof detail === 'string' ? detail : 'Не удалось поставить задачу');
    } finally {
      setAssignBusy(false);
    }
  };

  const reports = meeting?.reports || [];
  const clips = meeting?.clips || [];
  const runningResume = (meeting?.jobs || []).some(
    (j) => j.kind === 'resume' && ['queued', 'processing'].includes(j.status),
  );
  const transcriptSpeakers = useMemo(
    () => Array.from(new Set((transcript?.segments || []).map((s) => s.speaker).filter(Boolean))),
    [transcript],
  );
  const filteredSegments = useMemo(() => {
    const segs = transcript?.segments || [];
    const q = transcriptQuery.trim().toLowerCase();
    return segs.filter(
      (s) => (!transcriptSpeaker || s.speaker === transcriptSpeaker)
        && (!q || String(s.text || '').toLowerCase().includes(q)),
    );
  }, [transcript, transcriptQuery, transcriptSpeaker]);

  const closeDrawer = () => { speakerAudio.stop(); mediaRef.current?.pause?.(); onClose?.(); };

  const sendProtocolByMail = async () => {
    if (!base) return;
    let items = [];
    try {
      const data = await voiceJobsAPI.getAssignments(base);
      items = data.items || [];
    } catch {
      items = [];
    }
    const name = displayName(base);
    const lines = [
      `Протокол встречи: ${name}`,
      `Встреча: ${base}`,
    ];
    if (meeting?.segments_count != null) lines.push(`Реплик: ${meeting.segments_count}`);
    lines.push('', 'Поручения:');
    items.slice(0, 30).forEach((item, idx) => {
      const tail = [item.assignee, item.deadline].filter(Boolean).join(', ');
      lines.push(`${idx + 1}. ${item.task || '—'}${tail ? ` — ${tail}` : ''}`);
    });
    if (!items.length) lines.push('—');
    lines.push('', `Открыть протокол: ${window.location.origin}/voice`);
    stashMailComposePrefill({
      to: [],
      subject: `Протокол встречи: ${name}`,
      bodyPlain: lines.join('\n'),
    });
    navigate('/mail?folder=inbox&compose=prefill');
  };

  return (
    <Dialog
      open={open}
      onClose={closeDrawer}
      fullScreen={isMobile}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          height: isMobile ? '100%' : '90vh',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap>{displayName(base)}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{base}</Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            {meeting?.segments_count != null && (
              <Chip size="small" variant="outlined" label={`${meeting.segments_count} реплик`} />
            )}
            {(speakers.resolved || []).length + unresolved.length > 0 && (
              <Chip size="small" variant="outlined" label={`${(speakers.resolved || []).length + unresolved.length} участников`} />
            )}
            {reports.length > 0 && (
              <Chip size="small" variant="outlined" label={`${reports.length} отчётов`} />
            )}
            {meeting?.reports && (
              meeting.has_media ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  label={meeting.source_expires_at
                    ? `Источник до ${new Date(meeting.source_expires_at).toLocaleDateString('ru-RU')}`
                    : 'Источник доступен'}
                />
              ) : (
                <Chip size="small" variant="outlined" color="default" label="Источник удалён" />
              )
            )}
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.5}>
          {base && (
            <Tooltip title="Отправить протокол письмом">
              <IconButton
                size="small"
                aria-label="Отправить протокол письмом"
                onClick={sendProtocolByMail}
              >
                <EmailOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {base && (
            <Tooltip title="Поделиться ссылкой">
              <IconButton
                size="small"
                aria-label="Поделиться ссылкой на протокол"
                onClick={() => { setShareUrl(''); setShareErr(''); setShareOpen(true); }}
              >
                <ShareOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <IconButton onClick={closeDrawer} size="small" aria-label="Закрыть"><CloseOutlinedIcon /></IconButton>
        </Stack>
      </Box>
      <Divider />
      {speakerAudio.audioEl}

      {canManage && meeting?.reports && (
        <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Autocomplete
            multiple
            freeSolo
            size="small"
            options={[]}
            value={metaTags}
            onChange={(_e, v) => setMetaTags(v)}
            sx={{ minWidth: 220, flex: 1 }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip size="small" variant="outlined" label={option} {...getTagProps({ index })} />
              ))
            }
            renderInput={(params) => (
              <TextField {...params} label="Теги" placeholder="Введите и нажмите Enter" />
            )}
          />
          <TextField
            size="small"
            label="Проект"
            value={metaProject}
            onChange={(e) => setMetaProject(e.target.value)}
            sx={{ minWidth: 140 }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={metaSaving}
            onClick={async () => {
              setMetaSaving(true);
              setMetaMsg('');
              try {
                await voiceJobsAPI.updateMeetingMeta(base, { tags: metaTags, project: metaProject });
                setMetaMsg('Сохранено');
              } catch {
                setMetaMsg('Не удалось сохранить');
              } finally {
                setMetaSaving(false);
              }
            }}
          >
            {metaSaving ? '…' : 'Сохранить'}
          </Button>
          {metaMsg && (
            <Typography variant="caption" color={metaMsg === 'Сохранено' ? 'success.main' : 'error'}>{metaMsg}</Typography>
          )}
        </Box>
      )}

      {!meeting?.reports ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, minHeight: 44 }}>
            <Tab icon={<GroupsOutlinedIcon fontSize="small" />} iconPosition="start" label={`Участники${unresolved.length ? ` (${unresolved.length})` : ''}`} sx={{ minHeight: 44 }} />
            <Tab icon={<SubjectOutlinedIcon fontSize="small" />} iconPosition="start" label="Текст разговора" sx={{ minHeight: 44 }} />
            <Tab icon={<AssignmentOutlinedIcon fontSize="small" />} iconPosition="start" label={`Поручения${assignmentsCount != null ? ` (${assignmentsCount})` : ''}`} sx={{ minHeight: 44 }} />
            <Tab icon={<DescriptionOutlinedIcon fontSize="small" />} iconPosition="start" label={`Отчёты (${reports.length})`} sx={{ minHeight: 44 }} />
          </Tabs>
          <Divider />
          <Box sx={{ p: 2, flex: 1, overflow: 'auto' }}>
            {tab === 0 && (
              <Stack spacing={2}>
                {runningResume && (
                  <Alert severity="info">Имена обновляются — протокол будет пересчитан по завершении.</Alert>
                )}
                {(speakers.resolved || []).length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Опознанные участники</Typography>
                    <Stack spacing={1}>
                      {(speakers.resolved || []).map((s) => (
                        <Paper key={s.name} variant="outlined" sx={{ p: 1 }}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                            <Chip size="small" color="success" variant="outlined" label={s.name} sx={{ minWidth: 110 }} />
                            {(() => {
                              const src = mediaSrcFor(s.name, s.first_segment_start);
                              return src ? (
                                <AudioPlayButton
                                  src={src}
                                  playing={speakerAudio.playingSrc === src}
                                  onToggle={speakerAudio.toggle}
                                  title="Прослушать запись с первой реплики участника"
                                />
                              ) : null;
                            })()}
                            {canManage && (
                              <Autocomplete
                                freeSolo
                                size="small"
                                options={[...new Set([...(voices || []).map((v) => v.name), ...(allUsers || []).map((u) => u.full_name || u.username).filter(Boolean)])]}
                                value={assignments[s.name] || ''}
                                onChange={(_e, v) => setAssignments((prev) => ({ ...prev, [s.name]: v || '' }))}
                                onInputChange={(_e, v) => setAssignments((prev) => ({ ...prev, [s.name]: v || '' }))}
                                sx={{ minWidth: 220, flex: 1 }}
                                renderInput={(params) => (
                                  <TextField {...params} label="Переименовать в" placeholder="Новое имя (пусто — оставить)" />
                                )}
                              />
                            )}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                )}
                {unresolved.length === 0 ? (
                  <Alert severity="success">Все участники опознаны.</Alert>
                ) : (
                  <>
                    <Typography variant="subtitle2">
                      Неопознанные участники — послушайте фрагмент и укажите имя
                    </Typography>
                    {unresolved.map((sp) => (
                      <Paper key={sp.speaker} variant="outlined" sx={{ p: 1.5 }}>
                        <SpeakerAssignRow allUsers={allUsers}
                          speaker={{ ...sp, base }}
                          voices={voices}
                          value={assignments[sp.speaker] || ''}
                          onChange={(v) => setAssignments((prev) => ({ ...prev, [sp.speaker]: v }))}
                          mediaSrcFor={mediaSrcFor}
                          audioPlayingSrc={speakerAudio.playingSrc}
                          onAudioToggle={speakerAudio.toggle}
                        />
                        {canManage && assignments[sp.speaker] && !knownVoiceNames.has(assignments[sp.speaker]) && (
                          <Button
                            size="small"
                            sx={{ mt: 1 }}
                            onClick={() => setEnrollNew((prev) => ({ ...prev, [sp.speaker]: !prev[sp.speaker] }))}
                            color={enrollNew[sp.speaker] ? 'success' : 'inherit'}
                            disabled={!sp.has_sample}
                          >
                            {enrollNew[sp.speaker]
                              ? '✓ Голос будет запомнен для будущих записей'
                              : 'Запомнить этот голос для будущих записей'}
                          </Button>
                        )}
                      </Paper>
                    ))}
                  </>
                )}
                {canManage ? (
                  <Box>
                    <Button
                      variant="contained"
                      onClick={submitAssignments}
                      disabled={
                        assignBusy
                        || runningResume
                        || !Object.values(assignments).some((v) => String(v || '').trim())
                      }
                    >
                      {assignBusy ? 'Отправляю…' : 'Сохранить имена и обновить протокол'}
                    </Button>
                  </Box>
                ) : (
                  <Alert severity="info">Чтобы задавать имена спикерам, нужно право на редактирование (voice.manage).</Alert>
                )}
                {assignMsg && <Alert severity={assignMsg.includes('очередь') ? 'success' : 'error'}>{assignMsg}</Alert>}
                {speakers.speaker_map_hint && (
                  <Typography variant="caption" color="text.secondary">
                    Подсказка: {speakers.speaker_map_hint}
                  </Typography>
                )}
              </Stack>
            )}

            {tab === 1 && (
              <Box>
                {primaryMediaSrc && (
                  <Box sx={{
                    mb: 2,
                    position: 'sticky',
                    top: -16,
                    zIndex: 2,
                    bgcolor: 'background.paper',
                    mx: -2,
                    px: 2,
                    pt: 2,
                  }}>
                    <video
                      ref={mediaRef}
                      controls
                      preload="metadata"
                      src={primaryMediaSrc}
                      style={{ width: '100%', maxHeight: 280, background: '#000' }}
                    />
                    {mediaParts.length > 1 && (
                      <Typography variant="caption" color="text.secondary">
                        Объединённая запись из {mediaParts.length} частей — при переходе по таймкоду подставляется нужная часть.
                      </Typography>
                    )}
                  </Box>
                )}
                {topics.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                      Темы встречи — нажмите, чтобы перейти
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5 }}>
                      {topics.map((t, i) => {
                        const total = Math.max(...topics.map((x) => x.end || 0), 1);
                        const width = Math.max(24, ((t.end - t.start) / total) * 100);
                        return (
                          <Tooltip key={i} title={`${t.title} (${fmtTime(t.start)} — ${fmtTime(t.end)})`}>
                            <Chip
                              size="small"
                              clickable
                              onClick={() => seekMedia(t.start)}
                              label={t.title.length > 28 ? `${t.title.slice(0, 28)}…` : t.title}
                              sx={{ flex: `0 0 ${width}%`, minWidth: 24, justifyContent: 'flex-start' }}
                              variant="outlined"
                              color="primary"
                            />
                          </Tooltip>
                        );
                      })}
                    </Box>
                  </Box>
                )}
                {transcript && !transcript.error && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
                    <TextField
                      size="small"
                      placeholder="Поиск по тексту…"
                      value={transcriptQuery}
                      onChange={(e) => setTranscriptQuery(e.target.value)}
                      sx={{ flex: 1 }}
                      InputProps={{
                        startAdornment: <SearchOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                      }}
                    />
                    <TextField
                      select
                      size="small"
                      label="Участник"
                      value={transcriptSpeaker}
                      onChange={(e) => setTranscriptSpeaker(e.target.value)}
                      sx={{ minWidth: 180 }}
                    >
                      <MenuItem value="">Все</MenuItem>
                      {transcriptSpeakers.map((name) => (
                        <MenuItem key={name} value={name}>{name}</MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                )}
                {transcriptBusy && <CircularProgress size={24} />}
                {transcript && !transcriptBusy && (
                  transcript.error ? (
                    <Alert severity="error">Не удалось загрузить текст разговора</Alert>
                  ) : (
                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        Реплик: {filteredSegments.length === (transcript.segments || []).length
                          ? transcript.total
                          : `${filteredSegments.length} из ${transcript.total} (фильтр)`}
                        {primaryMediaSrc ? ' — нажмите на время, чтобы проиграть фрагмент' : ''}
                      </Typography>
                      {!filteredSegments.length && (
                        <Alert severity="info">По фильтру ничего не найдено.</Alert>
                      )}
                      {filteredSegments.slice(0, transcriptLimit).map((s, idx) => (
                        <Box key={idx} sx={{ display: 'flex', gap: 1 }}>
                          <Typography
                            variant="caption"
                            color={primaryMediaSrc ? 'primary' : 'text.secondary'}
                            sx={{
                              minWidth: 44,
                              pt: '2px',
                              fontFamily: 'monospace',
                              fontVariantNumeric: 'tabular-nums',
                              cursor: primaryMediaSrc ? 'pointer' : 'default',
                              '&:hover': primaryMediaSrc ? { textDecoration: 'underline' } : {},
                            }}
                            onClick={() => seekMedia(s.start)}
                          >
                            {s.start_time_formatted || fmtTime(s.start)}
                          </Typography>
                          <Typography variant="body2">
                            <b>{s.speaker || '—'}:</b> {s.text}
                          </Typography>
                        </Box>
                      ))}
                      {filteredSegments.length > transcriptLimit && (
                        <Button
                          size="small"
                          onClick={() => setTranscriptLimit((n) => n + 200)}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          Показать ещё ({filteredSegments.length - transcriptLimit} осталось)
                        </Button>
                      )}
                    </Stack>
                  )
                )}
              </Box>
            )}

            {tab === 2 && (
              <VoiceAssignmentsTab base={base} canCreateTasks={canCreateTasks} onCountChange={setAssignmentsCount} />
            )}

            {tab === 3 && (
              <Stack spacing={1}>
                {reports.length === 0 && <Alert severity="info">Отчётов нет</Alert>}
                {clips.length > 0 && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    HTML-отчёт в браузере интерактивный: по ссылкам на время можно смотреть фрагменты.
                    При скачивании отчёт приходит папкой (ZIP) — фрагменты работают и офлайн.
                  </Alert>
                )}
                {(() => {
                  const groups = [
                    { key: 'protocol', label: 'Протокол' },
                    { key: 'report', label: 'Отчёт' },
                    { key: 'transcript', label: 'Текст разговора' },
                    { key: null, label: 'Прочее' },
                  ];
                  const bucketed = groups.map((g) => ({
                    ...g,
                    items: g.key === null
                      ? reports.filter((r) => !['protocol', 'report', 'transcript'].includes(r.kind))
                      : reports.filter((r) => r.kind === g.key),
                  })).filter((g) => g.items.length);
                  return bucketed.map((group) => (
                    <Box key={group.label}>
                      {bucketed.length > 1 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, mt: 1 }}>
                          {group.label}
                        </Typography>
                      )}
                      <Stack spacing={1}>
                        {group.items.map((r) => {
                          const pretty = r.name.startsWith(`${base}_`) ? r.name.slice(base.length + 1) : r.name;
                          const kindLabel = { report: 'Отчёт', protocol: 'Протокол', transcript: 'Текст разговора' }[r.kind] || 'Файл';
                          const viewable = r.ext === 'html' || r.ext === 'pdf';
                          return (
                            <Paper key={r.name} variant="outlined" sx={{ p: 1.25 }}>
                              <Stack direction="row" spacing={1.5} alignItems="center">
                                <Chip
                                  size="small"
                                  color={r.ext === 'html' ? 'primary' : r.ext === 'pdf' ? 'error' : 'default'}
                                  label={String(r.ext || '?').toUpperCase()}
                                  sx={{ minWidth: 56, fontWeight: 600 }}
                                />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="body2" noWrap>{pretty}</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {kindLabel} · {(r.size / 1024).toFixed(0)} КБ
                                  </Typography>
                                </Box>
                                {viewable && (
                                  <Button size="small" variant="outlined" onClick={() => setViewReport({ name: r.name, ext: r.ext, url: voiceJobsAPI.reportUrl(base, r.name) })}>
                                    Просмотр
                                  </Button>
                                )}
                                {viewable && (
                                  <Button size="small" variant="text" component={Link} href={voiceJobsAPI.reportUrl(base, r.name)} target="_blank" rel="noopener" sx={{ minWidth: 0, px: 1 }}>
                                    ↗
                                  </Button>
                                )}
                                <Tooltip title={clips.length ? 'Скачать папку с фрагментами (ZIP)' : 'Скачать файл'}>
                                  <IconButton size="small" aria-label="Скачать отчёт" component={Link} href={voiceJobsAPI.reportUrl(base, r.name, true)} download>
                                    <DownloadOutlinedIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </Paper>
                          );
                        })}
                      </Stack>
                    </Box>
                  ));
                })()}
                {clips.length > 0 && (
                  <>
                    <Divider sx={{ my: 1 }}>Фрагменты с поручениями</Divider>
                    {clips.map((c) => (
                      <Paper key={c.name} variant="outlined" sx={{ p: 1 }}>
                        <Typography variant="body2" noWrap sx={{ mb: 0.5 }}>{c.name}</Typography>
                        {c.name.toLowerCase().endsWith('.mp4') ? (
                          <video controls preload="metadata" src={voiceJobsAPI.clipUrl(base, c.name)} style={{ width: '100%', maxHeight: 220, background: '#000' }} />
                        ) : (
                          <audio controls preload="none" src={voiceJobsAPI.clipUrl(base, c.name)} style={{ width: '100%' }} />
                        )}
                      </Paper>
                    ))}
                  </>
                )}
              </Stack>
            )}
          </Box>
        </>
      )}
      {/* Report viewer dialog */}
      <Dialog fullScreen open={Boolean(viewReport)} onClose={() => setViewReport(null)}>
        <AppBar position="relative" color="default" elevation={1}>
          <Toolbar variant="dense">
            <IconButton edge="start" onClick={() => setViewReport(null)} aria-label="Закрыть">
              <CloseOutlinedIcon />
            </IconButton>
            <Typography sx={{ flex: 1, ml: 1 }} variant="subtitle2" noWrap>
              {viewReport?.name}
            </Typography>
            <Button color="inherit" size="small" component={Link} href={viewReport?.url} target="_blank" rel="noopener">
              Новая вкладка
            </Button>
            <Button color="inherit" size="small" component={Link} href={viewReport ? voiceJobsAPI.reportUrl(base, viewReport.name, true) : '#'} download>
              Скачать
            </Button>
          </Toolbar>
        </AppBar>
        <Box sx={{ flex: 1, minHeight: 0, bgcolor: 'grey.100' }}>
          <iframe
            src={viewReport?.url || ''}
            title={viewReport?.name || ''}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            sandbox="allow-scripts allow-same-origin"
          />
        </Box>
      </Dialog>

      <Dialog open={shareOpen} onClose={() => setShareOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Поделиться протоколом</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Ссылка откроет HTML-отчёт <b>без входа в систему</b> — отправляйте её только тем,
              кто должен видеть протокол. По истечении срока ссылка перестанет работать.
            </Typography>
            <TextField
              select
              size="small"
              label="Срок действия"
              value={shareTtl}
              onChange={(e) => setShareTtl(Number(e.target.value))}
            >
              <MenuItem value={24}>24 часа</MenuItem>
              <MenuItem value={72}>3 дня</MenuItem>
              <MenuItem value={168}>7 дней</MenuItem>
              <MenuItem value={720}>30 дней</MenuItem>
            </TextField>
            {shareUrl && (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField size="small" fullWidth value={shareUrl} InputProps={{ readOnly: true }} />
                <IconButton
                  aria-label="Скопировать ссылку"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(shareUrl); } catch { /* clipboard denied */ }
                  }}
                >
                  <ContentCopyOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}
            {shareErr && <Alert severity="error">{shareErr}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareOpen(false)}>Закрыть</Button>
          <Button
            variant="contained"
            disabled={shareBusy}
            onClick={async () => {
              setShareBusy(true);
              setShareErr('');
              try {
                const rec = await voiceJobsAPI.createShareLink(base, shareTtl);
                setShareUrl(`${window.location.origin}/api/v1/voice/public/${encodeURIComponent(rec.token)}`);
              } catch (e) {
                setShareErr(e?.response?.data?.detail || 'Не удалось создать ссылку');
              } finally {
                setShareBusy(false);
              }
            }}
          >
            {shareBusy ? 'Создаю…' : shareUrl ? 'Новая ссылка' : 'Создать ссылку'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

export default VoiceMeetingDrawer;
