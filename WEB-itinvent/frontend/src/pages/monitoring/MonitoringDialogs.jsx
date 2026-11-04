import { useEffect, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { itObjectsAPI } from '../../api/itObjects';
import { monitoringAPI } from '../../api/monitoring';
import { errorMessage } from './monitoringFormat';

const grid = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 };
const deviceDefaults = { failure_polls: 3, icmp_timeout_ms: 800, cpu_warn: 85, memory_warn: 90, temperature_warn: 75, latency_warn_ms: 150, loss_warn_pct: 20 };

function ProfileDialog({ open, profile, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [community, setCommunity] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setName(profile?.name || ''); setCommunity(''); setError(''); } }, [open, profile]);
  const submit = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim()) { setError('Укажите название профиля.'); return; }
    setSaving(true); setError('');
    try {
      const saved = await monitoringAPI.saveProfile({ name: name.trim(), ...(community ? { community } : {}) }, profile?.id);
      setCommunity(''); onSaved(saved); onClose();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth PaperProps={{ component: 'form', onSubmit: submit, sx: { borderRadius: '16px' } }}>
    <DialogTitle>{profile ? 'Профиль SNMP' : 'Новый профиль SNMP'}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <TextField autoFocus required label="Название профиля" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 120 }} fullWidth />
      <TextField required={!profile} label={profile ? 'Новое community' : 'Community'} type="password" autoComplete="new-password" value={community} onChange={(e) => setCommunity(e.target.value)} inputProps={{ maxLength: 128 }} helperText={profile ? 'Оставьте пустым, чтобы сохранить действующее значение.' : 'Ключ доступа на чтение, настроенный на оборудовании.'} fullWidth />
      <Typography variant="caption" color="text.secondary">SNMPv2c · Данные доступа хранятся на сервере в зашифрованном виде.</Typography>
    </Stack></DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} disabled={saving}>Отмена</Button><Button type="submit" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>Сохранить профиль</Button></DialogActions>
  </Dialog>;
}

export function MonitoringTargetDialog({ open, target, onClose, onSaved }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profileDialog, setProfileDialog] = useState({ open: false, profile: null });
  const [form, setForm] = useState({});
  const [objects, setObjects] = useState([]);
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    // Список объектов нужен только для привязки; без права «Объекты ИТ» поле просто остаётся пустым.
    itObjectsAPI.list().then((result) => { if (active) setObjects(result?.items || []); }).catch(() => {});
    setForm({ network_device_id: target?.network_device_id ?? null, object_ref: target?.object_ref ?? null, name: target?.name || '', address: target?.address || '', port: target?.port || 161, profile_id: target?.profile_id || '', enabled: target?.enabled ?? true, settings: { ...deviceDefaults, ...target?.settings } });
    setError(''); setLoading(true);
    monitoringAPI.profiles().then((profileList) => { if (active) setProfiles(profileList); }).catch((err) => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, target]);
  const field = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (!form.profile_id || !form.name?.trim() || !form.address?.trim()) { setError('Укажите название, IP для опроса и профиль SNMP.'); return; }
    setSaving(true);
    try {
      const saved = await monitoringAPI.saveTarget({ ...form, name: form.name.trim(), port: Number(form.port), settings: Object.fromEntries(Object.entries(form.settings).map(([k, v]) => [k, Number(v)])) }, target?.id);
      onSaved(saved); onClose();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return <>
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth PaperProps={{ component: 'form', onSubmit: submit, sx: { borderRadius: '16px' } }}>
      <DialogTitle>{target ? 'Настройки устройства' : 'Подключить устройство'}</DialogTitle>
      <DialogContent><Stack spacing={2.5} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {loading && <Alert severity="info" icon={<CircularProgress size={18} />}>Загрузка профилей…</Alert>}
        <TextField autoFocus={!target} label="Название в мониторинге" required value={form.name || ''} onChange={(e) => field('name', e.target.value)} inputProps={{ maxLength: 160 }} />
        {(objects.length > 0 || form.object_ref) && <TextField select label="Объект ИТ" value={form.object_ref || ''} onChange={(e) => field('object_ref', e.target.value || null)} helperText="Устройство появится на вкладке «Мониторинг» этого объекта"><MenuItem value="">Не привязано</MenuItem>{form.object_ref && !objects.some((item) => item.object_ref === form.object_ref) && <MenuItem value={form.object_ref}>{form.object_ref}</MenuItem>}{objects.map((item) => <MenuItem key={item.object_ref} value={item.object_ref}>{item.name}</MenuItem>)}</TextField>}
        <Box sx={grid}><TextField required label="IP для опроса" value={form.address || ''} onChange={(e) => field('address', e.target.value)} autoComplete="off" inputProps={{ maxLength: 45 }} /><TextField label="Порт SNMP" type="number" required value={form.port ?? 161} onChange={(e) => field('port', e.target.value)} inputProps={{ min: 1, max: 65535 }} /></Box>
        <Stack direction="row" alignItems="flex-start" gap={1.5} flexWrap="wrap">
          <TextField select label="Профиль SNMPv2c" required value={form.profile_id || ''} onChange={(e) => field('profile_id', e.target.value)} sx={{ minWidth: 180, flex: 1 }}>{profiles.map((profile) => <MenuItem key={profile.id} value={profile.id}>{profile.name}</MenuItem>)}</TextField>
          <Button startIcon={<AddRoundedIcon />} onClick={() => setProfileDialog({ open: true, profile: null })} sx={{ minHeight: 48 }}>Новый профиль</Button>
          {form.profile_id && <Button onClick={() => setProfileDialog({ open: true, profile: profiles.find((p) => p.id === form.profile_id) })} sx={{ minHeight: 48 }}>Изменить профиль</Button>}
        </Stack>
        <FormControlLabel control={<Switch checked={Boolean(form.enabled)} onChange={(e) => field('enabled', e.target.checked)} />} label="Собирать данные устройства" />
        <Accordion elevation={0} disableGutters sx={{ '&:before': { display: 'none' }, border: 1, borderColor: 'divider', borderRadius: '12px !important' }}>
          <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="body2" fontWeight={600}>Пороги устройства</Typography></AccordionSummary>
          <AccordionDetails><Box sx={grid}>{[['failure_polls', 'Неуспешных проверок подряд', 2, 10], ['latency_warn_ms', 'Задержка, мс', 1, 30000], ['icmp_timeout_ms', 'Ожидание ответа ping, мс', 200, 5000], ['loss_warn_pct', 'Потери ICMP, %', 1, 100], ['cpu_warn', 'CPU, %', 1, 100], ['memory_warn', 'Память, %', 1, 100], ['temperature_warn', 'Температура, °C', 1, 150]].map(([key, label, min, max]) => <TextField key={key} label={label} type="number" required value={form.settings?.[key] ?? deviceDefaults[key]} onChange={(e) => setForm((old) => ({ ...old, settings: { ...old.settings, [key]: e.target.value } }))} inputProps={{ min, max }} />)}</Box></AccordionDetails>
        </Accordion>
      </Stack></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} disabled={saving}>Отмена</Button><Button type="submit" variant="contained" disabled={saving || loading} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>{target ? 'Сохранить устройство' : 'Подключить'}</Button></DialogActions>
    </Dialog>
    <ProfileDialog open={profileDialog.open} profile={profileDialog.profile} onClose={() => setProfileDialog({ open: false, profile: null })} onSaved={(profile) => { setProfiles((old) => [...old.filter((p) => p.id !== profile.id), profile]); field('profile_id', profile.id); }} />
  </>;
}

