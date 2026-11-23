const fs = require('fs');
const BASE = process.env.API_URL || 'http://127.0.0.1:18008/api/v1';
const run = `${Date.now()}`;
const suffix = run.slice(-8);
const users = [
  { key: 'owner', username: `audit_c17_owner_${suffix}`, full_name: `Audit Owner ${suffix}`, department: `Audit Dept A ${suffix}`, role: 'operator' },
  { key: 'delegate', username: `audit_c17_dep_${suffix}`, full_name: `Audit Delegate ${suffix}`, department: `Audit Dept A ${suffix}`, role: 'operator' },
  { key: 'mgrB', username: `audit_c17_mgr_${suffix}`, full_name: `Audit Manager B ${suffix}`, department: `Audit Dept B ${suffix}`, role: 'operator' },
  { key: 'memberB', username: `audit_c17_mem_${suffix}`, full_name: `Audit Member B ${suffix}`, department: `Audit Dept B ${suffix}`, role: 'operator' },
];
const password = 'AuditC17!pass123';
(async () => {
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const created = {};
  for (const u of users) {
    const res = await fetch(`${BASE}/auth/users`, { method: 'POST', headers: H, body: JSON.stringify({ ...u, password, is_active: true, auth_source: 'local' }) });
    const body = await res.json().catch(() => ({}));
    created[u.key] = { status: res.status, id: body.id, username: u.username, department: u.department };
  }
  const sync = await fetch(`${BASE}/departments/sync-from-users`, { method: 'POST', headers: H });
  const syncBody = await sync.json().catch(() => ({}));
  const list = await fetch(`${BASE}/departments?search=${encodeURIComponent('Audit Dept')}`, { headers: H });
  const listBody = await list.json();
  const items = listBody.items || listBody || [];
  const d1 = items.find((d) => String(d.name).includes(`Audit Dept A ${suffix}`));
  const d2 = items.find((d) => String(d.name).includes(`Audit Dept B ${suffix}`));
  let managers = {};
  if (d1 && d2) {
    const put1 = await fetch(`${BASE}/departments/${encodeURIComponent(d1.id)}/managers`, { method: 'PUT', headers: H, body: JSON.stringify({ manager_user_ids: [created.owner.id] }) });
    const put2 = await fetch(`${BASE}/departments/${encodeURIComponent(d2.id)}/managers`, { method: 'PUT', headers: H, body: JSON.stringify({ manager_user_ids: [created.mgrB.id] }) });
    managers = { put1: put1.status, put2: put2.status };
  }
  let delegatePut = null;
  if (created.owner.id && created.delegate.id) {
    const r = await fetch(`${BASE}/auth/users/${created.owner.id}/task-delegates`, { method: 'PUT', headers: H, body: JSON.stringify({ items: [{ delegate_user_id: created.delegate.id, role_type: 'assistant', is_active: true }] }) });
    delegatePut = r.status;
  }
  const bulk = await fetch(`${BASE}/auth/task-delegates?owner_ids=${created.owner.id}`, { headers: H });
  const bulkBody = await bulk.json().catch(() => ({}));
  const out = { run, suffix, created, syncStatus: sync.status, syncBody, d1: d1 && { id: d1.id, name: d1.name }, d2: d2 && { id: d2.id, name: d2.name }, managers, delegatePut, bulkStatus: bulk.status, bulkBody };
  const fixtureFile = process.env.FIXTURE_FILE || 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17_admin_fixtures.json';
  fs.writeFileSync(fixtureFile, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ run, created, d1: out.d1, d2: out.d2, managers, delegatePut, bulkStatus: bulk.status, bulkItems: (bulkBody.items || []).length }));
})();

