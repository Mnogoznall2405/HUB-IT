import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
  LinearProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { warehouse1cAPI } from '../../api/warehouse1c';
import { useAuth } from '../../contexts/AuthContext';
import {
  HUB_PART_NO_NOT_IN_1C,
  NomenclatureCell,
  formatWarehouseQty,
  resolveWarehouseErrorMessage,
} from './warehouse1cShared';

const QUEUE_TABS = [
  { id: 'pending', label: 'Без партномера' },
  { id: 'owner', label: 'По человеку' },
  { id: 'hub_over', label: 'Hub > 1С' },
  { id: 'not_in_1c', label: 'Помечено «нет в 1С»' },
];

const OWNER_FILTERS = [
  { id: 'with', label: 'С сотрудником' },
  { id: 'without', label: 'Без сотрудника' },
  { id: 'all', label: 'Все' },
];

function CoverageBar({ coverage }) {
  if (!coverage) return null;
  const total = Number(coverage.total_count || 0);
  const linked = Number(coverage.linked_count || 0);
  const pending = Number(coverage.pending_count || 0);
  const notIn1c = Number(coverage.not_in_1c_count || 0);
  const pct = Number(coverage.coverage_pct || 0);

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Покрытие PART_NO
          </Typography>
          <Chip size="small" color="primary" label={`${pct}% закрыто`} />
          <Chip size="small" variant="outlined" label={`Всего: ${total}`} />
          <Chip size="small" color="success" variant="outlined" label={`С кодом: ${linked}`} />
          <Chip size="small" color="warning" variant="outlined" label={`Очередь: ${pending}`} />
          <Chip size="small" variant="outlined" label={`${HUB_PART_NO_NOT_IN_1C}: ${notIn1c}`} />
        </Stack>
        <LinearProgress
          variant="determinate"
          value={Math.max(0, Math.min(100, pct))}
          sx={{ height: 8, borderRadius: 999 }}
        />
        <Typography variant="caption" color="text.secondary">
          Разобрать → сначала склад сотрудника в 1С → проставить PART_NO.
          «{HUB_PART_NO_NOT_IN_1C}» — только если подходящих кодов нет.
        </Typography>
      </Stack>
    </Paper>
  );
}

