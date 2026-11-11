import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import VerticalAlignBottomOutlinedIcon from '@mui/icons-material/VerticalAlignBottomOutlined';

const LEVEL_RE = /\b(INFO|WARNING|WARN|ERROR|CRITICAL|DEBUG|TRACE|OK|FAIL|SUCCESS)\b/i;
const TS_RE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/;
const STAGE_RE = /\b(Этап\s+\d+[\.\d]*|stage\s+\w+|audio|stt|diarization|speakers|analysis|insights|reports|done)\b/i;

const LEVEL_COLORS = {
  ERROR: '#ff6b6b',
  CRITICAL: '#ff6b6b',
  FAIL: '#ff6b6b',
  WARNING: '#ffd43b',
  WARN: '#ffd43b',
  INFO: '#74c0fc',
  DEBUG: '#868e96',
  TRACE: '#868e96',
  OK: '#69db7c',
  SUCCESS: '#69db7c',
};

function colorizeLine(line) {
  const parts = [];
  let rest = line;
  let key = 0;

  // Timestamp
  const tsMatch = rest.match(TS_RE);
  if (tsMatch) {
    const idx = rest.indexOf(tsMatch[0]);
    if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
    parts.push(<span key={key++} style={{ color: '#adb5bd', fontWeight: 600 }}>{tsMatch[0]}</span>);
    rest = rest.slice(idx + tsMatch[0].length);
  }

  // Level
  const lvlMatch = rest.match(LEVEL_RE);
  if (lvlMatch) {
    const idx = rest.indexOf(lvlMatch[0]);
    if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
    const lvl = lvlMatch[0].toUpperCase();
    parts.push(
      <span key={key++} style={{
        color: LEVEL_COLORS[lvl] || '#ced4da',
        fontWeight: 700,
        background: `${LEVEL_COLORS[lvl] || '#ced4da'}22`,
        borderRadius: 3,
        padding: '0 4px',
      }}>{lvl}</span>
    );
    rest = rest.slice(idx + lvlMatch[0].length);
  }

  // Stage marker
  const stMatch = rest.match(STAGE_RE);
  if (stMatch) {
    const idx = rest.indexOf(stMatch[0]);
    if (idx > 0) parts.push(<span key={key++}>{rest.slice(0, idx)}</span>);
    parts.push(<span key={key++} style={{ color: '#b197fc', fontWeight: 600 }}>{stMatch[0]}</span>);
    rest = rest.slice(idx + stMatch[0].length);
  }

  if (rest) parts.push(<span key={key++}>{rest}</span>);
  return parts;
}

function LogLine({ line, index, highlight }) {
  const colored = useMemo(() => colorizeLine(line), [line]);
  const isHit = highlight && line.toLowerCase().includes(highlight.toLowerCase());

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        px: 1.5,
        py: 0.25,
        borderRadius: 0.5,
        bgcolor: isHit ? 'rgba(255, 212, 59, 0.12)' : index % 2 ? 'rgba(255,255,255,0.02)' : 'transparent',
        '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
      }}
    >
      <Typography
        variant="caption"
        sx={{
          minWidth: 36,
          textAlign: 'right',
          color: 'rgba(255,255,255,0.25)',
          fontFamily: 'monospace',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
          lineHeight: '1.6',
        }}
      >
        {index + 1}
      </Typography>
      <Typography
        component="span"
        sx={{
          flex: 1,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: '#dee2e6',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {colored}
      </Typography>
    </Box>
  );
}

export default function VoiceLogViewer({ open, onClose, jobId, logText, loading }) {
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef(null);

  const lines = useMemo(() => (logText || '').split('\n'), [logText]);
  const filtered = useMemo(() => {
    if (!search.trim()) return lines;
    const q = search.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, search]);

  const stats = useMemo(() => {
    const counts = { error: 0, warning: 0, info: 0, other: 0 };
    for (const l of lines) {
      const m = l.match(LEVEL_RE);
      if (!m) { counts.other++; continue; }
      const lvl = m[0].toUpperCase();
      if (lvl === 'ERROR' || lvl === 'CRITICAL' || lvl === 'FAIL') counts.error++;
      else if (lvl === 'WARNING' || lvl === 'WARN') counts.warning++;
      else if (lvl === 'INFO') counts.info++;
      else counts.other++;
    }
    return counts;
  }, [lines]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(logText || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [logText]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([logText || ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job_${jobId || 'log'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logText, jobId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle1" sx={{ flex: 1, fontFamily: 'monospace' }}>
            Лог задачи {jobId}
          </Typography>
          {stats.error > 0 && <Chip size="small" color="error" label={`${stats.error} ошибок`} />}
          {stats.warning > 0 && <Chip size="small" color="warning" label={`${stats.warning} предупр.`} />}
          <Chip size="small" variant="outlined" label={`${lines.length} строк`} />
        </Stack>
      </DialogTitle>

      <Box sx={{ px: 3, pb: 1.5, display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Поиск по логу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, maxWidth: 320 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment>,
          }}
        />
        {search && (
          <Chip
            size="small"
            label={`${filtered.length} совпадений`}
            onDelete={() => setSearch('')}
            color="primary"
            variant="outlined"
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={autoScroll ? 'Автопрокрутка включена' : 'Автопрокрутка выключена'}>
          <IconButton
            size="small"
            color={autoScroll ? 'primary' : 'default'}
            aria-label={autoScroll ? 'Автопрокрутка включена' : 'Автопрокрутка выключена'}
            aria-pressed={autoScroll}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <VerticalAlignBottomOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Копировать всё">
          <IconButton size="small" onClick={handleCopy} color={copied ? 'success' : 'default'}>
            <ContentCopyOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Скачать .txt">
          <IconButton size="small" onClick={handleDownload}>
            <DownloadOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <DialogContent dividers sx={{ p: 0, bgcolor: '#1a1b23' }}>
        {loading ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Загрузка…</Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
            {search ? 'Ничего не найдено' : 'Лог пуст'}
          </Box>
        ) : (
          <Box ref={scrollRef} sx={{ maxHeight: 480, overflow: 'auto', py: 1 }}>
            {filtered.map((line, i) => (
              <LogLine key={i} line={line} index={i} highlight={search} />
            ))}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
