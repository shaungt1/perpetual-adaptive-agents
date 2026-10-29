// End-to-end test: the whole cycle on the sample project, with the mock provider
// standing in for the chat sessions. Planning outputs -> import -> approval ->
// runner wakes agents -> agents work through the pa CLI -> lists, records, board,
// points, usage, planning loop, proposals, retirement, snapshot for the UI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CASE = path.join(REPO, 'tests', 'e2e', 'test-case');
const CLI = path.join(REPO, 'core', 'cli.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-e2e-'));
const HOME = path.join(tmp, 'pa-home');
const PROJECT = path.join(tmp, 'notes-lite');
const env = { ...process.env, PA_HOME: HOME, PA_NATS: process.env.PA_NATS ?? 'off' };
delete env.PA_PROJECT; delete env.PA_AGENT;

function pa(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv }, cwd: PROJECT });
  if (r.status !== 0) throw new Error(`pa ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  try { return JSON.parse(r.stdout); } catch { return r.stdout; }
}

test('full cycle with the mock provider', { timeout: 180000 }, () => {
  fs.cpSync(path.join(CASE, 'sample-project'), PROJECT, { recursive: true });

  // Planning session outputs.
  const project = pa(['register', PROJECT, '--copy', '--approve', 'all', '--name', 'notes-lite']);
  assert.match(project.id, /^P-[0-9a-f]{6}$/);
  assert.ok(fs.existsSync(path.join(PROJECT, '.agents', 'adaptive-agents', 'config.toml')), 'payload installed and initialized');
  assert.ok(fs.readFileSync(path.join(PROJECT, 'AGENTS.md'), 'utf8').includes('adaptive-agents/SUPERVISOR.md'), 'AGENTS.md points to the payload');
  assert.ok(!fs.existsSync(path.join(PROJECT, 'CLAUDE.md')), 'no Claude Code file in a project without Claude Code');
  assert.ok(fs.existsSync(path.join(project.payload, 'workspace', 'project.json')), 'project.json written');
  fs.appendFileSync(path.join(project.payload, 'config.toml'), '\n[agents]\ndefault_provider = "mock"\nmax_concurrent = 3\n\n[runner]\ntick_seconds = 1\nplanner_min_interval_seconds = 2\n');

  const prompt = fs.readFileSync(path.join(CASE, 'planning-prompt.md'), 'utf8');
  const visionText = prompt.slice(prompt.indexOf('My vision:'));
  fs.writeFileSync(path.join(tmp, 'vision.txt'), visionText);
  pa(['vision', 'add', '--file', path.join(tmp, 'vision.txt')]);
  assert.equal(pa(['vision', 'show'])[0].text, visionText, 'vision stored verbatim');

  pa(['resource', 'add', '--kind', 'key_ref', '--name', 'none needed', '--ref', 'NO_KEY']);
  pa(['doc', 'add', '--key', '07-plan', '--title', 'Plan of action', '--path', path.join(CASE, 'plan.md')]);
  assert.equal(pa(['plan', 'validate', path.join(CASE, 'plan.json')]).ok, true);
  const imp = pa(['plan', 'import', path.join(CASE, 'plan.json')]);
  assert.deepEqual(imp.agents.map(a => a.name), ['Zorro-01', 'Kafka-02', 'Nova-03', 'Ronin-04']);
  assert.ok(imp.agents.every(a => a.tasks === 3), 'two tasks plus the planning task each');

  // Manifests and agent folders.
  const manifest = JSON.parse(fs.readFileSync(path.join(project.payload, 'workspace', 'manifest', 'agent-manifest.json'), 'utf8'));
  assert.equal(manifest.agents.length, 5, 'supervisor plus four workers');
  for (const a of manifest.agents) assert.ok(fs.existsSync(a.instructions), `${a.name} has instructions`);
  const l1 = JSON.parse(fs.readFileSync(path.join(manifest.agents[1].folder, 'lists', 'L1.json'), 'utf8'));
  assert.equal(l1.tasks.at(-1).kind, 'planning', 'list ends with the planning task');

  // Approval gate.
  const blocked = spawnSync(process.execPath, [CLI, 'approve'], { encoding: 'utf8', env, cwd: PROJECT });
  assert.equal(blocked.status, 2, 'approval refused while documents are unchecked');
  for (const d of pa(['doc', 'list'])) pa(['doc', 'status', d.key, 'checked']);
  assert.equal(pa(['approve']).phase, 'running');

  // The runner does the rest.
  const run = pa(['run', '--until-idle']);
  assert.equal(run.reason, 'idle');

  const st = pa(['status', '--json']);
  const byId = Object.fromEntries(st.agents.map(a => [a.id, a]));
  const original = st.tasks.filter(t => t.master_id);
  assert.equal(original.length, 8);
  assert.ok(original.every(t => t.status === 'done'), 'all eight master tasks done');

  // Planning loop: A01 planned a second list (bug + feature proposal), did the bug, then retired.
  const a01 = st.tasks.filter(t => t.agent_id === 'A01');
  assert.ok(a01.some(t => t.list_id === 'A01-L2' && t.kind === 'bug' && t.status === 'done'));
  assert.ok(a01.some(t => t.list_id === 'A01-L2' && t.kind === 'feature' && t.status === 'proposed'), 'feature waits for the owner');
  for (const id of ['A01', 'A02', 'A03', 'A04']) assert.equal(byId[id].status, 'retired', `${id} retired`);

  // Points: 1 per task, 10 per planning task.
  assert.equal(byId.A01.points, 2 + 10 + 1 + 10);
  for (const id of ['A02', 'A03', 'A04']) assert.equal(byId[id].points, 12);

  // Completion records are separate files.
  for (const a of manifest.agents.slice(1)) {
    const done = fs.readdirSync(path.join(a.folder, 'completed'));
    assert.ok(done.length >= 3, `${a.name} wrote completion records`);
  }
  const rec = JSON.parse(fs.readFileSync(path.join(manifest.agents[1].folder, 'completed', 'A01-L1-1.json'), 'utf8'));
  assert.equal(rec.kind, 'owner_request'); assert.equal(rec.points, 1); assert.ok(rec.summary);

  // Attempts: A02 failed once on purpose.
  const t = pa(['task', 'show', 'A02-L1-1']);
  assert.equal(t.attempts, 1);
  assert.ok(t.events.some(e => e.type === 'fail'));

  // Board: announcements, steps, done, question, and every question answered.
  const types = new Set(st.board.map(m => m.type));
  for (const ty of ['announce', 'step', 'done', 'question', 'answer', 'planning', 'proposal', 'retire']) assert.ok(types.has(ty), `board has ${ty}`);
  assert.equal(st.unanswered.length, 0, 'every question got a reply');

  // Usage tracking and the work itself.
  assert.ok(st.totals.runs >= 5);
  assert.ok(st.totals.tokens_in > 0 && st.totals.tokens_out > 0 && st.totals.cost_usd > 0);
  assert.ok(fs.existsSync(path.join(PROJECT, 'c1', 'A01-L1-1.txt')), 'agent wrote into the project');
  assert.equal(st.claims.length, 0, 'all claims released');

  // Radar data and UI snapshot.
  assert.ok(st.categories.every(c => c.percent === 100));
  const snap = JSON.parse(fs.readFileSync(path.join(project.payload, 'workspace', 'state.json'), 'utf8'));
  assert.equal(snap.project.id, project.id);

  // Owner pitch landed in the inbox.
  assert.match(fs.readFileSync(path.join(project.payload, 'workspace', 'owner-inbox.md'), 'utf8'), /Web page for notes/);
  console.log(`e2e: ${st.totals.runs} runs, ${st.totals.tasks_done}/${st.totals.tasks_total} tasks, ${st.totals.points} points, ${st.board.length} board messages, data in ${tmp}`);
});

test('stop, pause and the daily spending ceiling keep the runner from waking anyone', { timeout: 60000 }, () => {
  const root = path.join(tmp, 'stop-project');
  fs.cpSync(path.join(CASE, 'sample-project'), root, { recursive: true });
  const run = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd: root }); if (r.status !== 0) throw new Error(r.stderr); try { return JSON.parse(r.stdout); } catch { return r.stdout; } };
  const p = run(['register', root, '--copy', '--approve', 'all', '--name', 'stop-test']);
  fs.appendFileSync(path.join(p.payload, 'config.toml'), '\n[agents]\ndefault_provider = "mock"\n');
  run(['plan', 'import', path.join(CASE, 'plan.json')]);
  run(['approve', '--force']);
  run(['stop', '--reason', 'owner wants a pause']);
  assert.equal(run(['run', '--until-idle']).reason, 'STOP requested');
  run(['start']);
  run(['pause']);
  assert.equal(run(['run', '--until-idle']).reason, 'project phase is paused');
  run(['resume']);
  fs.appendFileSync(path.join(p.payload, 'config.toml'), '\n[limits]\ndaily_usd = 0.000001\n');
  // The first runs record cost, then the ceiling stops further runs.
  const r = run(['run', '--until-idle']);
  assert.match(r.reason, /idle|ceiling/);
  const st = run(['status', '--json']);
  assert.ok(st.totals.tasks_done < st.totals.tasks_total, 'the ceiling stopped work before the plan finished');
  assert.equal(st.board.filter(m => m.type === 'stop').length, 1);
});
