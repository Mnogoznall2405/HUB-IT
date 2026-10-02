import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { VariableSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Skeleton,
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
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import CompressOutlinedIcon from '@mui/icons-material/CompressOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined';
import FitScreenOutlinedIcon from '@mui/icons-material/FitScreenOutlined';
import Forward5OutlinedIcon from '@mui/icons-material/Forward5Outlined';
import FullscreenOutlinedIcon from '@mui/icons-material/FullscreenOutlined';
import GpsFixedOutlinedIcon from '@mui/icons-material/GpsFixedOutlined';
import GpsNotFixedOutlinedIcon from '@mui/icons-material/GpsNotFixedOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import KeyboardArrowDownOutlinedIcon from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlinedIcon from '@mui/icons-material/KeyboardArrowUpOutlined';
import LinearProgress from '@mui/material/LinearProgress';
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import PauseOutlinedIcon from '@mui/icons-material/PauseOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import PlayCircleOutlineOutlinedIcon from '@mui/icons-material/PlayCircleOutlineOutlined';
import Replay5OutlinedIcon from '@mui/icons-material/Replay5Outlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined';
import SkipPreviousOutlinedIcon from '@mui/icons-material/SkipPreviousOutlined';
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined';
import TopicOutlinedIcon from '@mui/icons-material/TopicOutlined';
import UnfoldMoreOutlinedIcon from '@mui/icons-material/UnfoldMoreOutlined';
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
// P5-время: «0:MM:SS» → «M:SS» — без нулевого часа читается легче
// (записи короче часа — почти все): «0:01:00» → «1:00», «0:00:07» → «0:07».
const fmtClock = (raw) => String(raw || '').replace(/^0+:(\d{1,2}):(\d{2})$/, (m, mm, ss) => `${Number(mm)}:${ss}`);
const shareTtlLabels = { 24: '24 часа', 72: '3 дня', 168: '7 дней', 720: '30 дней' };
// Русские склонения: 1 участник, 2 участника, 5 участников (T23).
const plural = (n, forms) => {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
};
// Плотное поле: подпись и ввод в одну строку, без переноса, высота ≤ 44 px (T24).
const denseFieldSx = {
  maxWidth: '100%',
  maxHeight: 44,
  '& .MuiInputBase-root': { height: 40 },
  '& .MuiInputBase-input': { padding: '8px 10px' },
  '& .MuiInputLabel-root': { whiteSpace: 'nowrap' },
};
const denseAutocompleteSx = { minWidth: 180, flex: '1 1 200px', maxWidth: '100%' };
// P4-2: четыре вкладки панели помещаются без скролл-стрелок (fullWidth).
const compactPanelTabSx = { minWidth: 0, minHeight: 44, px: 0.5, fontSize: '0.72rem' };
// T40: бейдж счётчика у вкладки (маленькая плашка справа от подписи,
// а не сокращение «Поруч.»); подпись не переносится на вторую строку.
const tabCountSx = {
  ml: 0.5, px: 0.5, minWidth: 16, borderRadius: 1,
  bgcolor: 'action.selected', fontSize: '0.68rem', lineHeight: '16px',
  fontWeight: 700, textAlign: 'center', flexShrink: 0,
};
const tabLabel = (text, count) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>
    <Box component="span" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</Box>
    {count != null && count > 0 && <Box component="span" sx={tabCountSx}>{count}</Box>}
  </Box>
);
const tabLabelNarrow = (icon, count) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
    {icon}
    {count != null && count > 0 && <Box component="span" sx={tabCountSx}>{count}</Box>}
  </Box>
);
// T38: стабильный цвет участника — точка и имя в тексте одним цветом.
// Палитра — секции темы; в тёмной берём .light-вариант (primary.main
// #0f6cbd на тёмной поверхности даёт ~2.9:1 — ниже критерия 3:1 меток).
const SPEAKER_PALETTE = ['primary', 'warning', 'success', 'error', 'info'];
const speakerPaletteColor = (theme, key) => {
  const pal = theme.palette[key] || {};
  const prefer = theme.palette.mode === 'dark' && pal.light ? 'light' : 'main';
  return pal[prefer] || pal.main || 'text.primary';
};
// P5-2: цвет — по порядку появления участника в записи (первые N —
// гарантированно разные); хеш — запасной путь сверх размера палитры.
const speakerHashKey = (name) => {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return SPEAKER_PALETTE[Math.abs(h) % SPEAKER_PALETTE.length];
};
// T38/T43: техническая метка диаризации SPEAKER_00 → «Участник 1 (без имени)».
const speakerLabel = (raw) => {
  const m = /^SPEAKER_(\d+)$/i.exec(String(raw || '').trim());
  return m ? `Участник ${Number(m[1]) + 1} (без имени)` : (raw || '—');
};
// T39: разметка совпадений поиска — <mark>, реплики при этом остаются на месте.
const renderMarked = (text, q) => {
  const src = String(text || '');
  if (!q) return src;
  const lower = src.toLowerCase();
  const out = [];
  let i = 0; let k = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j === -1) { out.push(src.slice(i)); break; }
    if (j > i) out.push(src.slice(i, j));
    out.push(<mark key={k}>{src.slice(j, j + q.length)}</mark>);
    k += 1; i = j + q.length;
  }
  return out;
};
const responseDetailOr = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
};
// Таймкод «H:MM:SS»/«MM:SS» (в т.ч. из интервала «17:10 — 18:52») → секунды.
export const timecodeToSec = (raw) => {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(raw || ''));
  if (!m) return null;
  return m[3] != null
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    : Number(m[1]) * 60 + Number(m[2]);
};

// T50: строка участника — одной строкой ≤56 px: цвет и имя как в тексте,
// статистика реплик, кнопка прослушивания и поле имени.
const SpeakerAssignRow = React.memo(function SpeakerAssignRow({
  speaker, label, color, stats, fieldLabel = 'Кто это?', editable = true,
  renameField = false,
  voices, value, onChange, mediaSrcFor, audioPlayingSrc, onAudioToggle,
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
    <Paper variant="outlined" data-testid="speaker-row" data-speaker-row sx={{ px: 1, py: 0.5 }}>
      {/* P6-2: строка может переноситься — имя «Участник N (без имени)»
          не должно схлопываться в «Участн…» из-за чипа и поля. */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 44, flexWrap: 'wrap' }}>
        <Box
          aria-hidden
          sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color || 'text.disabled', flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 96, flex: '1 1 auto' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, color: color || 'text.primary', overflowWrap: 'anywhere' }}>
            {label}
          </Typography>
          {stats && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.2 }}>
              {stats}
            </Typography>
          )}
        </Box>
        {listenSrc && (
          <AudioPlayButton
            src={listenSrc}
            playing={audioPlayingSrc === listenSrc}
            onToggle={onAudioToggle}
            title={speaker.has_sample
              ? `Прослушать фрагмент участника ${label}`
              : `Прослушать участника ${label} с первой реплики`}
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
              sx={{ flexShrink: 0 }}
            />
          </Tooltip>
        )}
        {editable && (renameField ? (
          <TextField
            size="small"
            label={fieldLabel}
            placeholder="Новое имя (пусто — оставить)"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            sx={{ ...denseAutocompleteSx, ...denseFieldSx, ml: 'auto' }}
          />
        ) : (
          <Autocomplete
            freeSolo
            size="small"
            options={options}
            value={value}
            onChange={(_e, v) => onChange(v || '')}
            onInputChange={(_e, v) => onChange(v || '')}
            sx={{ ...denseAutocompleteSx, ml: 'auto', '& .MuiFormControl-root': denseFieldSx }}
            renderInput={(params) => (
              <TextField {...params} label={fieldLabel} placeholder="Выберите из списка или впишите имя" />
            )}
          />
        ))}
      </Stack>
    </Paper>
  );
});

// T47: строка транскрипта — элемент виртуального списка. Мемоизация по
// флагу активности строки (а не по всей позиции плеера) — при тике плеера
// перерисовываются только две строки: снявшая и получившая подсветку (T46).
const TranscriptSegRow = React.memo(function TranscriptSegRow({ index, style, data }) {
  const {
    segs, activeIdx, flashStart, matchStart, query, isMobile, theme,
    colors, unresolvedSet, firstUnnamed, assignmentMarkers, canManage,
    onSeekTime, onMarkerClick, onNameClick, pendingRef, sizeMap, listRef, onMeasure,
  } = data;
  const s = segs[index];
  const innerRef = useRef(null);
  // Точная высота строки известна только после рендера — докладываем её в
  // sizeMap и просим список пересчитать offsets после этой строки.
  // Пересчёты батчатся на кадр (onMeasure), иначе при первом маунте каждая
  // строка вызывает resetAfterIndex и список перекладывается N раз.
  useEffect(() => {
    const h = innerRef.current?.getBoundingClientRect?.().height;
    if (h && Math.abs((sizeMap.get(index) || 0) - h) > 1) {
      sizeMap.set(index, h);
      onMeasure(index);
    }
  });
  // Отложенная прокрутка: цель попала в окно — центрируем её точно.
  useEffect(() => {
    const pend = pendingRef.current;
    if (pend && pend.start === s.start) {
      pendingRef.current = null;
      innerRef.current?.scrollIntoView?.({ block: 'center', behavior: pend.behavior || 'smooth' });
    }
  });
  if (!s) return <div style={style} />;
  const markers = assignmentMarkers.get(s.start) || [];
  const isActiveSeg = index === activeIdx;
  const isFlash = flashStart === s.start;
  const isCurrentMatch = matchStart === s.start;
  // T38: имя спикера — отдельной строкой и только при смене
  // спикера (реплики подряд читаются как монолог одного лица).
  const prev = index > 0 ? segs[index - 1] : null;
  const showName = !prev || prev.speaker !== s.speaker;
  const nameColor = colors.get(s.speaker) || speakerPaletteColor(theme, speakerHashKey(s.speaker));
  const isUnnamed = unresolvedSet.has(s.speaker);
  const nameField = (
    <>
      <Box
        component="span"
        data-speaker-dot
        aria-hidden
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: nameColor, flexShrink: 0 }}
      />
      {isUnnamed ? (
        <ButtonBase
          component="span"
          data-testid="seg-speaker"
          aria-label={`${speakerLabel(s.speaker)} — назвать участника`}
          onClick={(e) => onNameClick(s.speaker, e.currentTarget)}
          sx={{
            color: nameColor, fontWeight: 700, minWidth: 0, justifyContent: 'flex-start',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 'inherit', borderRadius: 0.5, px: 0.25,
          }}
        >
          {speakerLabel(s.speaker)}
        </ButtonBase>
      ) : (
        <Box
          component="span"
          data-testid="seg-speaker"
          sx={{
            color: nameColor, fontWeight: 700, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {speakerLabel(s.speaker)}
        </Box>
      )}
      {/* T51: «Назвать» — только у первого появления безымянного
          участника, а не у каждой его реплики. */}
      {isUnnamed && firstUnnamed.has(index) && (
        <Button
          size="small"
          variant="text"
          aria-label={`Назвать — ${speakerLabel(s.speaker)}`}
          onClick={(e) => onNameClick(s.speaker, e.currentTarget)}
          sx={{ minHeight: 0, py: 0, px: 0.5, fontSize: '0.72rem', lineHeight: 1.4, flexShrink: 0 }}
        >
          Назвать
        </Button>
      )}
    </>
  );
  const timeButton = (
    <Button
      size="small"
      aria-label={`Перейти к ${fmtClock(s.start_time_formatted || fmtTime(s.start))}`}
      onClick={() => onSeekTime(s.start)}
      sx={{
        minWidth: 44,
        px: 0,
        pt: '2px',
        justifyContent: 'flex-start',
        // P5-1: время — по верхней строке реплики, а не по центру
        // многострочного абзаца.
        alignSelf: 'flex-start',
        flexShrink: 0,
        fontSize: '0.75rem',
        fontFamily: 'monospace',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {fmtClock(s.start_time_formatted || fmtTime(s.start))}
    </Button>
  );
  const markersChip = markers.length > 0 && (
    <Tooltip title={markers.map((m) => `Поручение №${m.num}: ${String(m.task || '').slice(0, 80)}`).join('\n')}>
      <Chip
        size="small"
        icon={<AssignmentOutlinedIcon sx={{ fontSize: 14 }} />}
        label={markers.length > 1 ? `${markers.length}` : ''}
        clickable
        aria-label={`У реплики поручени${markers.length > 1 ? `я: ${markers.map((m) => `№${m.num}`).join(', ')}` : `е №${markers[0].num}`}`}
        onClick={() => onMarkerClick('assign')}
        variant="outlined"
        color="warning"
        sx={{ flexShrink: 0 }}
      />
    </Tooltip>
  );
  // P5-5: подсветка совпадений — warning из палитры темы
  // (полупрозрачный), а не браузерный #ff0.
  const segTextSx = {
    minWidth: 0, lineHeight: 1.5,
    '& mark': {
      bgcolor: alpha(theme.palette.warning.main, 0.45),
      color: 'inherit',
      borderRadius: '2px',
      px: '1px',
    },
  };
  const segSx = {
    display: 'flex',
    // P5-1: время прижато к верхней строке, не центрируется.
    alignItems: 'flex-start',
    gap: 1,
    borderLeft: '3px solid',
    borderColor: isActiveSeg ? 'primary.main' : 'transparent',
    bgcolor: isFlash ? 'action.hover' : isActiveSeg ? 'action.selected' : 'transparent',
    outline: isCurrentMatch ? '1px solid' : 'none',
    outlineColor: 'warning.main',
    borderRadius: 0.5,
    px: 0.5,
    ml: -0.5,
  };
  return (
    <div style={style}>
      <Box ref={innerRef} sx={{ pb: 0.5 }}>
        {showName && !isMobile && (
          <Typography
            variant="caption"
            component="div"
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              mt: index === 0 ? 0 : 0.5, pl: 0.5, minWidth: 0,
            }}
          >
            {nameField}
          </Typography>
        )}
        <Box
          data-seg-start={s.start}
          data-seg-active={isActiveSeg ? '1' : undefined}
          data-search-current={isCurrentMatch ? '1' : undefined}
          sx={segSx}
        >
          {isMobile ? (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box
                data-seg-head
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 0.5, minWidth: 0 }}
              >
                {showName ? nameField : null}
                <Box sx={{ ml: 'auto', flexShrink: 0, alignSelf: 'flex-start' }}>{timeButton}</Box>
                {markersChip}
              </Box>
              <Typography variant="body2" sx={{ ...segTextSx, pl: 0.5 }}>
                {renderMarked(s.text, query)}
              </Typography>
            </Box>
          ) : (
            <>
              {timeButton}
              {/* T38: текст без префикса «Имя:»; ≤~80 символов в
                  строке — колонка ограничена 80ch, межстрочный 1.5. */}
              <Typography variant="body2" sx={{ ...segTextSx, flex: 1, maxWidth: '80ch' }}>
                {renderMarked(s.text, query)}
              </Typography>
              {markersChip}
            </>
          )}
        </Box>
      </Box>
    </div>
  );
}, (prev, next) => {
  // T46: без полного сравнения data — решаем по признакам самой строки.
  const d = prev.data;
  const e = next.data;
  // react-window кеширует style на строку — новый объект только при смене
  // позиции/высоты; без сравнения style строка осталась бы на старом месте.
  if (prev.index !== next.index || prev.style !== next.style) return false;
  if (d.isMobile !== e.isMobile) return false;
  if (d.segs !== e.segs || d.segs[prev.index] !== e.segs[prev.index]) return false;
  const s = d.segs[prev.index];
  // T48: при смене запроса перерисовываются только строки, где совпадение
  // есть или было (mark там может появиться/исчезнуть/сдвинуться) —
  // остальные реплики на ввод не реагируют.
  if (d.query !== e.query) {
    const txt = String(s?.text || '').toLowerCase();
    if ((d.query && txt.includes(d.query)) || (e.query && txt.includes(e.query))) return false;
  }
  if ((d.activeIdx === prev.index) !== (e.activeIdx === prev.index)) return false;
  if ((d.flashStart === s?.start) !== (e.flashStart === s?.start)) return false;
  if ((d.matchStart === s?.start) !== (e.matchStart === s?.start)) return false;
  if (d.colors !== e.colors || d.unresolvedSet !== e.unresolvedSet) return false;
  if (d.firstUnnamed !== e.firstUnnamed || d.assignmentMarkers !== e.assignmentMarkers) return false;
  if (d.canManage !== e.canManage || d.theme !== e.theme) return false;
  if (d.pendingRef !== e.pendingRef || d.sizeMap !== e.sizeMap || d.listRef !== e.listRef || d.onMeasure !== e.onMeasure) return false;
  if (d.onSeekTime !== e.onSeekTime || d.onMarkerClick !== e.onMarkerClick || d.onNameClick !== e.onNameClick) return false;
  return true;
});

