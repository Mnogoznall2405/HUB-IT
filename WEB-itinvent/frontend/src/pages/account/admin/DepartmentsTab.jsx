import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import { departmentsAPI } from '../../../api/departments';
import { buildOfficeUiTokens, getOfficePanelSx } from '../../../theme/officeUiTokens';

export default function DepartmentsTab({ canManageDepartments }) {

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [departments, setDepartments] = useState([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [memberships, setMemberships] = useState([]);
  const [draftManagerIds, setDraftManagerIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await departmentsAPI.list();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setDepartments(items);
      setSelectedDepartmentId((current) => (items.some((item) => String(item.id) === String(current)) ? current : (items[0]?.id || '')));
    } catch (loadError) {
      console.error(loadError);
      setError('Не удалось загрузить отделы.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (departmentId) => {
    const normalizedId = String(departmentId || '').trim();
    if (!normalizedId) {
      setMemberships([]);
      setDraftManagerIds([]);
      return;
    }
    setMembersLoading(true);
    setError('');
    try {
      const payload = await departmentsAPI.getMembers(normalizedId);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setMemberships(items);
      setDraftManagerIds(items
        .filter((item) => String(item?.role || '') === 'manager' && item?.is_active !== false)
        .map((item) => Number(item?.user_id || 0))
        .filter((item) => Number.isInteger(item) && item > 0));
    } catch (loadError) {
      console.error(loadError);
      setError('Не удалось загрузить участников отдела.');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDepartments();
  }, [loadDepartments]);

  useEffect(() => {
    void loadMembers(selectedDepartmentId);
  }, [loadMembers, selectedDepartmentId]);

  const memberRows = useMemo(() => {
    const byId = new Map();
    memberships.forEach((membership) => {
      const userId = Number(membership?.user_id || 0);
      if (!Number.isInteger(userId) || userId <= 0) return;
      const current = byId.get(userId) || {
        user_id: userId,
        user: membership?.user || null,
        roles: new Set(),
      };
      if (membership?.user && !current.user) current.user = membership.user;
      if (membership?.is_active !== false) current.roles.add(String(membership?.role || 'member'));
      byId.set(userId, current);
    });
    return Array.from(byId.values())
      .map((item) => ({
        ...item,
        roles: Array.from(item.roles),
        is_manager: draftManagerIds.includes(item.user_id),
      }))
      .sort((a, b) => String(a.user?.full_name || a.user?.username || '').localeCompare(String(b.user?.full_name || b.user?.username || ''), 'ru'));
  }, [draftManagerIds, memberships]);

  const selectedDepartment = useMemo(
    () => departments.find((item) => String(item.id) === String(selectedDepartmentId)) || null,
    [departments, selectedDepartmentId],
  );

  const toggleManager = useCallback((userId) => {
    const normalizedUserId = Number(userId || 0);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return;
    setDraftManagerIds((current) => (
      current.includes(normalizedUserId)
        ? current.filter((item) => item !== normalizedUserId)
        : [...current, normalizedUserId]
    ));
  }, []);

  const handleSaveManagers = useCallback(async () => {
    if (!selectedDepartmentId || !canManageDepartments) return;
    setSaving(true);
    setError('');
    try {
      await departmentsAPI.setManagers(selectedDepartmentId, draftManagerIds);
      await Promise.all([loadDepartments(), loadMembers(selectedDepartmentId)]);
    } catch (saveError) {
      console.error(saveError);
      setError('Не удалось сохранить начальников отдела.');
    } finally {
      setSaving(false);
    }
  }, [canManageDepartments, draftManagerIds, loadDepartments, loadMembers, selectedDepartmentId]);

  const handleSyncDepartments = useCallback(async () => {
    if (!canManageDepartments) return;
    setSaving(true);
    setError('');
    try {
      const payload = await departmentsAPI.syncFromAD();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setDepartments(items);
      setSelectedDepartmentId((current) => (items.some((item) => String(item.id) === String(current)) ? current : (items[0]?.id || '')));
    } catch (syncError) {
      console.error(syncError);
      setError('Не удалось синхронизировать отделы из AD.');
    } finally {
      setSaving(false);
    }
  }, [canManageDepartments]);

  return (
    <Box sx={{ overflowY: { xs: 'visible', md: 'auto' }, minHeight: 0, pr: { md: 0.5 } }}>
      <Stack spacing={1.2}>
        {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}
        <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 1.4 }) }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
            <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 320 } }}>
              <InputLabel id="departments-select-label">Отдел</InputLabel>
              <Select
                labelId="departments-select-label"
                label="Отдел"
                value={selectedDepartmentId}
                onChange={(event) => setSelectedDepartmentId(String(event.target.value || ''))}
                disabled={loading || departments.length === 0}
              >
                {departments.map((department) => (
                  <MenuItem key={department.id} value={department.id}>
                    {department.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} onClick={() => void loadDepartments()} disabled={loading || saving}>
                Обновить
              </Button>
              {canManageDepartments ? (
                <Button variant="outlined" startIcon={<SyncOutlinedIcon />} onClick={() => void handleSyncDepartments()} disabled={loading || saving}>
                  Синхронизировать из AD
                </Button>
              ) : null}
              {canManageDepartments ? (
                <Button variant="contained" startIcon={<SaveOutlinedIcon />} onClick={() => void handleSaveManagers()} disabled={saving || !selectedDepartmentId}>
                  Сохранить начальников
                </Button>
              ) : null}
            </Stack>
          </Stack>
          {selectedDepartment ? (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.2 }}>
              <Chip label={`Участников: ${selectedDepartment.members_count || 0}`} size="small" />
              <Chip label={`Начальников: ${selectedDepartment.managers_count || 0}`} size="small" />
              <Chip label={selectedDepartment.source || 'manual'} size="small" variant="outlined" />
            </Stack>
          ) : null}
        </Paper>

        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: { md: 520 } }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Пользователь</TableCell>
                  <TableCell>Логин</TableCell>
                  <TableCell>Должность</TableCell>
                  <TableCell>Роли отдела</TableCell>
                  <TableCell align="right">Начальник</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {membersLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center' }}>
                      <CircularProgress size={24} />
                    </TableCell>
                  </TableRow>
                ) : memberRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      У отдела пока нет участников из AD.department.
                    </TableCell>
                  </TableRow>
                ) : (
                  memberRows.map((row) => (
                    <TableRow key={row.user_id} hover>
                      <TableCell>{row.user?.full_name || row.user?.username || `#${row.user_id}`}</TableCell>
                      <TableCell>{row.user?.username || '-'}</TableCell>
                      <TableCell>{row.user?.job_title || '-'}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {row.roles.map((role) => <Chip key={role} size="small" variant="outlined" label={role === 'manager' ? 'начальник' : 'участник'} />)}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Checkbox
                          checked={row.is_manager}
                          disabled={!canManageDepartments || saving}
                          onChange={() => toggleManager(row.user_id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Stack>
    </Box>
  );
}
