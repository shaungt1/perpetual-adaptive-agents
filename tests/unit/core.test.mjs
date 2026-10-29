// Unit tests for the record store, settings, planning validation, providers and decisions.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-unit-'));
process.env.PA_HOME = path.join(tmp, 'home');
process.env.PA_NATS = 'off';

const { openProjectDb } = await import('../../core/db.mjs');
const { registerFolder } = await import('../../core/register.mjs');
const S = await import('../../core/store.mjs');
const { clamp, loadSettings } = await import('../../core/config.mjs');
const { validatePlan, importPlan } = await import('../../core/planner.mjs');
const { PROVIDERS, safePrompt } = await import('../../core/providers.mjs');
const { decide } = await import('../../core/decide.mjs');

let db, project, settings;
before(async () => {
  fs.mkdirSync(path.join(tmp, 'proj'));
  const info = await registerFolder({ path: path.join(tmp, 'proj'), name: 'unit', copy: true });
  db = openProjectDb(info.id);
  project = S.getProject(db, info.id);
  settings = loadSettings();
  importPlan(db, project, {
    categories: [{ id: 'C1', name: 'One', scope: 'Everything about One in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }, { id: 'C2', name: 'Two', scope: 'Everything about Two in this test project.', owns: ['src/c2/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }],
    master_tasks: [
      { id: 'T-001', category: 'C1', kind: 'optimization', title: 'opt' },
      { id: 'T-002', category: 'C1', kind: 'bug', title: 'bug' },
      { id: 'T-003', category: 'C1', kind: 'critical', title: 'crit' },
      { id: 'T-004', category: 'C1', kind: 'owner_request', title: 'req' },
      { id: 'T-005', category: 'C2', kind: 'owner_request', title: 'other lane' },
    ],
    agents: [{ categories: ['C1'], provider: 'mock', tasks: ['T-001', 'T-002', 'T-003', 'T-004'] }, { categories: ['C2'], provider: 'mock', tasks: ['T-005'] }],
  }, settings);
});

test('settings: agent cap 8 (max 10), loop limit 3 (max 5)', () => {
  assert.equal(loadSettings().agents.max_active, 8);
  const s = clamp({ agents: { max_active: 50, hard_max: 99, max_concurrent: 40 }, tasks: { max_attempts: 99 } });
  assert.equal(s.agents.hard_max, 10);
  assert.equal(s.agents.max_active, 10);
  assert.equal(s.agents.max_concurrent, 10);
  assert.equal(s.tasks.max_attempts, 5, 'loop limit can never exceed 5');
  assert.equal(loadSettings().tasks.max_attempts, 3, 'default loop limit is 3');
});