// T47: оценка высоты строки до первого рендера (точная — после замера).
const estimateSegHeight = (segs, index, isMobile) => {
  const s = segs[index];
  const textLen = String(s?.text || '').length;
  const prevSpeaker = index > 0 ? segs[index - 1]?.speaker : null;
  const nameHead = (!prevSpeaker || prevSpeaker !== s?.speaker)
    ? (isMobile ? 0 : 20) // на <sm имя внутри строки-заголовка
    : 0;
  const charsPerLine = isMobile ? 42 : 100;
  const lines = Math.max(1, Math.ceil(textLen / charsPerLine));
  const mobileHead = isMobile && (!prevSpeaker || prevSpeaker !== s?.speaker) ? 24 : 0;
  return (isMobile ? 28 + mobileHead : 26 + nameHead) + lines * 20 + 6;
};

// T46/T48: область списка реплик мемоизирована — ввод в поле поиска
// перерисовывает только строку фильтров, список реагирует на deferred-запрос.
const TranscriptViewport = React.memo(function TranscriptViewport({
  transcriptBusy, transcriptData, filteredSegments, deferredQuery,
  transcriptSpeaker, segItemData, isMobile, segListRef, segBoxRef,
  segSizeMapRef, segVisibleRef, retryTranscript,
}) {
  return (
    <>
      {transcriptBusy && (
        // T42: скелетоны строк вместо одиночного спиннера.
        <Stack spacing={0.5} aria-label="Загрузка текста разговора">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} data-skeleton variant="rounded" height={i === 0 ? 14 : 34} sx={{ width: i === 0 ? '30%' : '100%' }} />
          ))}
        </Stack>
      )}
      {transcriptData && !transcriptBusy && (
        transcriptData.error ? (
          <Alert
            severity="error"
            action={<Button size="small" onClick={retryTranscript}>Повторить</Button>}
          >
            Не удалось загрузить текст разговора
          </Alert>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {!filteredSegments.length && (deferredQuery || transcriptSpeaker) && (
              <Alert severity="info" sx={{ mb: 0.5 }}>По фильтру ничего не найдено.</Alert>
            )}
            {!filteredSegments.length && !deferredQuery && !transcriptSpeaker && (
              <Alert severity="info" sx={{ mb: 0.5 }}>Текст разговора пуст.</Alert>
            )}
            {filteredSegments.length > 0 && (
              // T47: полный текст без лимита — виртуализированный список;
              // прокрутка к любой реплике через scrollToItem, без «Показать ещё».
              <Box ref={segBoxRef} sx={{ flex: 1, minHeight: 120 }}>
                {/* T47: default-размеры — список рисуется уже в первый кадр,
                    до замера AutoSizer; точный размер подставится далее. */}
                <AutoSizer defaultHeight={isMobile ? 420 : 600} defaultWidth={isMobile ? 340 : 800}>
                  {({ width, height }) => (
                    <VariableSizeList
                      ref={segListRef}
                      height={height}
                      width={width}
                      itemCount={filteredSegments.length}
                      itemSize={(i) => segSizeMapRef.current.get(i) || estimateSegHeight(filteredSegments, i, isMobile)}
                      estimatedItemSize={isMobile ? 76 : 48}
                      overscanCount={4}
                      itemData={segItemData}
                      itemKey={(i, d) => `${d.segs[i]?.start ?? 'x'}:${i}`}
                      onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
                        segVisibleRef.current = [visibleStartIndex, visibleStopIndex];
                      }}
                    >
                      {TranscriptSegRow}
                    </VariableSizeList>
                  )}
                </AutoSizer>
              </Box>
            )}
          </Box>
        )
      )}
    </>
  );
});

