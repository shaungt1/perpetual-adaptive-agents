// The communication and work protocol: owner-gated growth, loop limits, pause/resume,
// questions for the user, locks, name mentions, the inbox, and the project registry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'core', 'cli.mjs');

function setup(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pa-${name}-`));
  const env = { ...process.env, PA_HOME: path.join(tmp, 'home'), PA_NATS: 'off' };
  delete env.PA_AGENT; delete env.PA_PROJECT; delete env.PA_PAYLOAD;
  const run = (args, extra = {}, cwd = tmp) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd });
  const json = (args, extra, cwd) => { const r = run(args, extra, cwd); if (r.status !== 0) throw new Error(`pa ${args.join(' ')}: ${r.stderr}`); return JSON.parse(r.stdout); };
  fs.mkdirSync(path.join(tmp, 'proj'));
  const p = json(['register', path.join(tmp, 'proj'), '--copy', '--approve', 'all', '--name', name]);
  fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify({
    departments: [{ id: 'C1', name: 'API', scope: 'Everything about API in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }, { id: 'C2', name: 'UI', scope: 'Everything about UI in this test project.', owns: ['src/c2/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }],
    master_tasks: [{ id: 'T-001', category: 'C1', kind: 'bug', title: 'a' }, { id: 'T-002', category: 'C2', kind: 'bug', title: 'b' }],
    agents: [{ departments: ['C1'], provider: 'mock', tasks: ['T-001'] }, { departments: ['C2'], provider: 'mock', tasks: ['T-002'] }],
    supervisor: { provider: 'mock' },
  }));
  json(['plan', 'import', path.join(tmp, 'plan.json'), '--project', p.id]);
  const as = (agent, args) => json([...args, '--project', p.id], { PA_AGENT: agent });
  return { tmp, env, run, json, p, as };
}

test('found from the project folder: no flags needed inside a project', () => {
  const { json, tmp, p } = setup('cwd');
  fs.mkdirSync(path.join(tmp, 'proj', 'src', 'deep'), { recursive: true });
  const show = json(['project', 'show'], {}, path.join(tmp, 'proj', 'src', 'deep'));
  assert.equal(show.id, p.id);
  assert.ok(show.payload.endsWith(path.join('.agents', 'adaptive-agents')));
  const reg = json(['projects']);
  assert.equal(reg.length, 1);
  assert.equal(reg[0].agents, 3);
});

test('agents fix on their own but must propose growth: optimizations, features and research wait for the user', () => {
  const { as, tmp } = setup('gate');
  const f = path.join(tmp, 'list.json');
  fs.writeFileSync(f, JSON.stringify({ tasks: [
    { kind: 'bug', title: 'fix crash' }, { kind: 'critical', title: 'security hole' },
    { kind: 'optimization', title: 'cache it' }, { kind: 'feature', title: 'purple buttons' }, { kind: 'research', title: 'measure usage' },
  ] }));
  const r = as('A01', ['list', 'new', '--file', f]);
  const by = Object.fromEntries(r.tasks.map(t => [t.title, t.status]));
  assert.equal(by['fix crash'], 'todo');
  assert.equal(by['security hole'], 'todo');
  assert.equal(by['cache it'], 'proposed');
  assert.equal(by['purple buttons'], 'proposed');
  assert.equal(by['measure usage'], 'proposed');
});

test('loop limit: three tries stop the task; a fourth and fifth need a written reason; never a sixth', () => {
  const { as, run, p } = setup('loops');
  as('A01', ['task', 'start', 'A01-L1-1', '--files', 'src/api.js']);
  assert.equal(as('A01', ['task', 'fail', 'A01-L1-1', '--reason', 'r1']).blocked, false);
  const second = as('A01', ['task', 'fail', 'A01-L1-1', '--reason', 'r2']);
  assert.ok(Array.isArray(second.related_board_activity), 'second failure shows related board activity');
  const third = as('A01', ['task', 'fail', 'A01-L1-1', '--reason', 'r3', '--extend', 'the error message changed, one more idea is cheap']);
  assert.equal(third.blocked, false, 'extended past three');
  as('A01', ['task', 'fail', 'A01-L1-1', '--reason', 'r4', '--extend', 'last idea']);
  const fifth = as('A01', ['task', 'fail', 'A01-L1-1', '--reason', 'r5', '--extend', 'really?']);
  assert.equal(fifth.blocked, true, 'five is the absolute maximum');
  assert.equal(fifth.attempts, 5);
  // Without --extend the third failure stops the task.
  as('A02', ['task', 'start', 'A02-L1-1']);
  as('A02', ['task', 'fail', 'A02-L1-1', '--reason', 'x']);
  as('A02', ['task', 'fail', 'A02-L1-1', '--reason', 'y']);
  assert.equal(as('A02', ['task', 'fail', 'A02-L1-1', '--reason', 'z']).blocked, true);
  const inbox = JSON.parse(run(['inbox', '--project', p.id]).stdout);
  assert.equal(inbox.for_the_supervisor.blocked_tasks.length, 2);
});

test('pause releases files, resume restores the task; asking the user blocks the task until the answer is relayed', () => {
  const { as, json, p } = setup('pause');
  as('A01', ['task', 'start', 'A01-L1-1', '--files', 'shared.js']);
  as('A01', ['task', 'pause', 'A01-L1-1', '--reason', 'yielding shared.js to Kafka-02']);
  assert.equal(json(['board', 'claims', '--project', p.id]).length, 0, 'files released');
  assert.equal(as('A01', ['task', 'next']).task, null, 'a paused task is not picked up again by itself');
  as('A01', ['task', 'resume', 'A01-L1-1']);
  as('A01', ['task', 'start', 'A01-L1-1', '--files', 'shared.js']);
  const q = as('A01', ['task', 'ask-user', 'A01-L1-1', 'Should the error page be purple or red?']);
  assert.equal(q.task.status, 'waiting_user');
  const inbox = json(['inbox', '--project', p.id]);
  assert.equal(inbox.for_the_user.questions.length, 1);
  // Workers cannot answer for the user.
  assert.throws(() => as('A02', ['answer', q.question, 'Purple.']));
  // The Supervisor (or the user) can.
  const a = as('A00', ['answer', q.question, 'Red.']);
  assert.equal(a.task.status, 'todo');
  assert.equal(json(['inbox', '--project', p.id]).for_the_user.questions.length, 0);
});

test('locks are exclusive; mentioning an agent by name wakes it', async () => {
  const { as, env, p } = setup('lock');
  assert.ok(as('A01', ['lock', 'acquire', 'git:main']).expires_at);
  const r = spawnSync(process.execPath, [CLI, 'lock', 'acquire', 'git:main', '--project', p.id], { encoding: 'utf8', env: { ...env, PA_AGENT: 'A02' } });
  assert.equal(r.status, 3, 'second holder refused with exit code 3');
  as('A01', ['lock', 'release', 'git:main']);
  assert.ok(as('A02', ['lock', 'acquire', 'git:main']).holder === 'A02');
  process.env.PA_HOME = env.PA_HOME;
  const { openProjectDb } = await import('../../core/db.mjs');
  const S = await import('../../core/store.mjs');
  const db = openProjectDb(p.id);
  const kafka = S.getAgent(db, p.id, 'A02');
  S.readMessages(db, p.id, kafka);
  as('A01', ['board', 'post', '--type', 'note', '--text', 'Heads up Kafka-02: I am renaming the shared type.']);
  assert.equal(S.wakeCount(db, p.id, kafka), 1, 'a mention wakes the named agent');
});

test('API: health, register with a dry run and user approval, idempotent re-registration, files view, rename', { timeout: 30000 }, async () => {
  const { env, tmp, p } = setup('api');
  const port = 4900 + Math.floor(Math.random() * 90);
  const { spawn } = await import('node:child_process');
  const srv = spawn(process.execPath, [CLI, 'ui', '--port', String(port)], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const post = async (pth, body) => (await fetch(`${base}${pth}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    await new Promise(r => setTimeout(r, 1200));
    const h = await (await fetch(`${base}/api/health`)).json();
    assert.equal(h.service, 'perpetual-adaptive-agents');
    assert.equal(h.projects.count, 1);
    assert.ok(h.central_folder.writable);

    // A second project: the agent copied the payload into .claude (no .agents), and the project uses Cursor.
    const other = path.join(tmp, 'other');
    fs.mkdirSync(path.join(other, '.cursor'), { recursive: true });
    fs.cpSync(path.join(REPO, 'adaptive-agents'), path.join(other, '.claude', 'adaptive-agents'), { recursive: true });
    fs.writeFileSync(path.join(other, 'AGENTS.md'), '# My own agent notes\n');
    const dry = await post('/api/projects/register', { path: other, name: 'Other', dry_run: true });
    assert.equal(dry.dry_run, true);
    assert.ok(dry.payload.endsWith(path.join('.claude', 'adaptive-agents')), 'found the copy in .claude');
    assert.deepEqual(dry.tools.sort(), ['claude', 'cursor']);
    const paths = dry.files_outside_payload.map(f => f.path);
    assert.ok(paths.includes('AGENTS.md') && paths.includes('.cursor/rules/adaptive-agents.mdc') && paths.includes('CLAUDE.md'));
    assert.ok(!paths.some(x => x.startsWith('.github')), 'no Copilot file for a project without Copilot');
    assert.ok(!fs.existsSync(path.join(other, '.claude', 'adaptive-agents', 'workspace', 'project.json')), 'dry run changes nothing');

    // The user approves only AGENTS.md and the Cursor rule.
    const reg = await post('/api/projects/register', { path: other, name: 'Other', approve_files: ['AGENTS.md', '.cursor/rules/adaptive-agents.mdc'] });
    assert.equal(reg.name, 'Other');
    assert.match(fs.readFileSync(path.join(other, 'AGENTS.md'), 'utf8'), /# My own agent notes[\s\S]*adaptive-agents:begin/, 'appended, user text kept');
    assert.ok(fs.existsSync(path.join(other, '.cursor', 'rules', 'adaptive-agents.mdc')));
    assert.ok(!fs.existsSync(path.join(other, 'CLAUDE.md')), 'not approved, not written');
    assert.ok(reg.files_not_changed.some(f => f.path === 'CLAUDE.md' && /not approved/.test(f.reason)));
    assert.ok(fs.existsSync(reg.central_folder_entry), 'one link file per project in the central folder');
    const pj = JSON.parse(fs.readFileSync(reg.project_json, 'utf8'));
    assert.equal(pj.id, reg.id); assert.equal(pj.plans_folder, 'docs/plans'); assert.deepEqual(pj.project_managers, []);
    assert.ok(!fs.existsSync(path.join(other, 'docs', 'plans')), 'plans folder not created without approval');

    // Registering again keeps the same project.
    const again = await post('/api/projects/register', { path: other });
    assert.equal(again.id, reg.id); assert.equal(again.already_registered, true);
    const list = await (await fetch(`${base}/api/projects`)).json();
    assert.equal(list.length, 2);
    assert.ok(list.some(x => x.id === p.id && x.agents === 3));

    // Errors are explained.
    const missing = await post('/api/projects/register', { path: path.join(tmp, 'nope') });
    assert.equal(missing.error, 'not_found');
    fs.mkdirSync(path.join(tmp, 'empty'));
    assert.equal((await post('/api/projects/register', { path: path.join(tmp, 'empty') })).error, 'payload_missing');

    // The files view and renaming.
    const files = await (await fetch(`${base}/api/projects/${p.id}/files`)).json();
    assert.equal(files.project.id, p.id);
    assert.equal(files.agents.length, 3);
    assert.equal(files.master_tasks.length, 2);
    assert.ok(files.agents.find(a => a.name === 'Zorro-01').lists[0].tasks.length >= 2);
    assert.deepEqual((await post(`/api/projects/${reg.id}/rename`, { name: 'Renamed' })).name, 'Renamed');
    assert.equal(JSON.parse(fs.readFileSync(reg.project_json, 'utf8')).name, 'Renamed');
  } finally { srv.kill(); }
});

