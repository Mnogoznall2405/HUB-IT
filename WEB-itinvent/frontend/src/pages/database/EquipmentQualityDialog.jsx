import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';

import { LoadingSpinner } from '../../components/common';
import { equipmentQualityAPI } from '../../api/equipmentQuality';
import { equipmentPhotoOcrAPI } from '../../api/equipmentPhotoOcr';
import { formatMacInput, isMacComplete } from './detailModel';

const PAGE_SIZE = 50;
const OCR_BATCH = 100;
const OCR_POLL_MS = 5000;
const SUMMARY_ERROR = 'Не удалось загрузить панель качества данных.';
const ISSUES_ERROR = 'Не удалось загрузить список позиций.';
const EXPORT_ERROR = 'Не удалось скачать CSV.';
const OCR_RUN_ERROR = 'Не удалось запустить распознавание фото.';
const MAC_SAVE_ERROR = 'Не удалось сохранить MAC-адрес.';

// Правила про фото открывают карточку сразу на вкладке «Фото», остальные — на общей.
const PHOTO_RULES = new Set(['no_photo', 'serial_photo_similar', 'serial_photo_mismatch']);
const tabForRule = (rule) => (PHOTO_RULES.has(rule) ? 'photos' : 'general');

const readError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : (error?.message || fallback);
};

const formatAsOf = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

const severityColor = (rule) => {
  if (rule.count === null || rule.count === undefined) return 'text.disabled';
  if (rule.count === 0) return 'success.main';
  return rule.severity === 'error' ? 'error.main' : 'warning.main';
};

function RuleTile({ rule, onOpen }) {
  const unknown = rule.count === null || rule.count === undefined;
  const clean = !unknown && rule.count === 0;
  return (
    <ButtonBase
      onClick={() => onOpen(rule)}
      disabled={unknown}
      data-testid={`quality-rule-${rule.rule}`}
      sx={{ textAlign: 'left', display: 'block', width: '100%', borderRadius: 1.5 }}
    >
      <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{rule.title}</Typography>
        <Typography variant="h5" sx={{ color: severityColor(rule), fontWeight: 700, my: 0.5 }}>
          {unknown ? '—' : rule.count}
          {!unknown && rule.total ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {`${rule.pct}% из ${rule.total}`}
            </Typography>
          ) : null}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {unknown ? 'Не удалось определить — данные недоступны или устарели.' : (clean ? 'Всё чисто' : rule.description)}
        </Typography>
      </Paper>
    </ButtonBase>
  );
}

// Быстрая правка MAC прямо в строке: «Есть IP, нет MAC» — вписать; «MAC в неверном формате» — привести к AA:BB:….
function MacQuickFix({ rule, row, saving, onSave }) {
  const [value, setValue] = useState('');
  if (rule === 'mac_invalid') {
    if (!isMacComplete(row.mac_address)) return null;
    const fixed = formatMacInput(row.mac_address);
    return (
      <Button size="small" variant="outlined" disabled={saving} onClick={() => onSave(row, fixed)}>
        {`Исправить → ${fixed}`}
      </Button>
    );
  }
  if (rule !== 'ip_no_mac') return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder="AA:BB:CC:DD:EE:FF"
        value={value}
        onChange={(event) => setValue(formatMacInput(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isMacComplete(value) && !saving) onSave(row, value);
        }}
        inputProps={{ 'aria-label': 'MAC-адрес', autoCapitalize: 'characters', spellCheck: false }}
        sx={{ width: 190 }}
      />
      <Button size="small" variant="contained" disabled={saving || !isMacComplete(value)} onClick={() => onSave(row, value)}>
        Сохранить
      </Button>
    </Box>
  );
}

// Охват распознавания серийников по фото; запуск пакета доступен администратору.
function PhotoOcrPanel({ ocr, isAdmin, starting, onRun }) {
  if (!ocr || !ocr.store_available) return null;
  const run = ocr.run || {};
  const pending = Number(ocr.pending) || 0;
  const review = (Number(ocr.items_similar) || 0) + (Number(ocr.items_mismatch) || 0);
  const canRun = isAdmin && ocr.enabled && ocr.configured && pending > 0 && !run.running;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }} data-testid="quality-ocr-panel">
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Серийные номера по фото</Typography>
      <Typography variant="body2" color="text.secondary">
        {`Распознано фото: ${ocr.analyzed}${ocr.photos_total != null ? ` из ${ocr.photos_total}` : ''}`
          + ` · подтверждено по фото: ${ocr.items_confirmed} · на проверку глазами: ${review}`}
      </Typography>
      {run.running ? (
        <>
          <LinearProgress
            variant={run.planned ? 'determinate' : 'indeterminate'}
            value={run.planned ? Math.min(100, (run.done * 100) / run.planned) : undefined}
            sx={{ my: 1 }}
          />
          <Typography variant="caption" color="text.secondary">
            {`Идёт распознавание: ${run.done} из ${run.planned}`}
          </Typography>
        </>
      ) : null}
      {isAdmin && !ocr.enabled ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Распознавание выключено в настройках сервера.
        </Typography>
      ) : null}
      {canRun ? (
        <Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={starting} onClick={onRun}>
          {`Распознать ещё ${Math.min(OCR_BATCH, pending)} фото`}
        </Button>
      ) : null}
    </Paper>
  );
}

