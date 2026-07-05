import { useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { DEFAULT_MOBILE_BOTTOM_NAV_ITEMS } from '../../../contexts/PreferencesContext';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import SectionCard from '../shared/SectionCard';

export function MobileBottomNavSettingsCard({
  availableItems,
  selectedPaths,
  resolvedItems,
  onChange,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const availablePathSet = useMemo(
    () => new Set(availableItems.map((item) => item.path)),
    [availableItems],
  );
  const visibleSelectedPaths = useMemo(
    () => selectedPaths.filter((path) => availablePathSet.has(path)).slice(0, 4),
    [availablePathSet, selectedPaths],
  );
  const selectedPathSet = useMemo(() => new Set(visibleSelectedPaths), [visibleSelectedPaths]);

  const toggleItem = useCallback((path) => {
    if (selectedPathSet.has(path)) {
      onChange(visibleSelectedPaths.filter((selectedPath) => selectedPath !== path));
      return;
    }
    if (visibleSelectedPaths.length >= 4) return;
    onChange([...visibleSelectedPaths, path]);
  }, [onChange, selectedPathSet, visibleSelectedPaths]);

  return (
    <SectionCard
      title="Нижнее меню"
      description="Выберите до четырёх разделов. Пункт «Меню» всегда остаётся пятым."
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Chip
            size="small"
            color={visibleSelectedPaths.length === 4 ? 'primary' : 'default'}
            label={`Выбрано ${visibleSelectedPaths.length} из 4`}
            sx={{ fontWeight: 800 }}
          />
          <Button
            size="small"
            onClick={() => onChange([...DEFAULT_MOBILE_BOTTOM_NAV_ITEMS])}
            disabled={DEFAULT_MOBILE_BOTTOM_NAV_ITEMS.every((path) => selectedPaths.includes(path))}
          >
            По умолчанию
          </Button>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
            gap: 0.85,
          }}
        >
          {availableItems.map((item) => {
            const selected = selectedPathSet.has(item.path);
            const disabled = !selected && visibleSelectedPaths.length >= 4;
            return (
              <ButtonBase
                key={item.path}
                data-testid={`mobile-bottom-nav-option-${item.path.replace(/^\//, '')}`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => toggleItem(item.path)}
                sx={{
                  minHeight: 70,
                  p: 1,
                  borderRadius: '14px',
                  border: '1px solid',
                  borderColor: selected ? theme.palette.primary.main : ui.borderSoft,
                  bgcolor: selected
                    ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08)
                    : ui.panelSolid,
                  color: selected ? theme.palette.primary.main : ui.iconMuted,
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  opacity: disabled ? 0.48 : 1,
                  transition: theme.transitions.create(['border-color', 'background-color', 'transform'], {
                    duration: theme.transitions.duration.shorter,
                  }),
                  '&:hover': {
                    bgcolor: selected
                      ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.11)
                      : ui.actionHover,
                  },
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                  },
                }}
              >
                <Stack direction="row" spacing={0.9} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ lineHeight: 0, flexShrink: 0 }}>{item.icon}</Box>
                  <Typography sx={{ color: 'text.primary', fontWeight: 800, lineHeight: 1.15 }} noWrap>
                    {item.shortLabel || item.label}
                  </Typography>
                </Stack>
              </ButtonBase>
            );
          })}
        </Box>

        <Box sx={getOfficeSubtlePanelSx(ui, { p: 1, borderRadius: '16px', bgcolor: ui.panelInset })}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            Предпросмотр
          </Typography>
          <Stack
            direction="row"
            alignItems="stretch"
            sx={{
              minHeight: 62,
              borderRadius: '16px',
              overflow: 'hidden',
              bgcolor: alpha(ui.navBg, theme.palette.mode === 'dark' ? 0.86 : 0.9),
              boxShadow: theme.palette.mode === 'dark'
                ? '0 8px 24px rgba(0,0,0,0.24)'
                : '0 8px 22px rgba(15,23,42,0.10)',
            }}
          >
            {resolvedItems.map((item, index) => (
              <Stack
                key={item.path}
                alignItems="center"
                justifyContent="center"
                spacing={0.15}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  color: index === 0 ? theme.palette.primary.main : ui.iconMuted,
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 28,
                    borderRadius: '14px',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: index === 0 ? alpha(theme.palette.primary.main, 0.13) : 'transparent',
                    '& .MuiSvgIcon-root': { fontSize: 22 },
                  }}
                >
                  {item.icon}
                </Box>
                <Typography
                  sx={{
                    maxWidth: '100%',
                    px: 0.2,
                    color: index === 0 ? 'text.primary' : 'text.secondary',
                    fontSize: '0.62rem',
                    fontWeight: index === 0 ? 800 : 700,
                    lineHeight: 1.1,
                  }}
                  noWrap
                >
                  {item.shortLabel || item.label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography variant="caption" color="text.secondary">
          Изменения применятся после нажатия общей кнопки «Сохранить».
        </Typography>
      </Stack>
    </SectionCard>
  );
}
