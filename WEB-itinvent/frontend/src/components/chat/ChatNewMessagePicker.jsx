import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

import { ComposeFlowHeader, DialogListSkeleton, PersonPickerRow } from './ChatDialogsPrimitives';

const personSortName = (item) => String(item?.full_name || item?.username || '').trim().toLowerCase();

// Д2-9: сначала люди из недавних личных диалогов (по last_message_at),
// дальше — весь каталог по алфавиту.
export function orderPickerUsersByRecency(users, conversations) {
  const lastActivityByPeer = new Map();
  (Array.isArray(conversations) ? conversations : []).forEach((conversation) => {
    if (String(conversation?.kind || '').trim() !== 'direct') return;
    const peerId = Number(conversation?.direct_peer?.id || 0);
    if (!Number.isFinite(peerId) || peerId <= 0) return;
    const stamp = String(conversation?.last_message_at || conversation?.updated_at || '');
    const current = lastActivityByPeer.get(peerId) || '';
    if (stamp > current) lastActivityByPeer.set(peerId, stamp);
  });
  return [...(Array.isArray(users) ? users : [])].sort((left, right) => {
    const leftStamp = lastActivityByPeer.get(Number(left?.id || 0)) || '';
    const rightStamp = lastActivityByPeer.get(Number(right?.id || 0)) || '';
    if (leftStamp !== rightStamp) return rightStamp.localeCompare(leftStamp);
    return personSortName(left).localeCompare(personSortName(right), 'ru');
  });
}

// Поток «Новое сообщение»: поиск по людям каталога и открытие/создание
// личного диалога существующим обработчиком страницы (onSelectPerson).
export default function ChatNewMessagePicker({
  ui = {},
  compactMobile = false,
  query = '',
  onQueryChange,
  users = [],
  usersLoading = false,
  conversations = [],
  openingPeerId = '',
  onSelectPerson,
  onBack,
}) {
  const orderedUsers = useMemo(
    () => orderPickerUsersByRecency(users, conversations),
    [users, conversations],
  );
  const primaryText = ui.textStrong || ui.textPrimary || '#17212b';
  const searchBg = ui.sidebarSearchBg || alpha(primaryText, 0.08);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="chat-new-message-picker">
      <ComposeFlowHeader
        ui={ui}
        title="Новое сообщение"
        onBack={onBack}
        compactMobile={compactMobile}
      />
      <Box sx={{ px: 1.5, py: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: searchBg,
            borderRadius: 999,
            px: 1.4,
            minHeight: 42,
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 20, color: ui.textSecondary, flexShrink: 0 }} />
          <input
            aria-label="Поиск людей"
            autoFocus={!compactMobile}
            value={query}
            onChange={(event) => onQueryChange?.(event.target.value)}
            placeholder="Поиск"
            className="h-full min-w-0 flex-1 bg-transparent outline-none"
            style={{
              border: 'none',
              color: primaryText,
              fontSize: '0.95rem',
              fontFamily: 'inherit',
            }}
          />
          {query ? (
            <Box
              component="button"
              type="button"
              aria-label="Очистить поиск"
              onClick={() => onQueryChange?.('')}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                bgcolor: 'transparent',
                color: ui.textSecondary,
                cursor: 'pointer',
                p: 0.25,
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </Box>
          ) : null}
        </Box>
      </Box>
      <div
        className="chat-scroll-hidden flex-1 overflow-y-auto px-1 pb-2"
        data-testid="chat-new-message-picker-list"
      >
        {usersLoading ? (
          <DialogListSkeleton ui={ui} rows={7} compact />
        ) : orderedUsers.length === 0 ? (
          <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: ui.textSecondary }}>
              {String(query || '').trim() ? 'По запросу никого не найдено' : 'Начните вводить имя, логин или должность'}
            </Typography>
          </Box>
        ) : (
          orderedUsers.map((item) => (
            <PersonPickerRow
              key={`picker-person-${item?.id}`}
              item={item}
              ui={ui}
              query={query}
              opening={String(openingPeerId || '') === String(item?.id || '')}
              onPress={onSelectPerson}
            />
          ))
        )}
      </div>
    </div>
  );
}