export function MonitoringInterfaceDialog({ targetId, item, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!item) return;
    const settings = item.settings || {};
    setForm({ role: settings.role || 'lan', critical: Boolean(settings.critical), history_enabled: settings.history_enabled ?? true,
      expected_link_mbps: settings.expected_link_bps ? settings.expected_link_bps / 1e6 : '', capacity_rx_mbps: settings.capacity_rx_bps ? settings.capacity_rx_bps / 1e6 : '', capacity_tx_mbps: settings.capacity_tx_bps ? settings.capacity_tx_bps / 1e6 : '',
      utilization_warn: settings.utilization_warn ?? 85, errors_warn_pps: settings.errors_warn_pps ?? 2 });
    setError('');
  }, [item]);
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const bps = (value) => value === '' ? null : Number(value) * 1e6;
      const saved = await monitoringAPI.saveInterface(targetId, item.id, { role: form.role, critical: form.critical, history_enabled: form.history_enabled,
        expected_link_bps: bps(form.expected_link_mbps), capacity_rx_bps: bps(form.capacity_rx_mbps), capacity_tx_bps: bps(form.capacity_tx_mbps),
        utilization_warn: Number(form.utilization_warn), errors_warn_pps: Number(form.errors_warn_pps) });
      onSaved(saved); onClose();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  return <Dialog open={Boolean(item)} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth PaperProps={{ component: 'form', onSubmit: submit, sx: { borderRadius: '16px' } }}>
    <DialogTitle>Контроль интерфейса {item?.name}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <TextField autoFocus select label="Назначение" value={form.role || 'lan'} onChange={(e) => set('role', e.target.value)}>{[['lan', 'Локальная сеть'], ['wan', 'WAN / провайдер'], ['uplink', 'Между устройствами'], ['wifi', 'Wi-Fi'], ['vpn', 'VPN'], ['other', 'Другое']].map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
      <FormControlLabel control={<Switch checked={Boolean(form.critical)} onChange={(e) => set('critical', e.target.checked)} />} label="Важный интерфейс: сообщать о потере линка и снижении скорости" />
      <FormControlLabel control={<Switch checked={Boolean(form.history_enabled)} onChange={(e) => set('history_enabled', e.target.checked)} />} label="Сохранять историю трафика" />
      <TextField label="Ожидаемая скорость линка, Мбит/с" type="number" value={form.expected_link_mbps ?? ''} onChange={(e) => set('expected_link_mbps', e.target.value)} inputProps={{ min: 0.001, max: 10000000, step: 'any' }} helperText="Например, 1000 для гигабитного соединения. Пустое значение — сравнение с прежней скоростью." />
      <Typography variant="body2" fontWeight={600}>Ёмкость канала по договору</Typography>
      <Box sx={grid}>{[['capacity_rx_mbps', 'Приём, Мбит/с'], ['capacity_tx_mbps', 'Передача, Мбит/с']].map(([key, label]) => <TextField key={key} label={label} type="number" value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} inputProps={{ min: 0.001, max: 10000000, step: 'any' }} />)}</Box>
      <Typography variant="caption" color="text.secondary">Если ёмкость не задана, загрузка рассчитывается относительно скорости порта. Низкий трафик сам по себе не означает падение скорости интернета.</Typography>
      <Box sx={grid}><TextField required label="Порог загрузки, %" type="number" value={form.utilization_warn ?? 85} onChange={(e) => set('utilization_warn', e.target.value)} inputProps={{ min: 1, max: 100 }} /><TextField required label="Ошибки/отбрасывания, пакетов/с" type="number" value={form.errors_warn_pps ?? 2} onChange={(e) => set('errors_warn_pps', e.target.value)} inputProps={{ min: 0.001, step: 'any' }} /></Box>
    </Stack></DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} disabled={saving}>Отмена</Button><Button type="submit" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>Сохранить настройки порта</Button></DialogActions>
  </Dialog>;
}
