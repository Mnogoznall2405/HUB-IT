import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('./audit/frontend/ISSUES.json', 'utf8'));
const rem = {
  'FE-0197': 'REM-01',
  'FE-0198': 'REM-02',
  'FE-0059': 'REM-03',
  'FE-0083': 'REM-03',
  'FE-0232': 'REM-04',
  'FE-0239': 'REM-05',
  'FE-0259': 'REM-06',
  'FE-0023': 'REM-07',
  'FE-0325': 'REM-08',
  'FE-0215': 'REM-09',
  'FE-0194': 'REM-10',
  'FE-0110': 'REM-11',
  'FE-0161': 'REM-12',
  'FE-0300': 'REM-12',
  'FE-0323': 'REM-12',
  'FE-0324': 'REM-12',
  'FE-0051': 'REM-13',
  'FE-0076': 'REM-14',
  'FE-0115': 'REM-15',
  'FE-0004': 'REM-16',
  'FE-0265': 'REM-17',
  'FE-0230': 'REM-18',
  'FE-0326': 'REM-19',
};
const rows = [];
const counts = { backlogConfirmed: 0, backlogSuspected: 0, backlogRejected: 0, confirmedDeferred: 0, rejected: 0, fixed: 0, suspectedDeferred: 0 };
for (const issue of d.issues) {
  const id = issue.id;
  let coverage = '';
  if (rem[id]) {
    if (issue.status === 'Confirmed') { coverage = `backlog (${rem[id]})`; counts.backlogConfirmed += 1; }
    else if (issue.status === 'Suspected') { coverage = `backlog (${rem[id]}, Suspected)`; counts.backlogSuspected += 1; }
    else if (issue.status === 'Rejected') { coverage = `backlog (${rem[id]}, test-infra; no app fix)`; counts.backlogRejected += 1; }
    else { coverage = `backlog (${rem[id]}, ${issue.status})`; }
  } else if (issue.status === 'Fixed-externally') {
    coverage = 'fixed-externally; no action';
    counts.fixed += 1;
  } else if (issue.status === 'Rejected') {
    coverage = 'rejected; no action';
    counts.rejected += 1;
  } else if (issue.status === 'Suspected') {
    coverage = 'suspected; not prioritized';
    counts.suspectedDeferred += 1;
  } else {
    coverage = 'confirmed; deferred (not in priority selection)';
    counts.confirmedDeferred += 1;
  }
  rows.push({ id, status: issue.status, severity: issue.severity, coverage });
}
rows.sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
if (rows.length !== d.issues.length || new Set(rows.map((r) => r.id)).size !== d.issues.length) {
  throw new Error('coverage index lost or duplicated IDs');
}
const header = `# REMEDIATION COVERAGE — все 324 записи

> Это индекс учёта, а не второй реестр. Источник — \`ISSUES.json\`.
> Приоритетный backlog — выборка, а не полный список подтверждённых дефектов.

## Сводка

| Категория | Кол-во |
|---|---|
| Приоритетный backlog: Confirmed | ${counts.backlogConfirmed} |
| Приоритетный backlog: Suspected | ${counts.backlogSuspected} |
| Приоритетный backlog: Rejected (FE-0326, test-infra) | ${counts.backlogRejected} |
| **Всего упомянуто в backlog (23 FE-ID)** | **${counts.backlogConfirmed + counts.backlogSuspected + counts.backlogRejected}** |
| Confirmed, но отложено (не в приоритетной выборке) | ${counts.confirmedDeferred} |
| Rejected, не в backlog (no action) | ${counts.rejected} |
| Fixed-externally (no action) | ${counts.fixed} |
| Suspected, не в backlog | ${counts.suspectedDeferred} |
| **Всего** | **${rows.length}** |

Проверка: ${rows.length} строк, ${new Set(rows.map((r) => r.id)).size} уникальных ID.
`;
const table = `\n## Индекс ID\n\n| ID | Status | Severity | Coverage |\n|---|---|---|---|\n${rows.map((r) => `| ${r.id} | ${r.status} | ${r.severity} | ${r.coverage} |`).join('\n')}\n`;
fs.writeFileSync('./audit/frontend/REMEDIATION_COVERAGE.md', header + table, 'utf8');
console.log(JSON.stringify({ total: rows.length, unique: new Set(rows.map((r) => r.id)).size, counts }, null, 2));
