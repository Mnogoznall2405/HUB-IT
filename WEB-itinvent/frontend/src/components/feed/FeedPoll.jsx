import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CheckBoxOutlineBlankRoundedIcon from '@mui/icons-material/CheckBoxOutlineBlankRounded';
import CheckBoxRoundedIcon from '@mui/icons-material/CheckBoxRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const formatPollClose = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
};

const formatVotes = (value) => {
  const count = Math.max(0, Number(value || 0));
  const mod100 = count % 100;
  const mod10 = count % 10;
  const suffix = mod100 >= 11 && mod100 <= 14
    ? 'голосов'
    : mod10 === 1
      ? 'голос'
      : mod10 >= 2 && mod10 <= 4
        ? 'голоса'
        : 'голосов';
  return `${count} ${suffix}`;
};

export default function FeedPoll({ poll, onVote, preview = false }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const viewerIds = useMemo(() => (Array.isArray(poll?.viewer_option_ids) ? poll.viewer_option_ids.map(String) : []), [poll?.viewer_option_ids]);
  const [selectedIds, setSelectedIds] = useState(viewerIds);
  const [saving, setSaving] = useState(false);

  useEffect(() => setSelectedIds(viewerIds), [viewerIds]);

  if (!poll || !Array.isArray(poll.options) || !poll.options.length) return null;
  const showResults = Boolean(poll.has_voted || poll.is_closed);
  const denominator = Math.max(1, Number(poll.total_voters || 0));
  const canVote = !preview && !poll.is_closed && typeof onVote === 'function';
  const pollDescription = [
    poll.is_anonymous ? 'Анонимный опрос' : 'Открытый опрос',
    poll.allows_multiple ? 'можно выбрать несколько вариантов' : 'один вариант ответа',
  ].join(' · ');

  const submitVote = async (nextIds) => {
    if (!canVote || saving) return;
    setSaving(true);
    try {
      await onVote(nextIds);
    } finally {
      setSaving(false);
    }
  };

  const toggleMultiple = (optionId) => {
    setSelectedIds((current) => (
      current.includes(optionId)
        ? current.filter((item) => item !== optionId)
        : [...current, optionId]
    ));
  };

  return (
    <Box
      component="section"
      aria-label={`Опрос: ${poll.question}`}
      sx={{
        mt: 1.25,
        p: { xs: 1.25, sm: 1.5 },
        border: '1px solid',
        borderColor: ui.border,
        borderRadius: '14px',
        bgcolor: ui.isDark
          ? alpha(theme.palette.common.white, 0.035)
          : alpha(theme.palette.common.black, 0.025),
      }}
    >
      <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.35 }}>
        {poll.question || 'Опрос'}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {pollDescription}
      </Typography>

      <Stack role="group" aria-label="Варианты ответа" spacing={1.15} sx={{ mt: 1.4 }}>
        {poll.options.map((option) => {
          const optionId = String(option.id);
          const selected = selectedIds.includes(optionId);
          const votesCount = Number(option.votes_count || 0);
          const percentage = showResults ? Math.round((votesCount / denominator) * 100) : 0;
          return (
            <Box
              key={optionId}
              component={canVote ? 'button' : 'div'}
              type={canVote ? 'button' : undefined}
              disabled={canVote ? saving : undefined}
              aria-pressed={canVote ? selected : undefined}
              aria-label={canVote
                ? `${selected ? 'Снять выбор' : 'Выбрать'} «${option.text || 'Вариант без названия'}»${showResults ? `, ${percentage}%, ${formatVotes(votesCount)}` : ''}`
                : undefined}
              onClick={() => (poll.allows_multiple ? toggleMultiple(optionId) : submitVote(selected ? [] : [optionId]))}
              sx={{
                appearance: 'none',
                width: '100%',
                minWidth: 0,
                minHeight: showResults ? { xs: 52, sm: 46 } : { xs: 48, sm: 44 },
                m: 0,
                p: showResults ? 0 : 1,
                border: showResults ? 0 : '1px solid',
                borderColor: selected ? alpha(theme.palette.primary.main, 0.62) : ui.border,
                borderRadius: '10px',
                background: showResults
                  ? 'transparent'
                  : selected
                    ? alpha(theme.palette.primary.main, ui.isDark ? 0.18 : 0.1)
                    : alpha(theme.palette.background.paper, ui.isDark ? 0.35 : 0.7),
                color: 'text.primary',
                font: 'inherit',
                textAlign: 'start',
                cursor: canVote && !saving ? 'pointer' : 'default',
                '&:hover': canVote ? {
                  bgcolor: alpha(theme.palette.primary.main, ui.isDark ? 0.1 : 0.055),
                } : undefined,
                '&:focus-visible': canVote ? {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                } : undefined,
                '&:disabled': { color: 'text.primary', cursor: 'wait' },
                '@media (prefers-reduced-motion: no-preference)': canVote ? {
                  transition: 'background-color 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out',
                  '&:active': { transform: 'scale(0.96)' },
                } : undefined,
              }}
            >
              {showResults ? (
                <>
                  <Stack direction="row" alignItems="flex-start" spacing={0.65} sx={{ minWidth: 0 }}>
                    <Typography component="span" sx={{ flex: '0 0 2.5rem', pt: '1px', color: 'text.primary', fontSize: '0.81rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {percentage}%
                    </Typography>
                    {selected ? <CheckCircleRoundedIcon aria-hidden="true" sx={{ flex: '0 0 auto', mt: '1px', color: 'primary.main', fontSize: 17 }} /> : null}
                    <Typography component="span" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere', fontSize: '0.88rem', fontWeight: selected ? 750 : 600, lineHeight: 1.35 }}>
                      {option.text || 'Вариант без названия'}
                    </Typography>
                    <Typography component="span" color="text.secondary" sx={{ flex: '0 0 auto', pt: '1px', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums' }}>
                      {votesCount}
                    </Typography>
                  </Stack>
                  <Box aria-hidden="true" sx={{ mt: 0.65, ml: '2.5rem', height: 4, overflow: 'hidden', borderRadius: '999px', bgcolor: alpha(theme.palette.text.primary, ui.isDark ? 0.16 : 0.11) }}>
                    <Box sx={{ width: `${Math.min(100, percentage)}%`, height: '100%', borderRadius: 'inherit', bgcolor: selected ? 'primary.light' : 'primary.main' }} />
                  </Box>
                </>
              ) : (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                  <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', flex: '0 0 auto', color: selected ? 'primary.main' : 'text.secondary' }}>
                    {poll.allows_multiple
                      ? (selected ? <CheckBoxRoundedIcon /> : <CheckBoxOutlineBlankRoundedIcon />)
                      : (selected ? <RadioButtonCheckedRoundedIcon /> : <RadioButtonUncheckedRoundedIcon />)}
                  </Box>
                  <Typography component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: '0.9rem', fontWeight: selected ? 750 : 600 }}>
                    {option.text || 'Вариант без названия'}
                  </Typography>
                </Stack>
              )}
            </Box>
          );
        })}
      </Stack>

      {poll.allows_multiple && canVote ? (
        <Button
          variant="contained"
          disabled={saving || (!selectedIds.length && !poll.has_voted)}
          onClick={() => submitVote(selectedIds)}
          startIcon={saving ? <CircularProgress size={17} color="inherit" /> : null}
          sx={{ mt: 1.25, minHeight: 44, borderRadius: '11px', boxShadow: 'none', textTransform: 'none', fontWeight: 750 }}
        >
          {poll.has_voted ? (selectedIds.length ? 'Изменить выбор' : 'Отменить голос') : 'Проголосовать'}
        </Button>
      ) : null}

      <Stack direction="row" justifyContent="center" spacing={0.75} useFlexGap flexWrap="wrap" role="status" sx={{ mt: 1.35 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatVotes(poll.total_voters)}
        </Typography>
        {poll.is_closed || poll.closes_at ? (
          <Typography variant="caption" color="text.secondary">
            · {poll.is_closed ? 'опрос завершён' : `до ${formatPollClose(poll.closes_at)}`}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
