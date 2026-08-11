import { Box, Button, ButtonBase, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import DynamicFeedRoundedIcon from '@mui/icons-material/DynamicFeedRounded';
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded';
import PriorityHighRoundedIcon from '@mui/icons-material/PriorityHighRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import InputAdornment from '@mui/material/InputAdornment';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const FILTERS = [
  { id: 'all', label: 'Все публикации', icon: DynamicFeedRoundedIcon },
  { id: 'unread', label: 'Новое для меня', icon: FiberManualRecordRoundedIcon },
  { id: 'important', label: 'Важные новости', icon: PriorityHighRoundedIcon },
  { id: 'saved', label: 'Сохранённые', icon: BookmarkBorderRoundedIcon },
  { id: 'drafts', label: 'Черновики', icon: EditNoteRoundedIcon, managerOnly: true },
  { id: 'scheduled', label: 'Запланированные', icon: ScheduleRoundedIcon, managerOnly: true },
  { id: 'published', label: 'Опубликованные', icon: DynamicFeedRoundedIcon, managerOnly: true },
  { id: 'archived', label: 'Архив', icon: ArchiveOutlinedIcon, managerOnly: true },
];

export default function FeedSidebar({
  activeFilter,
  onFilterChange,
  query,
  onQueryChange,
  total,
  unreadTotal,
  canManage = false,
  categories = [],
  categoryId = '',
  onCategoryChange,
  tags = [],
  tag = '',
  onTagChange,
  onManageCategories,
}) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);

  return (
    <Stack
      component="aside"
      aria-label="Навигация по ленте"
      spacing={2}
      sx={{
        display: { xs: 'none', lg: 'flex' },
        position: 'sticky',
        top: 8,
        minWidth: 0,
      }}
    >
      <TextField
        fullWidth
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Поиск"
        inputProps={{ 'aria-label': 'Поиск в ленте' }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchRoundedIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            minHeight: 46,
            borderRadius: '999px',
            bgcolor: ui.panelBg,
            '& fieldset': { border: 0 },
            '&:hover fieldset': { border: 0 },
            '&.Mui-focused fieldset': { border: `2px solid ${theme.palette.primary.main}` },
          },
        }}
      />

      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          bgcolor: ui.panelSolid,
          boxShadow: 'none',
          border: 0,
          overflow: 'hidden',
        }}
      >
        <Typography component="h2" sx={{ px: 2, pt: 1.7, pb: 1, fontSize: '1.2rem', fontWeight: 800 }}>
          Разделы ленты
        </Typography>
        <Stack>
          {FILTERS.filter((filter) => !filter.managerOnly || canManage).map((filter) => {
            const Icon = filter.icon;
            const selected = activeFilter === filter.id;
            const count = filter.id === 'all' ? total : filter.id === 'unread' ? unreadTotal : null;
            return (
              <ButtonBase
                key={filter.id}
                aria-pressed={selected}
                onClick={() => onFilterChange(filter.id)}
                sx={{
                  width: '100%',
                  minHeight: 52,
                  px: 2,
                  borderRadius: 0,
                  justifyContent: 'flex-start',
                  color: selected ? 'primary.main' : 'text.primary',
                  bgcolor: selected ? alpha(theme.palette.primary.main, ui.isDark ? 0.16 : 0.08) : 'transparent',
                  transition: 'background-color 120ms ease-out, color 120ms ease-out',
                  '&:hover': { bgcolor: selected ? alpha(theme.palette.primary.main, ui.isDark ? 0.2 : 0.11) : ui.actionHover },
                  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                }}
              >
                <Box sx={{ width: 28, height: 28, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icon sx={{ fontSize: filter.id === 'unread' ? 12 : 20 }} />
                </Box>
                <Typography sx={{ ml: 1, flex: 1, textAlign: 'start', fontSize: '0.92rem', fontWeight: selected ? 800 : 600 }}>
                  {filter.label}
                </Typography>
                {Number.isFinite(Number(count)) ? (
                  <Typography
                    component="span"
                    sx={{
                      minWidth: 24,
                      color: selected ? 'primary.main' : 'text.secondary',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'end',
                    }}
                  >
                    {Number(count || 0)}
                  </Typography>
                ) : null}
              </ButtonBase>
            );
          })}
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 2, borderRadius: '16px', bgcolor: ui.panelSolid, boxShadow: 'none', border: 0 }}>
        <Typography component="h2" sx={{ mb: 1.25, fontSize: '0.95rem', fontWeight: 800 }}>Фильтры</Typography>
        <Stack spacing={1.25}>
          <Select size="small" displayEmpty value={categoryId} onChange={(event) => onCategoryChange?.(event.target.value)} inputProps={{ 'aria-label': 'Фильтр по категории' }} sx={{ minHeight: 44, borderRadius: '10px' }}>
            <MenuItem value="">Все категории</MenuItem>
            {categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}
          </Select>
          <Select size="small" displayEmpty value={tag} onChange={(event) => onTagChange?.(event.target.value)} inputProps={{ 'aria-label': 'Фильтр по тегу' }} sx={{ minHeight: 44, borderRadius: '10px' }}>
            <MenuItem value="">Все теги</MenuItem>
            {tags.map((item) => <MenuItem key={item.id || item.slug} value={item.slug || item.name}>#{item.name}</MenuItem>)}
          </Select>
          {onManageCategories ? <Button variant="outlined" onClick={onManageCategories} sx={{ minHeight: 42, textTransform: 'none' }}>Управлять категориями</Button> : null}
        </Stack>
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ px: 1, lineHeight: 1.55 }}>
        Корпоративные новости, важные объявления и перенесённые заметки.
      </Typography>
    </Stack>
  );
}
