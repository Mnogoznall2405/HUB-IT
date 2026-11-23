import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const file = `${DIR}/ISSUES.json`;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = Object.fromEntries(data.issues.map((i) => [i.id, i]));

// FE-0215 — remove the obsolete IMAP/SMTP assumption from current metadata
const fe0215 = byId['FE-0215'];
fe0215.statusRationale =
  'Static mechanism confirmed. The mail transport is Exchange EWS (exchangelib), not IMAP/SMTP; no EWS test server or mailbox exists, and the isolated stack sets MAIL_MODULE_ENABLED=0. The cycle15 "no IMAP/SMTP fixture" blocker is obsolete: an IMAP/SMTP fixture would not exercise this backend. A full E2E remains blocked; only a limited service-level EWS contract test with a fake Account/Message is possible.';
fe0215.currentConclusion =
  'Static remains confirmed. Live E2E is blocked: Exchange EWS, no EWS test server/mailbox, MAIL_MODULE_ENABLED=0. IMAP/SMTP is not applicable. A limited service-level contract test could check the draft HTML/attachments payload, but not UI->EWS autosave/reopen.';
fe0215.reverificationHistory.push({
  cycle: 19,
  date: '2026-11-23',
  verdict: 'blocked',
  note: 'Current metadata corrected: EWS only; the old IMAP/SMTP fixture assumption is obsolete. Full E2E still requires an EWS test server; limited service-level mock is the only safe next step.',
  sourceFile: 'evidence/cycle18/fe0215-ews-analysis.md',
});

// FE-0232 / FE-0239 / FE-0259 — current metadata no longer says "blocked"
for (const id of ['FE-0232', 'FE-0239', 'FE-0259']) {
  const issue = byId[id];
  issue.statusRationale =
    `Live reproduced and revalidated with strict assertions (cycles 17-18). The cycle15 "no fixtures/mutations" blocker is historical and preserved in reverificationHistory; the scenario is now reproducible on the isolated stack.`;
  issue.reverificationHistory.push({
    cycle: 19,
    date: '2026-11-23',
    verdict: 'confirmed',
    note: 'Metadata sync: status remains Confirmed; runtimeStatus reproduced-live; old cycle15 blocker moved to history. No new runtime test was needed in cycle19.',
    sourceFile: 'AUDIT_FINAL_REVIEW.md',
  });
}

// FE-0326 — refuted: the corrupt preview came from an invalid test fixture
const fe0326 = byId['FE-0326'];
const old0326Title = fe0326.title;
fe0326.status = 'Rejected';
fe0326.severity = 'Medium'; // historical severity, kept for history
fe0326.runtimeStatus = 'rejected-false-positive';
fe0326.title = 'My Files: PNG-превью — отклонено (повреждённый тестовый PNG; valid PNG обрабатываются корректно)';
fe0326.titleHistory = [
  ...(fe0326.titleHistory || []),
  {
    title: old0326Title,
    changedInCycle: 19,
    date: '2026-11-23',
    reason:
      'Cycle19 refuted the claim: the cycle18 fixture was an invalid 180-byte PNG (IDAT CRC mismatch); the app did not corrupt it. The test fixture is now valid and the preview pipeline passes.',
  },
];
fe0326.statusRationale =
  'Rejected as a false positive. Cycle19 matrix: valid small (32x32, 117 B), medium (512x512, 4,485 B) and large (1600x1200, 5.77 MB) PNGs were uploaded; private/public previews returned valid WebP or the original PNG (medium SHA matched the source), Pillow/browser decoded, natural sizes 32/512/1600, no visual errors, original downloads matched. The cycle18 artifact came from the test fixture: a 180-byte PNG with IHDR valid but IDAT CRC mismatch, 6 trailing bytes and zlib error; the app stored and served that invalid source unchanged. The image optimizer skipped it (Pillow could not decode it), so preview.png was the invalid source. No app corruption stage was found. The test fixture was fixed to a valid 186-byte 64x64 PNG; MyFiles E2E passes with 0 observations.';
