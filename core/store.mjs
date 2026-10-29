// Domain operations on the SQLite record store. Every function takes the database
// handle first so tests can use a throw-away database.

import crypto from 'node:crypto';
import { tx, now } from './db.mjs';

export class PaError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

export const KIND_RANK = {
  critical: 0,        // breaks the build, data loss, security
  owner_request: 1,   // features the owner asked for, and all their parts
  bug: 2,
  optimization: 3,
  feature: 4,         // new territory: needs owner approval when an agent proposes it
  research: 5,
  planning: 9,        // always last: plan the next list
};
export const KINDS = Object.keys(KIND_RANK);
const OPEN = ['todo', 'in_progress'];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const shortId = (prefix) => `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
const J = (v) => JSON.stringify(v ?? []);
const P = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };

// ---------------------------------------------------------------- projects

export function createProject(db, { name, root, kind = 'code', id }) {
  if (!name || !root) throw new PaError('bad_input', 'project needs a name and a root folder');
  const pid = id || shortId('P');
  db.prepare('INSERT INTO projects (id, name, root, kind) VALUES (?, ?, ?, ?)').run(pid, name, root, kind);
  return getProject(db, pid);
}

export const getProject = (db, id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
export const listProjects = (db) => db.prepare('SELECT * FROM projects ORDER BY created_at').all();

export function requireProject(db, id) {
  const p = getProject(db, id);
  if (!p) throw new PaError('not_found', `no project with id ${id}`);
  return p;
}

export function setPhase(db, id, phase) {
  db.prepare('UPDATE projects SET phase = ? WHERE id = ?').run(phase, id);
}

export function addVision(db, projectId, text) {
  return tx(db, () => {
    const v = db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM vision WHERE project_id = ?').get(projectId).v + 1;
    db.prepare('INSERT INTO vision (project_id, version, text, sha256) VALUES (?, ?, ?, ?)').run(projectId, v, text, sha256(text));
    return v;
  });
}
export const getVision = (db, projectId) =>
  db.prepare('SELECT * FROM vision WHERE project_id = ? ORDER BY version').all(projectId);

export function addResource(db, projectId, { kind, name, value_ref = null, note = null }) {
  if (kind === 'key_ref' && value_ref && /^(sk-|ghp_|xox|AKIA|eyJ)/.test(value_ref))
    throw new PaError('secret_refused', 'store the NAME of the environment variable or file holding a key, never the key itself');
  db.prepare('INSERT INTO resources (project_id, kind, name, value_ref, note) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, kind, name, value_ref, note);
}
export const listResources = (db, projectId) =>
  db.prepare('SELECT * FROM resources WHERE project_id = ? ORDER BY id').all(projectId);

export function upsertDocument(db, projectId, { key, title, path, status = 'made', content = null }) {
  db.prepare(`INSERT INTO documents (project_id, key, title, path, status, sha256, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(project_id, key) DO UPDATE SET title=excluded.title, path=excluded.path,
                status=excluded.status, sha256=COALESCE(excluded.sha256, documents.sha256), updated_at=excluded.updated_at`)
    .run(projectId, key, title, path, status, content == null ? null : sha256(content), now());
}
export function setDocumentStatus(db, projectId, key, status) {
  const r = db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE project_id = ? AND key = ?').run(status, now(), projectId, key);
  if (!r.changes) throw new PaError('not_found', `no document ${key}`);
}
export const listDocuments = (db, projectId) =>
  db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY key').all(projectId);

// ---------------------------------------------------------------- agents

export const getAgent = (db, projectId, agentId) => {
  const a = db.prepare('SELECT * FROM agents WHERE project_id = ? AND (id = ? OR name = ?)').get(projectId, agentId, agentId);
  if (a) a.categories = P(a.categories);
  return a;
};
export function requireAgent(db, projectId, agentId) {
  const a = getAgent(db, projectId, agentId);
  if (!a) throw new PaError('not_found', `no agent ${agentId} in project ${projectId}`);
  return a;
}
export const listAgents = (db, projectId) =>
  db.prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY id').all(projectId).map(a => ({ ...a, categories: P(a.categories) }));

export function insertAgent(db, projectId, a) {
  db.prepare(`INSERT INTO agents (project_id, id, name, role, categories, lane, persona, provider, model, folder)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(projectId, a.id, a.name, a.role, J(a.categories), a.lane ?? null, a.persona ?? null, a.provider, a.model ?? null, a.folder ?? null);
}

export function setAgentStatus(db, projectId, agentId, status, reason = null) {
  const retired = status === 'retired';
  db.prepare(`UPDATE agents SET status = ?, retire_reason = COALESCE(?, retire_reason),
              retired_at = CASE WHEN ? THEN ? ELSE retired_at END WHERE project_id = ? AND id = ?`)
    .run(status, reason, retired ? 1 : 0, now(), projectId, agentId);
}
export function setAgentSession(db, projectId, agentId, sessionId) {
  db.prepare('UPDATE agents SET session_id = ? WHERE project_id = ? AND id = ?').run(sessionId, projectId, agentId);
}
export function setStuckRuns(db, projectId, agentId, n) {
  db.prepare('UPDATE agents SET stuck_runs = ? WHERE project_id = ? AND id = ?').run(n, projectId, agentId);
}

