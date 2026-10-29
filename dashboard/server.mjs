// The service's API and dashboard: a small local web server (Node's built-in http module, no
// dependencies), listening on 127.0.0.1 only. It reads every registered project from the JSON
// files in that project's adaptive-agents/workspace/ folder (see core/files.mjs).
//
// Routes:
//   GET  /                              the dashboard page (dashboard/index.html)
//   GET  /api/health                    is the service healthy: central folder, NATS, runner, projects
//   GET  /api/projects                  every registered project, with a summary
//   GET  /api/projects/<id>/files       one project as read from its files (project, departments,
//                                       master tasks, agents with lists and completions, metrics, board)
//   GET  /api/state?project=<id>        one project's workspace/state.json (metrics, statuses, board)
//   GET  /api/stream?project=<id>       Server-Sent Events: the state whenever it changes
//   POST /api/projects/register         register a project folder (see core/register.mjs)
//   POST /api/projects/<id>/rename      {"name": "..."}
//   POST /api/action                    user controls: stop/start agents or the project, approve or
//                                       decline proposals, feedback on a master task, and so on
//
// POST rules: JSON only. A request from a web page (it carries an Origin header) must come
// from this dashboard's own page and carry its token, so no other web page can act. A
// request from a program on this computer (no Origin header, such as curl or an agent) is
// accepted without the token: anything on this computer can already run `pa`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openProjectDb } from '../core/db.mjs';
import { loadSettings } from '../core/config.mjs';
import { buildState } from '../core/snapshot.mjs';
import { projectPaths, writeFileAtomic, readRegistry, registryEntry, registerProject, homePaths, paHome, readJson, REPO_ROOT } from '../core/paths.mjs';
import { registerFolder, updateProjectJson, readConfig } from '../core/register.mjs';
import { readProjectFiles } from '../core/files.mjs';
import { heartbeat } from '../core/runner.mjs';
import * as S from '../core/store.mjs';
import { publishBoard, natsStatus } from '../core/nats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e5) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
  });
}

// One project's state: its workspace/state.json, which the runner rewrites on every pass.
// When the file is missing or older than a minute (no runner running), it is rebuilt from
// the agents' records and written back, so the file and the page always agree.
function state(projectId) {
  if (!registryEntry(projectId)) throw new S.PaError('not_found', `no registered project ${projectId}`);
  const snap = projectPaths(projectId).snapshot;
  try {
    const st = fs.statSync(snap);
    if (Date.now() - st.mtimeMs < 60e3) return JSON.parse(fs.readFileSync(snap, 'utf8'));
  } catch {}
  try {
    const st = buildState(openProjectDb(projectId), projectId, loadSettings(projectId));
    writeFileAtomic(snap, JSON.stringify(st, null, 2) + '\n');
    return st;
  } catch (e) {
    if (fs.existsSync(snap)) return { ...JSON.parse(fs.readFileSync(snap, 'utf8')), read_only: true };
    throw e;
  }
}

function summaries() {
  return readRegistry().projects.map(p => {
    try {
      if (!fs.existsSync(p.payload)) throw new Error(`the project's adaptive-agents folder is missing: ${p.payload}`);
      const st = state(p.id);
      const pj = readJson(projectPaths(p.id).projectJson, {});
      return {
        id: p.id, name: pj.name || st.project.name, description: pj.description || '', root: p.root, payload: p.payload, phase: st.project.phase,
        project_managers: (pj.project_managers || []).map(m => m.name),
        agents: st.agents.length, live: st.totals.live, stuck: st.totals.stuck,
        tasks_done: st.totals.tasks_done, tasks_total: st.totals.tasks_total, points: st.totals.points,
        cost_usd: st.totals.cost_usd, open_questions: st.unanswered.length,
        proposals: st.tasks.filter(t => t.status === 'proposed').length,
        last_activity: st.board.at(-1)?.created_at || null,
      };
    } catch (e) {
      return { id: p.id, name: p.name, root: p.root, payload: p.payload, phase: 'unreadable', error: e.message };
    }
  });
}

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
const startedAt = new Date().toISOString();

