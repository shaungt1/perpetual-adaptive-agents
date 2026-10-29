#!/usr/bin/env node
// A deterministic stand-in for a chat session, used by the end-to-end test.
// It does what a real agent or the Supervisor does, through the same `pa` commands:
// whoami, read the board, answer questions, take tasks in order, claim files,
// write files in the project, report steps, fail once (A02), ask a question (A03),
// plan a new list with a bug and a feature proposal (A01), and retire.
// At the end it prints a JSON result shaped like Claude Code's, so the runner
// records a session id, tokens and cost exactly as it would for a real session.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(process.env.PA_REPO, 'core', 'cli.mjs');
const me = process.env.PA_AGENT;
const calls = [];

function pa(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: process.env });
  calls.push(args.join(' '));
  if (r.status !== 0) return { error: JSON.parse(r.stderr || '{}'), status: r.status };
  try { return JSON.parse(r.stdout); } catch { return r.stdout; }
}

function finish() {
  process.stdout.write(JSON.stringify({
    type: 'result', is_error: false, session_id: `mock-${me}`,
    usage: { input_tokens: 800 + calls.length * 50, output_tokens: 150 + calls.length * 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    total_cost_usd: Number((0.002 * calls.length).toFixed(4)),
    result: `mock run of ${me}: ${calls.length} pa calls`,
  }) + '\n');
}

const who = pa('whoami');
if (who.stop_requested) { finish(); process.exit(0); }
for (const r of who.reset_checkins_required) pa('checkin', r.id, '--note', 'mock: idle and clean');

// Read the board and answer every question addressed to me.
const msgs = pa('board', 'read');
for (const m of Array.isArray(msgs) ? msgs : []) {
  if (m.type === 'question' && (m.to_agent === me || m.to_agent === who.agent.name || (who.agent.role === 'supervisor' && ['supervisor', 'all'].includes(m.to_agent)))) {
    pa('board', 'reply', m.id, `mock answer from ${who.agent.name}: yes, the store API is add(text) and remove(id).`);
  }
}

if (who.agent.role === 'supervisor') {
  // Supervise: answer anything still unanswered, pitch proposals to the owner.
  for (const q of pa('board', 'unanswered')) if (q.from_agent !== me) pa('board', 'reply', q.id, 'supervisor: noted; carry on with your list.');
  const props = pa('proposals');
  if (props.length) {
    const inbox = path.join(who.payload_folder, 'workspace', 'owner-inbox.md');
    fs.appendFileSync(inbox, props.map(p => `- Proposal ${p.id} from ${p.agent}: ${p.title}. ${p.detail || ''}\n`).join(''));
  }
  pa('board', 'post', '--type', 'note', '--text', `supervisor run: ${props.length} proposal(s) pitched to the owner`);
  finish(); process.exit(0);
}

const root = who.project.root;
let asked = false;
for (let guard = 0; guard < 10; guard++) {
  const next = pa('task', 'next');
  const t = next.task;
  if (!t) break;
  if (t.kind === 'planning') {
    pa('task', 'start', t.id, '--plan', 'plan next list');
    const done = pa('task', 'list', '--status', 'done').filter(x => x.kind === 'planning').length;
    if (me === 'A01' && done === 0) {
      const f = path.join(who.agent_folder, 'next-list.json');
      fs.writeFileSync(f, JSON.stringify({ tasks: [
        { kind: 'bug', title: 'Handle an empty data file', detail: 'Loading an empty notes.json crashes.', acceptance: 'Empty file loads as no notes.', complexity: 1 },
        { kind: 'feature', title: 'Web page for notes', detail: 'A one-page web view of the notes. The vision mentions it as a later wish.', acceptance: 'Page lists notes.', complexity: 3 },
      ] }));
      pa('list', 'new', '--file', f);
      pa('task', 'done', t.id, '--summary', 'planned 2 tasks: 1 bug, 1 feature proposal');
      continue;
    }
    pa('task', 'done', t.id, '--summary', 'lane complete; nothing worthwhile left');
    pa('retire', '--reason', 'lane complete and no proposals worth making');
    break;
  }
  const file = `${who.agent.categories[0].toLowerCase()}/${t.id}.txt`;
  const s = pa('task', 'start', t.id, '--files', file, '--plan', `write ${file}`);
  if (s.error) { pa('board', 'ask', '--to', 'supervisor', `conflict on ${file}: ${s.error.message}`); break; }
  if (me === 'A03' && !asked) {
    pa('board', 'ask', '--to', 'A01', '--task', t.id, 'What is the store API I should document?');
    asked = true;
  }
  if (me === 'A02' && t.seq === 1 && t.attempts === 0) {
    pa('task', 'fail', t.id, '--reason', 'mock: first attempt fails on purpose');
  }
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), `${t.title}\nwritten by ${who.agent.name}\n`);
  pa('task', 'step', t.id, `wrote ${file}`);
  pa('task', 'done', t.id, '--summary', `${t.title}: wrote ${file}`, '--files', file, '--tests', 'mock check passed');
}
finish();