function VoiceMeetingDrawer({
  meeting, open, onClose, canManage, canCreateTasks = false, voices, onAssigned,
  loadError = '', onRetryLoad, onActiveShareLinkChange, shareNavWarning = false,
}) {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  // P4-4: <360px — плеер и тулбар ужимаются до иконок/меню, иначе диалог
  // получает горизонтальную прокрутку (Ревью 9: scrollWidth 354 при 318).
  const isNarrow = useMediaQuery(theme.breakpoints.down(360));
  // Фаза 4 (утверждённая): на <md — вкладки контента, на ≥md — вкладки правой панели.
  const [mobileTab, setMobileTab] = useState('talk');        // talk|topics|assign|more
  const [panelTab, setPanelTab] = useState('topics');        // topics|assign|speakers|files
  const [mediaRate, setMediaRate] = useState(1);
  // T55: позиция указателя над шкалой ({frac, dragging}) — hover-подсказка
  // и перетаскивание бегунка (seek — при отпускании).
  const [timelineScrub, setTimelineScrub] = useState(null);
  const [mediaIsAudio, setMediaIsAudio] = useState(false);   // дорожка без картинки → аудио-полоса
  const [mediaPartOffset, setMediaPartOffset] = useState(0); // смещение текущей части объединённой записи
  const [navNotice, setNavNotice] = useState('');
  const [assignments, setAssignments] = useState({});
  const [enrollNew, setEnrollNew] = useState({});
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMsg, setAssignMsg] = useState(null); // { text, severity }
  const [transcript, setTranscript] = useState(null); // { base, data }
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [topics, setTopics] = useState([]);
  // T42: состояния блоков — loading/ready/error, у ошибки своё «Повторить».
  const [topicsStatus, setTopicsStatus] = useState('idle');
  const [assignStatus, setAssignStatus] = useState('idle');
  const [metaTags, setMetaTags] = useState([]);
  const [metaProject, setMetaProject] = useState('');
  const [metaEditorOpen, setMetaEditorOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [reportMenu, setReportMenu] = useState(null);
  const [playerMenuAnchor, setPlayerMenuAnchor] = useState(null);
  const [speakerMenuAnchor, setSpeakerMenuAnchor] = useState(null);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaFeedback, setMetaFeedback] = useState(null);
  const [mailError, setMailError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTtl, setShareTtl] = useState(72);
  const [shareLinks, setShareLinks] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCreateError, setShareCreateError] = useState('');
  const [shareCloseWarning, setShareCloseWarning] = useState(false);
  const [viewReport, setViewReport] = useState(null);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  // T39: по умолчанию запрос подсвечивает совпадения (<mark>), реплики не
  // прячутся; режим «Только совпадения» — прежняя фильтрация списка.
  const [searchMatchesOnly, setSearchMatchesOnly] = useState(false);
  const [searchCursor, setSearchCursor] = useState(0);
  const [allUsers, setAllUsers] = useState([]);
  const [transcriptSpeaker, setTranscriptSpeaker] = useState('');
  // T30: поручения подняты в drawer — таймкод поручения перематывает основной
  // плеер, а рядом с репликой показывается маркер «Поручение №N».
  const [assignmentItems, setAssignmentItems] = useState(null);
  // T31/T32: состояние плеера для компактного режима и подсветки реплики.
  const [mediaTime, setMediaTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [mediaPlaying, setMediaPlaying] = useState(false);
  const [playerCompact, setPlayerCompact] = useState(false);
  // T52: «Большое видео» — видео на большую часть высоты карточки.
  const [playerBig, setPlayerBig] = useState(false);
  const [followSegment, setFollowSegment] = useState(true);
  // T51: поповер имени участника из текста реплики.
  const [nameEditor, setNameEditor] = useState(null); // { anchor, speaker }
  const mediaRef = useRef(null);
  const transcriptAbortRef = useRef(null);
  const scrollRef = useRef(null);
  const mediaTickRef = useRef(0); // троттлинг timeupdate до ~4 раз/с (T33)
  // T47: виртуальный список — видимый диапазон, высоты строк и цель
  // отложенной прокрутки ({ start, behavior }).
  const segListRef = useRef(null);
  const segSizeMapRef = useRef(new Map());
  const segVisibleRef = useRef([0, 0]);
  const segBoxRef = useRef(null);
  const pendingSegRef = useRef(null);
  // T39: прокрутка к совпадению — только по явной навигации (↑/↓/Enter),
  // а не при обновлении списка совпадений по мере ввода.
  const matchNavRef = useRef(false);
  // T46: батчинг resetAfterIndex — строки докладывают высоту после маунта,
  // список перекладывается один раз за кадр, а не N раз.
  const segMeasureRef = useRef({ scheduled: false, min: Infinity });
  const onSegMeasured = React.useCallback((index) => {
    const m = segMeasureRef.current;
    m.min = Math.min(m.min, index);
    if (m.scheduled) return;
    m.scheduled = true;
    requestAnimationFrame(() => {
      m.scheduled = false;
      const min = m.min;
      m.min = Infinity;
      segListRef.current?.resetAfterIndex?.(min);
    });
  }, []);
  const speakerAudio = useSingleAudio();

  const base = meeting?.base_filename;
  const internalMeetingUrl = base
    ? `${window.location.origin}/voice?meeting=${encodeURIComponent(base)}`
    : '';
  const speakers = meeting?.speakers || {};
  const unresolved = speakers.unresolved || [];
  // T38: id-ы неопознанных — у их имён в тексте появляется кнопка «Назвать».
  const unresolvedSet = useMemo(() => new Set(unresolved.map((u) => u.speaker)), [unresolved]);
  const participantsTotal = (speakers.resolved || []).length + unresolved.length;
  const mediaParts = useMemo(() => meeting?.media_parts || [], [meeting?.media_parts]);
  const knownVoiceNames = useMemo(() => new Set((voices || []).map((v) => v.name)), [voices]);

  // Media src for a speaker: direct media, or the matching part of a merged
  // meeting (P{n}_ prefix picks merged_from[n-1]; otherwise the part whose
  // time window contains the speaker's first segment).
  const mediaSrcFor = React.useCallback((label, start) => speakerMediaSrc({
    label,
    start,
    hasMedia: meeting?.has_media,
    base,
    parts: mediaParts,
    mediaUrl: voiceJobsAPI.mediaUrl,
  }), [meeting?.has_media, base, mediaParts]);

  const primaryMediaSrc = meeting?.has_media
    ? voiceJobsAPI.mediaUrl(base)
    : (mediaParts.find((p) => p.has_media) ? voiceJobsAPI.mediaUrl(mediaParts.find((p) => p.has_media).base) : null);

  const seekMedia = React.useCallback((t) => {
    const el = mediaRef.current;
    const target = Number(t);
    if (!el || !Number.isFinite(target)) return;
    if (meeting?.has_media) {
      setMediaPartOffset(0);
      el.currentTime = target;
      el.play?.();
      return;
    }
    const picked = pickMergedPart(mediaParts, target);
    if (!picked) return;
    const { part, local } = picked;
    setMediaPartOffset(Number(part.offset || 0));
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
  }, [meeting?.has_media, mediaParts]);

  useEffect(() => {
    hubTaskSupportAPI.getAssignees({ q: '', limit: 200 })
      .then((data) => setAllUsers(data.items || []))
      .catch(() => {});
  }, []);

  // Полный сброс состояния — только при смене встречи.
  useEffect(() => {
    setAssignments({});
    setEnrollNew({});
    setAssignMsg(null);
    setTranscript(null);
    setTranscriptBusy(false);
    setTopics([]);
    setTopicsStatus('idle');
    setAssignStatus('idle');
    setAssignmentItems(null);
    setMetaTags(meeting?.web_meta?.tags || []);
    setMetaProject(meeting?.web_meta?.project || '');
    setMetaFeedback(null);
    setMailError('');
    setMobileTab('talk');
    setPanelTab('topics');
    setMediaTime(0);
    setMediaDuration(0);
    setMediaPlaying(false);
    setMediaRate(1);
    setMediaIsAudio(false);
    setMediaPartOffset(0);
    setNavNotice('');
    setFlashStart(null);
    setPlayerCompact(false);
    setFollowSegment(true);
    pendingSegRef.current = null;
    segSizeMapRef.current = new Map();
    segVisibleRef.current = [0, 0];
    setPlayerBig(false);
    setNameEditor(null);
    setTranscriptQuery('');
    setTranscriptSpeaker('');
    setMetaEditorOpen(false);
    // N17: при смене протокола (Вперёд/Назад между двумя карточками) диалог
    // «Поделиться» не должен показывать ссылки предыдущей встречи.
    setShareOpen(false);
    setShareLinks([]);
    setShareCreateError('');
    setShareCloseWarning(false);
    setShareBusy(false);
  }, [base]);

  useEffect(() => {
    if (!open) {
      setMetaEditorOpen(false);
      setMailError('');
    }
  }, [open]);

  // «Теги»/«Проект» обновляются из meeting без сброса остального состояния —
  // только при реальном изменении значений, а не при каждой новой ссылке на web_meta.
  const metaTagsValue = JSON.stringify(meeting?.web_meta?.tags || []);
  const metaProjectValue = meeting?.web_meta?.project || '';
  useEffect(() => {
    setMetaTags(JSON.parse(metaTagsValue));
    setMetaProject(metaProjectValue);
  }, [metaTagsValue, metaProjectValue]);

  // T28: единая прокрутка — транскрипт, темы и поручения грузятся при открытии
  // карточки, а не по входу на вкладку.
  useEffect(() => {
    if (!open || !base || !meeting?.reports) return;
    if (transcript && transcript.base === base) return;
    if (transcriptBusy) return;
    const controller = new AbortController();
    transcriptAbortRef.current = controller;
    setTranscriptBusy(true);
    voiceJobsAPI.getTranscript(base, { limit: 5000 }, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setTranscript({ base, data }); })
      .catch(() => {
        if (!controller.signal.aborted) setTranscript({ base, data: { segments: [], total: 0, error: true } });
      })
      .finally(() => { if (!controller.signal.aborted) setTranscriptBusy(false); });
    setTopicsStatus('loading');
    voiceJobsAPI.getTopics(base, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTopics(data.items || []);
        setTopicsStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTopics([]);
        setTopicsStatus('error');
      });
    setAssignStatus('loading');
    voiceJobsAPI.getAssignments(base, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setAssignmentItems(data.items || []);
        setAssignStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAssignmentItems([]);
        setAssignStatus('error');
      });
  }, [open, base, meeting?.reports, transcript, transcriptBusy]);

  // T42: «Повторить» перезагружает только свой блок, остальные не трогает.
  const retryTopics = React.useCallback(() => {
    if (topicsStatus === 'loading') return;
    setTopicsStatus('loading');
    voiceJobsAPI.getTopics(base)
      .then((data) => { setTopics(data.items || []); setTopicsStatus('ready'); })
      .catch(() => { setTopics([]); setTopicsStatus('error'); });
  }, [topicsStatus, base]);
  const retryAssignments = React.useCallback(() => {
    if (assignStatus === 'loading') return;
    setAssignStatus('loading');
    voiceJobsAPI.getAssignments(base)
      .then((data) => { setAssignmentItems(data.items || []); setAssignStatus('ready'); })
      .catch(() => { setAssignmentItems([]); setAssignStatus('error'); });
  }, [assignStatus, base]);
  const retryTranscript = React.useCallback(() => {
    if (transcriptBusy) return;
    setTranscriptBusy(true);
    voiceJobsAPI.getTranscript(base, { limit: 5000 })
      .then((data) => setTranscript({ base, data }))
      .catch(() => setTranscript({ base, data: { segments: [], total: 0, error: true } }))
      .finally(() => setTranscriptBusy(false));
  }, [transcriptBusy, base]);

  // Отмена незавершённого запроса транскрипта при смене встречи и закрытии карточки.
  useEffect(() => () => transcriptAbortRef.current?.abort(), [base]);

  const submitAssignments = React.useCallback(async () => {
    const cleaned = Object.fromEntries(
      Object.entries(assignments).filter(([, v]) => String(v || '').trim()),
    );
    if (!Object.keys(cleaned).length) return;
    setAssignBusy(true);
    setAssignMsg(null);
    try {
      const enroll = Object.entries(cleaned)
        .filter(([speaker, name]) => enrollNew[speaker] && !knownVoiceNames.has(name))
        .map(([, name]) => name);
      await voiceJobsAPI.assignSpeakers(base, cleaned, enroll);
      setAssignMsg({
        text: 'Задача на переименование поставлена в очередь. Отчёты обновятся после завершения.',
        severity: 'success',
      });
      setAssignments({});
      onAssigned?.(base);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setAssignMsg({
        text: typeof detail === 'string' ? detail : 'Не удалось поставить задачу',
        severity: 'error',
      });
    } finally {
      setAssignBusy(false);
    }
  }, [assignments, enrollNew, knownVoiceNames, base, onAssigned, assignBusy]);

  const reports = useMemo(() => meeting?.reports || [], [meeting?.reports]);
  const clips = useMemo(() => meeting?.clips || [], [meeting?.clips]);
  const runningResume = (meeting?.jobs || []).some(
    (j) => j.kind === 'resume' && ['queued', 'processing'].includes(j.status),
  );
  // Показывать транскрипт только для текущей встречи.
  const transcriptData = transcript && transcript.base === base ? transcript.data : null;
  const transcriptSpeakers = useMemo(
    () => Array.from(new Set((transcriptData?.segments || []).map((s) => s.speaker).filter(Boolean))),
    [transcriptData],
  );
  // P5-2: цвет участника — по порядку появления в записи, первые N из палитры
  // темы гарантированно разные; хеш — только для участников сверх палитры.
  const speakerColorMap = useMemo(() => {
    const map = new Map();
    transcriptSpeakers.forEach((name, i) => {
      map.set(name, speakerPaletteColor(theme, i < SPEAKER_PALETTE.length ? SPEAKER_PALETTE[i] : speakerHashKey(name)));
    });
    return map;
  }, [transcriptSpeakers, theme]);
  // T48: фильтрация и подсчёт совпадений идут по отложенному запросу —
  // ввод символа не ждёт пересчёта тысяч реплик и подсветки.
  const deferredTranscriptQuery = useDeferredValue(transcriptQuery);
  const deferredQuery = deferredTranscriptQuery.trim().toLowerCase();
  const filteredSegments = useMemo(() => {
    const segs = transcriptData?.segments || [];
    const filterByQuery = deferredQuery && searchMatchesOnly;
    return segs.filter(
      (s) => (!transcriptSpeaker || s.speaker === transcriptSpeaker)
        && (!filterByQuery || String(s.text || '').toLowerCase().includes(deferredQuery)),
    );
  }, [transcriptData, deferredQuery, transcriptSpeaker, searchMatchesOnly]);

  // T39: совпадения поиска — список start-ов реплик с вхождением запроса;
  // курсор ходит по ним через Enter/↑/↓ и счётчик «Реплика N из M» (P5-5).
  const matchStarts = useMemo(() => {
    if (!deferredQuery) return [];
    return filteredSegments
      .filter((s) => String(s.text || '').toLowerCase().includes(deferredQuery))
      .map((s) => s.start);
  }, [filteredSegments, deferredQuery]);
  const matchCursor = matchStarts.length ? Math.min(searchCursor, matchStarts.length - 1) : -1;

  // T51: индекс первого появления каждого безымянного участника —
  // «Назвать» показывается один раз на участника, а не у каждой реплики.
  const firstUnnamedIdx = useMemo(() => {
    const seen = new Set();
    const first = new Set();
    filteredSegments.forEach((s, idx) => {
      if (unresolvedSet.has(s.speaker) && !seen.has(s.speaker)) {
        seen.add(s.speaker);
        first.add(idx);
      }
    });
    return first;
  }, [filteredSegments, unresolvedSet]);

  // T50: статистика участника — число реплик и суммарное время речи.
  const speakerStats = useMemo(() => {
    const map = new Map();
    (transcriptData?.segments || []).forEach((s) => {
      const cur = map.get(s.speaker) || { count: 0, secs: 0 };
      cur.count += 1;
      const dur = Number(s.end ?? NaN) - Number(s.start ?? NaN);
      cur.secs += Number.isFinite(dur) && dur > 0 ? dur : 0;
      map.set(s.speaker, cur);
    });
    return map;
  }, [transcriptData]);

  // T33: активная реплика — последний сегмент с start <= глобальной позиции
  // плеера (для объединённой записи — offset части + локальное время;
  // бинарный поиск; обновление mediaTime зафиксировано на ~4 раза в секунду).
  const activeSegmentIndex = useMemo(() => {
    if (!primaryMediaSrc || !filteredSegments.length) return -1;
    const pos = mediaPartOffset + mediaTime;
    let lo = 0; let hi = filteredSegments.length - 1; let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Number(filteredSegments[mid].start) <= pos + 0.001) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }, [filteredSegments, mediaTime, mediaPartOffset, primaryMediaSrc]);

  // T33: маркеры поручений у реплик — s.start сегмента → поручения рядом по времени.
  const assignmentMarkers = useMemo(() => {
    const segs = transcriptData?.segments || [];
    const map = new Map();
    (assignmentItems || []).forEach((item) => {
      const sec = timecodeToSec(item.time);
      if (sec == null || !segs.length) return;
      let idx = segs.findIndex((s) => Number(s.start) >= sec - 0.5);
      if (idx === -1) idx = segs.length - 1;
      const key = segs[idx]?.start;
      if (key == null) return;
      map.set(key, [...(map.get(key) || []), item]);
    });
    return map;
  }, [transcriptData, assignmentItems]);

  // Прокрутка текста к первой реплике после таймкода. Виртуальный список
  // докручивается scrollToItem; точное центрирование — после рендера цели
  // (pendingSegRef срабатывает внутри строки). Цель, отфильтрованная
  // поиском/участником, — фильтр сбрасывается с уведомлением (T33).
  const scrollToSegment = React.useCallback((sec, behavior = 'smooth') => {
    let segs = filteredSegments;
    let idx = segs.findIndex((s) => Number(s.start) >= sec - 0.001);
    // В режиме подсветки запрос реплики не прячет — сбрасывать его не нужно;
    // сбрасываем фильтр участника и режим «Только совпадения».
    if (idx === -1 && (transcriptSpeaker || searchMatchesOnly)) {
      setTranscriptSpeaker('');
      setSearchMatchesOnly(false);
      setNavNotice('Фильтр сброшен, чтобы показать место в записи');
      segs = transcriptData?.segments || [];
      idx = segs.findIndex((s) => Number(s.start) >= sec - 0.001);
    }
    if (idx === -1) {
      if (!segs.length) return;
      idx = segs.length - 1;
    }
    const [vStart, vStop] = segVisibleRef.current;
    if (idx < vStart || idx > vStop) {
      segListRef.current?.scrollToItem?.(idx, 'center');
    }
    pendingSegRef.current = { start: segs[idx].start, behavior };
    setFlashStart(segs[idx].start);
    setFollowSegment(false);
  }, [filteredSegments, transcriptSpeaker, searchMatchesOnly, transcriptData]);
  // Тема/поручение/шкала → перемотка плеера (если есть) + прокрутка текста.
  const seekAndShow = React.useCallback((sec) => {
    if (primaryMediaSrc) seekMedia(sec);
    scrollToSegment(sec);
  }, [primaryMediaSrc, seekMedia, scrollToSegment]);
  const [flashStart, setFlashStart] = useState(null);

  // T47: список только смонтировался (смена вкладки) — докручиваем до
  // отложенной цели; сами строки доводят центрирование при рендере.
  useEffect(() => {
    const pend = pendingSegRef.current;
    if (!pend) return;
    const idx = filteredSegments.findIndex((s) => s.start === pend.start);
    if (idx < 0) return;
    const [vStart, vStop] = segVisibleRef.current;
    if (idx < vStart || idx > vStop) {
      segListRef.current?.scrollToItem?.(idx, 'center');
    }
  }, [filteredSegments, flashStart, mobileTab, panelTab]);

  // T47: размеры строк специфичны для набора реплик и раскладки —
  // при смене списка пересчитываем карту высот с нуля.
  useEffect(() => {
    segSizeMapRef.current = new Map();
    segListRef.current?.resetAfterIndex?.(0);
  }, [filteredSegments, isMobile]);

  useEffect(() => {
    if (flashStart == null) return undefined;
    const t = setTimeout(() => setFlashStart(null), 2200);
    return () => clearTimeout(t);
  }, [flashStart]);

  // T39: текущее совпадение поиска держится в видимой области — но только
  // при явной навигации (Enter/↑/↓). Сам ввод не скачет список на первое
  // совпадение: подсветка и счётчик обновляются без маунта дальних строк.
  useEffect(() => {
    if (!matchNavRef.current) return;
    matchNavRef.current = false;
    if (matchCursor < 0) return;
    const start = matchStarts[matchCursor];
    const idx = filteredSegments.findIndex((s) => s.start === start);
    if (idx < 0) return;
    const [vStart, vStop] = segVisibleRef.current;
    if (idx < vStart || idx > vStop) {
      segListRef.current?.scrollToItem?.(idx, 'center');
    }
    pendingSegRef.current = { start, behavior: 'smooth' };
  }, [matchCursor, matchStarts, filteredSegments]);

  // T47/T49: отложенная цель — если строка уже смонтирована (scrollToItem
  // не менял окно), центрируем её напрямую; иначе это сделает эффект строки
  // при монтировании. Без deps — проверка дешёвая и нужна после любого
  // коммита, потому что установка pendingSegRef сама по себе не рендерит.
  useEffect(() => {
    const pend = pendingSegRef.current;
    if (!pend) return;
    const el = segBoxRef.current?.querySelector?.(`[data-seg-start="${pend.start}"]`);
    if (el) {
      pendingSegRef.current = null;
      el.scrollIntoView?.({ block: 'center', behavior: pend.behavior || 'smooth' });
    }
  });

  useEffect(() => {
    if (navNotice === '') return undefined;
    const t = setTimeout(() => setNavNotice(''), 4000);
    return () => clearTimeout(t);
  }, [navNotice]);

  // T33/T49: follow-скролл за активной репликой — и при воспроизведении,
  // и при перемотке на паузе (пользователь ждёт текст рядом с позицией).
  // Двигаем список только когда строка вышла за видимое окно; дальний
  // скачок — без анимации. Ручная прокрутка (wheel/touch) отключает follow.
  useEffect(() => {
    if (!followSegment || activeSegmentIndex < 0) return;
    const seg = filteredSegments[activeSegmentIndex];
    if (!seg) return;
    const [vStart, vStop] = segVisibleRef.current;
    const span = Math.max(1, vStop - vStart);
    // Строка видна — ничего не двигаем; двигаемся только когда она ушла из окна.
    if (activeSegmentIndex >= vStart && activeSegmentIndex <= vStop) return;
    const far = Math.abs(activeSegmentIndex - (vStart + vStop) / 2) > span;
    segListRef.current?.scrollToItem?.(activeSegmentIndex, far ? 'auto' : 'center');
    pendingSegRef.current = { start: seg.start, behavior: far ? 'auto' : 'smooth' };
  }, [activeSegmentIndex, followSegment, filteredSegments]);

  // Маркер поручения у реплики / ссылки на панели: выбор вкладки раскладки.
  const goToPanel = React.useCallback((key) => {
    if (isMobile) setMobileTab({ assign: 'assign', topics: 'topics', talk: 'talk' }[key] || 'more');
    else setPanelTab(key);
  }, [isMobile]);
  // T51: клик по имени/«Назвать» — поповер ввода имени на месте реплики.
  const openNameEditor = React.useCallback((speaker, anchor) => {
    setNameEditor({ speaker, anchor });
  }, []);

  const toggleMediaPlay = React.useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) el.play?.(); else el.pause?.();
  }, []);
  const stepMedia = React.useCallback((delta) => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.currentTime)) return;
    el.currentTime = Math.max(0, Math.min(Number(el.duration || Infinity), el.currentTime + delta));
  }, []);
  // T32: переход к предыдущей/следующей теме относительно позиции плеера.
  const seekTopicEdge = React.useCallback((dir) => {
    if (!topics.length) return;
    const sorted = [...topics].sort((a, b) => Number(a.start) - Number(b.start));
    const cur = mediaPartOffset + mediaTime;
    let target;
    if (dir < 0) {
      const prev = sorted.filter((t) => Number(t.start) < cur - 1).pop();
      target = prev ? prev.start : 0;
    } else {
      const next = sorted.find((t) => Number(t.start) > cur + 0.5);
      target = next ? next.start : sorted[sorted.length - 1].start;
    }
    seekAndShow(Number(target));
  }, [topics, mediaPartOffset, mediaTime, seekAndShow]);
  const setRate = React.useCallback((value) => {
    const rate = Number(value) || 1;
    setMediaRate(rate);
    const el = mediaRef.current;
    if (el) el.playbackRate = rate;
  }, []);

  const activeTopic = topics.find((t) => (mediaPartOffset + mediaTime) >= t.start && (mediaPartOffset + mediaTime) < (t.end ?? Infinity));

  // Шкала времени (T30): для объединённой записи глобальная позиция —
  // offset текущей части + локальное время; длительность — оценка по
  // сумме частей (offset+duration), иначе по загруженной части. Без записи —
  // по концу транскрипта.
  const mediaEstimatedEnd = mediaParts.reduce(
    (m, p) => Math.max(m, Number(p.offset || 0) + Number(p.duration || 0)),
    0,
  );
  const mediaLastPartOffset = mediaParts.reduce((m, p) => Math.max(m, Number(p.offset || 0)), 0);
  const timelineDuration = primaryMediaSrc
    ? (meeting?.has_media ? mediaDuration : Math.max(mediaEstimatedEnd, mediaLastPartOffset + mediaDuration))
    : Math.max(0, ...((transcriptData?.segments || []).map((s) => Number(s.end ?? s.start ?? 0))));
  const globalPosition = mediaPartOffset + mediaTime;

  const closeDrawer = () => { speakerAudio.stop(); mediaRef.current?.pause?.(); onClose?.(); };
  const clearShareDialog = () => {
    if (shareBusy) return;
    setShareOpen(false);
    setShareLinks([]);
    setShareCreateError('');
    setShareCloseWarning(false);
  };
  const closeShareDialog = () => {
    if (shareBusy) return;
    if (shareLinks.some((link) => !link.revoked)) {
      setShareCloseWarning(true);
      return;
    }
    clearShareDialog();
  };
  // T27: незакрытый диалог с неотозванной ссылкой — единственное состояние, при котором
  // «Назад»/жест не должен молча уничтожать список ссылок.
  const hasUnrevokedShareLink = shareOpen && shareLinks.some((link) => !link.revoked);
  useEffect(() => {
    onActiveShareLinkChange?.(hasUnrevokedShareLink);
  }, [hasUnrevokedShareLink, onActiveShareLinkChange]);
  // N11: перехваченное «Назад» показывает предупреждение внутри диалога —
  // страница под модалкой пользователю не видна.
  useEffect(() => {
    if (shareNavWarning) setShareCloseWarning(true);
  }, [shareNavWarning]);
  // Отзыв последней активной ссылки снимает предупреждение сразу, до закрытия диалога.
  useEffect(() => {
    if (shareCloseWarning && !shareLinks.some((link) => !link.revoked)) {
      setShareCloseWarning(false);
    }
  }, [shareLinks, shareCloseWarning]);
  const revokeShareLink = async (token) => {
    if (!token || shareBusy) return;
    setShareBusy(true);
    setShareCreateError('');
    setShareLinks((prev) => prev.map((link) => (
      link.token === token ? { ...link, error: '' } : link
    )));
    try {
      await voiceJobsAPI.revokeShareLink(token);
      setShareLinks((prev) => prev.map((link) => (
        link.token === token ? { ...link, revoked: true, error: '' } : link
      )));
    } catch (err) {
      const message = responseDetailOr(err, 'Не удалось отозвать ссылку');
      setShareLinks((prev) => prev.map((link) => (
        link.token === token ? { ...link, error: message } : link
      )));
    } finally {
      setShareBusy(false);
    }
  };

  const sendProtocolByMail = async () => {
    if (!base) return;
    setMailError('');
    let items;
    try {
      const data = await voiceJobsAPI.getAssignments(base);
      items = data.items || [];
    } catch {
      setMailError('Не удалось загрузить поручения. Письмо не открыто.');
      return;
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
    lines.push('', `Открыть протокол: ${internalMeetingUrl}`);
    stashMailComposePrefill({
      to: [],
      subject: `Протокол встречи: ${name}`,
      bodyPlain: lines.join('\n'),
    });
    navigate('/mail?folder=inbox&compose=prefill');
  };

  // T32: клавиатура плеера — когда фокус не в поле ввода и не на интерактивном
  // элементе (иначе Пробел/стрелки съедут нативную активацию контрола).
  const handleDrawerKeyDown = (e) => {
    const t = e.target;
    if (!primaryMediaSrc || t?.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(t?.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); toggleMediaPlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepMedia(e.shiftKey ? -15 : -5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepMedia(e.shiftKey ? 15 : 5); }
  };

  // ---- Фаза 4: общие панели (левая колонка/вкладки <md ↔ правая панель ≥md) ----

  // T30: шкала времени — отрезки тем, точки поручений, маркер позиции; клик —
  // перемотка плеера или прокрутка текста, когда записи нет (T34).
  // T55: свободная перемотка — клик/перетаскивание ведут в точку шкалы,
  // отрезки тем указатель не перехватывают (переход к теме — из панели
  // «Темы», кнопок «Предыдущая/Следующая» и по Enter на отрезке).
  const timelineBar = useMemo(() => {
    if (!(timelineDuration > 0)) return null;
    const fracFromEvent = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return rect.width ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    };
    const scrubSec = timelineScrub ? timelineScrub.frac * timelineDuration : null;
    const shownTime = timelineScrub?.dragging ? scrubSec : globalPosition;
    const shownPct = Math.min(100, Math.max(0, (shownTime / timelineDuration) * 100));
    const scrubTopic = timelineScrub
      ? topics.find((t) => scrubSec >= t.start && scrubSec < (t.end ?? timelineDuration + 1))
      : null;
    return (
      <Box
        role="slider"
        tabIndex={0}
        aria-label="Шкала записи"
        aria-valuemin={0}
        aria-valuemax={Math.round(timelineDuration)}
        aria-valuenow={Math.round(shownTime)}
        aria-valuetext={`${fmtTime(shownTime)} из ${fmtTime(timelineDuration)}`}
        sx={{
          position: 'relative', height: isMobile ? 24 : 18, flex: 1,
          cursor: 'pointer', touchAction: 'none', userSelect: 'none',
        }}
        onClick={(e) => seekAndShow(fracFromEvent(e) * timelineDuration)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 5;
          const seek = (sec) => {
            e.preventDefault(); e.stopPropagation(); seekAndShow(sec);
          };
          if (e.key === 'Enter' || e.key === ' ') seek(globalPosition);
          else if (e.key === 'ArrowLeft') seek(Math.max(0, globalPosition - step));
          else if (e.key === 'ArrowRight') seek(Math.min(timelineDuration, globalPosition + step));
          else if (e.key === 'Home') seek(0);
          else if (e.key === 'End') seek(timelineDuration);
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setTimelineScrub({ frac: fracFromEvent(e), dragging: true });
        }}
        onPointerMove={(e) => {
          const frac = fracFromEvent(e);
          setTimelineScrub((prev) => (prev?.dragging ? { frac, dragging: true } : { frac, dragging: false }));
        }}
        onPointerUp={(e) => {
          const frac = fracFromEvent(e);
          if (timelineScrub?.dragging) seekAndShow(frac * timelineDuration);
          setTimelineScrub({ frac, dragging: false });
        }}
        onPointerCancel={() => setTimelineScrub(null)}
        onPointerLeave={() => setTimelineScrub((prev) => (prev?.dragging ? prev : null))}
      >
        {/* Визуальная шкала не перехватывает указатель — клик/драг идут в трек. */}
        <Box sx={{
          position: 'absolute', left: 0, right: 0, top: '50%', mt: '-7px',
          height: 14, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden',
          pointerEvents: 'none',
        }}>
          {topics.map((t, i) => {
            const l = Math.min(100, Math.max(0, (Number(t.start) / timelineDuration) * 100));
            const r = Math.min(100, Math.max(l, (Number(t.end ?? t.start) / timelineDuration) * 100));
            // T53: соседние темы отличаются и чередованием заливки, и
            // контрастным разделителем (≥3:1 в обеих темах).
            const sepColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
            return (
              <Box
                key={i}
                role="button"
                tabIndex={0}
                aria-label={`Тема «${t.title}» · ${fmtTime(t.start)}–${fmtTime(t.end ?? t.start)}`}
                title={`${t.title} (${fmtTime(t.start)}–${fmtTime(t.end ?? t.start)})`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); seekAndShow(Number(t.start)); }
                }}
                sx={{
                  position: 'absolute', left: `${l}%`, width: `${Math.max(0.6, r - l)}%`,
                  top: 0, bottom: 0, bgcolor: i % 2 ? 'primary.light' : 'primary.main', opacity: 0.4,
                  borderLeft: i > 0 ? '2px solid' : 'none',
                  borderColor: sepColor,
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.dark', opacity: 0.7 },
                }}
              />
            );
          })}
          {/* T55: заливка прогресса до текущей позиции (или точки драга). */}
          <Box
            data-testid="timeline-progress"
            sx={{
              position: 'absolute', left: 0, width: `${shownPct}%`, top: 0, bottom: 0,
              bgcolor: 'secondary.main', opacity: 0.35,
            }}
          />
        </Box>
        {(assignmentItems || []).map((a) => {
          const sec = timecodeToSec(a.time);
          if (sec == null) return null;
          const l = Math.min(100, Math.max(0, (sec / timelineDuration) * 100));
          return (
            <Box
              key={a.num}
              component="span"
              role="button"
              tabIndex={0}
              aria-label={`Поручение №${a.num} · ${fmtClock(a.time)} · ${String(a.task || '').slice(0, 80)}`}
              title={`Поручение №${a.num} · ${fmtClock(a.time)} · ${String(a.task || '').slice(0, 80)}`}
              onClick={(e) => { e.stopPropagation(); seekAndShow(sec); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); seekAndShow(sec); }
              }}
              sx={{
                position: 'absolute', left: `${l}%`, top: '50%',
                width: 8, height: 8, ml: '-4px', mt: '-4px',
                borderRadius: '50%', bgcolor: 'warning.dark', zIndex: 1,
                border: '1px solid', borderColor: 'common.white',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.dark' },
              }}
            />
          );
        })}
        {/* T55: бегунок текущей позиции. */}
        <Box
          data-testid="timeline-thumb"
          sx={{
            position: 'absolute', left: `${shownPct}%`, top: '50%',
            width: 12, height: 12, transform: 'translate(-50%, -50%)',
            borderRadius: '50%', bgcolor: 'secondary.main', zIndex: 2,
            border: '2px solid', borderColor: 'background.paper', boxShadow: 1,
            pointerEvents: 'none',
          }}
        />
        {/* T55: подсказка «время · тема» под курсором при наведении и драге. */}
        {timelineScrub && (
          <Box
            data-testid="timeline-hint"
            sx={{
              position: 'absolute', bottom: '100%', mb: 0.5,
              left: `${Math.min(92, Math.max(8, timelineScrub.frac * 100))}%`,
              transform: 'translateX(-50%)',
              px: 0.75, py: 0.25, borderRadius: 1,
              bgcolor: 'grey.800', color: 'common.white',
              fontSize: '0.7rem', lineHeight: 1.4, whiteSpace: 'nowrap',
              pointerEvents: 'none', zIndex: 4,
            }}
          >
            {fmtTime(scrubSec)}{scrubTopic ? ` · ${scrubTopic.title}` : ''}
          </Box>
        )}
      </Box>
    );
  }, [
    primaryMediaSrc, timelineDuration, globalPosition, topics, assignmentItems,
    theme, seekAndShow, timelineScrub, isMobile,
  ]);

  // T37: «Сейчас играет» — тема по текущей позиции под шкалой;
  // клик открывает вкладку «Темы» (панель справа / мобильную вкладку).
  const nowPlayingLine = useMemo(() => (topics.length > 0 ? (
    <Button
      size="small"
      variant="text"
      onClick={() => goToPanel('topics')}
      aria-label={activeTopic
        ? `Сейчас играет: тема ${topics.indexOf(activeTopic) + 1} из ${topics.length} — ${activeTopic.title}`
        : `Сейчас играет: ${fmtTime(globalPosition)}`}
      sx={{
        // В строке плеера (мобильная) stretch даёт полную высоту строки —
        // зона касания ~44 px вместо 20 px; в блочном контексте (десктоп)
        // alignSelf игнорируется, кнопка остаётся авто-ширины.
        alignSelf: 'stretch', minHeight: 0, py: 0, px: 0.5,
        textTransform: 'none', maxWidth: '100%',
        // P5-3: в строке плеера на мобильной — сжимается с многоточием.
        minWidth: 0, flexShrink: 1, overflow: 'hidden',
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap component="span">
        {activeTopic
          ? `Сейчас играет: тема ${topics.indexOf(activeTopic) + 1} из ${topics.length} — ${activeTopic.title}`
          : `Сейчас играет: ${fmtTime(globalPosition)}`}
      </Typography>
    </Button>
  ) : null), [topics, activeTopic, globalPosition, goToPanel]);

  // T28/T31/T32: общий плеер — не размонтируется между вкладками; для
  // аудиодорожек вместо чёрного видео-блока — компактная полоса.
  // T46: весь блок мемоизирован — тик таймера меняет globalPosition/время,
  // ввод в поиск и переключатели панелей его не пересчитывают.
  const playerBlock = useMemo(() => (primaryMediaSrc ? (
    <Box sx={{ px: 2, pt: isMobile ? 0.5 : 1, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
      <video
        ref={mediaRef}
        preload="metadata"
        src={primaryMediaSrc}
        onTimeUpdate={(e) => {
          const now = performance.now();
          if (now - mediaTickRef.current < 250) return;
          mediaTickRef.current = now;
          // T46: тик плеера — фоновый рендер низкого приоритета; ввод в
          // поиск/клики не ждут его завершения (startTransition).
          startTransition(() => setMediaTime(e.currentTarget.currentTime || 0));
        }}
        onSeeked={(e) => {
          mediaTickRef.current = performance.now();
          setMediaTime(e.currentTarget.currentTime || 0);
        }}
        onLoadedMetadata={(e) => {
          setMediaDuration(e.currentTarget.duration || 0);
          setMediaTime(e.currentTarget.currentTime || 0);
          setMediaIsAudio((e.currentTarget.videoHeight || 0) === 0);
          if (mediaRate !== 1) e.currentTarget.playbackRate = mediaRate;
        }}
        onDurationChange={(e) => setMediaDuration(e.currentTarget.duration || 0)}
        onPlay={() => setMediaPlaying(true)}
        onPause={() => setMediaPlaying(false)}
        onEnded={() => setMediaPlaying(false)}
        style={{
          width: '100%',
          // T52: на десктопе высота видео привязана к окну (≥330 px при 900 px),
          // «Большое видео» разворачивает его почти на всю высоту карточки.
          maxHeight: mediaIsAudio || playerCompact ? 0 : (isMobile ? 180 : playerBig ? '62vh' : '38vh'),
          display: mediaIsAudio || playerCompact ? 'none' : 'block',
          background: '#000',
        }}
      />
      <Stack data-player-row direction="row" spacing={0.5} alignItems="center" sx={{ py: 0.25 }}>
        <IconButton size="small" aria-label={mediaPlaying ? 'Пауза' : 'Играть'} onClick={toggleMediaPlay}>
          {mediaPlaying ? <PauseOutlinedIcon fontSize="small" /> : <PlayArrowOutlinedIcon fontSize="small" />}
        </IconButton>
        <Typography
          variant="caption"
          sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {fmtTime(globalPosition)} / {fmtTime(timelineDuration)}
        </Typography>
        {timelineBar}
        {/* P5-3: на <sm «Сейчас играет» — в строке плеера с многоточием,
            отдельной строки под шкалой нет. */}
        {isMobile && nowPlayingLine}
      </Stack>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ pb: 0.5 }}>
        <Tooltip title="Предыдущая тема">
          <span>
            <IconButton size="small" aria-label="Предыдущая тема" disabled={!topics.length} onClick={() => seekTopicEdge(-1)}>
              <SkipPreviousOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Назад на 15 с">
          <IconButton size="small" aria-label="Назад на 15 секунд" onClick={() => stepMedia(-15)} sx={{ borderRadius: 1 }}>
            <Typography variant="caption" fontWeight={700} component="span">−15</Typography>
          </IconButton>
        </Tooltip>
        {/* P4-4: на <360px шаги ±5 не помещаются — остаются ±15 и темы,
            остальное уходит в меню «⋮» строки управления. */}
        {!isNarrow && (
          <>
            <Tooltip title="Назад на 5 с">
              <IconButton size="small" aria-label="Назад на 5 секунд" onClick={() => stepMedia(-5)}>
                <Replay5OutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Вперёд на 5 с">
              <IconButton size="small" aria-label="Вперёд на 5 секунд" onClick={() => stepMedia(5)}>
                <Forward5OutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip title="Вперёд на 15 с">
          <IconButton size="small" aria-label="Вперёд на 15 секунд" onClick={() => stepMedia(15)} sx={{ borderRadius: 1 }}>
            <Typography variant="caption" fontWeight={700} component="span">+15</Typography>
          </IconButton>
        </Tooltip>
        <Tooltip title="Следующая тема">
          <span>
            <IconButton size="small" aria-label="Следующая тема" disabled={!topics.length} onClick={() => seekTopicEdge(1)}>
              <SkipNextOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {isNarrow ? (
          <>
            <IconButton
              size="small"
              aria-label="Ещё действия плеера"
              aria-haspopup="menu"
              onClick={(e) => setPlayerMenuAnchor(e.currentTarget)}
            >
              <MoreVertOutlinedIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={playerMenuAnchor}
              open={Boolean(playerMenuAnchor)}
              onClose={() => setPlayerMenuAnchor(null)}
            >
              {[1, 1.25, 1.5, 2].map((v) => (
                <MenuItem
                  key={v}
                  selected={mediaRate === v}
                  onClick={() => { setRate(v); setPlayerMenuAnchor(null); }}
                >
                  {`Скорость ×${v}`}
                </MenuItem>
              ))}
              {!mediaIsAudio && (
                <MenuItem
                  onClick={() => { setPlayerCompact((v) => !v); setPlayerMenuAnchor(null); }}
                >
                  {playerCompact ? 'Показать видео' : 'Свернуть видео'}
                </MenuItem>
              )}
              {!mediaIsAudio && !playerCompact && (
                <MenuItem
                  onClick={() => { setPlayerBig((v) => !v); setPlayerMenuAnchor(null); }}
                >
                  {playerBig ? 'Обычное видео' : 'Большое видео'}
                </MenuItem>
              )}
              {!mediaIsAudio && !playerCompact && (
                <MenuItem
                  onClick={() => { setPlayerMenuAnchor(null); mediaRef.current?.requestFullscreen?.(); }}
                >
                  Во весь экран
                </MenuItem>
              )}
            </Menu>
          </>
        ) : (
          <>
            <TextField
              select
              size="small"
              value={mediaRate}
              onChange={(e) => setRate(e.target.value)}
              inputProps={{ 'aria-label': 'Скорость воспроизведения' }}
              sx={{ width: 76, '& .MuiInputBase-input': { py: 0.5, fontSize: '0.8125rem' } }}
            >
              {[1, 1.25, 1.5, 2].map((v) => (
                <MenuItem key={v} value={v}>{`×${v}`}</MenuItem>
              ))}
            </TextField>
            {!mediaIsAudio && (
              <Tooltip title={playerCompact ? 'Показать видео' : 'Свернуть видео'}>
                <IconButton
                  size="small"
                  aria-label={playerCompact ? 'Показать видео' : 'Свернуть видео'}
                  aria-pressed={playerCompact}
                  onClick={() => setPlayerCompact((v) => !v)}
                >
                  {playerCompact ? <UnfoldMoreOutlinedIcon fontSize="small" /> : <CompressOutlinedIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
            {/* T52: большой режим и полноэкранный просмотр видео. */}
            {!mediaIsAudio && !playerCompact && (
              <>
                <Tooltip title={playerBig ? 'Обычное видео' : 'Большое видео'}>
                  <IconButton
                    size="small"
                    aria-label={playerBig ? 'Обычное видео' : 'Большое видео'}
                    aria-pressed={playerBig}
                    onClick={() => setPlayerBig((v) => !v)}
                  >
                    <FitScreenOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Во весь экран">
                  <IconButton
                    size="small"
                    aria-label="Во весь экран"
                    onClick={() => mediaRef.current?.requestFullscreen?.()}
                  >
                    <FullscreenOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </>
        )}
      </Stack>
      {!isMobile && nowPlayingLine}
      {mediaParts.length > 1 && (
        <Typography variant="caption" color="text.secondary">
          Объединённая запись из {mediaParts.length} частей — при переходе по таймкоду подставляется нужная часть.
        </Typography>
      )}
    </Box>
  ) : (meeting?.has_media === false ? (
    // T34: записи нет — компактная строка вместо плеера; шкала и переходы
    // работают по тексту (seekAndShow не трогает плеер без primaryMediaSrc).
    <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
      <Stack data-player-row direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          Запись удалена, доступен текст
        </Typography>
        {timelineBar}
        {isMobile && nowPlayingLine}
      </Stack>
      {!isMobile && nowPlayingLine}
    </Box>
  ) : null)), [
    primaryMediaSrc, meeting?.has_media, isMobile, isNarrow, mediaIsAudio,
    playerCompact, playerBig, mediaPlaying, mediaRate, playerMenuAnchor,
    globalPosition, timelineDuration, timelineBar, nowPlayingLine,
    topics.length, mediaParts.length, toggleMediaPlay, stepMedia,
    seekTopicEdge, setRate,
  ]);

  // T30: темы — список с полными названиями, диапазоном и длительностью.
  // T42: скелетон при загрузке, ошибка с «Повторить», понятное пустое состояние.
  // T46: тяжёлые панели — мемоизированные элементы; тик плеера их не трогает
  // (topicsPanel — по границам тем, assignmentsPanel — раз в секунду).
  const topicsPanel = useMemo(() => (
    <Stack spacing={0.75}>
      {(topicsStatus === 'idle' || topicsStatus === 'loading') && topics.length === 0 && (
        [0, 1, 2].map((i) => <Skeleton key={i} data-skeleton variant="rounded" height={48} />)
      )}
      {topicsStatus === 'error' && (
        <Alert severity="error" action={<Button size="small" onClick={retryTopics}>Повторить</Button>}>
          Не удалось загрузить темы
        </Alert>
      )}
      {topicsStatus === 'ready' && topics.length === 0 && (
        <Alert severity="info">Темы не выделены для этой записи.</Alert>
      )}
      {topics.map((t, i) => {
        const isActiveTopic = activeTopic === t;
        const dur = Math.max(0, Number(t.end ?? t.start) - Number(t.start));
        return (
          <Paper
            key={i}
            variant="outlined"
            role="button"
            tabIndex={0}
            aria-current={isActiveTopic ? 'true' : undefined}
            aria-label={`Перейти к теме «${t.title}», ${fmtTime(t.start)}`}
            onClick={() => seekAndShow(t.start)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seekAndShow(t.start); }
            }}
            sx={{
              px: 1, py: 0.75, cursor: 'pointer',
              borderLeft: '3px solid',
              borderColor: isActiveTopic ? 'primary.main' : 'divider',
              bgcolor: isActiveTopic ? 'action.selected' : 'background.paper',
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.8125rem', lineHeight: 1.3,
                display: '-webkit-box', WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2, overflow: 'hidden',
              }}
            >
              {t.title}
            </Typography>
            <Typography
              variant="caption"
              color={isActiveTopic ? 'primary' : 'text.secondary'}
              sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}
            >
              {`${fmtTime(t.start)}–${fmtTime(t.end ?? t.start)}${dur > 0 ? ` · ${fmtTime(dur)}` : ''}`}
            </Typography>
          </Paper>
        );
      })}
    </Stack>
  ), [topicsStatus, topics, activeTopic, seekAndShow, retryTopics]);

  const currentSecRounded = primaryMediaSrc ? Math.round(globalPosition) : null;
  const assignmentsPanel = useMemo(() => (assignStatus === 'error' ? (
    // T42: ошибка блока поручений — сообщение и «Повторить», остальные
    // блоки карточки при этом работают.
    <Alert severity="error" action={<Button size="small" onClick={retryAssignments}>Повторить</Button>}>
      Не удалось загрузить поручения
    </Alert>
  ) : (
    <VoiceAssignmentsTab
      base={base}
      canCreateTasks={canCreateTasks}
      items={assignmentItems}
      // T41: ближайшее к позиции записи поручение подсвечивается в списке.
      currentSec={currentSecRounded}
      onSeekTime={primaryMediaSrc ? (time) => {
        const sec = timecodeToSec(time);
        if (sec != null) seekAndShow(sec);
      } : undefined}
    />
  )), [
    assignStatus, assignmentItems, currentSecRounded, base,
    canCreateTasks, primaryMediaSrc, seekAndShow, retryAssignments,
  ]);

  // T46/T47: данные строк виртуального списка — мемоизированный объект;
  // при тике плеера меняется только activeIdx, строки сами решают по
  // компаратору, перерисовываться ли им (см. TranscriptSegRow).
  const segItemData = useMemo(() => ({
    segs: filteredSegments,
    activeIdx: activeSegmentIndex,
    flashStart,
    matchStart: matchCursor >= 0 ? matchStarts[matchCursor] : null,
    query: deferredQuery,
    isMobile,
    theme,
    colors: speakerColorMap,
    unresolvedSet,
    firstUnnamed: firstUnnamedIdx,
    assignmentMarkers,
    canManage,
    onSeekTime: seekAndShow,
    onMarkerClick: goToPanel,
    onNameClick: openNameEditor,
    pendingRef: pendingSegRef,
    sizeMap: segSizeMapRef.current,
    listRef: segListRef,
    onMeasure: onSegMeasured,
  }), [
    filteredSegments, activeSegmentIndex, flashStart, matchCursor, matchStarts,
    deferredQuery, isMobile, theme, speakerColorMap, unresolvedSet, firstUnnamedIdx,
    assignmentMarkers, canManage, seekAndShow, goToPanel, openNameEditor, onSegMeasured,
  ]);

  // T39: Enter/стрелки в поле поиска и кнопки ↑/↓ ходят по совпадениям
  // (с зацикливанием); прокрутка к цели — в эффекте на matchCursor.
  const gotoMatch = React.useCallback((dir) => {
    if (!matchStarts.length) return;
    const raw = matchCursor + dir;
    const next = raw < 0 ? matchStarts.length - 1 : raw >= matchStarts.length ? 0 : raw;
    matchNavRef.current = true;
    setSearchCursor(next);
  }, [matchStarts, matchCursor]);
  const onSearchKeyDown = React.useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); gotoMatch(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); gotoMatch(-1); }
  }, [gotoMatch]);

  // T46: панель транскрипта мемоизирована — тики плеера (mediaTime 4/с)
  // и действия правой колонки её не пересчитывают; список внутри —
  // TranscriptViewport (re-mount только при смене данных).
  const transcriptPanel = useMemo(() => (
    // T47: колонка с внутренним скроллом виртуального списка — сама панель
    // не раздувает внешний контейнер, высота списка — оставшаяся область.
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {transcriptData && !transcriptData.error && (
        // P4-2: поиск, фильтр участника, follow-переключатель и счётчик —
        // одной строкой на любой ширине (отдельная строка счётчика убрана).
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, minWidth: 0 }} data-toolbar="transcript-filters">
          <TextField
            size="small"
            placeholder="Поиск по тексту…"
            value={transcriptQuery}
            onChange={(e) => { setTranscriptQuery(e.target.value); setSearchCursor(0); }}
            onKeyDown={onSearchKeyDown}
            sx={{ flex: 1, minWidth: 120 }}
            InputProps={{
              startAdornment: <SearchOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
            }}
          />
          {isNarrow ? (
            // P4-4: на <360px «Участник» и «Следить» — иконки (селект+чип
            // сжимали поиск до 28 px); счётчик остаётся в шапке протокола.
            <>
              <IconButton
                size="small"
                aria-label={transcriptSpeaker ? `Фильтр по участнику: ${transcriptSpeaker}` : 'Фильтр по участнику'}
                aria-haspopup="menu"
                aria-pressed={Boolean(transcriptSpeaker)}
                color={transcriptSpeaker ? 'primary' : 'default'}
                onClick={(e) => setSpeakerMenuAnchor(e.currentTarget)}
                sx={{ flexShrink: 0 }}
              >
                <FilterListOutlinedIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={speakerMenuAnchor}
                open={Boolean(speakerMenuAnchor)}
                onClose={() => setSpeakerMenuAnchor(null)}
              >
                <MenuItem selected={!transcriptSpeaker} onClick={() => { setTranscriptSpeaker(''); setSpeakerMenuAnchor(null); }}>
                  Все
                </MenuItem>
                {transcriptSpeakers.map((name) => (
                  <MenuItem
                    key={name}
                    selected={transcriptSpeaker === name}
                    onClick={() => { setTranscriptSpeaker(name); setSpeakerMenuAnchor(null); }}
                  >
                    {name}
                  </MenuItem>
                ))}
              </Menu>
              <IconButton
                size="small"
                aria-label={`Следить за записью — реплик: ${filteredSegments.length} из ${transcriptData.total}`}
                aria-pressed={followSegment}
                color={followSegment ? 'primary' : 'default'}
                onClick={() => setFollowSegment((v) => !v)}
                sx={{ flexShrink: 0 }}
              >
                {followSegment ? <GpsFixedOutlinedIcon fontSize="small" /> : <GpsNotFixedOutlinedIcon fontSize="small" />}
              </IconButton>
            </>
          ) : (
            <>
              <TextField
                select
                size="small"
                label="Участник"
                value={transcriptSpeaker}
                onChange={(e) => setTranscriptSpeaker(e.target.value)}
                sx={{ width: isMobile ? 104 : 116, flexShrink: 0 }}
              >
                <MenuItem value="">Все</MenuItem>
                {transcriptSpeakers.map((name) => (
                  <MenuItem key={name} value={name}>{name}</MenuItem>
                ))}
              </TextField>
              {/* T33: переключатель follow-скролла; на мобильной счётчик встроен
                  в подпись чипа, на десктопе выводится отдельным текстом справа. */}
              <Chip
                size="small"
                clickable
                label={isMobile
                  ? `Следить · ${filteredSegments.length === (transcriptData.segments || []).length ? transcriptData.total : `${filteredSegments.length}/${transcriptData.total}`}`
                  : 'Следить за записью'}
                aria-label={isMobile ? `Следить за записью — реплик: ${filteredSegments.length} из ${transcriptData.total}` : undefined}
                aria-pressed={followSegment}
                color={followSegment ? 'primary' : 'default'}
                variant={followSegment ? 'filled' : 'outlined'}
                onClick={() => setFollowSegment((v) => !v)}
                sx={{ flexShrink: 0 }}
              />
              {!isMobile && (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                  Реплик: {filteredSegments.length === (transcriptData.segments || []).length
                    ? transcriptData.total
                    : `${filteredSegments.length} из ${transcriptData.total}`}
                </Typography>
              )}
            </>
          )}
        </Stack>
      )}
      {transcriptData && !transcriptData.error && transcriptQuery.trim() !== '' && (
        // T39: вторая строка появляется только при активном запросе —
        // счётчик, переход ↑/↓ (Enter в поле — то же) и режим «Только
        // совпадения»; на первую строку и ширины это не влияет.
        // P5-5: курсор ходит по репликам — счётчик честно говорит «Реплика».
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }} data-toolbar="search-nav">
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} aria-live="polite">
            {matchStarts.length
              ? `Реплика ${matchCursor + 1} из ${matchStarts.length} с совпадениями`
              : 'Совпадений нет'}
          </Typography>
          <IconButton
            size="small"
            aria-label="Предыдущее совпадение"
            disabled={matchStarts.length < 2}
            onClick={() => gotoMatch(-1)}
          >
            <KeyboardArrowUpOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Следующее совпадение"
            disabled={matchStarts.length < 2}
            onClick={() => gotoMatch(1)}
          >
            <KeyboardArrowDownOutlinedIcon fontSize="small" />
          </IconButton>
          <Chip
            size="small"
            clickable
            label="Только совпадения"
            aria-pressed={searchMatchesOnly}
            color={searchMatchesOnly ? 'primary' : 'default'}
            variant={searchMatchesOnly ? 'filled' : 'outlined'}
            onClick={() => setSearchMatchesOnly((v) => !v)}
          />
        </Stack>
      )}
      {navNotice && (
        <Alert severity="info" sx={{ mb: 1 }} onClose={() => setNavNotice('')}>{navNotice}</Alert>
      )}
      <TranscriptViewport
        transcriptBusy={transcriptBusy}
        transcriptData={transcriptData}
        filteredSegments={filteredSegments}
        deferredQuery={deferredQuery}
        transcriptSpeaker={transcriptSpeaker}
        segItemData={segItemData}
        isMobile={isMobile}
        segListRef={segListRef}
        segBoxRef={segBoxRef}
        segSizeMapRef={segSizeMapRef}
        segVisibleRef={segVisibleRef}
        retryTranscript={retryTranscript}
      />
    </Box>
  ), [
    transcriptData, transcriptBusy, transcriptQuery, transcriptSpeaker,
    transcriptSpeakers, filteredSegments, followSegment, isMobile, isNarrow,
    speakerMenuAnchor, searchMatchesOnly, matchStarts, matchCursor, navNotice,
    deferredQuery, segItemData, onSearchKeyDown, gotoMatch, retryTranscript,
  ]);

  const filesPanel = useMemo(() => (
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
        // N12: заголовков групп нет — тип отчёта («Протокол», «Отчёт»,
        // «Текст разговора») указан в подписи самой строки; блок из трёх
        // отчётов укладывается в ~160px.
        return bucketed.map((group) => (
          <Box key={group.label}>
            <Stack spacing={0.5}>
              {group.items.map((r) => {
                const pretty = r.name.startsWith(`${base}_`) ? r.name.slice(base.length + 1) : r.name;
                const kindLabel = { report: 'Отчёт', protocol: 'Протокол', transcript: 'Текст разговора' }[r.kind] || 'Файл';
                const viewable = r.ext === 'html' || r.ext === 'pdf';
                const label = r.name.startsWith(`${base}_`) ? r.name.slice(base.length + 1) : pretty;
                return (
                  <Paper key={r.name} variant="outlined" sx={{ px: 1, py: 0.25 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        size="small"
                        color={r.ext === 'html' ? 'primary' : r.ext === 'pdf' ? 'error' : 'default'}
                        label={String(r.ext || '?').toUpperCase()}
                        sx={{ minWidth: 40, height: 20, fontWeight: 600 }}
                      />
                      {/* T25: одна строка на отчёт — тип, имя и размер в подписи. */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          noWrap
                          title={r.name}
                          sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}
                        >
                          {label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          sx={{ display: 'block', lineHeight: 1.3 }}
                        >
                          {kindLabel} · {(r.size / 1024).toFixed(0)} КБ
                        </Typography>
                      </Box>
                      {viewable ? (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            aria-label={`Просмотр ${label}`}
                            onClick={() => setViewReport({ name: r.name, ext: r.ext, url: voiceJobsAPI.reportUrl(base, r.name) })}
                            // N12/N19: 44px на xs (тач), 36px на десктопе — выше density-умолчания 28px;
                            // compound-селектор нужен, чтобы перебить .MuiButton-sizeSmall темы.
                            sx={{ px: 1, fontSize: '0.75rem', '&.MuiButton-sizeSmall': { minHeight: { xs: 44, sm: 36 } } }}
                          >
                            Просмотр
                          </Button>
                          <IconButton
                            size="small"
                            aria-label={`Действия с файлом ${label}`}
                            aria-haspopup="menu"
                            onClick={(e) => setReportMenu({ anchor: e.currentTarget, report: r, viewable })}
                          >
                            <MoreVertOutlinedIcon fontSize="small" />
                          </IconButton>
                        </>
                      ) : (
                        // T25: у файла без просмотра «Скачать» остаётся видимым действием.
                        <Tooltip title={clips.length ? 'Скачать папку с фрагментами (ZIP)' : 'Скачать файл'}>
                          <IconButton
                            size="small"
                            aria-label={`Скачать ${label}`}
                            component={Link}
                            href={voiceJobsAPI.reportUrl(base, r.name, true)}
                            download
                          >
                            <DownloadOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        ));
      })()}
      <Menu
        anchorEl={reportMenu?.anchor || null}
        open={Boolean(reportMenu)}
        onClose={() => setReportMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {reportMenu?.viewable && (
          <MenuItem
            component={Link}
            href={voiceJobsAPI.reportUrl(base, reportMenu.report.name)}
            target="_blank"
            rel="noopener"
            onClick={() => setReportMenu(null)}
          >
            <ListItemIcon><OpenInNewOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Открыть в новой вкладке" />
          </MenuItem>
        )}
        <MenuItem
          component={Link}
          href={voiceJobsAPI.reportUrl(base, reportMenu?.report?.name, true)}
          download
          onClick={() => setReportMenu(null)}
        >
          <ListItemIcon><DownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Скачать" />
        </MenuItem>
      </Menu>
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
  ), [reports, clips, base, reportMenu]);

  // T50: участники — компактные строки (цвет/имя как в тексте, статистика
  // реплик, «Кто это?» в строке), список прокручивается, кнопка сохранения
  // закреплена внизу панели и несёт счётчик заполненных имён.
  const speakerStatsLabel = React.useCallback((id) => {
    const st = speakerStats.get(id);
    if (!st) return null;
    const cnt = `${st.count} ${plural(st.count, ['реплика', 'реплики', 'реплик'])}`;
    return st.secs > 0 ? `${cnt} · ${fmtTime(st.secs)}` : cnt;
  }, [speakerStats]);
  const speakerRowColor = React.useCallback((id) => speakerColorMap.get(id)
    || speakerPaletteColor(theme, speakerHashKey(id)), [speakerColorMap, theme]);
  const assignmentsFilled = Object.values(assignments).filter((v) => String(v || '').trim()).length;
  const speakersPanel = useMemo(() => (
    // На ≥md панель заполняет вкладку и кнопка «Сохранить имена» закреплена
    // внизу; на мобильной (вкладка «Ещё» делит скролл с файлами) — в потоке.
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...(isMobile ? {} : { height: '100%' }) }}>
      <Box sx={isMobile ? {} : { flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Stack spacing={0.5}>
          {(speakers.resolved || []).length > 0 && (
            <Typography component="h3" variant="subtitle2" sx={{ pt: 0.5 }}>
              Опознанные участники
            </Typography>
          )}
          {(speakers.resolved || []).map((s) => (
            <SpeakerAssignRow
              key={s.name}
              allUsers={allUsers}
              speaker={{ ...s, speaker: s.name, base }}
              label={s.name}
              color={speakerRowColor(s.name)}
              stats={speakerStatsLabel(s.name)}
              fieldLabel="Переименовать в"
              renameField
              editable={canManage}
              voices={voices}
              value={assignments[s.name] || ''}
              onChange={(v) => setAssignments((prev) => ({ ...prev, [s.name]: v || '' }))}
              mediaSrcFor={mediaSrcFor}
              audioPlayingSrc={speakerAudio.playingSrc}
              onAudioToggle={speakerAudio.toggle}
            />
          ))}
          <Typography component="h3" variant="subtitle2" sx={{ pt: 0.5 }}>
            {`Неопознанные участники${unresolved.length ? ` (${unresolved.length})` : ''}`}
          </Typography>
          {unresolved.length === 0 ? (
            <Alert severity="success">Все участники опознаны.</Alert>
          ) : unresolved.map((sp) => (
            <Box key={sp.speaker}>
              <SpeakerAssignRow
                allUsers={allUsers}
                speaker={{ ...sp, base }}
                label={assignments[sp.speaker]?.trim() || speakerLabel(sp.speaker)}
                color={speakerRowColor(sp.speaker)}
                stats={speakerStatsLabel(sp.speaker)}
                editable={canManage}
                voices={voices}
                value={assignments[sp.speaker] || ''}
                onChange={(v) => setAssignments((prev) => ({ ...prev, [sp.speaker]: v || '' }))}
                mediaSrcFor={mediaSrcFor}
                audioPlayingSrc={speakerAudio.playingSrc}
                onAudioToggle={speakerAudio.toggle}
              />
              {canManage && assignments[sp.speaker] && !knownVoiceNames.has(assignments[sp.speaker]) && (
                <Button
                  size="small"
                  onClick={() => setEnrollNew((prev) => ({ ...prev, [sp.speaker]: !prev[sp.speaker] }))}
                  aria-pressed={Boolean(enrollNew[sp.speaker])}
                  color={enrollNew[sp.speaker] ? 'success' : 'inherit'}
                  disabled={!sp.has_sample}
                >
                  {enrollNew[sp.speaker]
                    ? '✓ Голос будет запомнен для будущих записей'
                    : 'Запомнить этот голос для будущих записей'}
                </Button>
              )}
            </Box>
          ))}
          {assignMsg && <Alert severity={assignMsg.severity}>{assignMsg.text}</Alert>}
          {speakers.speaker_map_hint && (
            <Typography variant="caption" color="text.secondary">
              Подсказка: {speakers.speaker_map_hint}
            </Typography>
          )}
        </Stack>
      </Box>
      {canManage ? (
        <Box sx={{ flexShrink: 0, pt: 1, mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            fullWidth
            variant="contained"
            onClick={submitAssignments}
            disabled={
              assignBusy
              || runningResume
              || !assignmentsFilled
            }
          >
            {assignBusy ? 'Отправляю…' : `Сохранить имена (${assignmentsFilled})`}
          </Button>
        </Box>
      ) : (
        <Alert severity="info" sx={{ mt: 0.5, flexShrink: 0 }}>
          Чтобы задавать имена спикерам, нужно право на редактирование (voice.manage).
        </Alert>
      )}
    </Box>
  ), [
    isMobile, speakers, unresolved, assignments, enrollNew, canManage, voices,
    allUsers, speakerAudio.playingSrc, speakerAudio.toggle, mediaSrcFor,
    speakerStats, speakerColorMap, theme, assignBusy, runningResume, assignMsg,
    knownVoiceNames, base, submitAssignments, speakerStatsLabel, speakerRowColor,
    assignmentsFilled,
  ]);

  return (
    <Dialog
      open={open}
      onClose={closeDrawer}
      onKeyDown={handleDrawerKeyDown}
      fullScreen={isMobile}
      maxWidth="lg"
      fullWidth
      // T46: закрытие мгновенное (≤100мс) — выходная анимация отключена,
      // вход остаётся стандартной.
      transitionDuration={{ enter: 225, exit: 0 }}
      PaperProps={{
        sx: {
          height: isMobile ? '100%' : '90vh',
          maxHeight: isMobile ? '100%' : '90vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          '@media (pointer: coarse)': {
            '& .MuiIconButton-root': { width: 44, height: 44 },
          },
        },
      }}
    >
      <Box sx={{ px: 2, py: isMobile ? 1 : 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <DialogTitle
            title={displayName(base)}
            sx={{
              p: 0,
              minWidth: 0,
              // T36: у названия не должно быть подложки — выглядит как поле ввода.
              background: 'transparent',
              fontSize: '1rem',
              lineHeight: 1.25,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: isMobile ? 2 : 1,
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {displayName(base)}
          </DialogTitle>
          {/* T36: мета — длительность · реплики (из загруженного текста) ·
              участники · отчёты; «Источник доступен» — шум, остаются только
              предупреждения об удалении записи. */}
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            data-meta="meeting"
            sx={{ display: 'block', mt: 0.25 }}
            title={base}
          >
            {[
              timelineDuration > 0 ? fmtTime(timelineDuration) : null,
              (transcriptData?.total ?? meeting?.segments_count) != null
                ? `${transcriptData?.total ?? meeting.segments_count} ${plural(transcriptData?.total ?? meeting.segments_count, ['реплика', 'реплики', 'реплик'])}`
                : null,
              participantsTotal > 0
                ? `${participantsTotal} ${plural(participantsTotal, ['участник', 'участника', 'участников'])}`
                : null,
              reports.length > 0
                ? `${reports.length} ${plural(reports.length, ['отчёт', 'отчёта', 'отчётов'])}`
                : null,
              meeting?.reports
                ? (meeting.has_media
                  ? (meeting.source_expires_at
                    && (new Date(meeting.source_expires_at) - Date.now()) <= 7 * 86400 * 1000
                    ? `Запись удалится ${new Date(meeting.source_expires_at).toLocaleDateString('ru-RU')}`
                    : null)
                  : 'Запись удалена')
                : null,
            ].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton
            size="small"
            aria-label="Действия с протоколом"
            aria-haspopup="menu"
            aria-expanded={menuAnchor ? 'true' : undefined}
            aria-controls={menuAnchor ? 'voice-meeting-actions-menu' : undefined}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <MoreVertOutlinedIcon fontSize="small" />
          </IconButton>
          <Menu
            id="voice-meeting-actions-menu"
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {base && (
              <MenuItem
                onClick={() => { setMenuAnchor(null); sendProtocolByMail(); }}
              >
                <ListItemIcon><EmailOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Отправить протокол письмом" />
              </MenuItem>
            )}
            {base && (
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setShareLinks([]);
                  setShareCreateError('');
                  setShareCloseWarning(false);
                  setShareOpen(true);
                }}
              >
                <ListItemIcon><ShareOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Поделиться ссылкой" />
              </MenuItem>
            )}
            {canManage && meeting?.reports && (
              <MenuItem
                onClick={() => { setMenuAnchor(null); setMetaEditorOpen((value) => !value); }}
              >
                <ListItemIcon><ExpandMoreOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Теги и проект" />
              </MenuItem>
            )}
          </Menu>
          <IconButton onClick={closeDrawer} size="small" aria-label="Закрыть"><CloseOutlinedIcon /></IconButton>
        </Stack>
      </Box>
      <Divider />
      {speakerAudio.audioEl}
      {mailError && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setMailError('')}>
          {mailError}
        </Alert>
      )}
      {runningResume && (
        <Alert severity="info" sx={{ mx: 2, mt: 1 }}>
          Имена обновляются — протокол будет пересчитан по завершении.
        </Alert>
      )}

      {canManage && meeting?.reports && (
        <Box sx={{ px: 2, pb: metaEditorOpen ? 0 : 1 }}>
          {metaEditorOpen && (
            <Box id="voice-meeting-meta-editor" sx={{ py: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
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
                  setMetaFeedback(null);
                  try {
                    await voiceJobsAPI.updateMeetingMeta(base, { tags: metaTags, project: metaProject });
                    setMetaFeedback({ text: 'Сохранено', severity: 'success' });
                  } catch {
                    setMetaFeedback({ text: 'Не удалось сохранить', severity: 'error' });
                  } finally {
                    setMetaSaving(false);
                  }
                }}
              >
                {metaSaving ? '…' : 'Сохранить'}
              </Button>
              {metaFeedback && (
                <Alert severity={metaFeedback.severity} sx={{ py: 0 }}>
                  {metaFeedback.text}
                </Alert>
              )}
            </Box>
          )}
        </Box>
      )}

      {!meeting?.reports ? (
        loadError ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 8 }}>
            <Alert severity="error">{loadError}</Alert>
            <Button variant="outlined" onClick={() => onRetryLoad?.()}>Повторить</Button>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        )
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {isMobile ? (
            <>
              {playerBlock}
              <Tabs
                value={mobileTab}
                onChange={(_e, v) => setMobileTab(v)}
                variant="fullWidth"
                sx={{ minHeight: 44, flexShrink: 0 }}
                aria-label="Навигация по карточке протокола"
              >
                {/* T40: на ≥360px — полные подписи + бейдж; на <360px —
                    иконка + бейдж, полное имя в aria-label и title.
                    Без фрагментов-обёрток: MUI Tabs инжектирует
                    selected/onChange только в прямых детей-Tab. */}
                <Tab
                  value="talk"
                  label={isNarrow ? tabLabelNarrow(<SubjectOutlinedIcon fontSize="small" />) : 'Текст'}
                  aria-label="Текст"
                  title="Текст"
                  sx={compactPanelTabSx}
                />
                <Tab
                  value="topics"
                  label={isNarrow
                    ? tabLabelNarrow(<TopicOutlinedIcon fontSize="small" />, topics.length)
                    : tabLabel('Темы', topics.length)}
                  aria-label="Темы"
                  title="Темы"
                  sx={compactPanelTabSx}
                />
                <Tab
                  value="assign"
                  label={isNarrow
                    ? tabLabelNarrow(<AssignmentOutlinedIcon fontSize="small" />, assignmentItems?.length)
                    : tabLabel('Поручения', assignmentItems?.length)}
                  aria-label="Поручения"
                  title="Поручения"
                  sx={compactPanelTabSx}
                />
                <Tab
                  value="more"
                  label={isNarrow ? tabLabelNarrow(<MoreHorizOutlinedIcon fontSize="small" />) : 'Ещё'}
                  aria-label="Ещё"
                  title="Ещё"
                  sx={compactPanelTabSx}
                />
              </Tabs>
              <Divider />
              <Box
                ref={scrollRef}
                sx={{ flex: 1, overflow: 'auto', px: 2, pt: 0.5, pb: 2, minHeight: 0 }}
                onWheel={() => setFollowSegment(false)}
                onTouchMove={() => setFollowSegment(false)}
              >
                {mobileTab === 'talk' && transcriptPanel}
                {mobileTab === 'topics' && topicsPanel}
                {mobileTab === 'assign' && assignmentsPanel}
                {mobileTab === 'more' && (
                  <>
                    {speakersPanel}
                    <Divider sx={{ my: 2 }}>Файлы</Divider>
                    {filesPanel}
                  </>
                )}
              </Box>
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Левая колонка: плеер сверху, текст разговора на оставшееся место. */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                {playerBlock}
                <Box
                  ref={scrollRef}
                  sx={{ flex: 1, overflow: 'auto', p: 2, minHeight: 0 }}
                  onWheel={() => setFollowSegment(false)}
                  onTouchMove={() => setFollowSegment(false)}
                >
                  {transcriptPanel}
                </Box>
              </Box>
              {/* Правая панель: темы / поручения / участники / файлы (P4-1: 38–40% ширины диалога). */}
              <Box sx={{
                width: '39%',
                minWidth: 370,
                maxWidth: 480,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderLeft: '1px solid',
                borderColor: 'divider',
                minHeight: 0,
              }}>
                <Tabs
                  value={panelTab}
                  onChange={(_e, v) => setPanelTab(v)}
                  variant="fullWidth"
                  sx={{ minHeight: 44, flexShrink: 0 }}
                  aria-label="Панель протокола"
                >
                  <Tab value="topics" label={tabLabel('Темы', topics.length)} aria-label="Темы" sx={compactPanelTabSx} />
                  <Tab
                    value="assign"
                    label={tabLabel('Поручения', assignmentItems?.length)}
                    aria-label="Поручения"
                    sx={compactPanelTabSx}
                  />
                  <Tab
                    value="speakers"
                    label={tabLabel('Участники', unresolved.length)}
                    aria-label={unresolved.length ? `Участники (${unresolved.length})` : 'Участники'}
                    sx={compactPanelTabSx}
                  />
                  <Tab
                    value="files"
                    label={tabLabel('Файлы', reports.length)}
                    aria-label={reports.length ? `Файлы (${reports.length})` : 'Файлы'}
                    sx={compactPanelTabSx}
                  />
                </Tabs>
                <Divider />
                <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, minHeight: 0 }}>
                  {panelTab === 'topics' && topicsPanel}
                  {panelTab === 'assign' && assignmentsPanel}
                  {panelTab === 'speakers' && speakersPanel}
                  {panelTab === 'files' && filesPanel}
                </Box>
              </Box>
            </Box>
          )}
          {/* T33: follow-режим выключается ручной прокруткой; кнопка возвращает к активной реплике. */}
          {!followSegment && activeSegmentIndex >= 0 && (
            <Chip
              size="small"
              clickable
              color="primary"
              label="К текущему месту"
              onClick={() => {
                setFollowSegment(true);
                segListRef.current?.scrollToItem?.(activeSegmentIndex, 'center');
                pendingSegRef.current = { start: filteredSegments[activeSegmentIndex]?.start, behavior: 'smooth' };
              }}
              sx={{ position: 'absolute', bottom: 12, right: 16, zIndex: 3 }}
            />
          )}
        </Box>
      )}
      {/* T51: поповер имени участника — та же задача, что и вкладка
          «Участники»: выбор/ввод кладёт имя в общий assignments. */}
      <Popover
        open={Boolean(nameEditor)}
        anchorEl={nameEditor?.anchor || null}
        onClose={() => setNameEditor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.25, width: 300 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            {nameEditor ? speakerLabel(nameEditor.speaker) : ''}
          </Typography>
          <Autocomplete
            freeSolo
            autoFocus
            size="small"
            options={[...new Set([...(voices || []).map((v) => v.name), ...(allUsers || []).map((u) => u.full_name || u.username).filter(Boolean)])]}
            value={nameEditor ? (assignments[nameEditor.speaker] || '') : ''}
            onChange={(_e, v) => {
              if (!nameEditor) return;
              setAssignments((prev) => ({ ...prev, [nameEditor.speaker]: v || '' }));
              setNameEditor(null);
            }}
            onInputChange={(_e, v) => {
              if (!nameEditor) return;
              setAssignments((prev) => ({ ...prev, [nameEditor.speaker]: v || '' }));
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Кто это?"
                placeholder="Выберите из списка или впишите имя"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setNameEditor(null); } }}
              />
            )}
          />
        </Box>
      </Popover>
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

      <Dialog open={shareOpen} onClose={closeShareDialog} maxWidth="xs" fullWidth>
        <DialogTitle>Поделиться протоколом</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Для вошедших</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  fullWidth
                  label="Ссылка на протокол"
                  value={internalMeetingUrl}
                  InputProps={{ readOnly: true }}
                />
                <IconButton
                  aria-label="Копировать ссылку на протокол"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(internalMeetingUrl); } catch { /* clipboard denied */ }
                  }}
                >
                  <ContentCopyOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Публичная ссылка без входа</Typography>
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                Ссылка открывает HTML-отчёт без входа в систему. Отправляйте её только тем,
                кто должен видеть протокол. Она действует до отзыва или истечения выбранного срока.
              </Alert>
              <TextField
                select
                size="small"
                fullWidth
                label="Срок действия"
                value={shareTtl}
                onChange={(e) => setShareTtl(Number(e.target.value))}
                sx={{ mb: 1.5 }}
              >
                <MenuItem value={24}>24 часа</MenuItem>
                <MenuItem value={72}>3 дня</MenuItem>
                <MenuItem value={168}>7 дней</MenuItem>
                <MenuItem value={720}>30 дней</MenuItem>
              </TextField>
              {shareCreateError && <Alert severity="error" sx={{ mb: 1.5 }}>{shareCreateError}</Alert>}
              <Stack spacing={1.5}>
                {shareLinks.map((link, index) => (
                  <Paper key={link.token} variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      {`Публичная ссылка ${index + 1} · срок ${shareTtlLabels[link.ttl] || `${link.ttl} часов`}`}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        fullWidth
                        label={`Публичная ссылка ${index + 1}`}
                        value={link.url}
                        InputProps={{ readOnly: true }}
                      />
                      <IconButton
                        aria-label={`Скопировать публичную ссылку ${index + 1}`}
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(link.url); } catch { /* clipboard denied */ }
                        }}
                      >
                        <ContentCopyOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    {link.error && <Alert severity="error" sx={{ mt: 1 }}>{link.error}</Alert>}
                    {link.revoked ? (
                      <Alert severity="success" sx={{ mt: 1 }}>Ссылка отозвана</Alert>
                    ) : (
                      <Button
                        color="error"
                        disabled={shareBusy}
                        aria-label={`Отозвать публичную ссылку ${index + 1}`}
                        onClick={() => revokeShareLink(link.token)}
                        sx={{ mt: 0.5 }}
                      >
                        Отозвать
                      </Button>
                    )}
                  </Paper>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Отозвать ссылку можно только пока открыт этот диалог.
              </Typography>
              {shareCloseWarning && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  Неотозванная ссылка останется активной до истечения срока. Можно отозвать её здесь
                  или закрыть диалог, оставив ссылку действующей.
                </Alert>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          {shareCloseWarning ? (
            <>
              <Button disabled={shareBusy} onClick={() => setShareCloseWarning(false)}>Остаться</Button>
              <Button color="warning" disabled={shareBusy} onClick={clearShareDialog}>
                Закрыть без отзыва
              </Button>
            </>
          ) : (
            <>
              <Button disabled={shareBusy} onClick={closeShareDialog}>Закрыть</Button>
              <Button
                variant="contained"
                disabled={shareBusy}
                onClick={async () => {
                  setShareBusy(true);
                  setShareCreateError('');
                  try {
                    const rec = await voiceJobsAPI.createShareLink(base, shareTtl);
                    if (typeof rec?.token !== 'string' || !rec.token) {
                      setShareCreateError('Не удалось создать ссылку');
                      return;
                    }
                    setShareLinks((prev) => [...prev, {
                      token: rec.token,
                      ttl: shareTtl,
                      url: `${window.location.origin}/api/v1/voice/public/${encodeURIComponent(rec.token)}`,
                      revoked: false,
                      error: '',
                    }]);
                  } catch (err) {
                    setShareCreateError(responseDetailOr(err, 'Не удалось создать ссылку'));
                  } finally {
                    setShareBusy(false);
                  }
                }}
              >
                {shareBusy ? 'Создаю…' : shareLinks.length ? 'Создать ещё одну' : 'Создать ссылку'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

export default VoiceMeetingDrawer;