test('vision and master task list are immutable', () => {
  S.addVision(db, project.id, 'My exact words, typos and all: teh vision.');
  assert.throws(() => db.prepare('UPDATE vision SET text = ? WHERE project_id = ?').run('reworded', project.id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM master_tasks WHERE project_id = ?').run(project.id), /immutable/);
  assert.throws(() => db.prepare("UPDATE tasks SET title = 'changed' WHERE project_id = ?").run(project.id), /immutable/);
  assert.equal(S.addVision(db, project.id, 'second version'), 2);
  assert.equal(S.getVision(db, project.id)[0].text, 'My exact words, typos and all: teh vision.');
});

test('next task follows priority: critical, owner request, bug, optimization, planning last', () => {
  const order = [];
  for (let i = 0; i < 5; i++) {
    const t = S.nextTask(db, project.id, 'A01');
    order.push(t.kind);
    S.startTask(db, project.id, 'A01', t.id, []);
    S.completeTask(db, project.id, 'A01', t.id, { summary: 'ok', points: t.kind === 'planning' ? 10 : 1 });
  }
  assert.deepEqual(order, ['critical', 'owner_request', 'bug', 'optimization', 'planning']);
  assert.equal(S.nextTask(db, project.id, 'A01'), null);
  assert.equal(S.scoreboard(db, project.id).find(r => r.id === 'A01').points, 14);
});

test('file claims: overlapping paths conflict, other lanes are refused, claims release on done', () => {
  const t1 = S.createList(db, project.id, 'A01', [{ kind: 'bug', title: 'b1' }], { createdBy: 'supervisor' }).tasks[0];
  const t2 = S.nextTask(db, project.id, 'A02');
  S.startTask(db, project.id, 'A01', t1.id, ['src/store/', 'README.md']);
  assert.throws(() => S.startTask(db, project.id, 'A02', t2.id, ['src/store/index.js']), (e) => e.code === 'conflict' && e.details.conflicts[0].agent_id === 'A01');
  assert.equal(S.getTask(db, project.id, t2.id).status, 'todo', 'nothing changed on conflict');
  assert.throws(() => S.startTask(db, project.id, 'A02', t1.id, []), (e) => e.code === 'not_yours');
  S.completeTask(db, project.id, 'A01', t1.id, { summary: 'ok', points: 1 });
  assert.equal(S.startTask(db, project.id, 'A02', t2.id, ['src/store/index.js']).status, 'in_progress');
  S.completeTask(db, project.id, 'A02', t2.id, { summary: 'ok', points: 1 });
});

test('attempts: blocked after max attempts, then unblocked by the planner', () => {
  const t = S.createList(db, project.id, 'A01', [{ kind: 'bug', title: 'flaky' }], { createdBy: 'supervisor' }).tasks[0];
  S.startTask(db, project.id, 'A01', t.id, ['x.js']);
  let r;
  for (let i = 0; i < 3; i++) r = S.failTask(db, project.id, 'A01', t.id, 'nope', 3);
  assert.equal(r.blocked, true);
  assert.equal(S.getTask(db, project.id, t.id).status, 'blocked');
  assert.equal(S.activeClaims(db, project.id).filter(c => c.task_id === t.id).length, 0, 'claims released when blocked');
  S.setTaskStatus(db, project.id, t.id, 'unblock', 'A00');
  assert.equal(S.getTask(db, project.id, t.id).attempts, 0);
});

test('agent-proposed features wait for approval; a new list keeps exactly one planning task last', () => {
  const r = S.createList(db, project.id, 'A01', [{ kind: 'feature', title: 'shiny' }, { kind: 'bug', title: 'b' }], { createdBy: 'A01' });
  assert.equal(r.tasks.find(t => t.kind === 'feature').status, 'proposed');
  const open = S.listTasks(db, project.id, { agentId: 'A01', status: ['todo'] }).filter(t => t.kind === 'planning');
  assert.equal(open.length, 1);
  assert.throws(() => S.createList(db, project.id, 'A01', [{ kind: 'wish', title: 'x' }], { createdBy: 'A01' }), /unknown task kind/);
});

test('board: broadcast notes do not wake agents, direct messages and stops do; questions tracked until answered', () => {
  const a2 = S.getAgent(db, project.id, 'A02');
  S.readMessages(db, project.id, a2); // catch up
  S.postMessage(db, project.id, { from: 'A01', type: 'note', text: 'fyi' });
  assert.equal(S.wakeCount(db, project.id, a2), 0);
  const q = S.postMessage(db, project.id, { from: 'A01', to: 'A02', type: 'question', text: 'are you on store.js?' });
  assert.equal(S.wakeCount(db, project.id, a2), 1);
  assert.ok(S.unansweredQuestions(db, project.id).some(m => m.id === q.id));
  S.postMessage(db, project.id, { from: 'A02', to: 'A01', type: 'answer', reply_to: q.id, text: 'no' });
  assert.ok(!S.unansweredQuestions(db, project.id).some(m => m.id === q.id));
  S.postMessage(db, project.id, { from: 'owner', type: 'stop', text: 'stop all' });
  assert.equal(S.wakeCount(db, project.id, a2), 2);
  assert.throws(() => S.postMessage(db, project.id, { from: 'A01', type: 'shout', text: 'x' }), /unknown message type/);
});

test('reset consensus completes only when every live agent checks in', () => {
  const r = S.startReset(db, project.id, 'owner', 'plan changed');
  assert.deepEqual(r.expected.sort(), ['A00', 'A01', 'A02']);
  S.checkin(db, project.id, r.id, 'A00');
  S.checkin(db, project.id, r.id, 'A01');
  assert.equal(S.resetStatus(db, project.id, r.id).complete, false);
  assert.deepEqual(S.resetStatus(db, project.id, r.id).missing, ['A02']);
  assert.equal(S.checkin(db, project.id, r.id, 'A02').complete, true);
});

test('secrets are refused; only references are stored', () => {
  assert.throws(() => S.addResource(db, project.id, { kind: 'key_ref', name: 'OpenAI', value_ref: 'sk-abc123' }), /NAME/);
  S.addResource(db, project.id, { kind: 'key_ref', name: 'OpenAI', value_ref: 'OPENAI_API_KEY' });
});

test('plan validation catches cap, unknown categories and double assignment', () => {
  const v = validatePlan({
    categories: [{ id: 'C1', name: 'x', scope: 'Everything about x in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }],
    master_tasks: [{ id: 'T-001', category: 'C9', kind: 'bug', title: 't' }],
    agents: Array.from({ length: 9 }, () => ({ categories: ['C1'], tasks: ['T-001'] })),
  }, settings);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /max_active/.test(e)));
  assert.ok(v.errors.some(e => /unknown department C9/.test(e)));
  assert.ok(v.errors.some(e => /assigned to two agents/.test(e)));
});

test('providers: usage parsing and safe prompts', () => {
  const c = PROVIDERS.claude.parse(JSON.stringify({ session_id: 's1', total_cost_usd: 0.12, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 } }));
  assert.deepEqual([c.session_id, c.tokens_in, c.tokens_out, c.cost_usd], ['s1', 15, 7, 0.12]);
  const x = PROVIDERS.codex.parse(['{"type":"thread.started","thread_id":"th1"}', '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}'].join('\n'));
  assert.deepEqual([x.session_id, x.tokens_in, x.tokens_out], ['th1', 100, 20]);
  assert.equal(safePrompt('run "rm -rf" & echo %PATH% | x; `y`'), 'run rm -rf echo PATH x y');
  const b = PROVIDERS.claude.build({ settings, prompt: 'hi', sessionId: 'abc', addDirs: ['/a'], model: null });
  assert.ok(b.args.includes('--resume') && b.args.includes('abc') && b.args.includes('--output-format'));
  const cx = PROVIDERS.codex.build({ settings, prompt: 'hi', sessionId: 'th1', addDirs: ['/a'] });
  assert.deepEqual(cx.args.slice(-3), ['resume', 'th1', 'hi']);
});

test('decide: heuristic backend answers in the System One shape', async () => {
  const r = await decide({ state: 'The tests fail with a syntax error in store.js', questions: { next: { type: 'choice', instructions: 'What next?', options: ['fix the syntax error', 'write documentation'] }, risk: { type: 'score', instructions: 'Risk?' } } });
  assert.equal(r.answers.next.choice, 'fix the syntax error');
  assert.ok(r.answers.next.confidence > 0.5);
  assert.equal(r.answers.risk.type, 'score');
});

test('old board messages are pruned, unanswered questions are kept', () => {
  const old = new Date(Date.now() - 40 * 86400e3).toISOString();
  const n = S.postMessage(db, project.id, { from: 'A01', type: 'note', text: 'old note' });
  const q = S.postMessage(db, project.id, { from: 'A01', type: 'question', text: 'old question' });
  db.prepare('UPDATE messages SET created_at = ? WHERE id IN (?, ?)').run(old, n.id, q.id);
  assert.ok(S.pruneMessages(db, project.id, 30) >= 1);
  assert.equal(S.getMessage(db, n.id), undefined);
  assert.ok(S.getMessage(db, q.id));
});
