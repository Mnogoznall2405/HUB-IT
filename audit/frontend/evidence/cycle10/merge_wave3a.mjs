// Wave 3a merge: Tasks/Construction/Company/AddressBook agent (196ea00c).
import fs from 'node:fs';
const DIR = 'C:/Project/HUB-IT-main/audit/frontend/';
const j = JSON.parse(fs.readFileSync(DIR + 'ISSUES.json', 'utf8'));
const F = 'WEB-itinvent/frontend/src/';
let n = 258;
const I = (title, category, severity, status, file, lines, notes) => ({
  id: 'FE-' + String(++n).padStart(4, '0'), title, category, severity, status,
  file, lines, notes,
  evidence: ['статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company)'],
  verification: ['static'],
});
const add = [
I('Construction-workspace: нет beforeunload — черновики недельной сводки теряются при F5/закрытии','DataLoss/Construction','High','Confirmed (код)',F+'components/construction/ConstructionWorkWorkspace.jsx','dirty/useConstructionWorkLeaveGuard(dirty||saving) без beforeunload; в Panel.jsx:163-168 и TaskCanvasWorkspace.jsx:342-350 он есть','потеря несохранённой сводки/плана/посещаемости молча'),
I('Construction: data.items.find(id).version без fallback → TypeError при числовом id/исчезнувшем item','ErrorHandling/Construction','Medium','Suspected',F+'components/construction/ConstructionWorkPanel.jsx','193-195; аналог в save workspace','Object.entries(draft) ключи — строки; числовой i.id → undefined.version → generic-ошибка, черновик «залипает»'),
I('Construction-panel: эффект перезагрузки при смене scope не проверяет dirty → осиротевшие ключи черновика','State/Construction','Medium','Suspected',F+'components/construction/ConstructionWorkPanel.jsx','157-160 (нет if(dirty) return в отличие от workspace)','setData(null)+load() при живом draft → stale-черновик поверх нового scope'),
I('Tasks: закрытие диалога создания молча стирает выбранные файлы и чек-лист (несогласованно с createData)','DataLoss/Tasks','Medium','Confirmed (код)',F+'pages/tasks/hooks/useTaskCreateForm.js','343-357 (Escape/backdrop/X чистит createFiles/createChecklistItems); useTaskEditForm.js:90-91 (pending-файлы чистятся на editOpen)','тихая потеря выбранных файлов/чек-листа при случайном закрытии'),
I('Tasks: workflow-конфликт по задаче B перебивает открытую деталь задачи A (detailsTask=B)','State/Tasks','Medium','Suspected',F+'pages/tasks/hooks/useTaskWorkflowActions.js','43-55 → useTaskDetails.jsx:187-200: handleWorkflowConflict зовёт loadTaskDetails для любой конфликтной задачи','панель и URL/выделение расходятся — детали показывают чужую задачу'),
I('Tasks: loadTaskActivity глотает ошибку пустым catch — лента активности молча пуста','ErrorHandling/Tasks','Medium','Confirmed (код)',F+'pages/tasks/hooks/useTaskDetails.jsx','180-181: catch{} без индикации','вкладка выглядит «без истории» при сетевом сбое'),
I('Tasks: единый Suspense(fallback=null) на весь dialogs-слой — suspend размонтирует все открытые диалоги','React/Tasks','Low','Suspected',F+'pages/tasks/TasksDialogsLayer.jsx','28','suspend любого lazy-диалога размонтирует остальные → потеря transient-состояния пикеров'),
I('CompanyStructure: loadTree без seq/abort-guard — устаревшее дерево побеждает и делает replaceState','Race/Company','Medium','Suspected',F+'pages/CompanyStructure.jsx','144-178: параллельные вызовы применяются в порядке resolve','старший ответ перезаписывает дерево и выбор'),
I('CompanyStructure: updateUrlState через сырой history.pushState мимо роутера — ломаный back-стек','Routing/Company','Medium','Suspected',F+'pages/CompanyStructure.jsx','117-125: pushState + window.history.state со старым idx','router-location устаревает; idx-ориентированные гарды неверно считают delta'),
I('CompanyStructureOverview: ошибка layout/импорта ELK → перманентно пустой граф без ошибки и retry','ErrorHandling/Company','Medium','Confirmed (код)',F+'pages/company-structure/CompanyStructureOverview.jsx','45-52,316-381: .catch только гасит спиннер; elkInstancePromise остаётся rejected навсегда','мёртвый «Обзор» при сбое чанка — только reload помогает'),
I('CompanyStructure: ошибка getNodePeople → setPeople([]) — ложное «нет сотрудников»','ErrorHandling/Company','Low','Confirmed (код)',F+'pages/CompanyStructure.jsx','228-231','панель сотрудников молча пуста при сбое'),
I('CompanyStructure: автокомплит — isOptionEqualToValue по kind+title, key без node_id → коллизия тёзок','Data/Company','Low','Suspected',F+'pages/CompanyStructure.jsx','348,370','выбор/подсветка чужой записи при одинаковых именах'),
I('Construction-workspace: Escape/backdrop молча сбрасывает форму бригады (при этом входит в dirty)','DataLoss/Construction','Medium','Confirmed (код)',F+'components/construction/ConstructionWorkWorkspace.jsx','163: onClose=setCrewEditor(null) без confirm','потеря введённых полей crew-формы'),
I('Construction-workspace: рендер истории без optional chain → TypeError на битой записи','ErrorHandling/Construction','Low','Confirmed (код)',F+'components/construction/ConstructionWorkWorkspace.jsx','164: entry.after.targets.length без guard (асимметрично entry.before?)','диалог истории роняется на неполной записи'),
I('Construction-panel: data?.items.length===0 при необязательном data.items; entry.after.date без guard','ErrorHandling/Construction','Low','Suspected',F+'components/construction/ConstructionWorkPanel.jsx','101,110','TypeError на неполном ответе API'),
I('AddressBook: onComposeEmail продублирован в JSX — dev-предупреждение о дубле prop','Architecture/DeadCode','Info','Confirmed (код)',F+'pages/AddressBook.jsx','958-963,993-998','мёртвый проп'),
I('Construction-workspace: нет лимита 300 записей на batch (в Panel есть с сообщением)','Consistency/Construction','Low','Confirmed (код)',F+'components/construction/ConstructionWorkWorkspace.jsx','editDay/setAttendance vs Panel.jsx:184-187','payload daily/attendance неограничен → потенциальный отказ сервера'),
I('useConstructionWorkLeaveGuard: activePopGuard — модульный синглтон → гард достаётся последнему подписчику','Architecture/Guards','Medium','Suspected',F+'components/construction/useConstructionWorkLeaveGuard.js','14,129: push/replace/go мультиплексируются через Set, а popstate-гарда — только последний','Back уходит мимо гарда первого dirty-редактора при двух смонтированных'),
I('TaskCanvas: disabled читает pendingSceneRef.current в рендере — нереактивный ref','React/Tasks','Info','Confirmed (код)',F+'components/hub/tasks/TaskCanvasWorkspace.jsx','764: disabled={!pendingSceneRef.current} — работает лишь из-за парного setSaveState','хрупкая инварианта — «залипшая» кнопка при рефакторе'),
I('TaskCanvas: forbidden/error выставляет can_edit=false, но pendingSceneRef не чистится → вечный dirty','State/Tasks','Low','Suspected',F+'components/hub/tasks/TaskCanvasWorkspace.jsx','545-549','«Есть несохранённые изменения» навсегда + бесконечный beforeunload у заблокированного'),
I('TaskCanvas: inert выставляется один раз — поздние порталы остаются фокусируемыми вне aria-modal','A11y/Tasks','Low','Suspected',F+'components/hub/tasks/TaskCanvasWorkspace.jsx','367-398','утечка фокуса из pseudo-fullscreen в Snackbars/Dialogs'),
I('AddressBook: scope-ключ request-guard конкатенирует cityFilter+listMode без разделителя','Architecture/Guards','Info','Suspected',F+'pages/AddressBook.jsx','213-214','теоретическая коллизия контекста → гард пропустит чужой ответ'),
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
