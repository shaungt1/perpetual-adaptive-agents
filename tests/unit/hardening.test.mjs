// Regression tests for defects found by an independent review of the first build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'core', 'cli.mjs');

function setup(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pa-${name}-`));
  const env = { ...process.env, PA_HOME: path.join(tmp, 'home'), PA_NATS: 'off' };
  delete env.PA_AGENT; delete env.PA_PROJECT;
  const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  const json = (args, extra) => { const r = run(args, extra); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
  fs.mkdirSync(path.join(tmp, 'proj'));
  const p = json(['register', path.join(tmp, 'proj'), '--copy', '--approve', 'all', '--name', name]);
  const plan = {
    categories: [{ id: 'C1', name: 'one', scope: 'Everything about one in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }, { id: 'C2', name: 'two', scope: 'Everything about two in this test project.', owns: ['src/c2/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }],
    master_tasks: [{ id: 'T-001', category: 'C1', kind: 'bug', title: 'a' }, { id: 'T-002', category: 'C1', kind: 'bug', title: 'b' }, { id: 'T-003', category: 'C2', kind: 'bug', title: 'c' }],
    agents: [{ categories: ['C1'], provider: 'mock', tasks: ['T-001', 'T-002'] }, { categories: ['C2'], provider: 'mock', tasks: ['T-003'] }],
    planner: { provider: 'mock' },
  };
  fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify(plan));
  json(['plan', 'import', path.join(tmp, 'plan.json'), '--project', p.id]);
  return { tmp, env, run, json, p };
}

test('agents cannot switch identity, cancel others\' tasks, or fail a task they have not started', () => {
  const { run, p } = setup('ident');
  const as = (agent, args) => run([...args, '--project', p.id], { PA_AGENT: agent });
  assert.equal(as('A02', ['board', 'post', '--agent', 'A01', '--text', 'spoofed']).status, 2, '--agent cannot override PA_AGENT');
  assert.equal(as('A02', ['approve', '--force', '--as', 'owner']).status, 2, '--as refused inside a session');
  assert.equal(as('A02', ['approve', '--force']).status, 2, 'agents cannot approve');
  assert.equal(as('A01', ['task', 'start', 'A01-L1-1']).status, 0);
  const r = as('A02', ['task', 'cancel', 'A01-L1-1']);
  assert.equal(r.status, 2); assert.match(r.stderr, /not_yours/);
  assert.equal(as('A01', ['task', 'fail', 'A01-L1-2', '--reason', 'x']).status, 2, 'fail requires a started task');
  assert.equal(as('A01', ['board', 'post', '--text', '--force is risky']).status, 0, 'a text value may start with --');
  assert.equal(as('A01', ['task', 'done', 'A01-L1-1', '--summary']).status, 2, 'missing value is a clean error');
});

test('plans with unsafe names, models or unknown providers are refused', async () => {
  const { validatePlan } = await import('../../core/planner.mjs');
  const { clamp } = await import('../../core/config.mjs');
  const v = validatePlan({
    categories: [{ id: 'C1', name: 'x', scope: 'Everything about x in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }],
    master_tasks: [{ id: 'T-001', category: 'C1', kind: 'bug', title: 't' }],
    agents: [{ categories: ['C1'], name: '../evil', provider: 'gemini', model: 'a&b', tasks: ['T-001'] }],
  }, clamp({ agents: {}, tasks: {} }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /name/.test(e)) && v.errors.some(e => /provider/.test(e)) && v.errors.some(e => /model/.test(e)));
});

test('a run left open by a dead runner is closed, so the agent is woken again; only one runner at a time', async () => {
  const { tmp, env } = setup('stale');
  process.env.PA_HOME = env.PA_HOME; process.env.PA_NATS = 'off';
  const { openProjectDb } = await import('../../core/db.mjs');
  const { readRegistry } = await import('../../core/paths.mjs');
  const S = await import('../../core/store.mjs');
  const R = await import('../../core/runner.mjs');
  const pid = readRegistry().projects[0].id;
  const db = openProjectDb(pid);
  const runId = S.startRun(db, pid, 'A01', 'mock', 'test', null);
  S.setRunPid(db, runId, 999999);
  assert.equal(S.reapStaleRuns(db, pid, 30, () => false), 1);
  assert.equal(S.openRuns(db, pid).length, 0);
  const release = R.acquireRunnerLock();
  const r = spawnSync(process.execPath, [CLI, 'run', '--until-idle', '--project', pid], { encoding: 'utf8', env });
  assert.equal(r.status, 2); assert.match(r.stderr, /another runner/);
  release();
  assert.ok(!fs.existsSync(path.join(env.PA_HOME, 'runner.pid')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a session that leaves a background process writing to its output does not crash the runner', { timeout: 60000 }, () => {
  const { tmp, env, run, json, p } = setup('grandchild');
  const script = path.join(tmp, 'leaky-agent.mjs');
  fs.writeFileSync(script, `
import { spawn } from 'node:child_process';
const c = spawn(process.execPath, ['-e', "setTimeout(()=>{process.stdout.write('late output\\\\n')},1500); setTimeout(()=>{},3000)"], { stdio: ['ignore', 'inherit', 'inherit'], detached: false });
c.unref();
process.stdout.write(JSON.stringify({ session_id: 's', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }) + '\\n');
process.exit(0);
`);
  fs.appendFileSync(path.join(p.payload, 'config.toml'), `\n[providers.mock]\nscript = ${JSON.stringify(script)}\n\n[runner]\ntick_seconds = 1\nstuck_after_runs = 1\n`);
  run(['approve', '--force', '--project', p.id]);
  const r = run(['run', '--until-idle', '--project', p.id]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).reason, 'idle');
  const st = json(['status', '--json', '--project', p.id]);
  assert.ok(st.runs.length >= 1 && st.runs.every(x => x.ended_at), 'every run closed');
  assert.ok(st.agents.some(a => a.status === 'stuck'), 'runs without progress end in stuck, not an endless loop');
});

test('reset consensus ignores agents that retire and can be cancelled', async () => {
  const { run, json, p } = setup('reset');
  const r = json(['reset', 'start', '--reason', 'x', '--project', p.id]);
  assert.deepEqual(r.expected.sort(), ['A00', 'A01', 'A02']);
  run(['checkin', r.id, '--project', p.id], { PA_AGENT: 'A00' });
  run(['checkin', r.id, '--project', p.id], { PA_AGENT: 'A01' });
  run(['retire', '--reason', 'done', '--project', p.id], { PA_AGENT: 'A02' });
  assert.equal(json(['reset', 'status', r.id, '--project', p.id]).complete, true);
  const r2 = json(['reset', 'start', '--project', p.id]);
  json(['reset', 'cancel', r2.id, '--project', p.id]);
  assert.equal(json(['reset', 'status', '--project', p.id]).length, 0);
});

test('dashboard actions need the page token and a JSON body; no inline handlers in the page', { timeout: 30000 }, async () => {
  const { env, p } = setup('dash');
  const port = 4800 + Math.floor(Math.random() * 100);
  const srv = spawn(process.execPath, [CLI, 'ui', '--port', String(port), '--project', p.id], { env, stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 1200));
    const req = (method, pth, headers = {}, body) => new Promise((resolve, reject) => {
      const q = http.request({ host: '127.0.0.1', port, method, path: pth, headers }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
      q.on('error', reject); if (body) q.write(body); q.end();
    });
    const page = await req('GET', '/');
    assert.equal(page.status, 200);
    assert.ok(!/onclick="act\(/.test(page.body));
    const token = JSON.parse(page.body.match(/<script id="boot" type="application\/json">(.*?)<\/script>/)[1]).token;
    const body = JSON.stringify({ project: p.id, action: 'pause' });
    const own = `http://127.0.0.1:${port}`;
    assert.equal((await req('POST', '/api/action', { 'content-type': 'application/json', origin: own }, body)).status, 403, 'a web page without the token');
    assert.equal((await req('POST', '/api/action', { 'content-type': 'application/json', origin: 'http://evil.example', 'x-pa-token': token }, body)).status, 403, 'another web site');
    assert.equal((await req('POST', '/api/action', { 'content-type': 'text/plain', 'x-pa-token': token }, body)).status, 415, 'not JSON');
    assert.equal((await req('GET', '/api/projects', { host: 'evil.example:80' })).status, 403, 'foreign Host header');
    assert.equal((await req('POST', '/api/action', { 'content-type': 'application/json', origin: own, 'x-pa-token': token }, body)).status, 200, 'the dashboard page with its token');
    assert.equal((await req('POST', '/api/action', { 'content-type': 'application/json' }, JSON.stringify({ project: p.id, action: 'resume' }))).status, 200, 'a program on this computer (no Origin)');
  } finally { srv.kill(); }
});

