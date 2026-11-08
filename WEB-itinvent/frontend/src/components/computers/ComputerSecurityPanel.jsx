import React from 'react';
import { Chip, Paper, Stack, Typography } from '@mui/material';

const flag = (label, ok, okText = 'да', badText = 'нет') => (
  <Chip
    key={label}
    size="small"
    variant="outlined"
    color={ok === true ? 'success' : ok === false ? 'warning' : 'default'}
    label={`${label}: ${ok === true ? okText : ok === false ? badText : 'нет данных'}`}
  />
);

const signatureAgeDays = (iso) => {
  const parsed = Date.parse(String(iso || ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
};

export default function ComputerSecurityPanel({ security, agentRuntime }) {
  const sec = security && typeof security === 'object' ? security : {};
  const runtime = agentRuntime && typeof agentRuntime === 'object' ? agentRuntime : {};
  const sidecars = runtime.sidecars && typeof runtime.sidecars === 'object' ? runtime.sidecars : {};
  const egress = sidecars.fs_egress && typeof sidecars.fs_egress === 'object' ? sidecars.fs_egress : null;
  const firewall = Array.isArray(sec.firewall) ? sec.firewall : [];
  const admins = Array.isArray(sec.local_admins) ? sec.local_admins : [];
  const volumes = Array.isArray(sec.bitlocker_volumes) ? sec.bitlocker_volumes : [];
  const defender = sec.defender && typeof sec.defender === 'object' ? sec.defender : null;
  const age = defender ? signatureAgeDays(defender.signature_updated) : null;
  const hasPosture = firewall.length > 0 || defender || admins.length > 0 || volumes.length > 0
    || typeof sec.rdp_enabled === 'boolean' || typeof sec.secure_boot === 'boolean' || sec.tpm;

  return (
    <Paper variant="outlined" sx={{ p: 1.4 }} data-testid="computer-security">
      <Stack spacing={0.9}>
        {hasPosture ? (
          <>
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              {firewall.length > 0
                ? flag('Брандмауэр', firewall.every((item) => item.enabled), 'включён', 'есть выключенные профили')
                : null}
              {defender ? flag('Defender в реальном времени', defender.realtime, 'включён', 'выключен') : null}
              {typeof sec.rdp_enabled === 'boolean' ? flag('RDP', !sec.rdp_enabled, 'закрыт', 'открыт') : null}
              {typeof sec.secure_boot === 'boolean' ? flag('Secure Boot', sec.secure_boot) : null}
              {sec.tpm ? flag('TPM', Boolean(sec.tpm.present && sec.tpm.ready), 'готов', 'нет или не готов') : null}
            </Stack>
            {defender?.signature_updated ? (
              <Typography variant="body2" color={age !== null && age > 7 ? 'warning.main' : 'text.primary'}>
                Базы Defender: {age === null ? defender.signature_updated : `обновлены ${age} дн. назад`}
                {defender.signature_version ? ` (${defender.signature_version})` : ''}
              </Typography>
            ) : null}
            {volumes.length > 0 ? (
              <Typography variant="body2">
                BitLocker: {volumes.map((item) => `${item.mount} — ${item.protection || '?'}`).join(', ')}
              </Typography>
            ) : null}
            {admins.length > 0 ? (
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                Локальные администраторы: {admins.join(', ')}
              </Typography>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Расширенные данные о безопасности присылает агент версии 1.4.14 и выше.
          </Typography>
        )}
        {egress ? (
          <Typography variant="body2" color={egress.enabled && !egress.alive ? 'warning.main' : 'text.primary'}>
            Слежение за файлами: {egress.enabled ? (egress.alive ? 'работает' : 'не запущено') : 'выключено'}
            {egress.enabled && Number.isFinite(Number(egress.pending)) ? ` · в очереди ${egress.pending}` : ''}
            {egress.enabled && Number(egress.dead_letter) > 0 ? ` · не отправлено ${egress.dead_letter}` : ''}
          </Typography>
        ) : null}
        {sidecars.telegram_probe?.enabled ? (
          <Typography variant="body2" color={sidecars.telegram_probe.running ? 'text.primary' : 'warning.main'}>
            Проба Telegram: {sidecars.telegram_probe.running ? 'работает' : 'не запущена'}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