// The health check. ok is true only when the central folder is usable, the runner is
// passing, and every registered project's folder can be read. NATS being down is reported
// as a warning: the board then works through each project's database.
async function health(port) {
  const problems = [], warnings = [];
  const hp = homePaths();
  let writable = false;
  try { fs.accessSync(hp.home, fs.constants.W_OK); writable = true; } catch { problems.push({ problem: `central folder ${hp.home} is missing or not writable`, fix: 'run start.sh in perpetual-adaptive-agents' }); }
  for (const d of ['projects', 'logs', 'locks', 'bin']) if (!fs.existsSync(path.join(hp.home, d))) problems.push({ problem: `central folder is missing ${d}/`, fix: 'run start.sh in perpetual-adaptive-agents (it repairs missing parts)' });
  const settings = loadSettings();
  const nats = await natsStatus(settings.board.nats_url);
  if (!nats.connected) warnings.push({ problem: `NATS is not reachable at ${settings.board.nats_url}`, fix: 'run start.sh (it starts NATS), or start NATS with docker compose up -d in perpetual-adaptive-agents; until then the board works through the database' });
  let runner;
  if (heartbeat.started_at) {
    const age = heartbeat.last_pass_at ? (Date.now() - Date.parse(heartbeat.last_pass_at)) / 1000 : null;
    const limit = Math.max(30, (heartbeat.tick_seconds || 10) * 3);
    runner = { running: !heartbeat.error && (age === null ? (Date.now() - Date.parse(heartbeat.started_at)) / 1000 < limit : age < limit), in_service: true, last_pass_at: heartbeat.last_pass_at, passes: heartbeat.passes, nats_push: heartbeat.nats_push, error: heartbeat.error };
  } else {
    const pid = fs.existsSync(hp.runnerPid) ? Number(fs.readFileSync(hp.runnerPid, 'utf8')) : 0;
    runner = { running: !!(pid && pidAlive(pid)), in_service: false, pid: pid || null };
  }
  if (!runner.running) problems.push({ problem: `the runner is not running${runner.error ? `: ${runner.error}` : ''}`, fix: 'run start.sh in perpetual-adaptive-agents' });
  const projects = readRegistry().projects.map(p => {
    const ok = fs.existsSync(path.join(p.payload, 'workspace', 'project.json'));
    let repo = null; try { repo = readConfig(p.payload).service?.repo || null; } catch {}
    if (ok && repo && path.resolve(repo).toLowerCase() !== path.resolve(REPO_ROOT).toLowerCase()) warnings.push({ problem: `project ${p.name} (${p.id}) points to perpetual-adaptive-agents at ${repo}, but the service runs from ${REPO_ROOT}`, fix: `register it again (same id is kept): POST /api/projects/register {"path": "${p.root.replace(/\\/g, '/')}"}` });
    if (!ok) warnings.push({ problem: `project ${p.name} (${p.id}): ${p.payload} is missing or not set up`, fix: `register it again: POST /api/projects/register {"path": "${p.root.replace(/\\/g, '/')}"}, or remove it: pa projects --forget ${p.id}` });
    return { id: p.id, name: p.name, root: p.root, payload: p.payload, readable: ok, board: `pa.${p.id}.>` };
  });
  return {
    ok: problems.length === 0, service: 'perpetual-adaptive-agents', version, pid: process.pid, started_at: startedAt,
    dashboard: `http://127.0.0.1:${port}`, perpetual_adaptive_agents_folder: REPO_ROOT,
    central_folder: { path: hp.home, writable },
    nats: { url: settings.board.nats_url, ...nats },
    runner, projects: { count: projects.length, list: projects },
    problems, warnings, checked_at: new Date().toISOString(),
  };
}

async function action(body) {
  const db = openProjectDb(body.project);
  const pid = body.project;
  const p = S.requireProject(db, pid);
  const settings = loadSettings(pid);
  const note = body.note ? String(body.note).slice(0, 500) : null;
  const post = async (m) => { const msg = S.postMessage(db, pid, { from: 'owner', ...m }); await publishBoard(settings, pid, msg); };
  switch (body.action) {
    case 'stop-agent': {
      const a = S.requireAgent(db, pid, body.target);
      S.setAgentStatus(db, pid, a.id, 'stopped');
      await post({ type: 'stop', to: a.id, text: `Stop requested for ${a.name} by the owner (dashboard).` });
      return { ok: true };
    }
    case 'start-agent': {
      const a = S.requireAgent(db, pid, body.target);
      S.setAgentStatus(db, pid, a.id, 'active'); S.setStuckRuns(db, pid, a.id, 0);
      return { ok: true };
    }
    case 'stop-project':
      writeFileAtomic(projectPaths(pid).stop, new Date().toISOString());
      await post({ type: 'stop', to: 'all', text: 'Stop requested for the whole project by the owner (dashboard).' });
      return { ok: true };
    case 'start-project': fs.rmSync(projectPaths(pid).stop, { force: true }); return { ok: true };
    case 'pause': S.setPhase(db, pid, 'paused'); return { ok: true };
    case 'resume': S.setPhase(db, pid, 'running'); return { ok: true };
    case 'approve': case 'decline': case 'unblock': {
      const t = S.setTaskStatus(db, pid, body.target, body.action, 'owner', note);
      await post({ type: 'note', to: t.agent_id, task_id: t.id, text: `Task ${t.id} (${t.title}) ${body.action}d by the owner${note ? `: ${note}` : ''}.` });
      return { ok: true };
    }
    case 'doc-status': S.setDocumentStatus(db, pid, body.target, body.value); return { ok: true };
    case 'task-feedback': {
      // The user's objection to a planned task, sent to the project managers to act on.
      const kind = body.value === 'remove' ? 'remove' : 'object';
      const said = (note || '').replace(/[.\s]+$/, '');
      if (!note && kind === 'object') throw new S.PaError('bad_input', 'say what you object to');
      const m = S.postMessage(db, pid, { from: 'owner', to: 'supervisor', type: 'question', task_id: null,
        text: kind === 'remove' ? `The user asks to remove master task ${body.target} from the plan${said ? `: ${said}` : ''}. Confirm with the user in your chat if unclear, then cancel the tasks that came from it and reply here.` : `The user objects to master task ${body.target}: ${said}. Discuss it with the user, change or cancel the tasks that came from it, and reply here.` });
      await publishBoard(settings, pid, m);
      return { ok: true, message: m.id };
    }
    default: throw new S.PaError('bad_input', `unknown action ${body.action}`);
  }
}

