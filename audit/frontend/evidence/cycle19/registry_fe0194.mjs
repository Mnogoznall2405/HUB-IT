import fs from 'node:fs';
const f = './audit/frontend/ISSUES.json';
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const i = d.issues.find((x) => x.id === 'FE-0194');
i.runtimeStatus = 'mocked-browser-reproduced';
i.verification = Array.from(new Set([...(i.verification || []), 'local-browser-mock']));
i.statusRationale =
  'Static guard is missing. Cycle19 mocked overview with a target without name reproduces TypeError "Cannot read properties of undefined (reading split)" and the route error boundary. The real backend trigger (a partial target without name) is still unproven, so the record stays Suspected; the mocked reproduction confirms the code path, not the production data condition.';
i.evidence.push(
  '[cycle19:mocked-browser] Route-mocked /monitoring/overview with one target without name: console TypeError at MonitoringDeviceGrid.jsx:29, "Route render failed", error boundary "Не удалось отобразить раздел". No real backend target without name was observed; status remains Suspected.',
);
i.reverificationHistory.push({
  cycle: 19,
  date: '2026-11-23',
  verdict: 'inconclusive',
  note: 'Mocked overview with a nameless target reproduces the split TypeError and error boundary; real backend trigger not proven. Suspected retained.',
  sourceFile: 'evidence/cycle19/fe0194-probe.cjs',
});
fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log('FE-0194 updated');