test('retiring completes and scores the open planning task instead of cancelling it', () => {
  const { json, p } = setup('retire');
  const r = json(['retire', '--reason', 'nothing left', '--project', p.id], { PA_AGENT: 'A02' });
  assert.equal(r.planning_task_completed, 'A02-L1-2');
  assert.deepEqual(r.cancelled_tasks, ['A02-L1-1']);
  assert.equal(json(['scoreboard', '--project', p.id]).find(x => x.id === 'A02').points, 10);
  const rec = JSON.parse(fs.readFileSync(path.join(p.payload, 'workspace', 'agents', 'Kafka-02', 'completed', 'A02-L1-2.json'), 'utf8'));
  assert.equal(rec.complete, true); assert.deepEqual(rec.findings, []); assert.deepEqual(rec.errors, []);
});

test('spending ceiling counts runs in flight at the average run cost', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ceiling-'));
  const { openDb } = await import('../../core/db.mjs');
  const S = await import('../../core/store.mjs');
  const db = openDb(path.join(tmp, 'state.sqlite'));
  const p = S.createProject(db, { name: 'c', root: tmp });
  assert.equal(S.averageRunCost(db, p.id), 0, 'no finished runs yet');
  db.prepare("INSERT INTO agents (project_id, id, name, role, status, categories, provider) VALUES (?, 'A01', 'Zorro-01', 'worker', 'active', '[]', 'mock')").run(p.id);
  for (const usd of [1, 2, 3]) { const r = S.startRun(db, p.id, 'A01', 'mock', 'test', null); S.endRun(db, r, { exit_code: 0, cost_usd: usd }); }
  assert.equal(S.averageRunCost(db, p.id), 2);
});

test('a database file deleted and recreated while a process keeps it open is reopened', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-reopen-'));
  const { openDb } = await import('../../core/db.mjs');
  const S = await import('../../core/store.mjs');
  const file = path.join(tmp, 'ws', 'state.sqlite');
  const db1 = openDb(file);
  S.createProject(db1, { id: 'P-aaaaaa', name: 'old', root: tmp });
  fs.rmSync(path.join(tmp, 'ws'), { recursive: true, force: true });
  const db2 = openDb(file);
  assert.ok(!S.getProject(db2, 'P-aaaaaa'), 'a fresh database, not the deleted one');
  S.createProject(db2, { id: 'P-aaaaaa', name: 'new', root: tmp });
  assert.ok(fs.existsSync(file));
  assert.equal(openDb(file), db2, 'the same open file is reused');
});
