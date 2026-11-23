#!/usr/bin/env node
/*
 * Cycle 17 — refresh rotation matrix (FE-0059 / FE-0083).
 *
 * Uses only the isolated local backend. Effective grace on this stand is the
 * code default 15 s (REFRESH_ROTATION_GRACE_SECONDS is not set); MAX_HITS=1.
 *
 * Run:
 *   $env:BASE_URL='http://127.0.0.1:18007/api/v1'
 *   node audit/frontend/evidence/cycle17/refresh-matrix.cjs
 *
 * Output contains status codes only, no tokens/cookies.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18007/api/v1';
const USER = process.env.E2E_USER || 'e2e_admin';
const PASS = process.env.E2E_PASS || 'e2e-local-admin-pass';
const GRACE_SECONDS = Number(process.env.GRACE_SECONDS || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jarOf(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return jarOf(res);
}

async function refresh(jar) {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { Cookie: jar } });
  const body = await res.text();
  return { status: res.status, detail: body.slice(0, 120), jar: jarOf(res) || jar };
}

async function me(jar) {
  const res = await fetch(`${BASE}/auth/me`, { headers: { Cookie: jar } });
  return res.status;
}

const out = { base: BASE, graceSeconds: GRACE_SECONDS, maxHits: 1, scenarios: {} };

// A. one rotation + one sequential stale retry within grace
{
  const j0 = await login();
  const r1 = await refresh(j0);
  const j1 = r1.jar;
  const r2 = await refresh(j0);
  const a1 = await me(j1);
  const r3 = await refresh(j1);
  out.scenarios.A = {
    rotate: r1.status,
    staleRetry1: r2.status,
    firstNewAccess: a1,
    firstNewRefresh: r3.status,
    firstNewRefreshDetail: r3.detail,
  };
}

// B. one rotation + two sequential stale retries within grace
{
  const j0 = await login();
  const r1 = await refresh(j0);
  const j1 = r1.jar;
  const r2 = await refresh(j0);
  const r3 = await refresh(j0);
  const a1 = await me(j1);
  const r4 = await refresh(j1);
  out.scenarios.B = {
    rotate: r1.status,
    staleRetry1: r2.status,
    staleRetry2: r3.status,
    secondRetryDetail: r3.detail,
    firstNewAccess: a1,
    firstNewRefresh: r4.status,
    firstNewRefreshDetail: r4.detail,
  };
}

// C. three parallel refreshes with the same cookie
{
  const j0 = await login();
  const results = await Promise.all([1, 2, 3].map(() => refresh(j0)));
  const winners = results.filter((r) => r.status === 200);
  const access = [];
  const refreshStatuses = [];
  for (const w of winners) access.push(await me(w.jar));
  for (const w of winners) refreshStatuses.push((await refresh(w.jar)).status);
  out.scenarios.C = {
    statuses: results.map((r) => r.status),
    details: results.map((r) => r.detail).filter(Boolean),
    winnerTokens: winners.length,
    winnerAccess: access,
    winnerRefresh: refreshStatuses,
  };
}

// D. retry the old cookie after grace expires
{
  const j0 = await login();
  const r1 = await refresh(j0);
  const j1 = r1.jar;
  await sleep((GRACE_SECONDS + 5) * 1000);
  const r2 = await refresh(j0);
  const a1 = await me(j1);
  const r3 = await refresh(j1);
  out.scenarios.D = {
    rotate: r1.status,
    staleAfterGrace: r2.status,
    staleAfterGraceDetail: r2.detail,
    newAccessAfterOldRejection: a1,
    newRefreshAfterOldRejection: r3.status,
    newRefreshDetail: r3.detail,
  };
}

console.log(JSON.stringify(out, null, 2));
