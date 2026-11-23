// Wave 3b merge: Computers/Transfer/Equipment/DLP/Statistics agent (f16c1c18).
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));
const F = 'WEB-itinvent/frontend/src/';
let n = 280;
const I = (title, category, severity, status, file, lines, notes) => ({
  id: 'FE-' + String(++n).padStart(4, '0'), title, category, severity, status,
  file, lines, notes,
  evidence: ['статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP)'],
  verification: ['static'],
});
const add = [
I('Computers: незащищённые localStorage.getItem в инициализаторах useState → крах страницы при заблокированном storage','Reliability/Storage','Medium','Confirmed (код)',F+'pages/Computers.jsx','883,884,887,888,889; EmployeeHistoryPanel.jsx:155 — useState(()=>localStorage.getItem()) без try','SecurityError в render-инициализаторе → белый экран; в том же файле readRecentSearches обёрнуты в try — несогласованность'),
I('Computers: незащищённые localStorage.setItem в эффектах (флаги/seen-карта до 500 записей)','Reliability/Storage','Low','Confirmed (код)',F+'pages/Computers.jsx','1405,1409,1413,1417,1427,1455; EmployeeHistoryPanel.jsx:157','переполнение квоты/blocked storage → исключение из эффекта'),
I('Database: гонка openActFile — нет seq-guard + утечка blob-URL при клике по акту B во время загрузки A','Race/Database','Medium','Confirmed (код)',F+'pages/database/useEquipmentActFilePreview.js','47-165: objectUrlRef перетирается без revoke; ответ A может перезаписать preview чужим файлом','показ не того акта + утечка object-URL (у useMovementDetail filePreviewSequenceRef есть)'),
I('ItObjects: тихая потеря несохранённых правок матрицы доступа при сохранении соседней строки','DataLoss/ItObjects','Medium','Confirmed (код)',F+'components/itObjects/ObjectAccessMatrix.jsx','45-46: useEffect сбрасывает values при новой ссылке person.sections (каждый load создаёт новый)','правки строки A стираются при save строки B или «Обновить»'),
I('ItObjects: отзыв всего доступа пользователя одним кликом без подтверждения','UX/ItObjects','Low','Confirmed (код)',F+'components/itObjects/ObjectAccessMatrix.jsx','61-70: IconButton → onSave(userId, all NONE)','случайный отзыв доступа без confirm'),
I('ItObjects: «Снять» ответственного объекта без подтверждения','UX/ItObjects','Low','Confirmed (код)',F+'pages/ItObjectDetail.jsx','298-308: немедленный clearOwner (удаление объекта — через диалог)','объект без владельца одним кликом'),
I('Database: stale loc_no остаётся в состоянии при «пустом» поле локации после смены филиала','State/Transfer','Medium','Confirmed (код)',F+'pages/database/useTransferFormState.js','232-261 + LocationAutocompleteField.jsx:79-82: options.find→null (поле пустое), а transferLocationNo держит старый id → уходит в payload','перемещение в неправильную локацию или ошибка сервера'),
I('ItObjects: панель паролей объекта тихо обрезана до 100 записей без индикатора','Data/ItObjects','Low','Confirmed (код)',F+'components/itObjects/ObjectPasswordsPanel.jsx','17,52: limit=100 без «показано N из M»','часть паролей невидима (в SectionSummary есть «100+» — несогласованность)'),
I('Statistics: обновление статистики после чистки обходит seq-guard → данные не того периода','Race/Statistics','Low','Confirmed (код)',F+'pages/Statistics.jsx','598 (loadPcStats с isCurrent=()=>true) + :239-242','смена периода во время запроса → ответ старого периода перезаписывает; ошибка глотается .catch(()=>{})'),
I('Statistics: немедленный revokeObjectURL после anchor.click() при экспорте Excel','Download/Statistics','Low','Confirmed (код)',F+'pages/Statistics.jsx','324-331 (нет задержки, у useTransferActJob:147-148 — 60 с)','пустой/битый xlsx в части браузеров'),
I('ItObjects: loadFree в диалоге мониторинг-устройств без abort/seq — stale список','Race/ItObjects','Low','Confirmed (код)',F+'components/itObjects/ObjectMonitoringDevicesDialog.jsx','24-38','устаревший список свободных устройств при переоткрытии'),
I('ItObjects: тихий провал загрузки филиалов в диалоге создания → объект создаётся без привязки','ErrorHandling/ItObjects','Low','Confirmed (код)',F+'components/itObjects/ObjectCreateDialog.jsx','22-24: catch→setBranches([])','пользователь видит только «Без привязки» без признака сбоя'),
I('Database: unhandled rejection при провале копирования расхождений','ErrorHandling/Database','Low','Confirmed (код)',F+'pages/database/useDiscrepanciesCopy.js','55-64 + lib/clipboard.js:28: handleCopy без try/catch','кнопка молчит без объяснения (актуально WebView2/HTTP)'),
I('Database: список ошибок перемещения обрезан до 5 без пометки «и ещё N»','UX/Transfer','Low','Confirmed (код)',F+'pages/database/TransferActionContent.jsx','344: result.failed.slice(0,5)','retry идёт по полному списку — пользователь видит меньше ошибок'),
I('Database: ошибка поиска принтеров неотличима от «не найдено»','ErrorHandling/Database','Low','Confirmed (код)',F+'pages/database/useConsumableQrPrinterPicker.js','161-163: catch→setSearchResults([])','сетевой сбой выглядит как пустой результат'),
I('DLP: «Обновить»/«Актуальный отчёт» без busy-guard — дубли запросов/отчётов','BusyGuards/DLP','Low','Confirmed (код)',F+'pages/FileEgress.jsx','163-178,253-262,308','параллельные load; двойной клик = два отчёта'),
I('DLP: тихий провал загрузки скриншота браузерного визита','ErrorHandling/DLP','Low','Confirmed (код)',F+'components/dlp/BrowserVisitsPanel.jsx','205-206: catch{setUrl(\"\")}','кнопка «Снимок» возвращается в исходное без объяснения'),
I('DLP: строки таблицы хостов/доменов доступны только мышью (без tabIndex/onKeyDown)','A11y/DLP','Low','Confirmed (код)',F+'components/dlp/DlpHostList.jsx','412-416 + BrowserVisitsPanel.jsx:629-635','клавиатурный пользователь не откроет хост/домен'),
I('Statistics: setItems после cancelled в reloadRemaining — запись на размонтированном диалоге','Leaks/Statistics','Low','Confirmed (код)',F+'pages/statistics/PcRemainingDialog.jsx','82-90: .then пишет без проверки cancelled (есть только в catch/finally)','устаревший список при переоткрытии'),
I('DLP: список telegram/max-чатов обрезан limit=200 без индикатора','Data/DLP','Low','Suspected',F+'pages/FileEgress.jsx','220-235','>200 диалогов → хвост молча невидим'),
I('Database: поиск получателя/сотрудника без AbortController + устаревшие options при ошибке','Race/Transfer','Low','Suspected',F+'pages/database/useTransferEmail.js','50-58 + useTransferFormState.js:129-144','старый запрос грузит сеть; ошибка → только console.error, options устаревают'),
I('Database: экспорт оборудования без листа перемещений при падении prefetch — только console.warn','ErrorHandling/Transfer','Low','Suspected',F+'pages/database/useEmployeeEquipmentExport.js','41-53','пользователь получает неполный Excel без предупреждения'),
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
