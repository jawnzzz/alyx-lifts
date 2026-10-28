/* Trainer plans (Lindsey Lifts): the admin makes a profile a trainer and links clients to it; the
   trainer sends a plan; only that client sees it, and only while it is pending. Real server.js in
   a child, same harness as server-admin-delete.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm', CLIENT = 'u_cli', OTHER = 'u_oth';
const ORIGIN = 'http://localhost:8080';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', Origin: ORIGIN });
const PLAN = {
  opengym_plan: 1, unit: 'lb', week: { 1: ['r1'] },
  routines: [{ id: 'r1', name: 'Lower A', ex: [{ id: '0770', sets: 3, reps: 12, repsMin: 8, weight: 70 }] }],
  customEx: []
};

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainer-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Lindsey', created: now, admin: true },
      { id: CLIENT, name: 'Rayiah', created: now },
      { id: OTHER, name: 'Mo', created: now }
    ],
    creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${CLIENT}.json`), JSON.stringify({ unit: 'lb', workouts: [{ d: '2026-10-24', entries: [] }], routines: [], _rev: 1 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  const api = `http://127.0.0.1:${h.port}`;
  h.req = async (method, p, uid, body) => {
    const r = await fetch(api + p, { method, headers: as(uid), ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  return h;
}

async function linked(t) {
  const h = await startServer(t);
  assert.equal((await h.req('POST', '/api/admin/user/trainer', ADMIN, { id: ADMIN, trainer: true })).status, 200);
  assert.equal((await h.req('POST', '/api/admin/user/assign-trainer', ADMIN, { id: CLIENT, trainerId: ADMIN })).status, 200);
  return h;
}

test('only an admin makes trainers and links clients', async t => {
  const h = await startServer(t);
  assert.equal((await h.req('POST', '/api/admin/user/trainer', OTHER, { id: OTHER, trainer: true })).status, 403);
  assert.equal((await h.req('POST', '/api/admin/user/assign-trainer', ADMIN, { id: CLIENT, trainerId: OTHER })).status, 400, 'not a trainer yet');
  assert.equal((await h.req('POST', '/api/admin/user/trainer', ADMIN, { id: ADMIN, trainer: 'yes' })).status, 400);
  assert.equal((await h.req('POST', '/api/admin/user/trainer', ADMIN, { id: ADMIN, trainer: true })).status, 200);
  assert.equal((await h.req('POST', '/api/admin/user/assign-trainer', ADMIN, { id: ADMIN, trainerId: ADMIN })).status, 400, 'not their own client');
  assert.equal((await h.req('POST', '/api/admin/user/assign-trainer', ADMIN, { id: CLIENT, trainerId: ADMIN })).status, 200);
  const db = h.db();
  assert.equal(db.users.find(u => u.id === ADMIN).trainer, true);
  assert.equal(db.users.find(u => u.id === CLIENT).trainerId, ADMIN);
  const me = await h.req('GET', '/api/me', ADMIN);
  assert.equal(me.body.user.trainer, true);
});

test('a trainer sees only their own clients', async t => {
  const h = await linked(t);
  const list = await h.req('GET', '/api/trainer/clients', ADMIN);
  assert.deepEqual(list.body.clients.map(c => c.name), ['Rayiah']);
  assert.equal(list.body.clients[0].workouts, 1);
  assert.equal((await h.req('GET', '/api/trainer/clients', OTHER)).status, 403);
  assert.equal((await h.req('GET', `/api/trainer/client?id=${CLIENT}`, ADMIN)).status, 200);
  assert.equal((await h.req('GET', `/api/trainer/client?id=${OTHER}`, ADMIN)).status, 404, 'not their client');
});

test('a sent plan reaches only that client, once, until applied', async t => {
  const h = await linked(t);
  assert.equal((await h.req('POST', '/api/trainer/send', ADMIN, { clientId: OTHER, plan: PLAN })).status, 404, 'not linked');
  assert.equal((await h.req('POST', '/api/trainer/send', OTHER, { clientId: CLIENT, plan: PLAN })).status, 403, 'not a trainer');
  assert.equal((await h.req('POST', '/api/trainer/send', ADMIN, { clientId: CLIENT, plan: { routines: 'x' } })).body.code, 'not-plan');

  const sent = await h.req('POST', '/api/trainer/send', ADMIN, { clientId: CLIENT, plan: PLAN, note: 'New week' });
  assert.equal(sent.status, 200);
  const inbox = await h.req('GET', '/api/plan-inbox', CLIENT);
  assert.equal(inbox.body.plans.length, 1);
  assert.equal(inbox.body.plans[0].from.name, 'Lindsey');
  assert.equal(inbox.body.plans[0].note, 'New week');
  assert.deepEqual(inbox.body.plans[0].plan.routines[0].name, 'Lower A');
  assert.equal((await h.req('GET', '/api/plan-inbox', OTHER)).body.plans.length, 0, 'nobody else sees it');

  // A second send replaces the first rather than stacking.
  await h.req('POST', '/api/trainer/send', ADMIN, { clientId: CLIENT, plan: { ...PLAN, name: 'v2' } });
  const again = await h.req('GET', '/api/plan-inbox', CLIENT);
  assert.equal(again.body.plans.length, 1);
  assert.equal(again.body.plans[0].plan.name, 'v2');

  const id = again.body.plans[0].id;
  assert.equal((await h.req('POST', '/api/plan-inbox/done', OTHER, { id, status: 'applied' })).status, 404, 'not theirs');
  assert.equal((await h.req('POST', '/api/plan-inbox/done', CLIENT, { id, status: 'maybe' })).status, 400);
  assert.equal((await h.req('POST', '/api/plan-inbox/done', CLIENT, { id, status: 'applied' })).status, 200);
  assert.equal((await h.req('GET', '/api/plan-inbox', CLIENT)).body.plans.length, 0, 'applied plans leave the inbox');
  const status = (await h.req('GET', '/api/trainer/clients', ADMIN)).body.clients[0].plan.status;
  assert.equal(status, 'applied', 'the trainer sees it was applied');
});

test('unlinking or deleting drops the plans and the links', async t => {
  const h = await linked(t);
  await h.req('POST', '/api/trainer/send', ADMIN, { clientId: CLIENT, plan: PLAN });
  assert.equal(h.db().plans.length, 1);
  await h.req('POST', '/api/admin/user/assign-trainer', ADMIN, { id: CLIENT, trainerId: null });
  assert.equal(h.db().plans.length, 0);
  assert.equal(h.db().users.find(u => u.id === CLIENT).trainerId, undefined);
  assert.equal((await h.req('GET', '/api/plan-inbox', CLIENT)).body.plans.length, 0);

  await h.req('POST', '/api/admin/user/assign-trainer', ADMIN, { id: CLIENT, trainerId: ADMIN });
  await h.req('POST', '/api/trainer/send', ADMIN, { clientId: CLIENT, plan: PLAN });
  await h.req('POST', '/api/admin/user/delete', ADMIN, { id: CLIENT });
  assert.equal(h.db().plans.length, 0, 'a deleted client leaves no plan');
});

test('a cross-origin send is refused', async t => {
  const h = await linked(t);
  const r = await fetch(`http://127.0.0.1:${h.port}/api/trainer/send`, {
    method: 'POST', headers: { ...as(ADMIN), Origin: 'https://evil.example' },
    body: JSON.stringify({ clientId: CLIENT, plan: PLAN })
  });
  assert.equal(r.status, 403);
  assert.equal(h.db().plans.length, 0);
});
