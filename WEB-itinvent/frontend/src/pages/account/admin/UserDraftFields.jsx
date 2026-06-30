import { useCallback, useMemo } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import { SETTINGS_PERMISSION_GROUPS, roleOptions } from '../accountConstants';
import {
  buildDefaultExchangeLoginPreview,
  formatDateTime,
  normalizePermissions,
  normalizeTaskDelegateLinks,
} from '../accountUserModel';
import SectionCard from '../shared/SectionCard';

export default function UserDraftFields({ draft, onChange, dbOptions, linkedSessions, users }) {

  const togglePermission = useCallback((permission) => {
    const current = normalizePermissions(draft.custom_permissions);
    if (current.includes(permission)) {
      onChange('custom_permissions', current.filter((item) => item !== permission));
      return;
    }
    onChange('custom_permissions', [...current, permission]);
  }, [draft.custom_permissions, onChange]);

  const delegateOptions = useMemo(
    () => (Array.isArray(users) ? users : []).filter((item) => Number(item.id) !== Number(draft.id) && item.is_active),
    [draft.id, users],
  );

  const delegateLinks = normalizeTaskDelegateLinks(draft.task_delegate_links);

  const updateDelegateLinks = useCallback((nextValue) => {
    onChange('task_delegate_links', normalizeTaskDelegateLinks(nextValue));
  }, [onChange]);

  const addDelegateLink = useCallback(() => {
    const firstAvailable = delegateOptions.find((item) => !delegateLinks.some((link) => Number(link.delegate_user_id) === Number(item.id)));
    if (!firstAvailable) return;
    updateDelegateLinks([
      ...delegateLinks,
      {
        delegate_user_id: String(firstAvailable.id),
        role_type: 'assistant',
        is_active: true,
        delegate_username: firstAvailable.username || '',
        delegate_full_name: firstAvailable.full_name || '',
      },
    ]);
  }, [delegateLinks, delegateOptions, updateDelegateLinks]);

  return (
    <Stack spacing={2}>
      <SectionCard title="Профиль" description="Базовые данные пользователя и история изменений.">
        <Grid container spacing={1.5}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Логин"
              value={draft.username}
              onChange={(event) => onChange('username', event.target.value)}
              disabled={Boolean(draft.id)}
            />
          </Grid>
          {!draft.id && draft.auth_source !== 'ldap' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label="Пароль"
                helperText="Для локального пользователя нужен пароль не короче 6 символов."
                value={draft.password}
                onChange={(event) => onChange('password', event.target.value)}
              />
            </Grid>
          ) : null}
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="ФИО" value={draft.full_name} onChange={(event) => onChange('full_name', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Email" value={draft.email} onChange={(event) => onChange('email', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Должность" value={draft.job_title} onChange={(event) => onChange('job_title', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Отдел" value={draft.department} onChange={(event) => onChange('department', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Telegram ID" value={draft.telegram_id} onChange={(event) => onChange('telegram_id', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary">Создан / обновлён</Typography>
              <Typography variant="body2" sx={{ mt: 0.4 }}>{formatDateTime(draft.created_at)}</Typography>
              <Typography variant="body2" sx={{ mt: 0.35 }}>{formatDateTime(draft.updated_at)}</Typography>
            </Paper>
          </Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="Доступ" description="Источник входа, роль, ограничения базы и права доступа.">
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Источник</InputLabel>
              <Select label="Источник" value={draft.auth_source} onChange={(event) => onChange('auth_source', event.target.value)}>
                <MenuItem value="local">Локальная</MenuItem>
                <MenuItem value="ldap">AD / LDAP</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Роль</InputLabel>
              <Select label="Роль" value={draft.role} onChange={(event) => onChange('role', event.target.value)}>
                {roleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Назначенная БД</InputLabel>
              <Select label="Назначенная БД" value={draft.assigned_database || ''} onChange={(event) => onChange('assigned_database', event.target.value)}>
                <MenuItem value="">Не ограничивать</MenuItem>
                {dbOptions.map((db) => (
                  <MenuItem key={db.id} value={db.id}>{db.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel control={<Switch checked={Boolean(draft.is_active)} onChange={(event) => onChange('is_active', event.target.checked)} />} label="Учётная запись активна" />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel control={<Switch checked={Boolean(draft.use_custom_permissions)} onChange={(event) => onChange('use_custom_permissions', event.target.checked)} />} label="Индивидуальные права" />
          </Grid>
        </Grid>

        {Boolean(draft.use_custom_permissions) ? (
          <Box sx={{ mt: 1.5 }}>
            {SETTINGS_PERMISSION_GROUPS.map((group) => (
              <Accordion key={group.group} disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{group.group}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <FormGroup>
                    {group.permissions.map((permission) => {
                      const checked = normalizePermissions(draft.custom_permissions).includes(permission.value);
                      return (
                        <FormControlLabel
                          key={permission.value}
                          control={<Checkbox size="small" checked={checked} onChange={() => togglePermission(permission.value)} />}
                          label={permission.label}
                        />
                      );
                    })}
                  </FormGroup>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        ) : null}
      </SectionCard>

      <SectionCard title="Почта" description="Параметры Exchange и источник почтового профиля.">
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Почта Exchange" value={draft.mailbox_email} onChange={(event) => onChange('mailbox_email', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              size="small"
              label="Логин Exchange"
              placeholder={buildDefaultExchangeLoginPreview(draft.username)}
              value={draft.mailbox_login}
              onChange={(event) => onChange('mailbox_login', event.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <Alert severity="info" sx={{ borderRadius: '10px' }}>
              Пароль корпоративной почты больше не хранится и не меняется в настройках. Пользователь вводит его только на странице <strong>Почта</strong> при первом входе или после смены пароля в AD.
            </Alert>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" color="text.secondary">
              Почта обновлена: {formatDateTime(draft.mail_updated_at)}
            </Typography>
          </Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="Помощники и замы" description="Получают уведомления по задачам и доступ на чтение карточек исполнителя.">
        {!draft.id ? (
          <Typography variant="body2" color="text.secondary">
            Сначала создайте пользователя, затем назначьте помощников и замов.
          </Typography>
        ) : (
          <Stack spacing={1.1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Активные связи используются для уведомлений и доступа к чужим задачам на чтение.
              </Typography>
              <Button variant="outlined" size="small" onClick={addDelegateLink} disabled={delegateOptions.length === 0} sx={{ alignSelf: 'flex-start' }}>
                Добавить связь
              </Button>
            </Stack>

            {delegateLinks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Помощники и замы не назначены.
              </Typography>
            ) : delegateLinks.map((item, index) => (
              <Paper key={`${item.delegate_user_id}-${index}`} variant="outlined" sx={{ p: 1.1, borderRadius: 2 }}>
                <Grid container spacing={1.1} alignItems="center">
                  <Grid item xs={12} md={5}>
                    <FormControl fullWidth size="small">
                      <InputLabel id={`delegate-user-${index}`}>Пользователь</InputLabel>
                      <Select
                        labelId={`delegate-user-${index}`}
                        label="Пользователь"
                        value={String(item.delegate_user_id || '')}
                        onChange={(event) => {
                          const nextValue = String(event.target.value || '');
                          const nextUser = delegateOptions.find((userItem) => String(userItem.id) === nextValue);
                          updateDelegateLinks(delegateLinks.map((row, rowIndex) => (
                            rowIndex === index
                              ? {
                                  ...row,
                                  delegate_user_id: nextValue,
                                  delegate_username: nextUser?.username || '',
                                  delegate_full_name: nextUser?.full_name || '',
                                }
                              : row
                          )));
                        }}
                      >
                        {delegateOptions.map((userItem) => (
                          <MenuItem key={userItem.id} value={String(userItem.id)}>
                            {userItem.full_name || userItem.username}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel id={`delegate-role-${index}`}>Роль</InputLabel>
                      <Select
                        labelId={`delegate-role-${index}`}
                        label="Роль"
                        value={item.role_type}
                        onChange={(event) => {
                          updateDelegateLinks(delegateLinks.map((row, rowIndex) => (
                            rowIndex === index ? { ...row, role_type: event.target.value } : row
                          )));
                        }}
                      >
                        <MenuItem value="assistant">Помощник</MenuItem>
                        <MenuItem value="deputy">Зам</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={item.is_active !== false}
                          onChange={(event) => {
                            updateDelegateLinks(delegateLinks.map((row, rowIndex) => (
                              rowIndex === index ? { ...row, is_active: event.target.checked } : row
                            )));
                          }}
                        />
                      )}
                      label="Активна"
                    />
                  </Grid>
                  <Grid item xs={12} md={2} sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                    <Button
                      color="error"
                      variant="text"
                      onClick={() => updateDelegateLinks(delegateLinks.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      Удалить
                    </Button>
                  </Grid>
                </Grid>
              </Paper>
            ))}
          </Stack>
        )}
      </SectionCard>

      <SectionCard title="Статус и сессии" description="Связанные активные сессии пользователя.">
        {linkedSessions.length > 0 ? (
          <Stack spacing={1}>
            {linkedSessions.map((session) => (
              <Paper key={session.session_id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                      {session.device_label || 'Устройство'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {session.ip_address || 'IP неизвестен'} • {formatDateTime(session.last_seen_at)}
                    </Typography>
                  </Box>
                  <Chip size="small" color="success" label="Активна" />
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">Активных сессий нет.</Typography>
        )}
      </SectionCard>
    </Stack>
  );
}
