import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
} from '@mui/material';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SectionCard from '../shared/SectionCard';

export function PasswordVaultGroupsSettingsCard({
  groups,
  loading,
  saving,
  onRefresh,
  onCreate,
  onUpdate,
  onArchive,
}) {
  const [newGroupName, setNewGroupName] = useState('');

  return (
    <SectionCard
      title="Группы хранилища паролей"
      description="Админ задаёт централизованный список групп для страницы Пароли."
      action={(
        <Button size="small" startIcon={<RefreshOutlinedIcon />} onClick={onRefresh} disabled={loading || saving}>
          Обновить
        </Button>
      )}
      sx={{ flexShrink: 0 }}
      contentSx={{ p: 1.1 }}
    >
      <Stack spacing={1.1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            size="small"
            label="Новая группа"
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            fullWidth
          />
          <Button
            variant="contained"
            disabled={saving || !String(newGroupName || '').trim()}
            onClick={async () => {
              const ok = await onCreate({ name: String(newGroupName || '').trim(), sort_order: groups.length });
              if (ok) setNewGroupName('');
            }}
          >
            Добавить
          </Button>
        </Stack>
        {!groups.length && !loading ? (
          <Alert severity="warning">
            Список групп пуст. Пользователи не смогут создать запись пароля, пока админ не добавит хотя бы одну группу.
          </Alert>
        ) : null}
        <Stack spacing={0.8}>
          {groups.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 1 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                <TextField
                  size="small"
                  label="Название"
                  value={item.name}
                  onChange={(event) => onUpdate(item.id, { name: event.target.value, sort_order: Number(item.sort_order || 0) }, { autosave: true })}
                  fullWidth
                  disabled={saving || !item.is_active}
                />
                <TextField
                  size="small"
                  label="Порядок"
                  type="number"
                  value={Number(item.sort_order || 0)}
                  onChange={(event) => onUpdate(item.id, { name: item.name, sort_order: Math.max(0, Number(event.target.value || 0)) }, { autosave: true })}
                  sx={{ width: { xs: '100%', md: 120 } }}
                  disabled={saving || !item.is_active}
                />
                <Chip
                  size="small"
                  color={item.is_active ? 'success' : 'default'}
                  label={item.is_active ? 'Активна' : 'Архив'}
                  variant={item.is_active ? 'filled' : 'outlined'}
                />
                {item.is_active ? (
                  <>
                    <Button
                      size="small"
                      onClick={() => onUpdate(item.id, { name: item.name, sort_order: Math.max(0, Number(item.sort_order || 0)) })}
                      disabled={saving || !String(item.name || '').trim()}
                    >
                      Сохранить
                    </Button>
                    <Button size="small" color="warning" onClick={() => onArchive(item)} disabled={saving}>
                      Архив
                    </Button>
                  </>
                ) : null}
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </SectionCard>
  );
}