export function startDashboard({ port = 4777, projectId = null, host = '127.0.0.1' } = {}) {
  // A random token, embedded in the page and required on every action. A page served by
  // anything else on this computer (for example, a web app an agent is building) cannot read it.
  const token = crypto.randomBytes(24).toString('hex');
  const safeId = projectId && /^P-[0-9a-f]+$/.test(projectId) ? projectId : '';
  // The boot data is JSON inside a <script type="application/json"> element; "<" is escaped
  // so no value can close the element. A replacer function avoids "$&" substitutions.
  const boot = JSON.stringify({ project: safeId, token }).replace(/</g, '\\u003c');
  const page = () => fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace('__BOOT__', () => boot);
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const server = http.createServer(async (req, res) => {
    // Host check on every request defeats DNS rebinding (a remote site pointing its own name at 127.0.0.1).
    if (!allowedHosts.has(String(req.headers.host))) return json(res, 403, { error: 'forbidden host' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(page());
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (url.pathname === '/api/health') return json(res, 200, await health(port));
      if (url.pathname === '/api/projects') return json(res, 200, summaries());
      let m = url.pathname.match(/^\/api\/projects\/(P-[0-9a-f]{6})\/files$/);
      if (m && req.method === 'GET') {
        const e = registryEntry(m[1]);
        if (!e) return json(res, 404, { error: 'not_found', message: `no registered project ${m[1]}` });
        if (!fs.existsSync(e.payload)) return json(res, 410, { error: 'payload_missing', message: `the project's adaptive-agents folder is missing: ${e.payload}` });
        return json(res, 200, readProjectFiles(e.payload));
      }
      if (url.pathname === '/api/state') return json(res, 200, state(url.searchParams.get('project')));
      if (url.pathname === '/api/stream') {
        const pid = url.searchParams.get('project');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        let last = '';
        const send = () => {
          try {
            const st = state(pid);
            const { generated_at, ...rest } = st;
            const h = crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex');
            if (h !== last) { last = h; res.write(`data: ${JSON.stringify(st)}\n\n`); }
            else res.write(': keep-alive\n\n');
          } catch (e) { res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`); }
        };
        send();
        const t = setInterval(send, 2000);
        req.on('close', () => clearInterval(t));
        return;
      }
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) return json(res, 403, { error: 'forbidden origin' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'content-type must be application/json' });
        if (origin) {
          const given = String(req.headers['x-pa-token'] || '');
          if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return json(res, 403, { error: 'missing or wrong dashboard token' });
        }
        const body = await readBody(req);
        if (url.pathname === '/api/projects/register') return json(res, 200, await registerFolder(body));
        if ((m = url.pathname.match(/^\/api\/projects\/(P-[0-9a-f]{6})\/rename$/))) {
          const e = registryEntry(m[1]);
          if (!e) return json(res, 404, { error: 'not_found', message: `no registered project ${m[1]}` });
          const name = String(body.name || '').trim().slice(0, 120);
          if (!name) return json(res, 400, { error: 'bad_input', message: 'give a name' });
          openProjectDb(m[1]).prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, m[1]);
          updateProjectJson(e.payload, { name });
          registerProject({ ...e, name });
          return json(res, 200, { ok: true, id: m[1], name });
        }
        if (url.pathname === '/api/action') return json(res, 200, await action(body));
        return json(res, 404, { error: 'not found' });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, e instanceof S.PaError ? 400 : 500, { error: e.code || 'error', message: e.message });
    }
  });
  return new Promise((resolve, reject) => { server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? Object.assign(new Error(`port ${port} is already in use by another program`), { code: 'port_busy' }) : e)); server.listen(port, host, () => {
    console.log(`Dashboard: http://${host}:${port}/${projectId ? `?project=${projectId}` : ''}  (${readRegistry().projects.length} registered project(s))`);
    resolve(server);
  }); });
}
