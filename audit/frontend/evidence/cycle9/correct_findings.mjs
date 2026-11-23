// Cycle-10 corrections after runtime verification.
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));
const byId = Object.fromEntries(j.issues.map(i => [i.id, i]));

// FE-0078 REWRITE: auto-resend exists (WS outbox). Real defect = sender's own
// resent message invisible until reload. Confirmed by failing e2e spec.
const a = byId['FE-0078'];
Object.assign(a, {
  title: 'Чат: авто-реотправленное после офлайна сообщение исчезает из ленты отправителя до перезагрузки',
  category: 'Functional/Chat',
  severity: 'High',
  status: 'Confirmed (runtime)',
  file: 'WEB-itinvent/frontend/src/lib/chatSocket.js',
  lines: '657,1107-1186 (offline queue + flushQueue); слияние в ленте — useChatThreadMessageMerge.js',
  notes: 'Авто-реотправка СУЩЕСТВУЕТ: WS outbox (enqueueOfflineMessage/flushQueue, request_id сохраняется, таймаут продлевается) — peer получил сообщение без ручного retry. НО e2e chat-realtime.spec.js:185 падает на :202: после resend в ленте ОТПРАВИТЕЛЯ токен найден 0 раз (ожидалось 1) — оптимистичный failed-пузырь снят, серверная копия не смержена (дедуп по client_message_id ломается). Получатель видит сообщение, отправитель — нет до reload. Первичная формулировка «нет авто-реотправки» по коду была ошибочна — перепроверка рантаймом.',
  evidence: [
    'E2E_LOCAL=1 playwright chat-realtime.spec.js «sender is offline» → FAIL на :202 (toHaveCount(1) received 0 за 15 c)',
    ':194-199 прошли — индикатор ⚠ и авто-доставка peer-у работают',
    'trace/screenshot: test-results/chat-realtime-*reconnect-exactly-once*'
  ],
  verification: ['static', 'tooling'],
});
delete a.relatedFiles; delete a.source;

// FE-0083: runtime-confirmed — parallel refresh revokes family; sibling tab logged out.
const b = byId['FE-0083'];
b.status = 'Confirmed (runtime)';
b.evidence = [
  'probe_refresh_race.mjs (local stack): 3 параллельных POST /auth/refresh с одной кукой → [200,200,401]; далее /auth/me → 401 и во ВТОРОЙ вкладке (тот же cookie jar) → 401 — family отозвана, обе вкладки разлогинены',
  'код: http.js:54,66-76 — refreshInFlight только внутри вкладки; navigator.locks/BroadcastChannel отсутствуют',
  'backend auth.py:135 (_REFRESH_GRACE_MAX_HITS=1), 1648-1676 (grace 15 c → revoke family)'
];
b.verification = ['static', 'tooling'];
b.notes = 'Триггер в реальности: silent refresh на каждый visibilitychange (AuthContext.jsx:471-508) — пробуждение ноутбука с N вкладок → гонка внутри grace-окна → массовый logout. Потеря несохранённых черновиков — да (принудительный logout). Grace/MAX_HITS не трогать (auth-политика).';

// FE-0124: ambiguous — library switch may reset via viewParam dep.
const c = byId['FE-0124'];
c.status = 'Suspected';
c.notes = 'перепроверка: clearSelection-эффект зависит от [currentFolderId, viewParam, searchQuery, typeFilter, dateFilter] — если переключение библиотеки меняет viewParam, выделение сбрасывается корректно; дефект есть только если библиотека переключается без смены viewParam — требует рантайм-пробы.';

// FE-0082 (typing): refine — timeout key includes conversationId; collision only same-user-across-dialogs.
const d = byId['FE-0082'];
d.notes = 'перепроверка: ключ таймаутов `${conversationId}:${typingUserId}` — прямой коллизии нет; остаточный кейс: один и тот же пользователь «печатает» в двух диалогах — таймаут из старого диалога гасит индикатор в новом (список typingUsers общий).';

// FE-0136 (auth-guards spec): test debt, NOT a product defect — downgrade + reword.
const e = byId['FE-0136'];
e.severity = 'Low';
e.title = 'E2E auth-guards: ожидание редиректа оператора из /admin устарело — техдолг теста, не дефект приложения';
e.category = 'Tests/Debt';
e.notes = 'поведение приложения корректно по текущей политике прав (operator + scan.tasks ∈ ADMIN_AREA_PERMISSIONS); падение спеки — устаревшее ожидание, красный набор маскирует регрессии. Не дефект продукта.';

// recalc counters
const cnt = { critical:0, high:0, medium:0, low:0, info:0, suspected:0 };
for (const it of j.issues) {
  if (String(it.status||'').startsWith('Suspected')) cnt.suspected++;
  const s = String(it.severity||'').toLowerCase();
  if (s==='critical') cnt.critical++; else if (s==='high') cnt.high++;
  else if (s==='medium') cnt.medium++; else if (s==='low') cnt.low++; else cnt.info++;
}
j.issueCounters = cnt;
fs.writeFileSync(DIR + 'ISSUES.json', JSON.stringify(j, null, 2) + '\n');
console.log('corrected; counters:', JSON.stringify(cnt));
