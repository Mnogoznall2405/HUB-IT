import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { formatDwell, shortLabel } from './utils';

function num(row, key) {
  return Number(row?.[key]) || 0;
}

function idleSec(h) {
  return num(h, 'away_sec') > 0 ? num(h, 'away_sec') : num(h, 'browser_idle_sec');
}

function KpiCard({ title, value, caption, color = 'text.primary', onClick }) {
  const body = (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        transition: 'border-color .15s, background-color .15s',
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {title}
      </Typography>
      <Typography
        variant="h6"
        sx={{ color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}
        noWrap
      >
        {value}
      </Typography>
      {caption ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          {caption}
        </Typography>
      ) : null}
    </Paper>
  );

  if (!onClick) return body;
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`${title}: ${value}. Показать детали`}
      sx={{
        display: 'block',
        width: '100%',
        height: '100%',
        textAlign: 'left',
        borderRadius: 1,
        '&:hover .MuiPaper-root': {
          borderColor: 'primary.main',
          bgcolor: 'action.hover',
        },
      }}
    >
      {body}
    </ButtonBase>
  );
}

function AttentionList({ title, rows, metric, total, onOpenHost, highlighted, paperRef }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      ref={paperRef}
      sx={{
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'box-shadow .3s',
        boxShadow: highlighted ? `0 0 0 2px ${theme.palette.primary.main}` : 'none',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">{title}</Typography>
        {total ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} noWrap>
            {total}
          </Typography>
        ) : null}
      </Stack>
      {rows.length ? (
        <Box sx={{ maxHeight: 264, overflowY: 'auto', pr: 0.5 }}>
          <Stack spacing={0.25}>
            {rows.map((row) => (
              <ButtonBase
                key={row.computer_name}
                onClick={() => onOpenHost(row.computer_name)}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 1,
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 0.5,
                  textAlign: 'left',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {row.user_full_name || row.computer_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {shortLabel(
                      [row.computer_name, row.branch_name].filter(Boolean).join(' · '),
                      44,
                    )}
                  </Typography>
                </Box>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                >
                  {metric(row)}
                </Typography>
              </ButtonBase>
            ))}
          </Stack>
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Нет данных за день
        </Typography>
      )}
    </Paper>
  );
}