test('two projects registering at the same moment both end up registered', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-two-'));
  const env = { ...process.env, PA_HOME: path.join(tmp, 'home'), PA_NATS: 'off' };
  const { spawn } = await import('node:child_process');
  const N = 4;
  const codes = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const dir = path.join(tmp, `proj${i}`); fs.mkdirSync(dir);
    const c = spawn(process.execPath, [CLI, 'register', dir, '--copy', '--name', `p${i}`], { env, stdio: 'ignore' });
    c.on('exit', resolve);
  })));
  assert.deepEqual(codes, Array(N).fill(0));
  const r = spawnSync(process.execPath, [CLI, 'projects'], { encoding: 'utf8', env });
  assert.equal(JSON.parse(r.stdout).length, N, 'no registration lost');
  assert.equal(fs.readdirSync(path.join(tmp, 'home', 'projects')).length, N);
});

test('a project manager names itself; several can join; project.json lists them', () => {
  const { json, p } = setup('pm');
  // The plan import made a default first project manager; a second joins under its own name.
  const a = json(['pm', 'join', '--name', 'Atlas', '--number', '7', '--project', p.id]);
  assert.equal(a.name, 'Atlas-07');
  assert.notEqual(a.agent_id, 'A00');
  assert.throws(() => json(['pm', 'join', '--name', 'Atlas', '--number', '7', '--project', p.id]), /taken/);
  const pms = json(['pm', 'list', '--project', p.id]);
  assert.equal(pms.length, 1);
  assert.equal(pms[0].name, 'Atlas-07');
  json(['project', 'set', '--description', 'A test project', '--owner', 'the user', '--fact', 'language=JavaScript', '--project', p.id]);
  const show = json(['project', 'show', '--project', p.id]);
  assert.equal(show.project_json.description, 'A test project');
  assert.equal(show.project_json.facts.language, 'JavaScript');
});

test('a fresh project: the first project manager to join becomes A00 under its own name', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-pm1-'));
  const env = { ...process.env, PA_HOME: path.join(tmp, 'home'), PA_NATS: 'off' };
  delete env.PA_AGENT; delete env.PA_PROJECT;
  fs.mkdirSync(path.join(tmp, 'proj'));
  const run = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd: path.join(tmp, 'proj') }); if (r.status) throw new Error(r.stderr); return JSON.parse(r.stdout); };
  run(['register', '.', '--copy']);
  const pm = run(['pm', 'join', '--name', 'Orion', '--number', '0']);
  assert.equal(pm.agent_id, 'A00');
  assert.equal(pm.name, 'Orion-00');
});
