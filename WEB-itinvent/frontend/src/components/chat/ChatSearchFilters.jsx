import { useMemo } from 'react';
import { Chip, MenuItem, Stack, TextField } from '@mui/material';

import useChatPanelMembers from './useChatPanelMembers';
import { EMPTY_SEARCH_FILTERS } from './useChatMessageSearch';

const KIND_OPTIONS = [
  ['image', 'Фото'],
  ['video', 'Видео'],
  ['file', 'Файлы'],
  ['audio', 'Голосовые'],
  ['link', 'Ссылки'],
];

// Narrows the in-chat search to one person, a period and a message type; any of them works without text.
export default function ChatSearchFilters({ conversation, open, filters = EMPTY_SEARCH_FILTERS, onChange }) {
  const memberDetails = useChatPanelMembers(conversation, open);
  const isMultiUser = conversation?.kind === 'group' || conversation?.kind === 'task';
  const people = useMemo(() => {
    const source = Array.isArray(memberDetails.members) ? memberDetails.members : [];
    const byId = new Map();
    source.forEach((member) => {
      const user = member?.user || member;
      const id = Number(user?.id || 0);
      if (id > 0 && !byId.has(id)) byId.set(id, String(user.full_name || user.username || `№${id}`));
    });
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1], 'ru'));
  }, [memberDetails.members]);
  const update = (patch) => onChange?.(patch);

  return (
    <Stack spacing={1.5} data-testid="chat-search-filters">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        {isMultiUser ? (
          <TextField
            select
            size="small"
            fullWidth
            label="Автор"
            value={filters.senderUserId ? String(filters.senderUserId) : ''}
            onChange={(event) => update({ senderUserId: event.target.value })}
            inputProps={{ 'data-testid': 'chat-search-sender' }}
          >
            <MenuItem value="">Любой</MenuItem>
            {people.map(([id, name]) => (
              <MenuItem key={id} value={String(id)}>{name}</MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField
          size="small"
          fullWidth
          type="date"
          label="С даты"
          value={filters.createdFrom || ''}
          onChange={(event) => update({ createdFrom: event.target.value })}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'chat-search-from', max: filters.createdTo || undefined }}
        />
        <TextField
          size="small"
          fullWidth
          type="date"
          label="По дату"
          value={filters.createdTo || ''}
          onChange={(event) => update({ createdTo: event.target.value })}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'chat-search-to', min: filters.createdFrom || undefined }}
        />
      </Stack>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        {KIND_OPTIONS.map(([kind, label]) => {
          const active = filters.kind === kind;
          return (
            <Chip
              key={kind}
              size="small"
              label={label}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => update({ kind: active ? '' : kind })}
              data-testid={`chat-search-kind-${kind}`}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