// Панель качества данных: плитки правил → список нарушителей с открытием карточки и CSV.
export default function EquipmentQualityDialog({
  open, onClose, onOpenEquipment, dbId = '', isAdmin = false, canWrite = false,
  // Меняется, когда пользователь вернулся из карточки: данные перечитываются на месте.
  reloadToken = 0,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeRule, setActiveRule] = useState(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ocr, setOcr] = useState(null);
  const [ocrStarting, setOcrStarting] = useState(false);
  const [savingRowId, setSavingRowId] = useState(null);
  const summaryRequestRef = useRef(0);
  const issuesRequestRef = useRef(0);
  const ocrRunningRef = useRef(false);
  const countersStaleRef = useRef(false);

  const loadOcr = useCallback(async () => {
    try {
      const data = await equipmentPhotoOcrAPI.summary({ dbId });
      setOcr(data);
      return data;
    } catch {
      // The coverage block is optional: the rule tiles keep working without it.
      return null;
    }
  }, [dbId]);

  const loadSummary = useCallback(async (refresh = false) => {
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setSummaryLoading(true);
    setError('');
    void loadOcr();
    try {
      const data = await equipmentQualityAPI.summary({ refresh, dbId });
      if (summaryRequestRef.current === requestId) setSummary(data);
    } catch (err) {
      if (summaryRequestRef.current === requestId) setError(readError(err, SUMMARY_ERROR));
    } finally {
      if (summaryRequestRef.current === requestId) setSummaryLoading(false);
    }
  }, [dbId, loadOcr]);

  const ocrRunning = Boolean(ocr?.run?.running);
  useEffect(() => {
    if (!open || !ocrRunning) return undefined;
    ocrRunningRef.current = true;
    const timer = setInterval(() => { void loadOcr(); }, OCR_POLL_MS);
    return () => clearInterval(timer);
  }, [open, ocrRunning, loadOcr]);

  // Пакет закончился: плитки правил пересчитываем уже с новыми результатами.
  useEffect(() => {
    if (open && !ocrRunning && ocrRunningRef.current) {
      ocrRunningRef.current = false;
      void loadSummary(true);
    }
  }, [open, ocrRunning, loadSummary]);

  const handleRunOcr = async () => {
    if (ocrStarting) return;
    setOcrStarting(true);
    setError('');
    try {
      const result = await equipmentPhotoOcrAPI.run({ limit: OCR_BATCH, dbId });
      // The batch starts after the response: show it as running right away, polling takes over.
      if (result?.started) {
        setOcr((prev) => (prev ? { ...prev, run: { ...(prev.run || {}), running: true, done: 0, planned: 0 } } : prev));
      } else {
        await loadOcr();
      }
    } catch (err) {
      setError(readError(err, OCR_RUN_ERROR));
    } finally {
      setOcrStarting(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    setActiveRule(null);
    setQuery('');
    void loadSummary(false);
    return () => { summaryRequestRef.current += 1; };
  }, [open, loadSummary]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const loadIssues = useCallback(async ({ append = false, offset = 0 } = {}) => {
    if (!activeRule) return;
    const requestId = issuesRequestRef.current + 1;
    issuesRequestRef.current = requestId;
    if (append) setLoadingMore(true); else setIssuesLoading(true);
    setError('');
    try {
      const data = await equipmentQualityAPI.issues({
        rule: activeRule.rule, q: debouncedQuery, offset, limit: PAGE_SIZE, dbId,
      });
      if (issuesRequestRef.current !== requestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      setRows((prev) => (append ? [...prev, ...items] : items));
      setTotal(Number(data?.total) || 0);
    } catch (err) {
      if (issuesRequestRef.current === requestId) setError(readError(err, ISSUES_ERROR));
    } finally {
      if (issuesRequestRef.current === requestId) {
        setIssuesLoading(false);
        setLoadingMore(false);
      }
    }
  }, [activeRule, debouncedQuery, dbId]);

  useEffect(() => {
    if (!open || !activeRule) return undefined;
    setRows([]);
    setTotal(0);
    void loadIssues();
    return () => { issuesRequestRef.current += 1; };
  }, [open, activeRule, loadIssues]);

  const reloadSeenRef = useRef(reloadToken);
  useEffect(() => {
    if (reloadSeenRef.current === reloadToken) return;
    reloadSeenRef.current = reloadToken;
    if (!open) return;
    void loadSummary(true);
    if (activeRule) void loadIssues();
  }, [reloadToken, open, activeRule, loadSummary, loadIssues]);

  const handleOpenRule = (rule) => {
    setQuery('');
    setDebouncedQuery('');
    setActiveRule(rule);
  };

  const handleBack = () => {
    setActiveRule(null);
    setError('');
    // Rows were fixed in place: the tile counters are recounted when the list of rules is shown again.
    if (countersStaleRef.current) {
      countersStaleRef.current = false;
      void loadSummary(true);
    }
  };

  const handleSaveMac = async (row, mac) => {
    if (savingRowId !== null) return;
    setSavingRowId(row.item_id);
    setError('');
    try {
      await equipmentQualityAPI.setMac({ invNo: row.inv_no || row.item_id, mac, dbId });
      // The row no longer breaks the rule: drop it instead of reloading the whole page.
      setRows((prev) => prev.filter((item) => item.item_id !== row.item_id));
      setTotal((prev) => Math.max(0, prev - 1));
      countersStaleRef.current = true;
    } catch (err) {
      setError(readError(err, MAC_SAVE_ERROR));
    } finally {
      setSavingRowId(null);
    }
  };

  const handleExport = async () => {
    if (!activeRule || exporting) return;
    setExporting(true);
    setError('');
    try {
      const blob = await equipmentQualityAPI.exportCsv({ rule: activeRule.rule, q: debouncedQuery, dbId });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `quality-${activeRule.rule}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(readError(err, EXPORT_ERROR));
    } finally {
      setExporting(false);
    }
  };

  const canLoadMore = rows.length < total;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
      data-testid="equipment-quality-dialog"
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1, gap: 0.5 }}>
        {activeRule ? (
          <IconButton aria-label="К списку правил" onClick={handleBack} edge="start">
            <ArrowBackIcon />
          </IconButton>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>{activeRule ? activeRule.title : 'Качество данных'}</Box>
        {!activeRule ? (
          <IconButton
            aria-label="Пересчитать"
            onClick={() => { void loadSummary(true); }}
            disabled={summaryLoading}
          >
            <RefreshIcon />
          </IconButton>
        ) : null}
        <IconButton aria-label="Закрыть" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}

        {!activeRule ? (
          <>
            {summaryLoading ? <LinearProgress sx={{ mb: 1 }} /> : null}
            {summary ? (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  {`Текущая база · ${summary.total} позиций`}
                  {summary.as_of ? ` · обновлено в ${formatAsOf(summary.as_of)}` : ''}
                  {summary.cached ? ' (из кэша)' : ''}
                </Typography>
                <PhotoOcrPanel ocr={ocr} isAdmin={isAdmin} starting={ocrStarting} onRun={() => { void handleRunOcr(); }} />
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                  }}
                >
                  {(summary.rules || []).map((rule) => (
                    <RuleTile key={rule.rule} rule={rule} onOpen={handleOpenRule} />
                  ))}
                </Box>
              </>
            ) : null}
            {!summary && summaryLoading ? <LoadingSpinner /> : null}
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {activeRule.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
              <TextField
                fullWidth
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Инв. номер, модель, серийный, сотрудник"
              />
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                disabled={exporting || !total}
                onClick={() => { void handleExport(); }}
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                CSV
              </Button>
            </Box>
            {issuesLoading ? <LoadingSpinner /> : null}
            {!issuesLoading && !rows.length && !error ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                Всё чисто — позиций с этой проблемой нет.
              </Typography>
            ) : null}
            {total > 0 && !issuesLoading ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {`Найдено: ${total}`}
              </Typography>
            ) : null}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {rows.map((row) => (
                <Paper
                  key={`${row.item_id}`}
                  variant="outlined"
                  sx={{ p: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}
                  data-testid="quality-issue-row"
                >
                  <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
                    <Typography variant="subtitle2" noWrap title={row.model_name}>
                      {`${row.inv_no || row.item_id} · ${row.model_name || row.type_name || 'Без модели'}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                      {[row.employee_name, row.branch_name, row.location_name].filter(Boolean).join(' · ') || 'Без владельца и расположения'}
                    </Typography>
                    {row.serial_no ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                        {`S/N ${row.serial_no}`}
                      </Typography>
                    ) : null}
                    {row.note ? (
                      <Typography variant="caption" color="warning.main" sx={{ display: 'block' }} noWrap title={row.note}>
                        {row.note}
                      </Typography>
                    ) : null}
                  </Box>
                  {canWrite ? (
                    <MacQuickFix
                      rule={activeRule.rule}
                      row={row}
                      saving={savingRowId === row.item_id}
                      onSave={(item, mac) => { void handleSaveMac(item, mac); }}
                    />
                  ) : null}
                  <Button
                    size="small"
                    onClick={() => onOpenEquipment?.(row.inv_no || row.item_id, { initialTab: tabForRule(activeRule.rule) })}
                  >
                    Открыть
                  </Button>
                </Paper>
              ))}
            </Box>
            {canLoadMore && !issuesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
                <Button
                  onClick={() => { void loadIssues({ append: true, offset: rows.length }); }}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Загрузка...' : `Показать ещё (${total - rows.length})`}
                </Button>
              </Box>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