export default function DlpOverview({ day, onDayChange, attention, loading, onOpenHost, onShowHosts }) {
  const hosts = useMemo(() => (Array.isArray(attention) ? attention : []), [attention]);
  const cardRefs = useRef({});
  const [flash, setFlash] = useState(null);

  const focusCard = (key) => {
    const el = cardRefs.current[key];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    setFlash(key);
  };

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
  }, [flash]);

  const kpi = useMemo(() => {
    const worked = hosts.filter((h) => num(h, 'active_sec') > 0 || num(h, 'passive_sec') > 0);
    const active = hosts.reduce((s, h) => s + num(h, 'active_sec'), 0);
    return {
      activeHosts: worked.length,
      active,
      avgActive: worked.length ? active / worked.length : 0,
      idle: hosts.reduce((s, h) => s + idleSec(h), 0),
      entertainment: hosts.reduce((s, h) => s + num(h, 'entertainment_sec'), 0),
      usbFiles: hosts.reduce((s, h) => s + num(h, 'usb_files'), 0),
      messengerFiles: hosts.reduce((s, h) => s + num(h, 'messenger_files'), 0),
    };
  }, [hosts]);

  const ranked = useMemo(() => {
    const by = (getter) =>
      [...hosts]
        .filter((h) => getter(h) > 0)
        .sort((a, b) => getter(b) - getter(a));
    return {
      entertainment: by((h) => num(h, 'entertainment_sec')),
      idle: by(idleSec),
      usb: by((h) => num(h, 'usb_files')),
      messenger: by((h) => num(h, 'messenger_files')),
    };
  }, [hosts]);

  const cards = [
    {
      key: 'hosts',
      title: 'Активных ПК',
      value: kpi.activeHosts,
      caption: `из ${hosts.length} с данными`,
      onClick: onShowHosts,
    },
    {
      key: 'active',
      title: 'Ввод/пауза',
      value: formatDwell(kpi.active),
      caption: kpi.activeHosts ? `≈ ${formatDwell(kpi.avgActive)} на ПК` : undefined,
      color: 'success.main',
      onClick: onShowHosts,
    },
    {
      key: 'idle',
      title: 'Отошли',
      value: formatDwell(kpi.idle),
      caption: `${ranked.idle.length} ПК`,
      color: 'warning.main',
      onClick: () => focusCard('idle'),
    },
    {
      key: 'entertainment',
      title: 'Развлечения',
      value: formatDwell(kpi.entertainment),
      caption: `${ranked.entertainment.length} ПК`,
      color: 'warning.main',
      onClick: () => focusCard('entertainment'),
    },
    {
      key: 'usb',
      title: 'USB-файлов',
      value: kpi.usbFiles,
      caption: `${ranked.usb.length} ПК`,
      color: 'info.main',
      onClick: () => focusCard('usb'),
    },
    {
      key: 'messenger',
      title: 'Файлов в мессенджеры',
      value: kpi.messengerFiles,
      caption: `${ranked.messenger.length} ПК`,
      color: 'info.main',
      onClick: () => focusCard('messenger'),
    },
  ];

  return (
    <Stack spacing={1.5} sx={{ flexShrink: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle1" fontWeight={700}>
          Сводка за день · Тюмень (UTC+05:00)
        </Typography>
        <TextField
          size="small"
          type="date"
          value={day}
          onChange={(e) => onDayChange(e.target.value)}
          inputProps={{ 'aria-label': 'День сводки' }}
          sx={{ width: 160 }}
        />
      </Stack>
      {loading ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(6,1fr)' }, gap: 1 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(6,1fr)' }, gap: 1 }}>
          {cards.map(({ key, ...card }) => (
            <KpiCard key={key} {...card} />
          ))}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        Ввод/пауза — ввод и до 2 минут после него, не оценка продуктивности.
      </Typography>
      <Typography variant="subtitle1" fontWeight={700}>
        Обратить внимание
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)', xl: 'repeat(4,1fr)' },
          gap: 1,
        }}
      >
        <AttentionList
          title="Развлечения"
          total={`${formatDwell(kpi.entertainment)} · ${ranked.entertainment.length} ПК`}
          rows={ranked.entertainment}
          metric={(h) => formatDwell(num(h, 'entertainment_sec'))}
          onOpenHost={onOpenHost}
          highlighted={flash === 'entertainment'}
          paperRef={(el) => { cardRefs.current.entertainment = el; }}
        />
        <AttentionList
          title="Простой"
          total={`${formatDwell(kpi.idle)} · ${ranked.idle.length} ПК`}
          rows={ranked.idle}
          metric={(h) => formatDwell(idleSec(h))}
          onOpenHost={onOpenHost}
          highlighted={flash === 'idle'}
          paperRef={(el) => { cardRefs.current.idle = el; }}
        />
        <AttentionList
          title="USB"
          total={`${kpi.usbFiles} шт · ${ranked.usb.length} ПК`}
          rows={ranked.usb}
          metric={(h) => `${num(h, 'usb_files')} шт`}
          onOpenHost={onOpenHost}
          highlighted={flash === 'usb'}
          paperRef={(el) => { cardRefs.current.usb = el; }}
        />
        <AttentionList
          title="Мессенджеры"
          total={`${kpi.messengerFiles} шт · ${ranked.messenger.length} ПК`}
          rows={ranked.messenger}
          metric={(h) => `${num(h, 'messenger_files')} шт`}
          onOpenHost={onOpenHost}
          highlighted={flash === 'messenger'}
          paperRef={(el) => { cardRefs.current.messenger = el; }}
        />
      </Box>
    </Stack>
  );
}
