import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const file = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = Object.fromEntries(data.issues.map((i) => [i.id, i]));

const fe59 = byId['FE-0059'];
fe59.evidence.push(
  '[cycle16:live] Lost rotation response: after 185 s (> effective grace 180 s) the old refresh cookie -> 401 "Refresh token has been revoked". The NEW token pair issued by the rotation remained valid: /auth/me 200 and /auth/refresh 200. So the family is not revoked by the mere old-cookie rejection; the forced logout happens because the client kept only the old cookie.',
);
fe59.currentConclusion =
  'Подтверждено: при потерянном ответе ротации клиент остаётся со старой cookie; после grace старый refresh -> 401 revoked, /auth/me -> 401, принудительный logout. Новый токен, выданный ротацией, при этом остаётся живым — проблема клиентская (потеря ответа), а не отзыв family.';
fe59.reverificationHistory.push({
  cycle: 16,
  date: '2026-11-23',
  verdict: 'confirmed',
  note:
    'Lost-response probe: old token after grace -> 401 revoked; new token from the same rotation -> /auth/me 200 and /auth/refresh 200. Forced logout is caused by losing the new cookie, not by family revocation.',
  sourceFile: 'manual-live-refresh-loss-viability',
});

const fe83 = byId['FE-0083'];
fe83.evidence.push(
  '[cycle16:live] Same cookie, 3 parallel POST /auth/refresh -> [200,200,401]. Cookies from a successful response -> /auth/me 401 and /auth/refresh 401 "revoked": the third hit exceeded grace MAX_HITS and revoked the family, killing the winners too. Control: two sequential retries within grace -> [200,200], new access 200. Trigger is concurrency, not staleness.',
);
fe83.currentConclusion =
  'Подтверждено: 3 параллельных refresh с одной cookie -> [200,200,401]; family отозвана, токены даже успешных ответов дают 401. Два последовательных повтора внутри grace проходят (200), поэтому триггер — именно параллельность (несколько вкладок/visibilitychange), а не устаревание.';
fe83.reverificationHistory.push({
  cycle: 16,
  date: '2026-11-23',
  verdict: 'confirmed',
  note:
    '3 parallel refresh: [200,200,401]; new cookies from a 200 response -> 401 on /auth/me and /auth/refresh (family revoked). Sequential control within grace: [200,200], new access alive.',
  sourceFile: 'manual-live-refresh-race-family',
});

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('updated', fe59.id, fe83.id, 'history', fe59.reverificationHistory.length, fe83.reverificationHistory.length);
