import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const file = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = Object.fromEntries(data.issues.map((i) => [i.id, i]));

const fe59 = byId['FE-0059'];
const oldTitle = fe59.title;
fe59.title = 'Потеря ответа ротации refresh-токена принудительно разлогинивает после истечения grace';
fe59.titleHistory = [
  {
    title: oldTitle,
    changedInCycle: 17,
    date: '2026-11-23',
    reason:
      'The historical title named "15 s" as if it were a universal threshold. 15 s is only the code default; the stand value is configurable (180 s in cycle 16 with root .env, 15 s in the clean cycle-17 stand).',
  },
];
fe59.evidence.push(
  '[cycle17:live] Clean stand b95c4cac, effective grace 15 s (code default), MAX_HITS=1. A: rotate + one sequential stale retry -> both 200; first new access/refresh still 200. D: after grace the stale cookie -> 401 revoked, while the new token from the rotation -> /auth/me 200 and /auth/refresh 200. Confirms the lost-response logout is client-side and is not family revocation.',
);
fe59.currentConclusion =
  'Подтверждено: при потерянном ответе ротации клиент остаётся со старой cookie и после grace получает 401 revoked; новый токен той же ротации при этом жив (A/D: 200). Причина принудительного logout — потеря нового ответа клиентом, а не отзыв family. Порог grace не универсален: код-дефолт 15 с, значение переопределяется окружением (на стенде цикла 16 — 180 с).';
fe59.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'confirmed',
  note:
    'A: one stale retry within grace -> 200, first new token access/refresh 200. D: stale after grace -> 401 revoked, new token access/refresh 200. Lost-response logout confirmed; family not revoked.',
  sourceFile: 'manual-live-refresh-matrix',
});

const fe83 = byId['FE-0083'];
fe83.evidence.push(
  '[cycle17:live] Clean stand b95c4cac, grace 15 s, MAX_HITS=1, four isolated families. A: one sequential stale retry -> 200, first new access/refresh 200. B: two sequential stale retries -> [200,401 expired/already used], first new access/refresh 401 revoked. C: three parallel -> [200,200,401], both winner access/refresh 401. D: stale after grace -> 401 revoked, new access/refresh 200. The family is revoked by the reuse that exceeds MAX_HITS=1, not by concurrency per se; parallel refresh only produces the excess reuse faster.',
);
fe83.currentConclusion =
  'Подтверждено: family отзывается при превышении лимита повторного использования старой cookie (MAX_HITS=1), а не из-за параллельности как таковой. A: один последовательный повтор -> 200, новый токен жив. B: два последовательных -> второй 401, family отозвана, новый токен мёртв. C: три параллельных -> [200,200,401], оба победителя мертвы. D: после grace старый токен 401, новый жив. Параллельный refresh — практический триггер, ускоряющий превышение лимита.';
fe83.reverificationHistory.push({
  cycle: 17,
  date: '2026-11-23',
  verdict: 'confirmed',
  note:
    'A-D matrix: one stale retry survives; the second reuse revokes the family; 3 parallel behaves like two retries; after-grace rejection does not revoke the new token. Root cause is reuse count, not concurrency.',
  sourceFile: 'manual-live-refresh-matrix',
});

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('updated FE-0059 title+history, FE-0083 conclusion; titleHistory added');
