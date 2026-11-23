#!/usr/bin/env node
/*
 * Cycle 19 — hardened negative-control runner.
 *
 * A negative control is validated only when:
 *   - the expected scenario actually started (a scenario record exists);
 *   - the test-only injection was applied (scenario.controls contains it);
 *   - the scenario failed for the expected reason (a specific failed check, or
 *     the expected login timeout);
 *   - no infrastructure error is present.
 *
 * A random browser/test-runner crash is classified INFRA_FAILURE and is never
 * counted as a successful negative control. A dedicated meta-case forces a
 * missing browser channel and asserts exactly that.
 *
 * Run from WEB-itinvent/frontend with the same env as five-e2e.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SUITE = path.join(DIR, 'five-e2e.cjs');
const OUT = process.env.SHOT_DIR || path.join(process.cwd(), 'cycle19-shots');
const RUNS = path.join(OUT, 'negative-runs');
fs.mkdirSync(RUNS, { recursive: true });

const cases = [
  { name: 'positive_feed', scenario: 'feed', control: '', expect: 'PASS' },
  { name: 'feed_api_error', scenario: 'feed', control: 'feed_api_error', expect: 'EXPECTED_FAILURE', checks: ['feed.dialogClosed', 'feed.visibleAfterPublish', 'feed.apiCreated'] },
  { name: 'feed_wrong_record', scenario: 'feed', control: 'feed_wrong_record', expect: 'EXPECTED_FAILURE', checks: ['feed.apiCreated', 'feed.visibleAfterReload', 'feed.persistedAfterReload', 'feed.sameRecordAfterReload'] },
  { name: 'tasks_save_noop', scenario: 'tasks', control: 'tasks_save_noop', expect: 'EXPECTED_FAILURE', checks: ['tasks.editedAfterReload', 'tasks.descriptionPersisted', 'tasks.editedVisible'] },
  { name: 'tasks_duplicate', scenario: 'tasks', control: 'tasks_duplicate', expect: 'EXPECTED_FAILURE', checks: ['tasks.uniqueAfterCreate', 'tasks.noTaskDuplicates'] },
  { name: 'chat_duplicate', scenario: 'chat', control: 'chat_duplicate', expect: 'EXPECTED_FAILURE', checks: ['chat.apiDuplicatesZero', 'chat.apiFirstCount', 'chat.apiSecondCount'] },
  { name: 'myfiles_hide', scenario: 'myFiles', control: 'myfiles_hide', expect: 'EXPECTED_FAILURE', checks: ['myfiles.createdInApi', 'myfiles.previewReady', 'myfiles.visibleAfterReload'] },
  { name: 'myfiles_duplicate', scenario: 'myFiles', control: 'myfiles_duplicate', expect: 'EXPECTED_FAILURE', checks: ['myfiles.uniqueAfterUpload', 'myfiles.apiUniqueAfterReload'] },
  { name: 'admin_hide', scenario: 'adminUsers', control: 'admin_hide', expect: 'EXPECTED_FAILURE', checks: ['admin.createdInApi', 'admin.visibleAfterReload', 'admin.apiUniqueAfterReload'] },
  { name: 'admin_duplicate', scenario: 'adminUsers', control: 'admin_duplicate', expect: 'EXPECTED_FAILURE', checks: ['admin.uniqueAfterCreate', 'admin.apiUniqueAfterReload'] },
  { name: 'login_timeout', scenario: 'feed', control: 'login_timeout', expect: 'EXPECTED_FAILURE', timeout: true },
  { name: 'meta_browser_launch_error', scenario: 'feed', control: 'feed_api_error', expect: 'INFRA_FAILURE', browserChannel: '__missing__' },
];

const INFRA_PATTERNS = [
  /browserType\.launch/i,
  /Executable doesn't exist/i,
  /Chromium distribution .* is not found/i,
  /net::ERR_CONNECTION_REFUSED/i,
  /ECONNREFUSED/i,
  /connectOverCDP/i,
  /Target page, context or browser has been closed/i,
  /spawn .* ENOENT/i,
  /MODULE_NOT_FOUND/i,
  /Cannot find module/i,
];

function parseScenario(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && parsed.name && typeof parsed.pass === 'boolean') return parsed;
    } catch (e) {}
  }
  return null;
}

function classify(item, run) {
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const scenario = parseScenario(output);
  const infra = INFRA_PATTERNS.find((re) => re.test(output));
  const base = {
    started: Boolean(scenario),
    injectionApplied: Boolean(scenario && Array.isArray(scenario.controls) && scenario.controls.includes(item.control)),
    scenarioPass: scenario ? scenario.pass : null,
    failedChecks: scenario ? scenario.failedChecks || [] : [],
    error: scenario ? String(scenario.error || '').slice(0, 240) : String(output).slice(-400),
    infraPattern: infra ? String(infra) : null,
  };
  if (item.expect === 'PASS') {
    if (scenario && scenario.pass === true) return { ...base, classification: 'PASS', countedAsExpected: false };
    return { ...base, classification: scenario ? 'UNEXPECTED_FAILURE' : 'INFRA_FAILURE', countedAsExpected: false };
  }
  if (item.expect === 'INFRA_FAILURE') {
    const classification = infra ? 'INFRA_FAILURE' : (scenario && scenario.pass === false ? 'UNEXPECTED_FAILURE' : 'UNEXPECTED_FAILURE');
    return { ...base, classification, countedAsExpected: false };
  }
  // EXPECTED_FAILURE
  if (!scenario) return { ...base, classification: infra ? 'INFRA_FAILURE' : 'UNEXPECTED_FAILURE', countedAsExpected: false };
  if (scenario.pass === true) return { ...base, classification: 'PASS', countedAsExpected: false };
  if (infra) return { ...base, classification: 'INFRA_FAILURE', countedAsExpected: false };
  if (item.control && !base.injectionApplied) return { ...base, classification: 'UNEXPECTED_FAILURE', countedAsExpected: false };
  if (item.timeout) {
    const expectedTimeout = /waitForURL[\s\S]*Timeout|Timeout[\s\S]*waitForURL/i.test(base.error || output);
    return { ...base, classification: expectedTimeout ? 'EXPECTED_FAILURE' : 'UNEXPECTED_FAILURE', countedAsExpected: expectedTimeout };
  }
  const expectedCheck = (item.checks || []).some((name) => base.failedChecks.includes(name));
  return { ...base, classification: expectedCheck ? 'EXPECTED_FAILURE' : 'UNEXPECTED_FAILURE', countedAsExpected: expectedCheck };
}

const results = [];
for (const item of cases) {
  const env = {
    ...process.env,
    ONLY: item.scenario,
    NEGATIVE_CONTROL: item.control,
    SHOT_DIR: RUNS,
    BROWSER_CHANNEL: item.browserChannel || process.env.BROWSER_CHANNEL || 'chrome',
  };
  const started = Date.now();
  const run = spawnSync(process.execPath, [SUITE], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });
  const classification = classify(item, run);
  const ok = item.expect === 'PASS'
    ? classification.classification === 'PASS'
    : item.expect === 'INFRA_FAILURE'
      ? classification.classification === 'INFRA_FAILURE' && classification.countedAsExpected === false
      : classification.classification === 'EXPECTED_FAILURE' && classification.countedAsExpected === true;
  const record = {
    name: item.name,
    scenario: item.scenario,
    control: item.control || null,
    expected: item.expect,
    exit: run.status,
    classification: classification.classification,
    countedAsExpected: classification.countedAsExpected,
    started: classification.started,
    injectionApplied: classification.injectionApplied,
    scenarioPass: classification.scenarioPass,
    failedChecks: classification.failedChecks,
    error: classification.error,
    infraPattern: classification.infraPattern,
    ok,
    ms: Date.now() - started,
  };
  results.push(record);
  console.log(JSON.stringify(record));
  fs.writeFileSync(path.join(OUT, 'negative-controls.json'), JSON.stringify({ cases: results }, null, 2));
}

const validatedNegatives = results.filter((r) => r.expected === 'EXPECTED_FAILURE' && r.classification === 'EXPECTED_FAILURE' && r.countedAsExpected).length;
const infraMeta = results.find((r) => r.name === 'meta_browser_launch_error');
const positive = results.find((r) => r.name === 'positive_feed');
const unexpected = results.filter((r) => !r.ok);
const summary = {
  total: results.length,
  validatedNegatives,
  unexpected: unexpected.length,
  positivePass: Boolean(positive && positive.classification === 'PASS'),
  infraMetaClassified: Boolean(infraMeta && infraMeta.classification === 'INFRA_FAILURE' && infraMeta.countedAsExpected === false),
  infraMetaCountedAsExpected: Boolean(infraMeta && infraMeta.countedAsExpected),
};
console.log('NEGATIVE_SUMMARY ' + JSON.stringify(summary));
process.exit(unexpected.length === 0 && validatedNegatives === 10 && summary.positivePass && summary.infraMetaClassified ? 0 : 1);

