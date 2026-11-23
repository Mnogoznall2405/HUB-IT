#!/usr/bin/env node
/*
 * Cycle 18 — negative controls for the asserted E2E suite.
 *
 * The suite must FAIL (exit 1) when a mandatory condition is broken:
 * API error, missing save, corrupted/wrong record, duplicate, hidden record,
 * and login timeout. A clean feed run must PASS (exit 0).
 *
 * Run from WEB-itinvent/frontend:
 *   NODE_PATH=<frontend>/node_modules BASE_URL=http://127.0.0.1:5228 \
 *   SHOT_DIR=<audit>/audit/frontend/evidence/cycle18/shots \
 *   node audit/frontend/evidence/cycle18/negative-controls.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SUITE = path.join(DIR, 'five-e2e.cjs');
const OUT = path.join(process.env.SHOT_DIR || path.join(process.cwd(), 'cycle18-shots'), 'negative-controls.json');
const cases = [
  { name: 'positive_feed', scenario: 'feed', control: '', expectExit: 0 },
  { name: 'feed_api_error', scenario: 'feed', control: 'feed_api_error', expectExit: 1 },
  { name: 'feed_wrong_record', scenario: 'feed', control: 'feed_wrong_record', expectExit: 1 },
  { name: 'tasks_save_noop', scenario: 'tasks', control: 'tasks_save_noop', expectExit: 1 },
  { name: 'tasks_duplicate', scenario: 'tasks', control: 'tasks_duplicate', expectExit: 1 },
  { name: 'chat_duplicate', scenario: 'chat', control: 'chat_duplicate', expectExit: 1 },
  { name: 'myfiles_hide', scenario: 'myFiles', control: 'myfiles_hide', expectExit: 1 },
  { name: 'myfiles_duplicate', scenario: 'myFiles', control: 'myfiles_duplicate', expectExit: 1 },
  { name: 'admin_hide', scenario: 'adminUsers', control: 'admin_hide', expectExit: 1 },
  { name: 'admin_duplicate', scenario: 'adminUsers', control: 'admin_duplicate', expectExit: 1 },
  { name: 'login_timeout', scenario: 'feed', control: 'login_timeout', expectExit: 1 },
];

const results = [];
for (const item of cases) {
  const env = {
    ...process.env,
    ONLY: item.scenario,
    NEGATIVE_CONTROL: item.control,
  };
  const started = Date.now();
  const run = spawnSync(process.execPath, [SUITE], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  let scenario = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && parsed.name && typeof parsed.pass === 'boolean') { scenario = parsed; break; }
    } catch (e) {}
  }
  const okExit = run.status === item.expectExit;
  const okOutcome = item.expectExit === 0
    ? Boolean(scenario && scenario.pass === true)
    : Boolean((scenario && scenario.pass === false) || run.status !== 0);
  const record = {
    name: item.name,
    scenario: item.scenario,
    control: item.control || null,
    expectedExit: item.expectExit,
    actualExit: run.status,
    scenarioPass: scenario ? scenario.pass : null,
    failedChecks: scenario ? scenario.failed : null,
    error: scenario ? String(scenario.error || '').slice(0, 260) : null,
    ok: okExit && okOutcome,
    ms: Date.now() - started,
  };
  results.push(record);
  console.log(JSON.stringify(record));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ cases: results }, null, 2));
}
const failed = results.filter((r) => !r.ok);
console.log('NEGATIVE_SUMMARY ' + JSON.stringify({ total: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
