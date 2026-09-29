import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

import equipmentDbTransferAPI from '../../api/equipmentDbTransfer';
import equipmentTransferActsAPI from '../../api/equipmentTransferActs';
import hubTaskSupportAPI from '../../api/hubTaskSupport';

const noop = () => {};

const fmtInv = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? String(n) : String(value ?? '');
};

const toOwnerOption = (row) => ({
  owner_no: row?.OWNER_NO ?? row?.owner_no ?? null,
  label: String(row?.OWNER_DISPLAY_NAME ?? row?.owner_display_name ?? '').trim(),
  dept: String(row?.OWNER_DEPT ?? row?.owner_dept ?? '').trim(),
});

// Dialog that moves selected equipment into another ITINVENT database. The
// employee/branch/location pickers are populated from the *target* database,
// not the current one.
const DatabaseDbTransferDialog = memo(function DatabaseDbTransferDialog({
  open = false,
  onClose = noop,
  onSubmit = noop,
  running = false,
  result = null,
  error = '',
  items = [],
  databases = [],
  currentDb = '',
  onDataChanged = noop,
}) {
  const [targetDb, setTargetDb] = useState('');
  const [ownerOption, setOwnerOption] = useState(null);
  const [ownerInput, setOwnerInput] = useState('');
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [branchNo, setBranchNo] = useState('');
  const [locNo, setLocNo] = useState('');
  const [branchOptions, setBranchOptions] = useState([]);
  const [locationOptions, setLocationOptions] = useState([]);
  const [assignee, setAssignee] = useState(null);
  const [assigneeInput, setAssigneeInput] = useState('');
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [dueAt, setDueAt] = useState('');
  const [comment, setComment] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const ownerSeqRef = useRef(0);
  const assigneeSeqRef = useRef(0);

  const currentDbId = useMemo(
    () => (typeof currentDb === 'string' ? currentDb : String(currentDb?.id || '')),
    [currentDb],
  );

  const targetDatabases = useMemo(
    () => (Array.isArray(databases) ? databases : []).filter((db) => String(db?.id || '') !== currentDbId),
    [databases, currentDbId],
  );

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTargetDb(String(targetDatabases[0]?.id || ''));
    setOwnerOption(null);
    setOwnerInput('');
    setOwnerOptions([]);
    setBranchNo('');
    setLocNo('');
    setBranchOptions([]);
    setLocationOptions([]);
    setAssignee(null);
    setAssigneeInput('');
    setDueAt('');
    setComment('');
    setEmailTo('');
    setEmailStatus('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Target-DB dictionaries reload when the destination database changes.
  useEffect(() => {
    if (!open || !targetDb) return;
    let cancelled = false;
    equipmentDbTransferAPI.getTargetBranches(targetDb)
      .then((rows) => { if (!cancelled) setBranchOptions(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setBranchOptions([]); });
    equipmentDbTransferAPI.getTargetLocations(targetDb, branchNo || undefined)
      .then((rows) => { if (!cancelled) setLocationOptions(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setLocationOptions([]); });
    return () => { cancelled = true; };
  }, [open, targetDb, branchNo]);

  const loadOwnerOptions = useCallback((query) => {
    if (!targetDb) return;
    const seq = ++ownerSeqRef.current;
    setOwnerLoading(true);
    equipmentDbTransferAPI.searchTargetOwners(targetDb, query || '', 30)
      .then((payload) => {
        if (ownerSeqRef.current !== seq) return;
        const owners = Array.isArray(payload?.owners) ? payload.owners : [];
        setOwnerOptions(owners.map(toOwnerOption).filter((o) => o.label));
      })
      .catch(() => { if (ownerSeqRef.current === seq) setOwnerOptions([]); })
      .finally(() => { if (ownerSeqRef.current === seq) setOwnerLoading(false); });
  }, [targetDb]);

  const loadAssignees = useCallback((query) => {
    const seq = ++assigneeSeqRef.current;
    hubTaskSupportAPI.getAssignees({ q: query || '', limit: 30 })
      .then((payload) => {
        if (assigneeSeqRef.current !== seq) return;
        setAssigneeOptions(Array.isArray(payload?.items) ? payload.items : []);
      })
      .catch(() => { if (assigneeSeqRef.current === seq) setAssigneeOptions([]); });
  }, []);

  useEffect(() => {
    if (!open) return;
    loadAssignees('');
  }, [open, loadAssignees]);

  const filteredLocations = locationOptions;

  const itemRows = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const canSubmit = Boolean(
    targetDb
    && (ownerOption?.owner_no || ownerInput.trim().length >= 2)
    && !running
    && !result,
  );

  const handleSubmit = useCallback(() => {
    const invNos = itemRows
      .map((item) => String(item?.inv_no ?? item?.INV_NO ?? '').trim())
      .filter(Boolean);
    if (!invNos.length || !targetDb) return;
    void onSubmit({
      invNos,
      targetDb,
      targetOwnerNo: ownerOption?.owner_no ?? null,
      newOwnerName: ownerOption?.owner_no ? null : ownerInput.trim(),
      targetBranchNo: branchNo !== '' ? Number(branchNo) : null,
      targetLocNo: locNo !== '' ? Number(locNo) : null,
      taskAssigneeUserIds: assignee?.id ? [Number(assignee.id)] : null,
      taskDueAt: dueAt || null,
      comment: comment.trim() || null,
    });
  }, [itemRows, targetDb, ownerOption, ownerInput, branchNo, locNo, assignee, dueAt, comment, onSubmit]);

  const handleDownloadAct = useCallback(async (act) => {
    try {
      const response = await equipmentTransferActsAPI.downloadTransferAct(act.act_id);
      const blob = new Blob([response.data], {
        type: response.headers?.['content-type'] || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = act.file_name || `transfer_act_${act.act_id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error downloading transfer act:', e);
    }
  }, []);

  const handleSendEmail = useCallback(async () => {
    const actIds = (result?.acts || []).map((a) => a.act_id).filter(Boolean);
    if (!actIds.length || !emailTo.trim()) return;
    setEmailStatus('sending');
    try {
      await equipmentTransferActsAPI.sendTransferActsEmail({
        act_ids: actIds,
        mode: 'manual',
        manual_email: emailTo.trim(),
      });
      setEmailStatus('sent');
    } catch (e) {
      console.error('Error sending transfer acts:', e);
      setEmailStatus('error');
    }
  }, [result, emailTo]);

  const resultItems = Array.isArray(result?.items) ? result.items : [];
  const resultActs = Array.isArray(result?.acts) ? result.acts : [];

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Перенести в другую базу</DialogTitle>
      <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        <Typography variant="body2" color="text.secondary">
          Предметы будут перенесены из базы <strong>{currentDbId}</strong> в целевую базу с новым
          инвентарным номером, историей перемещений и актом оприходования. В исходной базе записи удаляются.
        </Typography>

        {itemRows.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {itemRows.slice(0, 12).map((item) => {
              const inv = String(item?.inv_no ?? item?.INV_NO ?? '');
              const model = String(item?.model_name ?? item?.MODEL_NAME ?? '');
              return <Chip key={inv} size="small" label={model ? `${inv} — ${model}` : inv} />;
            })}
            {itemRows.length > 12 && (
              <Chip size="small" variant="outlined" label={`+${itemRows.length - 12}`} />
            )}
          </Box>
        )}

        {!result && (
          <>
            <TextField
              select
              label="Целевая база"
              value={targetDb}
              onChange={(e) => setTargetDb(e.target.value)}
              size="small"
              fullWidth
            >
              {targetDatabases.map((db) => (
                <MenuItem key={db.id} value={db.id}>
                  {typeof db?.name === 'string' && db.name ? db.name : String(db?.id || '')}
                </MenuItem>
              ))}
            </TextField>

            <Autocomplete
              size="small"
              freeSolo
              loading={ownerLoading}
              options={ownerOptions}
              value={ownerOption}
              inputValue={ownerInput}
              getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.label)}
              isOptionEqualToValue={(opt, val) => opt?.owner_no === val?.owner_no}
              onOpen={() => loadOwnerOptions('')}
              onInputChange={(_, value, reason) => {
                setOwnerInput(value);
                if (reason === 'input' || reason === 'clear') loadOwnerOptions(value);
                if (reason !== 'select') setOwnerOption(null);
              }}
              onChange={(_, value) => {
                if (value && typeof value === 'object') {
                  setOwnerOption(value);
                  setOwnerInput(value.label);
                } else {
                  setOwnerOption(null);
                }
              }}
              renderOption={(props, opt) => (
                <li {...props} key={opt.owner_no ?? opt.label}>
                  <Box>
                    <Typography variant="body2">{opt.label}</Typography>
                    {opt.dept ? <Typography variant="caption" color="text.secondary">{opt.dept}</Typography> : null}
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Сотрудник в целевой базе"
                  helperText="Выберите из списка или введите ФИО — сотрудник будет создан в целевой базе"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {ownerLoading ? <CircularProgress size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField
                select
                label="Филиал"
                value={branchNo}
                onChange={(e) => { setBranchNo(e.target.value); setLocNo(''); }}
                size="small"
                fullWidth
              >
                <MenuItem value=""><em>Как в источнике</em></MenuItem>
                {branchOptions.map((b) => (
                  <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Локация"
                value={locNo}
                onChange={(e) => setLocNo(e.target.value)}
                size="small"
                fullWidth
              >
                <MenuItem value=""><em>Как в источнике</em></MenuItem>
                {filteredLocations.map((l) => (
                  <MenuItem key={l.loc_no} value={l.loc_no}>{l.loc_name}</MenuItem>
                ))}
              </TextField>
            </Box>

            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">Задача на приёмку</Typography>
            </Divider>

            <Autocomplete
              size="small"
              options={assigneeOptions}
              value={assignee}
              inputValue={assigneeInput}
              getOptionLabel={(opt) => String(opt?.full_name || opt?.username || opt?.name || '')}
              isOptionEqualToValue={(opt, val) => opt?.id === val?.id}
              onInputChange={(_, value) => {
                setAssigneeInput(value);
                loadAssignees(value);
              }}
              onChange={(_, value) => setAssignee(value)}
              renderInput={(params) => (
                <TextField {...params} label="Исполнитель задачи" helperText="Задача «принять технику» в HUB" />
              )}
            />

            <TextField
              label="Срок задачи"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ width: 180 }}
            />

            <TextField
              label="Комментарий"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              size="small"
              multiline
              minRows={2}
              fullWidth
            />
          </>
        )}

        {result && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Alert severity={result?.summary?.failed ? 'warning' : 'success'}>
              Перенос завершён: {result?.summary?.ok ?? 0} из {result?.summary?.total ?? itemRows.length}.
              {result?.act_doc_no ? ` Акт оприходования № ${result.act_doc_no} в базе ${result.target_db}.` : ''}
            </Alert>

            {resultItems.map((item) => (
              <Box key={item.inv_no ?? item.old_item_id} sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  инв. {fmtInv(item.inv_no_old ?? item.inv_no)}
                  {item.inv_no_new ? ` → ${fmtInv(item.inv_no_new)}` : ''}
                </Typography>
                <Typography
                  variant="caption"
                  color={item.status === 'ok' ? 'success.main' : item.status === 'partial' ? 'warning.main' : 'error.main'}
                >
                  {item.status === 'ok' ? 'перенесено' : item.status === 'partial' ? 'частично' : `ошибка: ${item.message || ''}`}
                </Typography>
              </Box>
            ))}

            {Array.isArray(result?.created_refs) && result.created_refs.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">Создано в целевой базе:</Typography>
                {result.created_refs.map((line, idx) => (
                  <Typography key={idx} variant="caption" display="block">• {line}</Typography>
                ))}
              </Box>
            )}

            {resultActs.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {resultActs.map((act) => (
                  <Button
                    key={act.act_id}
                    size="small"
                    variant="outlined"
                    onClick={() => void handleDownloadAct(act)}
                    sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
                  >
                    Скачать акт ({act.file_name || act.act_id})
                  </Button>
                ))}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    label="Отправить акт на email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={!emailTo.trim() || emailStatus === 'sending'}
                    onClick={() => void handleSendEmail()}
                  >
                    {emailStatus === 'sending' ? 'Отправка…' : 'Отправить'}
                  </Button>
                </Box>
                {emailStatus === 'sent' && <Alert severity="success">Акт отправлен.</Alert>}
                {emailStatus === 'error' && <Alert severity="error">Не удалось отправить акт.</Alert>}
              </Box>
            )}

            {result?.task?.id && (
              <Typography variant="body2">
                Задача на приёмку создана: #{String(result.task.id).slice(0, 8)}
              </Typography>
            )}
            {result?.task_error && (
              <Alert severity="warning">Задача не создана: {result.task_error}</Alert>
            )}
            {result?.act_error && (
              <Alert severity="warning">Акт в целевой базе не создан: {result.act_error}</Alert>
            )}
            {result?.acts_error && (
              <Alert severity="warning">Файл акта не сгенерирован: {result.acts_error}</Alert>
            )}
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: 'flex-end', gap: 1 }}>
        <Button variant="outlined" onClick={onClose} disabled={running}>
          Закрыть
        </Button>
        {!result && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={!canSubmit}
            startIcon={running ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {running ? 'Перенос...' : 'Перенести'}
          </Button>
        )}
        {result && (
          <Button
            variant="contained"
            onClick={() => { onDataChanged(); onClose(); }}
          >
            Готово
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

export default DatabaseDbTransferDialog;
