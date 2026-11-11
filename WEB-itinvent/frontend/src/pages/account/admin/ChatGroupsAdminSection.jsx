import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import { chatGroupAdminAPI } from '../../../api/chatGroupAdmin';
import { useConfirmDialog } from '../../../components/feedback/ConfirmDialogProvider';
import { useNotification } from '../../../contexts/NotificationContext';

const ROLE_LABELS = {
  owner: 'Владелец',
  moderator: 'Модератор',
  member: 'Участник',
};

const AUDIT_ACTION_LABELS = {
  assign_owner: 'Назначен владелец',
  remove_member: 'Исключён участник',
  auto_assign_owner: 'Владелец назначен автоматически',
};

const formatDateTime = (value) => {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleString('ru-RU');
};

function GroupStructurePanel({ structure, audit, busy, onAssignOwner, onRemoveMember }) {
  const members = Array.isArray(structure?.members) ? structure.members : [];
  const nameById = new Map(members.map((member) => [Number(member.user_id), member.full_name]));
  return (
    <Stack spacing={1.25} sx={{ mt: 1.25 }}>
      <Typography variant="body2" color="text.secondary">
        Участники: {Number(structure?.member_count || members.length)}.
        {structure?.owner_active ? '' : ' Активного владельца нет.'}
      </Typography>
      <Stack divider={<Divider flexItem />} spacing={0.75}>
        {members.map((member) => {
          const isOwner = member.member_role === 'owner';
          return (
            <Stack
              key={member.user_id}
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="space-between"
              data-testid={`chat-group-admin-member-${member.user_id}`}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>{member.full_name}</Typography>
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.25 }}>
                  <Chip size="small" label={ROLE_LABELS[member.member_role] || member.member_role} />
                  {member.is_active ? null : <Chip size="small" color="warning" label="Отключён" />}
                </Stack>
              </Box>
              <Stack direction="row" spacing={0.75}>
                {!isOwner && member.is_active ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => onAssignOwner(member)}
                  >
                    Назначить владельцем
                  </Button>
                ) : null}
                {!isOwner ? (
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => onRemoveMember(member)}
                  >
                    Исключить
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          );
        })}
      </Stack>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Журнал действий администраторов</Typography>
        {audit.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Записей пока нет.</Typography>
        ) : (
          <Stack spacing={0.5}>
            {audit.map((item) => (
              <Typography key={item.id} variant="body2" color="text.secondary">
                {formatDateTime(item.created_at)} — {AUDIT_ACTION_LABELS[item.action] || item.action}
                {item.target_user_id ? `: ${nameById.get(Number(item.target_user_id)) || `№${item.target_user_id}`}` : ''}
              </Typography>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

export function ChatGroupsAdminSection() {
  const { confirm } = useConfirmDialog();
  const { notifyApiError, notifySuccess } = useNotification();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [structure, setStructure] = useState(null);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [autoPlan, setAutoPlan] = useState(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await chatGroupAdminAPI.listOwnerlessGroups({ limit: 100 });
      setGroups(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      setLoadError('Не удалось загрузить список бесед.');
      notifyApiError?.(error, 'Не удалось загрузить список бесед.');
    } finally {
      setLoading(false);
    }
  }, [notifyApiError]);

  const loadDetails = useCallback(async (conversationId) => {
    setBusy(true);
    try {
      const [structureData, auditData] = await Promise.all([
        chatGroupAdminAPI.getGroupStructure(conversationId),
        chatGroupAdminAPI.listGroupAudit(conversationId, { limit: 20 }),
      ]);
      setStructure(structureData);
      setAudit(Array.isArray(auditData?.items) ? auditData.items : []);
    } catch (error) {
      notifyApiError?.(error, 'Не удалось загрузить состав беседы.');
    } finally {
      setBusy(false);
    }
  }, [notifyApiError]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const handleSelect = (conversationId) => {
    if (selectedId === conversationId) {
      setSelectedId('');
      setStructure(null);
      setAudit([]);
      return;
    }
    setSelectedId(conversationId);
    setStructure(null);
    setAudit([]);
    void loadDetails(conversationId);
  };

  const runAction = async (action, successMessage) => {
    setBusy(true);
    try {
      await action();
      notifySuccess?.(successMessage);
      await Promise.all([loadGroups(), loadDetails(selectedId)]);
    } catch (error) {
      notifyApiError?.(error, 'Не удалось выполнить действие.');
    } finally {
      setBusy(false);
    }
  };

  const handleAssignOwner = async (member) => {
    const confirmed = await confirm({
      title: `Назначить владельцем: ${member.full_name}?`,
      message: 'Прежние владельцы станут модераторами. В беседе появится сообщение о действии администратора.',
      confirmLabel: 'Назначить',
    });
    if (!confirmed) return;
    await runAction(
      () => chatGroupAdminAPI.assignGroupOwner(selectedId, member.user_id),
      'Владелец назначен.',
    );
  };

  const handleRemoveMember = async (member) => {
    const confirmed = await confirm({
      title: `Исключить ${member.full_name} из беседы?`,
      message: 'В беседе появится сообщение о действии администратора.',
      confirmLabel: 'Исключить',
      destructive: true,
    });
    if (!confirmed) return;
    await runAction(
      () => chatGroupAdminAPI.removeGroupMember(selectedId, member.user_id),
      'Участник исключён.',
    );
  };

  const handleAutoPreview = async () => {
    setBusy(true);
    try {
      setAutoPlan(await chatGroupAdminAPI.autoAssignOwners({ dryRun: true }));
    } catch (error) {
      notifyApiError?.(error, 'Не удалось подготовить автоназначение.');
    } finally {
      setBusy(false);
    }
  };

  const handleAutoApply = async () => {
    const count = autoPlan?.planned?.length || 0;
    const confirmed = await confirm({
      title: `Назначить владельцев автоматически (${count})?`,
      message: 'Владельцем станет активный модератор или самый давний активный участник. Действие попадёт в журнал.',
      confirmLabel: 'Назначить',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await chatGroupAdminAPI.autoAssignOwners({ dryRun: false });
      notifySuccess?.(`Назначено владельцев: ${result?.assigned || 0}.`);
      setAutoPlan(null);
      await loadGroups();
    } catch (error) {
      notifyApiError?.(error, 'Не удалось назначить владельцев.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5} data-testid="chat-groups-admin">
      <Box>
        <Typography variant="h6">Беседы без владельца</Typography>
        <Typography variant="body2" color="text.secondary">
          Беседы, у которых владелец отключён или отсутствует. Администратор видит только состав и роли,
          содержимое сообщений недоступно. Каждое действие записывается в журнал.
        </Typography>
      </Box>
      {groups.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="chat-groups-auto-owner">
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">
              Автоназначение подбирает владельца из активных участников.
            </Typography>
            <Button size="small" variant="outlined" disabled={busy} onClick={handleAutoPreview}>
              Проверить автоназначение
            </Button>
          </Stack>
          {autoPlan ? (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {autoPlan.planned.length === 0 ? (
                <Typography variant="body2">Назначать некому: нет активных участников.</Typography>
              ) : (
                autoPlan.planned.map((plan) => (
                  <Typography key={plan.conversation_id} variant="body2">
                    {plan.title || 'Без названия'} — {plan.successor_name || `№${plan.successor_user_id}`}
                  </Typography>
                ))
              )}
              {autoPlan.enabled ? (
                <Box>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy || autoPlan.planned.length === 0}
                    onClick={handleAutoApply}
                  >
                    Назначить автоматически
                  </Button>
                </Box>
              ) : (
                <Alert severity="info">
                  Автоназначение выключено в настройках сервера (CHAT_GROUP_AUTO_OWNER_ENABLED).
                </Alert>
              )}
            </Stack>
          ) : null}
        </Paper>
      ) : null}
      {loadError ? <Alert severity="error">{loadError}</Alert> : null}
      {loading ? <CircularProgress size={24} /> : null}
      {!loading && !loadError && groups.length === 0 ? (
        <Alert severity="success">Все беседы имеют активного владельца.</Alert>
      ) : null}
      {groups.map((group) => (
        <Paper key={group.id} variant="outlined" sx={{ p: 1.5 }} data-testid={`chat-group-admin-${group.id}`}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography sx={{ fontWeight: 700 }} noWrap>{group.title || 'Без названия'}</Typography>
            <Button size="small" onClick={() => handleSelect(group.id)} disabled={busy && selectedId !== group.id}>
              {selectedId === group.id ? 'Свернуть' : 'Открыть состав'}
            </Button>
          </Stack>
          {selectedId === group.id && structure ? (
            <GroupStructurePanel
              structure={structure}
              audit={audit}
              busy={busy}
              onAssignOwner={handleAssignOwner}
              onRemoveMember={handleRemoveMember}
            />
          ) : null}
        </Paper>
      ))}
    </Stack>
  );
}

export default ChatGroupsAdminSection;
