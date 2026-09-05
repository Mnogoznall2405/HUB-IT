import { useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarGroup, Box, Stack, Tooltip, Typography } from '@mui/material';

import {
  hubRealtimeSocket,
  HUB_REALTIME_TASK_PRESENCE_EVENT,
} from '../../../lib/hubRealtimeSocket';

const PRESENCE_TTL_MS = 80_000;
const PRESENCE_SWEEP_MS = 20_000;

const collaboratorName = (collaborator) => (
  String(collaborator?.full_name || collaborator?.username || '').trim() || 'Пользователь'
);

const initials = (name) => String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

export default function TaskPresenceIndicator({ taskId }) {
  const [peers, setPeers] = useState(() => new Map());

  useEffect(() => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return undefined;

    const handlePresence = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      if (String(payload.task_id || '') !== normalizedTaskId) return;
      const eventType = String(envelope.type || '');
      if (eventType === 'tasks.presence.snapshot') {
        setPeers(new Map());
        return;
      }
      const collaborator = payload.collaborator || {};
      const connectionId = String(payload.connection_id || collaborator.connection_id || '').trim();
      if (!connectionId) return;
      setPeers((current) => {
        const next = new Map(current);
        if (eventType === 'tasks.presence.left') next.delete(connectionId);
        else next.set(connectionId, { ...collaborator, connection_id: connectionId, seenAt: Date.now() });
        return next;
      });
    };

    window.addEventListener(HUB_REALTIME_TASK_PRESENCE_EVENT, handlePresence);
    const releasePresence = hubRealtimeSocket.watchTaskPresence(normalizedTaskId);
    const sweepTimer = window.setInterval(() => {
      const oldestAllowed = Date.now() - PRESENCE_TTL_MS;
      setPeers((current) => {
        const next = new Map(
          [...current].filter(([, peer]) => Number(peer?.seenAt || 0) >= oldestAllowed),
        );
        return next.size === current.size ? current : next;
      });
    }, PRESENCE_SWEEP_MS);

    return () => {
      window.clearInterval(sweepTimer);
      window.removeEventListener(HUB_REALTIME_TASK_PRESENCE_EVENT, handlePresence);
      releasePresence();
    };
  }, [taskId]);

  const collaborators = useMemo(() => {
    const byUser = new Map();
    for (const peer of peers.values()) {
      const key = String(peer?.id || peer?.username || peer?.connection_id || '');
      if (key && !byUser.has(key)) byUser.set(key, peer);
    }
    return [...byUser.values()];
  }, [peers]);

  if (!collaborators.length) return null;
  const names = collaborators.map(collaboratorName);
  const summary = names.length === 1
    ? `${names[0]} сейчас смотрит задачу`
    : `Сейчас смотрят задачу: ${names.join(', ')}`;

  return (
    <Tooltip title={summary} placement="bottom-start">
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        role="status"
        aria-live="polite"
        aria-label={summary}
        sx={{ minWidth: 0, px: 0.5, pb: 0.75 }}
      >
        <Box aria-hidden="true">
          <AvatarGroup max={3} spacing="small">
            {collaborators.map((collaborator) => {
              const name = collaboratorName(collaborator);
              return (
                <Avatar
                  key={String(collaborator.connection_id || collaborator.id || name)}
                  sx={{ width: 24, height: 24, fontSize: 11, fontWeight: 700 }}
                >
                  {initials(name)}
                </Avatar>
              );
            })}
          </AvatarGroup>
        </Box>
        <Typography variant="caption" color="text.secondary" noWrap>
          {names.length === 1 ? `${names[0]} смотрит задачу` : `Сейчас смотрят: ${names.length}`}
        </Typography>
      </Stack>
    </Tooltip>
  );
}
