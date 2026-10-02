import { useMemo, useRef, useState } from 'react';
import { Box, InputBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddAPhotoRoundedIcon from '@mui/icons-material/AddAPhotoRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

import {
  ComposeActionFab,
  ComposeFlowHeader,
  DialogListSkeleton,
  GroupUserCheckboxRow,
  SelectedMemberChip,
} from './ChatDialogsPrimitives';

// Д2-9: двухшаговый поток создания группы внутри колонки списка чатов —
// «Добавить участников» (чипы в поиске) → «Новая группа» (фото + название).
export default function ChatGroupCreateFlow({
  ui = {},
  compactMobile = false,
  step = 'members',
  onStepChange,
  query = '',
  onQueryChange,
  users = [],
  usersLoading = false,
  selectedUsers = [],
  onAddMember,
  onRemoveMember,
  maxMembers = null,
  title = '',
  onTitleChange,
  creating = false,
  createDisabled = true,
  onCreate,
  onBack,
}) {
  const selected = useMemo(
    () => (Array.isArray(selectedUsers) ? selectedUsers : []),
    [selectedUsers],
  );
  const availableUsers = Array.isArray(users) ? users : [];
  const selectedIds = useMemo(
    () => new Set(selected.map((item) => String(item?.id || '')).filter(Boolean)),
    [selected],
  );
  const hasLimit = Number.isFinite(Number(maxMembers)) && Number(maxMembers) > 0;
  // Бэкенд добавляет создателя в множество участников: выбрать можно на 1 меньше.
  const selectableLimit = hasLimit ? Math.max(0, Number(maxMembers) - 1) : null;
  const limitReached = selectableLimit != null && selected.length >= selectableLimit;
  const canProceed = selected.length >= 2 && !creating;
  const isDetailsStep = step === 'details';

  const subtitle = hasLimit
    ? `Выбрано: ${selected.length} из ${maxMembers}`
    : `Выбрано: ${selected.length}`;

  const searchInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');

  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.textPrimary || '#17212b';
  const searchBg = ui.sidebarSearchBg || alpha(primaryText, 0.08);

  const refocusSearch = () => {
    if (compactMobile) return;
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus?.();
    });
  };

  const handleToggle = (item) => {
    const itemId = String(item?.id || '');
    if (!itemId) return;
    if (selectedIds.has(itemId)) {
      onRemoveMember?.(item.id);
    } else {
      onAddMember?.(item);
      onQueryChange?.('');
    }
    refocusSearch();
  };

  const handleSearchKeyDown = (event) => {
    if (event.key !== 'Backspace') return;
    if (event.currentTarget.value) return;
    const last = selected[selected.length - 1];
    if (!last) return;
    event.preventDefault();
    onRemoveMember?.(last.id);
  };

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (loadEvent) => setAvatarPreview(String(loadEvent.target.result || ''));
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col"
      data-testid="chat-group-create-flow"
    >
      <ComposeFlowHeader
        ui={ui}
        title={isDetailsStep ? 'Новая группа' : 'Добавить участников'}
        subtitle={isDetailsStep ? '' : subtitle}
        backLabel={isDetailsStep ? 'Назад к выбору участников' : 'Закрыть создание группы'}
        onBack={isDetailsStep ? () => onStepChange?.('members') : onBack}
        compactMobile={compactMobile}
      />
      {!isDetailsStep ? (
        <>
          <Box sx={{ px: 1.5, py: 1 }}>
            <Box
              data-testid="group-members-search"
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 0.75,
                bgcolor: searchBg,
                borderRadius: selected.length ? 2.5 : 999,
                px: 1.4,
                py: 0.75,
                minHeight: 42,
                // Много выбранных не должны вытеснять список: поле с чипами прокручивается.
                maxHeight: 132,
                overflowY: 'auto',
              }}
            >
              <SearchRoundedIcon sx={{ fontSize: 20, color: ui.textSecondary, flexShrink: 0 }} />
              {selected.map((item) => (
                <SelectedMemberChip
                  key={`group-chip-${item?.id}`}
                  item={item}
                  ui={ui}
                  onRemove={(chip) => {
                    onRemoveMember?.(chip?.id);
                    refocusSearch();
                  }}
                />
              ))}
              <input
                ref={searchInputRef}
                aria-label="Поиск участников"
                autoFocus={!compactMobile}
                value={query}
                onChange={(event) => onQueryChange?.(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Поиск"
                className="min-w-[120px] flex-1 bg-transparent outline-none"
                style={{
                  border: 'none',
                  color: primaryText,
                  fontSize: '0.95rem',
                  fontFamily: 'inherit',
                  height: 34,
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
            {limitReached ? (
              <Typography
                variant="caption"
                role="status"
                sx={{ display: 'block', px: 0.75, pt: 0.75, color: ui.textSecondary }}
              >
                {`Лимит группы — ${maxMembers} участников включая вас.`}
              </Typography>
            ) : null}
          </Box>
          <div
            className="chat-scroll-hidden flex-1 overflow-y-auto px-1 pb-2"
            data-testid="group-user-search-results"
          >
            {usersLoading ? (
              <DialogListSkeleton ui={ui} rows={7} compact />
            ) : availableUsers.length === 0 ? (
              <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: ui.textSecondary }}>
                  Никого не найдено
                </Typography>
              </Box>
            ) : (
              availableUsers.map((item) => {
                const itemId = String(item?.id || '');
                const checked = selectedIds.has(itemId);
                return (
                  <GroupUserCheckboxRow
                    key={`group-user-${itemId}`}
                    item={item}
                    ui={ui}
                    checked={checked}
                    disabled={!checked && limitReached}
                    query={query}
                    onToggle={handleToggle}
                  />
                );
              })
            )}
          </div>
          <ComposeActionFab
            ui={ui}
            label="Далее"
            disabled={!canProceed}
            icon={<ArrowForwardRoundedIcon />}
            onClick={() => onStepChange?.('details')}
          />
        </>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
          />
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2.5,
              px: 2.5,
              pt: 2.5,
              pb: 1.5,
            }}
          >
            <Box
              component="button"
              type="button"
              aria-label="Загрузить фото группы"
              onClick={() => avatarInputRef.current?.click()}
              sx={{
                flexShrink: 0,
                width: 72,
                height: 72,
                borderRadius: '50%',
                border: 'none',
                cursor: 'pointer',
                bgcolor: accentColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                transition: 'opacity 120ms ease',
                '&:hover': { opacity: 0.88 },
                '&:active': { opacity: 0.72 },
                p: 0,
              }}
            >
              {avatarPreview ? (
                <Box
                  component="img"
                  src={avatarPreview}
                  alt=""
                  sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <AddAPhotoRoundedIcon sx={{ fontSize: 30, color: '#fff' }} />
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <InputBase
                inputProps={{ 'data-testid': 'group-flow-title-input', 'aria-label': 'Название группы' }}
                fullWidth
                autoFocus
                value={title}
                onChange={(event) => onTitleChange?.(event.target.value)}
                placeholder="Название группы"
                sx={{
                  fontSize: '1rem',
                  fontWeight: 500,
                  color: primaryText,
                  '& input': {
                    borderBottom: `1.5px solid ${accentColor}`,
                    pb: 0.5,
                  },
                  '& input::placeholder': { color: ui.textSecondary, opacity: 1 },
                }}
              />
            </Box>
          </Box>
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 2.5, pb: 2, color: ui.textSecondary }}
          >
            {`Участников: ${selected.length}`}
          </Typography>
          <ComposeActionFab
            ui={ui}
            label="Создать группу"
            disabled={createDisabled}
            loading={creating}
            icon={<CheckRoundedIcon />}
            onClick={() => void onCreate?.(avatarFile)}
          />
        </Box>
      )}
    </div>
  );
}