// ---------------------------------------------------------------- lists and tasks

// Create a new immutable list for an agent. A planning task is appended at the end
// unless the agent already has an open planning task. Features proposed by an agent
// (createdBy is the agent itself) start as 'proposed' and need owner approval.
export function createList(db, projectId, agentId, tasks, { createdBy, file = null } = {}) {
  return tx(db, () => {
    const seq = db.prepare('SELECT COALESCE(MAX(seq),0) AS s FROM lists WHERE project_id = ? AND agent_id = ?').get(projectId, agentId).s + 1;
    const listId = `${agentId}-L${seq}`;
    db.prepare('INSERT INTO lists (project_id, id, agent_id, seq, created_by, file) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, listId, agentId, seq, createdBy, file);
    const byAgent = createdBy === agentId;
    const ins = db.prepare(`INSERT INTO tasks (project_id, id, list_id, agent_id, seq, master_id, kind, title, detail, acceptance, complexity, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let n = 0;
    const out = [];
    for (const t of tasks) {
      if (!KINDS.includes(t.kind)) throw new PaError('bad_input', `unknown task kind "${t.kind}"; use one of ${KINDS.join(', ')}`);
      if (t.kind === 'planning') continue; // the system adds the planning task itself
      n++;
      const id = `${listId}-${n}`;
      // Fixing is autonomous; growing is not. When an agent writes its own list, critical
      // issues and bugs go straight to work; optimizations, new features, research and
      // anything framed as a user request become proposals that wait for the user.
      const status = byAgent && !['critical', 'bug'].includes(t.kind) ? 'proposed' : 'todo';
      ins.run(projectId, id, listId, agentId, n, t.master_id ?? null, t.kind, t.title, t.detail ?? null, t.acceptance ?? null,
        Math.min(5, Math.max(1, Number(t.complexity ?? 2))), status);
      out.push({ id, status, ...t });
    }
    // A planning task already waiting (todo) keeps its place as the last task. The planning
    // task that is in progress right now is the one creating this list, so it does not count.
    const openPlanning = db.prepare(`SELECT 1 FROM tasks WHERE project_id = ? AND agent_id = ? AND kind = 'planning' AND status = 'todo'`).get(projectId, agentId);
    if (!openPlanning) {
      n++;
      const id = `${listId}-${n}`;
      ins.run(projectId, id, listId, agentId, n, null, 'planning', 'Plan the next list',
        'Follow procedures/next-task-list.md in the payload folder: make sure all your work is on main, backtrace your department, run a gap analysis of your department against the vision, the master list and the planning documents (the plans folder named in workspace/project.json), then create your next list with `pa list new` or retire with `pa retire`.',
        'A new list exists for this agent, or the agent is retired with a stated reason.', 3, 'todo');
      out.push({ id, status: 'todo', kind: 'planning', title: 'Plan the next list' });
    }
    return { listId, seq, tasks: out };
  });
}

export const getTask = (db, projectId, taskId) => {
  const t = db.prepare('SELECT * FROM tasks WHERE project_id = ? AND id = ?').get(projectId, taskId);
  if (t) t.files = P(t.files);
  return t;
};
function requireOwnTask(db, projectId, agentId, taskId) {
  const t = getTask(db, projectId, taskId);
  if (!t) throw new PaError('not_found', `no task ${taskId}`);
  if (t.agent_id !== agentId) throw new PaError('not_yours', `task ${taskId} belongs to ${t.agent_id}; stay in your lane or ask on the board`);
  return t;
}

export const listTasks = (db, projectId, { agentId = null, status = null } = {}) => {
  let sql = 'SELECT * FROM tasks WHERE project_id = ?';
  const args = [projectId];
  if (agentId) { sql += ' AND agent_id = ?'; args.push(agentId); }
  if (status) { sql += ` AND status IN (${status.map(() => '?').join(',')})`; args.push(...status); }
  sql += ' ORDER BY agent_id, list_id, seq';
  return db.prepare(sql).all(...args).map(t => ({ ...t, files: P(t.files) }));
};

const rankSql = `CASE kind ${Object.entries(KIND_RANK).map(([k, r]) => `WHEN '${k}' THEN ${r}`).join(' ')} END`;

// The task the agent should work on now: its in-progress task if it has one,
// otherwise the highest-priority todo task (critical, owner requests, bugs,
// optimizations, features, research), and the planning task only when nothing
// else is open.
export function nextTask(db, projectId, agentId) {
  const cur = db.prepare(`SELECT * FROM tasks WHERE project_id = ? AND agent_id = ? AND status = 'in_progress' ORDER BY started_at LIMIT 1`).get(projectId, agentId);
  if (cur) return { ...cur, files: P(cur.files) };
  // The planning task waits until every other task of this agent is finished: nothing paused,
  // waiting for the user, or blocked may be left behind when the next list is planned.
  const pending = db.prepare(`SELECT 1 FROM tasks WHERE project_id = ? AND agent_id = ? AND kind <> 'planning'
                              AND status IN ('todo','in_progress','paused','waiting_user','blocked') LIMIT 1`).get(projectId, agentId);
  const t = db.prepare(`SELECT tasks.*, lists.seq AS list_seq FROM tasks JOIN lists ON lists.project_id = tasks.project_id AND lists.id = tasks.list_id
                        WHERE tasks.project_id = ? AND tasks.agent_id = ? AND tasks.status = 'todo' ${pending ? "AND tasks.kind <> 'planning'" : ''}
                        ORDER BY ${rankSql}, lists.seq, tasks.seq LIMIT 1`).get(projectId, agentId);
  return t ? { ...t, files: P(t.files) } : null;
}

export const hasRunnableWork = (db, projectId, agentId) => !!nextTask(db, projectId, agentId);

function normPath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
function overlaps(a, b) {
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

export function activeClaims(db, projectId) {
  return db.prepare('SELECT * FROM claims WHERE project_id = ? AND expires_at > ? ORDER BY path').all(projectId, now());
}

// Start (or resume) a task and claim its files. Fails with code 'conflict' if another
// agent holds an overlapping, unexpired claim; nothing is changed in that case.
export function startTask(db, projectId, agentId, taskId, files = [], { ttlHours = 12 } = {}) {
  return tx(db, () => {
    const t = requireOwnTask(db, projectId, agentId, taskId);
    if (!OPEN.includes(t.status)) throw new PaError('bad_state', `task ${taskId} is ${t.status}`);
    const other = db.prepare(`SELECT 1 FROM tasks WHERE project_id = ? AND agent_id = ? AND status = 'in_progress' AND id <> ?`).get(projectId, agentId, taskId);
    if (other) throw new PaError('bad_state', 'finish or fail your current in-progress task first (one task at a time)');
    const want = [...new Set(files.map(normPath).filter(Boolean))];
    const held = db.prepare('SELECT * FROM claims WHERE project_id = ? AND agent_id <> ? AND expires_at > ?').all(projectId, agentId, now());
    const conflicts = [];
    for (const w of want) for (const h of held) if (overlaps(w, h.path)) conflicts.push({ path: w, held_path: h.path, agent_id: h.agent_id, task_id: h.task_id });
    if (conflicts.length) throw new PaError('conflict', 'another agent is working on overlapping files', { conflicts });
    db.prepare('DELETE FROM claims WHERE project_id = ? AND agent_id = ? AND expires_at <= ?').run(projectId, agentId, now());
    const exp = new Date(Date.now() + ttlHours * 3600e3).toISOString();
    const up = db.prepare(`INSERT INTO claims (project_id, path, agent_id, task_id, expires_at) VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT(project_id, path) DO UPDATE SET agent_id=excluded.agent_id, task_id=excluded.task_id, expires_at=excluded.expires_at`);
    for (const w of want) up.run(projectId, w, agentId, taskId, exp);
    const allFiles = [...new Set([...t.files, ...want])];
    db.prepare(`UPDATE tasks SET status = 'in_progress', started_at = COALESCE(started_at, ?), files = ? WHERE project_id = ? AND id = ?`)
      .run(now(), J(allFiles), projectId, taskId);
    addEvent(db, projectId, taskId, agentId, 'start', want.join(', '));
    return { ...getTask(db, projectId, taskId) };
  });
}

export function addEvent(db, projectId, taskId, agentId, type, text = null) {
  db.prepare('INSERT INTO task_events (project_id, task_id, agent_id, type, text) VALUES (?, ?, ?, ?, ?)').run(projectId, taskId, agentId, type, text);
}

export function stepTask(db, projectId, agentId, taskId, text) {
  const t = requireOwnTask(db, projectId, agentId, taskId);
  if (t.status !== 'in_progress') throw new PaError('bad_state', `task ${taskId} is ${t.status}; start it first`);
  addEvent(db, projectId, taskId, agentId, 'step', text);
}

export function releaseClaims(db, projectId, agentId, taskId = null) {
  if (taskId) db.prepare('DELETE FROM claims WHERE project_id = ? AND agent_id = ? AND task_id = ?').run(projectId, agentId, taskId);
  else db.prepare('DELETE FROM claims WHERE project_id = ? AND agent_id = ?').run(projectId, agentId);
}

export function completeTask(db, projectId, agentId, taskId, { summary, files = [], tests = null, points }) {
  if (!summary) throw new PaError('bad_input', 'a completion needs a summary of what was done');
  return tx(db, () => {
    const t = requireOwnTask(db, projectId, agentId, taskId);
    if (t.status !== 'in_progress') throw new PaError('bad_state', `task ${taskId} is ${t.status}; start it before completing it`);
    const allFiles = [...new Set([...t.files, ...files.map(normPath)])];
    db.prepare(`UPDATE tasks SET status = 'done', done_at = ?, files = ? WHERE project_id = ? AND id = ?`).run(now(), J(allFiles), projectId, taskId);
    db.prepare('INSERT INTO completions (project_id, task_id, agent_id, summary, files, tests, points) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, taskId, agentId, summary, J(allFiles), tests, points);
    releaseClaims(db, projectId, agentId, taskId);
    addEvent(db, projectId, taskId, agentId, 'done', summary);
    return {
      task_id: taskId, agent_id: agentId, list_id: t.list_id, master_id: t.master_id, kind: t.kind, title: t.title,
      summary, files: allFiles, tests, points, attempts: t.attempts + 1, started_at: t.started_at, completed_at: now(),
    };
  });
}

export function setCompletionPath(db, projectId, taskId, p) {
  db.prepare('UPDATE completions SET record_path = ? WHERE project_id = ? AND task_id = ?').run(p, projectId, taskId);
}

// One failed attempt. After maxAttempts the task is blocked: the agent must ask
// permission, move on, or propose an alternative.
// One failed attempt. The loop limit: after `maxAttempts` (default 3) the task is blocked
// and the agent must stop, check the board for crossed work, and drop the approach or
// escalate. Up to `hardMax` (at most 5) attempts are allowed only when the agent states
// why another try is worth it (`extend`). There is never a sixth.
export function failTask(db, projectId, agentId, taskId, reason, maxAttempts, { hardMax = 5, extend = null } = {}) {
  return tx(db, () => {
    const t = requireOwnTask(db, projectId, agentId, taskId);
    if (t.status !== 'in_progress') throw new PaError('bad_state', `task ${taskId} is ${t.status}; only a started task can fail an attempt`);
    const attempts = t.attempts + 1;
    const limit = extend ? Math.min(hardMax, 5) : maxAttempts;
    const blocked = attempts >= limit;
    db.prepare('UPDATE tasks SET attempts = ?, status = ? WHERE project_id = ? AND id = ?').run(attempts, blocked ? 'blocked' : 'in_progress', projectId, taskId);
    if (blocked) releaseClaims(db, projectId, agentId, taskId);
    addEvent(db, projectId, taskId, agentId, blocked ? 'blocked' : 'fail', extend ? `${reason} [extended: ${extend}]` : reason);
    return { attempts, blocked, max_attempts: maxAttempts, hard_max: hardMax, extended: !!extend };
  });
}

// Pause and resume: a paused task keeps its claims' place in history but releases the
// files, so the agent that yielded does not block the one that continues.
export function pauseTask(db, projectId, agentId, taskId, reason) {
  return tx(db, () => {
    const t = requireOwnTask(db, projectId, agentId, taskId);
    if (t.status !== 'in_progress') throw new PaError('bad_state', `task ${taskId} is ${t.status}; only an in-progress task can be paused`);
    db.prepare(`UPDATE tasks SET status = 'paused' WHERE project_id = ? AND id = ?`).run(projectId, taskId);
    releaseClaims(db, projectId, agentId, taskId);
    addEvent(db, projectId, taskId, agentId, 'pause', reason);
    return getTask(db, projectId, taskId);
  });
}

export function resumeTask(db, projectId, agentId, taskId) {
  return tx(db, () => {
    const t = requireOwnTask(db, projectId, agentId, taskId);
    if (t.status !== 'paused') throw new PaError('bad_state', `task ${taskId} is ${t.status}, not paused`);
    db.prepare(`UPDATE tasks SET status = 'todo' WHERE project_id = ? AND id = ?`).run(projectId, taskId);
    addEvent(db, projectId, taskId, agentId, 'resume', null);
    return getTask(db, projectId, taskId);
  });
}

// A question only the user can answer. The task waits (status waiting_user) and cannot
// continue until the user's answer is recorded.
export function waitForUser(db, projectId, agentId, taskId, question) {
  return tx(db, () => {
    const t = requireOwnTask(db, projectId, agentId, taskId);
    if (!['todo', 'in_progress', 'paused', 'blocked'].includes(t.status)) throw new PaError('bad_state', `task ${taskId} is ${t.status}`);
    db.prepare(`UPDATE tasks SET status = 'waiting_user' WHERE project_id = ? AND id = ?`).run(projectId, taskId);
    releaseClaims(db, projectId, agentId, taskId);
    addEvent(db, projectId, taskId, agentId, 'waiting_user', question);
    return getTask(db, projectId, taskId);
  });
}

export function userAnswered(db, projectId, taskId, by, answer) {
  const t = getTask(db, projectId, taskId);
  if (!t || t.status !== 'waiting_user') return null;
  db.prepare(`UPDATE tasks SET status = 'todo' WHERE project_id = ? AND id = ? AND status = 'waiting_user'`).run(projectId, taskId);
  addEvent(db, projectId, taskId, by, 'user_answer', answer);
  return getTask(db, projectId, taskId);
}

// Named locks (for example "git:main" while merging), held in the claims table so they
// expire on their own if the holder dies.
export function acquireLock(db, projectId, agentId, name, ttlMinutes = 15) {
  return tx(db, () => {
    const key = `lock:${name}`;
    const held = db.prepare('SELECT * FROM claims WHERE project_id = ? AND path = ? AND expires_at > ?').get(projectId, key, now());
    if (held && held.agent_id !== agentId) throw new PaError('locked', `${name} is held by ${held.agent_id} until ${held.expires_at}`, { holder: held.agent_id, expires_at: held.expires_at });
    const exp = new Date(Date.now() + ttlMinutes * 60e3).toISOString();
    db.prepare(`INSERT INTO claims (project_id, path, agent_id, task_id, expires_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_id, path) DO UPDATE SET agent_id = excluded.agent_id, task_id = excluded.task_id, expires_at = excluded.expires_at`)
      .run(projectId, key, agentId, '-', exp);
    return { lock: name, holder: agentId, expires_at: exp };
  });
}

export function releaseLock(db, projectId, agentId, name) {
  const r = db.prepare('DELETE FROM claims WHERE project_id = ? AND path = ? AND agent_id = ?').run(projectId, `lock:${name}`, agentId);
  return { released: r.changes > 0 };
}

export function setTaskStatus(db, projectId, taskId, status, by, note = null) {
  return tx(db, () => setTaskStatusInTx(db, projectId, taskId, status, by, note));
}
function setTaskStatusInTx(db, projectId, taskId, status, by, note) {
  const t = getTask(db, projectId, taskId);
  if (!t) throw new PaError('not_found', `no task ${taskId}`);
  const allowed = {
    approve: [['proposed'], 'todo'], decline: [['proposed'], 'declined'],
    unblock: [['blocked', 'waiting_user'], 'todo'], cancel: [['todo', 'blocked', 'proposed', 'in_progress', 'paused', 'waiting_user'], 'cancelled'],
  }[status];
  if (!allowed) throw new PaError('bad_input', `unknown action ${status}`);
  if (!allowed[0].includes(t.status)) throw new PaError('bad_state', `cannot ${status} a task that is ${t.status}`);
  const r = db.prepare(`UPDATE tasks SET status = ?, attempts = CASE WHEN ? = 'unblock' THEN 0 ELSE attempts END
                         WHERE project_id = ? AND id = ? AND status = ?`).run(allowed[1], status, projectId, taskId, t.status);
  if (!r.changes) throw new PaError('bad_state', `task ${taskId} changed while this was being applied; try again`);
  if (status === 'cancel') releaseClaims(db, projectId, t.agent_id, taskId);
  addEvent(db, projectId, taskId, by, status, note);
  return getTask(db, projectId, taskId);
}

export const taskEvents = (db, projectId, taskId) =>
  db.prepare('SELECT * FROM task_events WHERE project_id = ? AND task_id = ? ORDER BY id').all(projectId, taskId);

// ---------------------------------------------------------------- board

export const MESSAGE_TYPES = [
  'pause',      // I paused a task (with why, and what I am waiting for)
  'resume',     // I resumed a task
  'branch',     // I created a branch / worktree for a task
  'merge',      // I merged a task branch into main (main verified healthy)
  'push',       // I pushed main to the remote
  'shutdown',   // I am ending my session or shutting a system down
  'ask_user',   // a question only the user can answer; routed by the Supervisor
  'user_answer',// the user's answer, relayed by the Supervisor
  'announce',   // starting a task: files and plan
  'step',       // progress on a task
  'done',       // task finished
  'question',   // needs a reply
  'answer',     // reply to a question
  'conflict',   // overlapping files found
  'need_tasks', // my list is running out
  'planning',   // planning session requested / done
  'stop',       // stop request (to an agent or all)
  'reset',      // reset consensus started
  'checkin',    // reply to a reset
  'retire',     // agent retiring
  'proposal',   // new-feature proposal for the owner
  'note',       // anything else
];

export function postMessage(db, projectId, m) {
  if (!MESSAGE_TYPES.includes(m.type)) throw new PaError('bad_input', `unknown message type "${m.type}"; use one of ${MESSAGE_TYPES.join(', ')}`);
  if (!m.text || !String(m.text).trim()) throw new PaError('bad_input', 'a message needs text');
  const id = m.id || crypto.randomUUID();
  const needsReply = m.type === 'question' || m.needs_reply ? 1 : 0;
  db.prepare(`INSERT INTO messages (id, project_id, from_agent, to_agent, type, text, task_id, files, reply_to, needs_reply)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, m.from, m.to || 'all', m.type, String(m.text).slice(0, 4000), m.task_id ?? null, J(m.files), m.reply_to ?? null, needsReply);
  return getMessage(db, id);
}

export const getMessage = (db, id) => {
  const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (r) r.files = P(r.files);
  return r;
};

function audienceSql(agent) {
  // What an agent should read: messages to all, to itself, and (for the planner) to 'supervisor'.
  const to = ['all', agent.id, agent.name];
  if (agent.role === 'supervisor') to.push('supervisor');
  return { sql: `to_agent IN (${to.map(() => '?').join(',')})`, args: to };
}

// Unread messages for an agent. Advances the agent's read cursor unless peek is set.
export function readMessages(db, projectId, agent, { peek = false, limit = 50, all = false, since = null } = {}) {
  const cur = db.prepare('SELECT last_seq FROM read_cursors WHERE project_id = ? AND agent_id = ?').get(projectId, agent.id)?.last_seq ?? 0;
  const from = since != null ? Number(since) : cur;
  const a = audienceSql(agent);
  const where = all ? '1=1' : `(${a.sql}) AND from_agent <> ?`;
  const args = all ? [] : [...a.args, agent.id];
  const rows = db.prepare(`SELECT * FROM messages WHERE project_id = ? AND seq > ? AND ${where} ORDER BY seq LIMIT ?`)
    .all(projectId, from, ...args, limit).map(r => ({ ...r, files: P(r.files) }));
  if (!peek && rows.length) {
    const last = rows[rows.length - 1].seq;
    db.prepare(`INSERT INTO read_cursors (project_id, agent_id, last_seq) VALUES (?, ?, ?)
                ON CONFLICT(project_id, agent_id) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)`).run(projectId, agent.id, last);
  }
  return rows;
}

export function unreadCount(db, projectId, agent) {
  const cur = db.prepare('SELECT last_seq FROM read_cursors WHERE project_id = ? AND agent_id = ?').get(projectId, agent.id)?.last_seq ?? 0;
  const a = audienceSql(agent);
  return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE project_id = ? AND seq > ? AND (${a.sql}) AND from_agent <> ?`)
    .get(projectId, cur, ...a.args, agent.id).n;
}

// Unread messages that justify waking an agent's session. Broadcast notes and
// announcements do not wake anyone (agents read them on their next run anyway);
// direct messages, stop requests and resets do.
export function wakeCount(db, projectId, agent) {
  const cur = db.prepare('SELECT last_seq FROM read_cursors WHERE project_id = ? AND agent_id = ?').get(projectId, agent.id)?.last_seq ?? 0;
  const direct = [agent.id, agent.name, ...(agent.role === 'supervisor' ? ['supervisor'] : [])];
  // An agent is also woken when its name is mentioned anywhere on the board ("@Zorro-01" or "Zorro-01").
  return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE project_id = ? AND seq > ? AND from_agent <> ?
                     AND (to_agent IN (${direct.map(() => '?').join(',')})
                          OR (to_agent = 'all' AND type IN ('stop','reset'))
                          OR instr(text, ?) > 0
                          OR (? = 'supervisor' AND to_agent IN ('all', 'owner') AND type IN ('question','need_tasks','proposal','planning','retire','ask_user','conflict')))`)
    .get(projectId, cur, agent.id, ...direct, agent.name, agent.role).n;
}

// Questions that nobody has answered yet. Every question must get a reply.
export function unansweredQuestions(db, projectId) {
  return db.prepare(`SELECT q.* FROM messages q WHERE q.project_id = ? AND q.needs_reply = 1
                     AND NOT EXISTS (SELECT 1 FROM messages a WHERE a.project_id = q.project_id AND a.reply_to = q.id)
                     ORDER BY q.seq`).all(projectId).map(r => ({ ...r, files: P(r.files) }));
}

// Keep the database bounded: board messages older than the retention period are
// deleted, except questions still waiting for a reply. Task history, completions and
// runs are kept (they are small and are the project's record).
export function pruneMessages(db, projectId, days) {
  if (!days || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
  const r = db.prepare(`DELETE FROM messages WHERE project_id = ? AND created_at < ?
                        AND NOT (needs_reply = 1 AND NOT EXISTS (SELECT 1 FROM messages a WHERE a.reply_to = messages.id))`).run(projectId, cutoff);
  db.prepare("DELETE FROM claims WHERE project_id = ? AND expires_at <= ?").run(projectId, now());
  return Number(r.changes);
}

export const recentMessages = (db, projectId, limit = 100) =>
  db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY seq DESC LIMIT ?').all(projectId, limit).reverse().map(r => ({ ...r, files: P(r.files) }));

// ---------------------------------------------------------------- reset consensus

export function startReset(db, projectId, startedBy, reason) {
  // Only agents the runner can wake are expected; stuck and stopped agents could never answer.
  const expected = listAgents(db, projectId).filter(a => ['active', 'idle'].includes(a.status)).map(a => a.id);
  const id = shortId('R');
  db.prepare('INSERT INTO resets (id, project_id, started_by, reason, expected) VALUES (?, ?, ?, ?, ?)').run(id, projectId, startedBy, reason ?? null, J(expected));
  return { id, expected };
}

export function checkin(db, projectId, resetId, agentId, note = null) {
  const r = db.prepare('SELECT * FROM resets WHERE id = ? AND project_id = ?').get(resetId, projectId);
  if (!r) throw new PaError('not_found', `no reset ${resetId}`);
  db.prepare('INSERT OR REPLACE INTO reset_checkins (reset_id, agent_id, note) VALUES (?, ?, ?)').run(resetId, agentId, note);
  return resetStatus(db, projectId, resetId);
}

export function resetStatus(db, projectId, resetId) {
  const r = db.prepare('SELECT * FROM resets WHERE id = ? AND project_id = ?').get(resetId, projectId);
  if (!r) throw new PaError('not_found', `no reset ${resetId}`);
  // An agent that has since retired, stopped or got stuck is no longer waited for.
  const gone = new Set(listAgents(db, projectId).filter(a => !['active', 'idle'].includes(a.status)).map(a => a.id));
  const expected = P(r.expected).filter(a => !gone.has(a));
  const got = db.prepare('SELECT agent_id FROM reset_checkins WHERE reset_id = ?').all(resetId).map(x => x.agent_id);
  const missing = expected.filter(a => !got.includes(a));
  if (!missing.length && !r.completed_at) db.prepare('UPDATE resets SET completed_at = ? WHERE id = ?').run(now(), resetId);
  return { id: resetId, reason: r.reason, expected, checked_in: got, missing, complete: missing.length === 0 };
}

export function cancelReset(db, projectId, resetId) {
  const r = db.prepare('UPDATE resets SET completed_at = ?, reason = COALESCE(reason, \'\') || \' (cancelled)\' WHERE id = ? AND project_id = ? AND completed_at IS NULL').run(now(), resetId, projectId);
  if (!r.changes) throw new PaError('not_found', `no open reset ${resetId}`);
}

export function openResets(db, projectId) {
  return db.prepare('SELECT id FROM resets WHERE project_id = ? AND completed_at IS NULL').all(projectId).map(r => resetStatus(db, projectId, r.id)).filter(r => !r.complete);
}

// ---------------------------------------------------------------- runs, usage, presence

export function startRun(db, projectId, agentId, provider, reason, logPath) {
  const r = db.prepare('INSERT INTO runs (project_id, agent_id, provider, reason, log_path) VALUES (?, ?, ?, ?, ?)').run(projectId, agentId, provider, reason, logPath);
  return Number(r.lastInsertRowid);
}
export function setRunPid(db, runId, pid) { db.prepare('UPDATE runs SET pid = ? WHERE id = ?').run(pid, runId); }
export function endRun(db, runId, { exit_code, tokens_in = 0, tokens_out = 0, cost_usd = 0, session_id = null, progressed = 0 }) {
  db.prepare(`UPDATE runs SET ended_at = ?, exit_code = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?, session_id = ?, progressed = ? WHERE id = ?`)
    .run(now(), exit_code, tokens_in, tokens_out, cost_usd, session_id, progressed ? 1 : 0, runId);
}
// Close runs left open by a runner that crashed or was killed: the process is gone,
// or the run is older than the time limit. Without this, such an agent is never woken again.
export function reapStaleRuns(db, projectId, timeoutMinutes, isLive = pidAlive) {
  const cutoff = new Date(Date.now() - (timeoutMinutes + 5) * 60e3).toISOString();
  let n = 0;
  for (const r of openRuns(db, projectId)) {
    if (r.started_at < cutoff || !r.pid || !isLive(r.pid)) {
      db.prepare('UPDATE runs SET ended_at = ?, exit_code = COALESCE(exit_code, -2) WHERE id = ? AND ended_at IS NULL').run(now(), r.id);
      n++;
    }
  }
  return n;
}
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export const openRuns = (db, projectId) => db.prepare('SELECT * FROM runs WHERE project_id = ? AND ended_at IS NULL').all(projectId);

export function spendToday(db, projectId) {
  const day = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS usd FROM runs WHERE project_id = ? AND substr(started_at,1,10) = ?`).get(projectId, day).usd;
}
// Average cost of the project's last 10 finished runs (0 when none have finished).
export function averageRunCost(db, projectId) {
  const r = db.prepare(`SELECT AVG(cost_usd) AS a FROM (SELECT cost_usd FROM runs WHERE project_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 10)`).get(projectId);
  return r.a || 0;
}
export function tokensToday(db, projectId) {
  const day = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT COALESCE(SUM(tokens_in + tokens_out),0) AS t FROM runs WHERE project_id = ? AND substr(started_at,1,10) = ?`).get(projectId, day).t;
}
export function runsToday(db, projectId, agentId) {
  const day = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE project_id = ? AND agent_id = ? AND substr(started_at,1,10) = ?`).get(projectId, agentId, day).n;
}

// Progress marker used to detect a run that did nothing: count of task events + completions.
// Progress means something changed state: a task started, failed, finished or was
// blocked, a list was created, a question was answered, a reset was acknowledged, or
// (for the planner) a task was approved, unblocked or cancelled. Reading the board,
// posting step notes, and posting conflicts do not count, so an agent that only
// talks is eventually marked stuck instead of being woken forever.
export function progressMarker(db, projectId, agentId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM task_events WHERE project_id = ? AND agent_id = ? AND type <> 'step'`).get(projectId, agentId).n
    // The planner's work is mostly messages (answers, routing, pitches), so all of its messages count.
    + db.prepare(`SELECT COUNT(*) AS n FROM messages m WHERE project_id = ? AND from_agent = ?
                  AND (type IN ('answer','checkin','retire','proposal')
                       OR EXISTS (SELECT 1 FROM agents a WHERE a.project_id = m.project_id AND a.id = m.from_agent AND a.role = 'supervisor'))`).get(projectId, agentId).n
    + db.prepare('SELECT COUNT(*) AS n FROM lists WHERE project_id = ? AND created_by = ?').get(projectId, agentId).n
    + db.prepare('SELECT COUNT(*) AS n FROM reset_checkins c JOIN resets r ON r.id = c.reset_id WHERE r.project_id = ? AND c.agent_id = ?').get(projectId, agentId).n;
}

export function touchPresence(db, projectId, agentId) {
  db.prepare(`INSERT INTO presence (project_id, agent_id, last_seen) VALUES (?, ?, ?)
              ON CONFLICT(project_id, agent_id) DO UPDATE SET last_seen = excluded.last_seen`).run(projectId, agentId, now());
}

export function recordDecision(db, { projectId = null, agentId = null, backend, request, response }) {
  db.prepare('INSERT INTO decisions (project_id, agent_id, backend, request, response) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, agentId, backend, JSON.stringify(request), JSON.stringify(response));
}

// ---------------------------------------------------------------- reporting

export function agentStats(db, projectId, presenceTtlSec = 120) {
  const cutoff = new Date(Date.now() - presenceTtlSec * 1000).toISOString();
  return listAgents(db, projectId).map(a => {
    const t = db.prepare(`SELECT
        SUM(status='done') AS done, SUM(status IN ('todo','in_progress')) AS open, SUM(status='blocked') AS blocked,
        SUM(status='proposed') AS proposed, SUM(status='paused') AS paused, SUM(status='waiting_user') AS waiting_user, SUM(status NOT IN ('declined','cancelled','proposed')) AS total
      FROM tasks WHERE project_id = ? AND agent_id = ?`).get(projectId, a.id);
    const u = db.prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out,
        COALESCE(SUM(cost_usd),0) AS cost_usd,
        COALESCE(SUM((julianday(COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(started_at)) * 86400),0) AS seconds
      FROM runs WHERE project_id = ? AND agent_id = ?`).get(projectId, a.id);
    const pts = db.prepare('SELECT COALESCE(SUM(points),0) AS p FROM completions WHERE project_id = ? AND agent_id = ?').get(projectId, a.id).p;
    const cur = db.prepare(`SELECT id, title FROM tasks WHERE project_id = ? AND agent_id = ? AND status = 'in_progress' LIMIT 1`).get(projectId, a.id);
    const seen = db.prepare('SELECT last_seen FROM presence WHERE project_id = ? AND agent_id = ?').get(projectId, a.id)?.last_seen ?? null;
    const running = !!db.prepare('SELECT 1 FROM runs WHERE project_id = ? AND agent_id = ? AND ended_at IS NULL').get(projectId, a.id);
    const complexity = db.prepare(`SELECT COALESCE(AVG(complexity),0) AS c FROM tasks WHERE project_id = ? AND agent_id = ?`).get(projectId, a.id).c;
    return {
      ...a, points: pts, current_task: cur ?? null, live: running || (['active', 'idle'].includes(a.status) && seen != null && seen > cutoff), running, last_seen: seen,
      tasks: { done: t.done ?? 0, open: t.open ?? 0, blocked: t.blocked ?? 0, proposed: t.proposed ?? 0, paused: t.paused ?? 0, waiting_user: t.waiting_user ?? 0, total: t.total ?? 0 },
      usage: { runs: u.runs, tokens_in: u.tokens_in, tokens_out: u.tokens_out, cost_usd: Number(u.cost_usd.toFixed(4)), seconds: Math.round(u.seconds) },
      avg_complexity: Number(complexity.toFixed(2)),
    };
  });
}

// Percent complete per category (the radar chart). A task belongs to the category of
// its master task, or else to its agent's first category.
export function categoryProgress(db, projectId) {
  const cats = db.prepare('SELECT * FROM categories WHERE project_id = ? ORDER BY id').all(projectId);
  const agents = Object.fromEntries(listAgents(db, projectId).map(a => [a.id, a]));
  const masters = Object.fromEntries(db.prepare('SELECT id, category_id FROM master_tasks WHERE project_id = ?').all(projectId).map(m => [m.id, m.category_id]));
  const acc = Object.fromEntries(cats.map(c => [c.id, { ...c, done: 0, total: 0 }]));
  for (const t of listTasks(db, projectId)) {
    if (['declined', 'cancelled', 'proposed'].includes(t.status) || t.kind === 'planning') continue;
    const cat = (t.master_id && masters[t.master_id]) || agents[t.agent_id]?.categories?.[0];
    if (!acc[cat]) continue;
    acc[cat].total++;
    if (t.status === 'done') acc[cat].done++;
  }
  return Object.values(acc).map(c => ({ ...c, percent: c.total ? Math.round((100 * c.done) / c.total) : 0 }));
}

export function scoreboard(db, projectId) {
  return db.prepare(`SELECT a.id, a.name, COALESCE(SUM(c.points),0) AS points, COUNT(c.task_id) AS completed
                     FROM agents a LEFT JOIN completions c ON c.project_id = a.project_id AND c.agent_id = a.id
                     WHERE a.project_id = ? GROUP BY a.id ORDER BY points DESC, a.id`).all(projectId);
}