function ReconcileItemDialog({
  open,
  item,
  onClose,
  onChanged,
  onOpenInvNo,
  canWriteReconcile = false,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmNotIn1c, setConfirmNotIn1c] = useState(false);

  const invNo = String(item?.inv_no || '').trim();
  const hubDbId = String(item?.hub_db_id || '').trim();
  const expectedVersion = Number(payload?.expected_version ?? item?.expected_version ?? 0) || 0;

  useEffect(() => {
    if (!open || !item) {
      setPayload(null);
      setError('');
      setConfirmNotIn1c(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setPayload(null);
    setConfirmNotIn1c(false);
    warehouse1cAPI.getReconcileItemSuggestions({
      invNo,
      modelName: item.model_name || '',
      serialNo: item.serial_no || item.hw_serial_no || '',
      limit: 8,
    })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(resolveWarehouseErrorMessage(err, 'Не удалось подобрать коды 1С.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item, invNo, hubDbId]);

  const runApply = async (code, nomenclatureRef = '') => {
    if (!canWriteReconcile) return;
    setBusy(code);
    setError('');
    try {
      const candidate = candidates.find((row) => String(row?.code || '').trim() === String(code || '').trim());
      await warehouse1cAPI.applyReconcilePartNo({
        invNo,
        nomenclatureRef: nomenclatureRef || candidate?.ref || '',
        partNo: code,
        reason: 'Подтверждено вручную в разборе единицы Hub.',
        expectedPartNo: item?.part_no,
        expectedVersion,
        confirm: true,
      });
      if (onChanged) onChanged();
      onClose();
    } catch (err) {
      setError(resolveWarehouseErrorMessage(err, 'Не удалось проставить PART_NO.'));
    } finally {
      setBusy('');
    }
  };

  const runMarkNotIn1c = async () => {
    if (!canWriteReconcile) return;
    setBusy('not-in-1c');
    setError('');
    try {
      await warehouse1cAPI.markReconcileNotIn1c({
        invNo,
        reason: 'Проверено вручную: подходящая номенклатура 1С не найдена.',
        expectedPartNo: item?.part_no,
        expectedVersion,
        confirm: true,
      });
      if (onChanged) onChanged();
      onClose();
    } catch (err) {
      setError(resolveWarehouseErrorMessage(err, 'Не удалось пометить.'));
    } finally {
      setBusy('');
    }
  };

  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const aiSuggestions = Array.isArray(payload?.ai?.suggestions) ? payload.ai.suggestions : [];
  const hasCandidates = candidates.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={isMobile}
      scroll="paper"
    >
      <DialogTitle sx={{ pr: 6 }}>
        Разбор единицы Hub
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {item ? (
          <Stack spacing={0.75} sx={{ mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {item.model_name || 'Без модели'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Сотрудник: {item.employee_name || 'не назначен'}
              {item.hub_db_name ? ` · БД: ${item.hub_db_name}` : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Инв. №:{' '}
              {onOpenInvNo ? (
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => onOpenInvNo(invNo, { databaseId: hubDbId })}
                >
                  {invNo}
                </Link>
              ) : invNo}
              {item.serial_no ? ` · S/N: ${item.serial_no}` : ''}
              {item.part_no ? ` · Парт. №: ${item.part_no}` : ''}
            </Typography>
            {payload?.hint ? (
              <Alert severity={hasCandidates ? 'info' : 'warning'} sx={{ mt: 1 }}>
                {payload.hint}
              </Alert>
            ) : null}
          </Stack>
        ) : null}

        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Подбираем коды номенклатуры 1С…</Typography>
          </Stack>
        ) : null}
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {!canWriteReconcile ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Сверка доступна в режиме просмотра. Для изменения связи нужны права «Склад 1С: изменение сверки» и «База: изменения».
          </Alert>
        ) : null}

        {!loading && hasCandidates ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Подходящие коды 1С ({candidates.length})
            </Typography>
            <Paper variant="outlined">
              {candidates.map((row) => (
                <Box
                  key={`${row.code}|${row.ref}`}
                  sx={{
                    px: 1.5,
                    py: 1.25,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <NomenclatureCell code={row.code} name={row.name} />
                      {row.qty_1c_total != null ? (
                        <Typography variant="caption" color="text.secondary">
                          Остаток в 1С (все склады): {formatWarehouseQty(row.qty_1c_total, 0)}
                        </Typography>
                      ) : null}
                    </Box>
                    {canWriteReconcile && row?.ref ? (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={Boolean(busy)}
                        onClick={() => runApply(row.code, row.ref)}
                        sx={{ textTransform: 'none', alignSelf: { xs: 'stretch', sm: 'center' } }}
                      >
                        {busy === row.code ? '…' : `Проставить ${row.code}`}
                      </Button>
                    ) : null}
                  </Stack>
                </Box>
              ))}
            </Paper>
          </Box>
        ) : null}

        {!loading && aiSuggestions.length ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              AI-подсказки (подтвердите вручную)
            </Typography>
            <Stack spacing={1}>
              {aiSuggestions.map((row) => (
                <Paper key={`ai-${row.code}`} variant="outlined" sx={{ p: 1.25 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                  >
                    <Box>
                      <NomenclatureCell code={row.code} name={row.name} />
                      <Typography variant="caption" color="text.secondary">
                        {row.reason || 'AI'}
                        {row.confidence != null ? ` · уверенность ${(Number(row.confidence) * 100).toFixed(0)}%` : ''}
                      </Typography>
                    </Box>
                    {canWriteReconcile && row?.ref ? (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={Boolean(busy)}
                        onClick={() => runApply(row.code, row.ref)}
                        sx={{ textTransform: 'none' }}
                      >
                        {busy === row.code ? '…' : 'Применить'}
                      </Button>
                    ) : null}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Box>
        ) : null}

        {!loading && canWriteReconcile ? (
          <>
            <Divider sx={{ my: 1.5 }} />
            {!hasCandidates || confirmNotIn1c ? (
              <Alert severity="warning" sx={{ mb: 1 }}>
                Пометка «{HUB_PART_NO_NOT_IN_1C}» означает: единица проверена и в 1С её учитывать не нужно.
                {!hasCandidates
                  ? ' Подходящих кодов не найдено — можно пометить.'
                  : ' Сейчас есть кандидаты; помечайте только если ни один не подходит.'}
              </Alert>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Если ни один код не подходит — сначала нажмите «Нет подходящих кодов», затем подтвердите пометку.
              </Typography>
            )}
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {hasCandidates && !confirmNotIn1c ? (
                <Button
                  size="small"
                  color="warning"
                  variant="outlined"
                  onClick={() => setConfirmNotIn1c(true)}
                  sx={{ textTransform: 'none' }}
                >
                  Нет подходящих кодов…
                </Button>
              ) : (
                <Button
                  size="small"
                  color="warning"
                  variant="contained"
                  disabled={Boolean(busy)}
                  onClick={runMarkNotIn1c}
                  sx={{ textTransform: 'none' }}
                >
                  {busy === 'not-in-1c' ? '…' : `Пометить «${HUB_PART_NO_NOT_IN_1C}»`}
                </Button>
              )}
              {confirmNotIn1c && hasCandidates ? (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setConfirmNotIn1c(false)}
                  sx={{ textTransform: 'none' }}
                >
                  Отмена
                </Button>
              ) : null}
            </Stack>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Warehouse1CReconcilePanel({
  onOpenInvNo = null,
  onOpenNomenclature = null,
}) {
  const { hasPermission } = useAuth();
  const [reconcileWriteEnabled, setReconcileWriteEnabled] = useState(false);
  const [reconcileWriteKnown, setReconcileWriteKnown] = useState(false);
  const canWriteReconcile = Boolean(
    reconcileWriteEnabled
    && hasPermission('warehouse_1c.reconcile.write')
    && hasPermission('database.write')
  );
  const [queueTab, setQueueTab] = useState('pending');
  const [hasOwner, setHasOwner] = useState('with');
  const [coverage, setCoverage] = useState(null);
  const [coverageError, setCoverageError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hubOverMeta, setHubOverMeta] = useState(null);
  const [hubOverLoadingMore, setHubOverLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeeDraft, setEmployeeDraft] = useState('');
  const [ownerHubPending, setOwnerHubPending] = useState([]);
  const [ownerHubTotal, setOwnerHubTotal] = useState(0);
  const [ownerMismatches, setOwnerMismatches] = useState([]);
  const [warehouseStatus, setWarehouseStatus] = useState('');
  const [autoInfo, setAutoInfo] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [workItem, setWorkItem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    warehouse1cAPI.getRuntimeStatus()
      .then((data) => {
        if (cancelled) return;
        setReconcileWriteEnabled(Boolean(data?.reconcile?.write_enabled));
        setReconcileWriteKnown(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed: an unavailable status endpoint must not expose a
        // mutation button whose server-side rollout state is unknown.
        setReconcileWriteEnabled(false);
        setReconcileWriteKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refreshCoverage = useCallback(() => {
    warehouse1cAPI.getReconcileCoverage()
      .then((data) => {
        setCoverage(data);
        setCoverageError('');
      })
      .catch((err) => {
        setCoverageError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить покрытие.'));
      });
  }, []);

  useEffect(() => {
    refreshCoverage();
  }, [refreshCoverage, reloadToken]);

  useEffect(() => {
    const onDatabaseChanged = () => {
      setReloadToken((value) => value + 1);
    };
    window.addEventListener('database-changed', onDatabaseChanged);
    return () => window.removeEventListener('database-changed', onDatabaseChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setItems([]);
    setTotal(0);
    setHubOverMeta(null);
    setHubOverLoadingMore(false);
    setOwnerHubPending([]);
    setOwnerHubTotal(0);
    setOwnerMismatches([]);
    setWarehouseStatus('');
    setAutoInfo('');

    const load = async () => {
      if (queueTab === 'pending' || queueTab === 'not_in_1c') {
        const data = await warehouse1cAPI.getReconcileQueue({
          queue: queueTab === 'not_in_1c' ? 'not_in_1c' : 'pending',
          q: search,
          hasOwner: queueTab === 'pending' ? hasOwner : 'all',
          limit: 100,
          offset: 0,
        });
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number(data?.total) || 0);
        return;
      }

      if (queueTab === 'hub_over') {
        const data = await warehouse1cAPI.getReconcileHubOver1c({ limit: 50 });
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        const sourceTotal = Number(data?.total);
        setTotal(Number.isFinite(sourceTotal) ? sourceTotal : null);
        setHubOverMeta({
          total: Number.isFinite(sourceTotal) ? sourceTotal : null,
          comparisonTotal: data?.comparison_total == null ? null : Number(data.comparison_total),
          nextCursor: String(data?.next_cursor || ''),
          hasMore: Boolean(data?.has_more),
          status: String(data?.status || 'unknown'),
          truncated: Boolean(data?.truncated),
          incompleteItems: Array.isArray(data?.incomplete_items) ? data.incomplete_items : [],
        });
        return;
      }

      if (queueTab === 'owner') {
        const name = String(employeeName || '').trim();
        if (!name) return;
        const data = await warehouse1cAPI.getReconcileOwnerMismatches({
          employeeName: name,
          limit: 100,
        });
        if (cancelled) return;
        setOwnerHubPending(Array.isArray(data?.hub_pending) ? data.hub_pending : []);
        setOwnerHubTotal(Number(data?.hub_pending_total) || 0);
        setOwnerMismatches(Array.isArray(data?.mismatched) ? data.mismatched : []);
        setWarehouseStatus(String(data?.warehouse_status || ''));
        setItems(Array.isArray(data?.hub_pending) ? data.hub_pending : []);
        setTotal(Number(data?.hub_pending_total) || 0);
      }
    };

    load()
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load reconcile queue:', err);
        setError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить очередь сверки.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [queueTab, search, employeeName, hasOwner, reloadToken]);

  const bump = useCallback(() => setReloadToken((value) => value + 1), []);

  const loadMoreHubOver = async () => {
    const cursor = String(hubOverMeta?.nextCursor || '').trim();
    if (!cursor || hubOverLoadingMore) return;
    setHubOverLoadingMore(true);
    setError('');
    try {
      const data = await warehouse1cAPI.getReconcileHubOver1c({ limit: 50, cursor });
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setItems((previous) => {
        const known = new Set(previous.map((row) => String(row?.nomenclature_ref || row?.part_no || '')));
        return [
          ...previous,
          ...nextItems.filter((row) => !known.has(String(row?.nomenclature_ref || row?.part_no || ''))),
        ];
      });
      const sourceTotal = Number(data?.total);
      const resolvedTotal = Number.isFinite(sourceTotal) ? sourceTotal : (hubOverMeta?.total ?? null);
      setTotal(resolvedTotal);
      setHubOverMeta({
        total: resolvedTotal,
        comparisonTotal: data?.comparison_total == null ? null : Number(data.comparison_total),
        nextCursor: String(data?.next_cursor || ''),
        hasMore: Boolean(data?.has_more),
        status: String(data?.status || 'unknown'),
        truncated: Boolean(data?.truncated),
        incompleteItems: Array.isArray(data?.incomplete_items) ? data.incomplete_items : [],
      });
    } catch (err) {
      setError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить следующую страницу сверки.'));
    } finally {
      setHubOverLoadingMore(false);
    }
  };

  const handleAutoPreview = async () => {
    setAutoBusy(true);
    setAutoInfo('');
    try {
      const data = await warehouse1cAPI.autoLinkReconcile({
        limit: 50,
        dryRun: true,
      });
      const linked = Number(data?.linked_count || 0);
      const skipped = Number(data?.skipped_count || 0);
      setAutoInfo(
        `Предпросмотр: найдено ${linked} кандидатов, пропущено ${skipped}. `
          + 'Каждую связь подтвердите отдельно в карточке оборудования.',
      );
    } catch (err) {
      setAutoInfo(resolveWarehouseErrorMessage(err, 'Предпросмотр автоподбора не выполнен.'));
    } finally {
      setAutoBusy(false);
    }
  };

  const titleHint = useMemo(() => {
    if (queueTab === 'owner') {
      return 'Введите фамилию или ФИО: покажем технику этого человека без партномера и расхождения со складом 1С.';
    }
    if (queueTab === 'hub_over') {
      return 'Номенклатуры, где в Hub единиц больше, чем суммарный остаток в 1С.';
    }
    if (queueTab === 'not_in_1c') {
      return `Уже помеченные «${HUB_PART_NO_NOT_IN_1C}» — для аудита.`;
    }
    return 'Нажмите «Разобрать»: сначала склад сотрудника в 1С, затем ручной поиск номенклатуры.';
  }, [queueTab]);

  const openWorkbench = (item) => setWorkItem(item);

  return (
    <Box>
      <CoverageBar coverage={coverage} />
      {coverageError ? <Alert severity="warning" sx={{ mb: 2 }}>{coverageError}</Alert> : null}

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
        {QUEUE_TABS.map((tab) => (
          <Button
            key={tab.id}
            size="small"
            variant={queueTab === tab.id ? 'contained' : 'outlined'}
            onClick={() => setQueueTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {titleHint}
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }} alignItems={{ md: 'center' }}>
        {(queueTab === 'pending' || queueTab === 'not_in_1c') ? (
          <>
            <TextField
              size="small"
              label="Поиск (ФИО, модель, инв.№)"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSearch(searchDraft.trim());
              }}
              fullWidth
            />
            <Button
              size="small"
              variant="contained"
              onClick={() => setSearch(searchDraft.trim())}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              Найти
            </Button>
          </>
        ) : null}

        {queueTab === 'pending' ? (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {OWNER_FILTERS.map((filter) => (
              <Chip
                key={filter.id}
                size="small"
                color={hasOwner === filter.id ? 'primary' : 'default'}
                variant={hasOwner === filter.id ? 'filled' : 'outlined'}
                label={filter.label}
                onClick={() => setHasOwner(filter.id)}
              />
            ))}
          </Stack>
        ) : null}

        {queueTab === 'owner' ? (
          <>
            <TextField
              size="small"
              label="Фамилия / ФИО сотрудника"
              value={employeeDraft}
              onChange={(event) => setEmployeeDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setEmployeeName(employeeDraft.trim());
              }}
              fullWidth
            />
            <Button
              size="small"
              variant="contained"
              onClick={() => setEmployeeName(employeeDraft.trim())}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              Найти
            </Button>
          </>
        ) : null}

        {queueTab === 'pending' ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              size="small"
              variant="outlined"
              disabled={autoBusy}
              onClick={handleAutoPreview}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              Auto предпросмотр
            </Button>
          </Stack>
        ) : null}
      </Stack>

      {!canWriteReconcile ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {!reconcileWriteKnown || !reconcileWriteEnabled
            ? 'Сверка запущена в audit-only режиме: изменение связей временно выключено на сервере.'
            : 'Сверка работает в режиме просмотра. Изменение связей требует прав «Склад 1С: изменение сверки» и «База: изменения».'}
        </Alert>
      ) : null}
      {autoInfo ? <Alert severity="info" sx={{ mb: 2 }}>{autoInfo}</Alert> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      {loading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Загрузка очереди…</Typography>
        </Stack>
      ) : null}

      {!loading && !error && queueTab === 'owner' && employeeName ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Hub без партномера: {ownerHubTotal}
          {warehouseStatus ? ` · склад 1С: ${warehouseStatus}` : ''}
          {ownerMismatches.length ? ` · расхождений 1С↔Hub: ${ownerMismatches.length}` : ''}
        </Alert>
      ) : null}

      {!loading && !error && queueTab !== 'hub_over' ? (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Показано: {items.length}{total ? ` из ${total}` : ''}
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Сотрудник</TableCell>
                  <TableCell>Модель</TableCell>
                  <TableCell>Инв. №</TableCell>
                  <TableCell>Парт. №</TableCell>
                  <TableCell>БД</TableCell>
                  <TableCell align="right">Действие</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length ? items.map((item) => (
                  <TableRow
                    key={`${item.hub_db_id}|${item.inv_no}|${item.owner_no}`}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openWorkbench(item)}
                  >
                    <TableCell>{item.employee_name || 'не назначен'}</TableCell>
                    <TableCell>{item.model_name || '—'}</TableCell>
                    <TableCell>
                      {onOpenInvNo ? (
                        <Link
                          component="button"
                          type="button"
                          variant="body2"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenInvNo(item.inv_no, { databaseId: item.hub_db_id });
                          }}
                        >
                          {item.inv_no}
                        </Link>
                      ) : item.inv_no}
                    </TableCell>
                    <TableCell>{item.part_no || '—'}</TableCell>
                    <TableCell>{item.hub_db_name || item.hub_db_id || '—'}</TableCell>
                    <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => openWorkbench(item)}
                        sx={{ textTransform: 'none' }}
                      >
                        Разобрать
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">
                        {queueTab === 'owner' && !employeeName
                          ? 'Введите фамилию и нажмите «Найти».'
                          : 'Пусто.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}

      {!loading && !error && queueTab === 'owner' && ownerMismatches.length ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Расхождения остатков 1С ↔ Hub
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Номенклатура</TableCell>
                  <TableCell align="right">В 1С</TableCell>
                  <TableCell align="right">В Hub</TableCell>
                  <TableCell align="right">Δ</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {ownerMismatches.map((row) => (
                  <TableRow key={`${row.nomenclature_ref}|${row.nomenclature_code}`}>
                    <TableCell>
                      <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
                    </TableCell>
                    <TableCell align="right">{formatWarehouseQty(row.qty_1c ?? row.qty_balance)}</TableCell>
                    <TableCell align="right">{row.hub_count ?? 0}</TableCell>
                    <TableCell align="right">{formatWarehouseQty(row.delta)}</TableCell>
                    <TableCell align="right">
                      {onOpenNomenclature ? (
                        <Button
                          size="small"
                          onClick={() => onOpenNomenclature(row)}
                          sx={{ textTransform: 'none' }}
                        >
                          Сверка
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : null}

      {!loading && !error && queueTab === 'hub_over' ? (
        <Stack spacing={1.5}>
          <Typography variant="caption" color="text.secondary">
            Показано расхождений: {items.length}
            {hubOverMeta?.total != null ? ` · исходных групп Hub: ${hubOverMeta.total}` : ''}
            {hubOverMeta?.comparisonTotal != null ? ` · всего расхождений: ${hubOverMeta.comparisonTotal}` : ''}
          </Typography>
          {hubOverMeta?.status !== 'ok' || hubOverMeta?.truncated ? (
            <Alert severity="warning">
              Сверка Hub&gt;1С неполна: отсутствие строки не является итоговым выводом.
              {hubOverMeta?.incompleteItems?.length ? ` Не проверено групп: ${hubOverMeta.incompleteItems.length}.` : ''}
            </Alert>
          ) : null}
          {items.length ? items.map((row) => (
            <Paper key={row.part_no || row.nomenclature_code} variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                  <NomenclatureCell code={row.nomenclature_code || row.part_no} name={row.nomenclature_name} />
                  <Chip
                    size="small"
                    color="error"
                    label={`Hub ${row.hub_count} > 1С ${formatWarehouseQty(row.qty_1c, 0)}`}
                  />
                </Stack>
                {(row.hub_items || []).map((item) => (
                  <Stack
                    key={`${item.hub_db_id}|${item.inv_no}`}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    sx={{ pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}
                  >
                    <Typography variant="body2">
                      {item.employee_name || 'не назначен'} · инв. {item.inv_no}
                      {item.model_name ? ` · ${item.model_name}` : ''}
                    </Typography>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => openWorkbench(item)}
                      sx={{ textTransform: 'none' }}
                    >
                      Разобрать
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )) : (
            <Typography variant="body2" color="text.secondary">
              {hubOverMeta?.status === 'ok'
                ? 'Расхождений Hub>1С не найдено.'
                : 'На этой неполной странице расхождений не найдено.'}
            </Typography>
          )}
          {hubOverMeta?.hasMore && hubOverMeta?.nextCursor ? (
            <Box>
              <Button
                size="small"
                variant="outlined"
                disabled={hubOverLoadingMore}
                onClick={() => { void loadMoreHubOver(); }}
                sx={{ textTransform: 'none' }}
              >
                {hubOverLoadingMore ? 'Загрузка…' : 'Показать следующую страницу'}
              </Button>
            </Box>
          ) : null}
        </Stack>
      ) : null}

      <ReconcileItemDialog
        open={Boolean(workItem)}
        item={workItem}
        onClose={() => setWorkItem(null)}
        onChanged={bump}
        onOpenInvNo={onOpenInvNo}
        canWriteReconcile={canWriteReconcile}
      />
    </Box>
  );
}
