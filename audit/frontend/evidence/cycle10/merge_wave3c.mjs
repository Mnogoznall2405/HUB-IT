// Wave 3c merge: Scan/Database/Statistics agent (120c1181).
// Deduped: #2 Statistics-revoke -> FE-0291 note; #19 openActFile -> FE-0283 note;
// #9 export-movements -> upgrade FE-0302 to Confirmed + detail.
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));
const byId = Object.fromEntries(j.issues.map(i => [i.id, i]));
byId['FE-0291'].notes += ' Особенно критично для Desktop (WPF/WebView2 использует тот же фронтенд).';
byId['FE-0283'].notes += ' Подтверждено вторым агентом: revoke только для текущего URL — проигравший утекает.';
const exp = byId['FE-0302'];
exp.status = 'Confirmed (код)';
exp.notes += ' Доп.: movements грузятся limit:500 — флаг усечения в файл не пишется.';

const F = 'WEB-itinvent/frontend/src/';
let n = 304;
const I = (title, category, severity, status, file, lines, notes) => ({
  id: 'FE-' + String(++n).padStart(4, '0'), title, category, severity, status,
  file, lines, notes,
  evidence: ['статическая проверка по file:line (цикл 11, агент Scan/Database)'],
  verification: ['static'],
});
const add = [
I('Database: crypto.randomUUID() без fallback — перенос в другую БД падает на HTTP-развёртывании','Compat/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseDbTransfer.js','58: crypto.randomUUID() внутри try — нет в не-secure context (HTTP IIS); useTransferActJob.js:32-37 имеет fallback — несогласованность','перенос оборудования всегда падает TypeError на HTTP-интранете'),
I('Database: storm-ретрай догрузки списка при падении эндпоинта — бесконечный поток запросов без backoff','ErrorHandling/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseEquipmentData.js','344-349,407-414: catch только console.error; nextEquipmentPage не сдвигается → sentinel пересоздаётся и вызывает onLoadMore снова','при 500-эндпоинте непрерывные падающие запросы + вечный спиннер'),
I('Database: тот же storm-ретрай для универсального поиска (осознанный механизм без предохранителя)','ErrorHandling/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseSearch.js','313-315: .catch(()=>{}) «next sentinel retries» без backoff/лимита/ошибки в UI','при постоянной ошибке searchUniversal — непрерывные повторные запросы'),
I('Database: метаданные (типы/статусы/филиалы) без generation-защиты — чужие справочники под новой БД','Race/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseEquipmentData.js','168-232: setEquipmentTypes/Branches/Statuses без isCurrent; refreshCurrentDbData:430-441 проверяет generation только для fetchAllEquipment','две быстрые смены БД → справочники старой БД; persisted-филиал валидируется по чужому списку'),
I('Database: ошибка первичной загрузки проглатывается — пустая база без индикации','ErrorHandling/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseEquipmentData.js','416-418: fetchAllEquipment catch только console.error; состояния ошибки нет','пользователь принимает упавшую загрузку за пустую базу'),
I('Database: «недавние карточки» без scope-защиты — чужие карточки при смене БД','Race/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseRecentCards.js','30-50,52-72,99-130: refreshRecentCards/touchRecentCard без requestId; список не чистится при dbName (в recentActs есть)','touch старой БД добавляет её позицию в список новой'),
I('Database: смена БД без busy-guard + откат селекта к stale-значению при ошибке','Race/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseSelection.js','79-99: параллельные switchDatabase → двойной database-changed-рефетч; catch откатывает к захваченному previousDbId','рассинхрон UI-селекта с реальной БД при частичном отказе'),
I('ScanCenter: ошибка observations кэшируется как «пусто» — ретрай навсегда заблокирован','ErrorHandling/Scan','Medium','Confirmed (код)',F+'pages/scan-center/ScanCenterPage.jsx','1130,1148-1155: не-append ошибка пишет {total:0,items:[]}; входной dedupe по currentBucket блокирует повтор','run показывает «изменения не найдены» до перезагрузки'),
I('Database: transfer-job поллинг продолжается ~10 мин после unmount страницы','Leaks/Database','Low','Confirmed (код)',F+'pages/database/useTransferActJob.js','155-229,39-44: хук без useEffect; seq инвалидируется только reset/новым poll','фоновый трафик после ухода со страницы'),
I('Database: setTimeout(300мс) setSelectedItems без cleanup — галочки на чужой контекст','Async/Database','Low','Confirmed (код)',F+'pages/database/useDatabaseWorkspaceIdentity.js','30-32','смена БД в окне таймера → выделение inv_no другого контекста'),
I('Database: long-press таймер карточки без unmount-cleanup — «призрачное» выделение','Gestures/Database','Low','Confirmed (код)',F+'pages/database/ModernEquipmentCard.jsx','184-200: 500мс таймер не очищается','срабатывание на размонтированной карточке → выделение невидимого элемента'),
I('Database: мёртвый prefetch чанков диалогов — guard !allEquipment?.length всегда истинен','Perf/Database','Medium','Confirmed (код)',F+'pages/database/useDatabaseListController.js','154-168: allEquipment — grouped-объект, .length===undefined → import() никогда не выполняется','первое открытие карточки всегда платит chunk-load задержку'),
I('ScanCenter: busyIncident/busyTaskAgent — одиночный слот без входного guard','BusyGuards/Scan','Low','Confirmed (код)',F+'pages/scan-center/ScanCenterPage.jsx','1486-1508,1773-1823: finally первого снимает busy второго','повторный ack до конца запроса; лишние refresh-волны'),
I('Scan: refreshFirstPage без AbortSignal — запросы наслаиваются на медленном бэкенде','Async/Scan','Low','Confirmed (код)',F+'hooks/useScanIncidentInbox.js','121-152 vs 95-104 (loadFirstPage/loadMore с signal)','отменённый запрос дочитывает трафик'),
I('ScanCenter: drawer-запросы (host incidents/runs) без abort — живут после закрытия','Async/Scan','Low','Confirmed (код)',F+'pages/scan-center/ScanCenterPage.jsx','992-997,1034-1047,1090-1093 + scanIncidents.js:20-25 (getHostScanRuns без options)','лишний трафик после смены хоста'),
I('Database: загрузчики истории обслуживания без canceled-флага — чужая история при переоткрытии','Race/Database','Low','Confirmed (код)',F+'pages/database/useDatabaseMaintenanceData.js','86-141,162-197: loadWorkConsumables/loadCartridgeHistory и далее пишут после await','окно показа истории другого оборудования'),
I('Database: deep-link openLinkedConsumable без отмены — модалка не того deeplink','Race/Database','Low','Confirmed (код)',F+'pages/database/useConsumableCard.js','242-289','быстрая навигация → last-resolved-wins модалки'),
I('Scan/UI: таймеры вспышек без cleanup (flash 120мс, pathCopied 1500мс)','Async/UI','Info','Confirmed (код)',F+'pages/scan-center/HostDrawer.jsx','192; QuickCameraDialog.jsx:71; IncidentsInboxSection.jsx:122','setState после unmount — косметический техдолг'),
I('API: getHostsFallbackFromIncidents молча усекает список хостов до incidentLimit (латентный)','Data/Scan','Low','Suspected',F+'api/scanHosts.js','123-148: метод в проде не вызывается (только тесты) — латентный риск подключения','если метод подключат — неполный список хостов без индикации'),
I('Database: справочники departments/movements с limit 500/1000 — переполнение зависит от данных','Data/Database','Low','Suspected',F+'pages/database/useDatabaseLookups.js','28-39 + useTransferFormState.js','при справочнике >лимита хвост молча недоступен в форме'),
];
j.issues.push(...add);
const c = { critical:0, high:0, medium:0, low:0, info:0, suspected:0 };
for (const it of j.issues) {
  if (String(it.status||'').startsWith('Suspected')) c.suspected++;
  const s = String(it.severity||'').toLowerCase();
  c[s==='critical'?'critical':s==='high'?'high':s==='medium'?'medium':s==='low'?'low':'info']++;
}
j.issueCounters = c;
fs.writeFileSync(DIR + 'ISSUES.json', JSON.stringify(j, null, 2) + '\n');
console.log('added', add.length, '-> total', j.issues.length, JSON.stringify(c));