fe0326.currentConclusion =
  'Rejected / false positive: the corrupt preview was caused by an invalid test PNG, not by the app. Valid PNGs of different sizes/formats produce valid private/public previews and downloads. The test fixture is fixed; no remediation task for the app is required.';
fe0326.recommendation =
  'No app fix. Keep only validated PNG fixtures in audit tests; add a fixture-decode check to the E2E test bootstrap so an invalid source cannot be reported as an app defect.';
fe0326.evidence.push(
  '[cycle19:matrix] Valid PNGs small 32x32 (117 B, SHA aac8...), medium 512x512 (4,485 B, SHA f440...), large 1600x1200 (5,769,402 B, SHA 9561...) uploaded via UI. Preview worker ready; private/public preview: small image/webp 80 B, medium image/png 4,485 B with SHA equal to the original, large image/webp 1,437,182 B. Browser img.complete true, natural sizes 32/512/1600, no visual error. Original private/public downloads matched the source SHA. No corruption.',
);
fe0326.evidence.push(
  '[cycle19:root-cause] The cycle18 "corrupt" source was the 180-byte base64 fixture in five-e2e: IHDR valid, IDAT length 129 with CRC mismatch, 6 trailing bytes, zlib "incorrect data check"; Pillow failed on the source itself. The app stored the invalid source and served it as preview.png; the image optimization path skipped it. The exact corruption is in the test fixture, not in the app or the preview worker.',
);
fe0326.reverificationHistory.push({
  cycle: 19,
  date: '2026-11-23',
  verdict: 'rejected',
  note: 'Matrix with valid small/medium/large PNGs: previews valid, browser/Pillow decode, public/private downloads intact. Cycle18 artifact traced to an invalid 180-byte test fixture (IDAT CRC mismatch); fixture fixed; MyFiles E2E 12/12, 0 observations.',
  sourceFile: 'evidence/cycle19/fe0326-matrix.cjs',
});

data.highBreakdown = {
  historical: 12,
  historicalHigh: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0078', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
  current: 11,
  activeHigh: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0215', 'FE-0230', 'FE-0232', 'FE-0239', 'FE-0259'],
  fixedHigh: ['FE-0078'],
  runtimeProven: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0078', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0232', 'FE-0239', 'FE-0259'],
  unresolvedRuntime: ['FE-0022', 'FE-0023', 'FE-0059', 'FE-0083', 'FE-0197', 'FE-0198', 'FE-0232', 'FE-0239', 'FE-0259'],
  fixedExternally: ['FE-0078'],
  staticOnly: ['FE-0215'],
  runtimeNotReproduced: ['FE-0230'],
  suspectedHigh: ['FE-0230'],
  blockedEnvironment: ['FE-0215'],
};

const counts = { confirmed: 0, suspected: 0, fixed: 0, rejected: 0, high: 0, medium: 0, low: 0, info: 0 };
for (const issue of data.issues) {
  if (issue.status === 'Confirmed') counts.confirmed += 1;
  else if (issue.status === 'Suspected') counts.suspected += 1;
  else if (issue.status === 'Fixed-externally') counts.fixed += 1;
  else if (issue.status === 'Rejected') counts.rejected += 1;
  if (issue.severity === 'High') counts.high += 1;
  else if (issue.severity === 'Medium') counts.medium += 1;
  else if (issue.severity === 'Low') counts.low += 1;
  else if (issue.severity === 'Info') counts.info += 1;
}
data.issueCounters = {
  critical: 0,
  high: counts.high,
  medium: counts.medium,
  low: counts.low,
  info: counts.info,
  suspected: counts.suspected,
  fixedExternally: counts.fixed,
  rejected: counts.rejected,
  confirmed: counts.confirmed,
  total: data.issues.length,
};

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('updated FE-0215/0232/0239/0259/0326; total', data.issues.length, JSON.stringify(data.issueCounters));
