#!/usr/bin/env node
// pa: the one command-line tool for the user, the Supervisor, and the agents.
// Agents are ordinary chat sessions with a shell; this CLI is the tool they are given.
// Run `pa help` for the command list.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { openDb, openProjectDb, closeAll } from './db.mjs';
import { loadSettings } from './config.mjs';
import { serviceInfo, paHome, homePaths, projectPaths, findPayload, readRegistry, registryEntry, registerProject, unregisterProject, writeJson, writeFileAtomic, ensureDir, REPO_ROOT, readJson } from './paths.mjs';
import { registerFolder, readConfig, rootOfPayload, updateProjectJson } from './register.mjs';
import * as S from './store.mjs';
import { importPlan, validatePlan, createAgent, writeListFile, writeManifests } from './planner.mjs';
import { publishBoard, publishControl, putPresence, closeConnections, natsStatus } from './nats.mjs';
import { decide } from './decide.mjs';
import { buildState, writeProjectSnapshot } from './snapshot.mjs';

// ------------------------------------------------------------------ argument parsing

// Options that always take a value. Their value is taken as given even if it starts
// with "--" (so --text "--force is risky" works), and a missing value is an error.
const VALUE_KEYS = new Set(['project', 'agent', 'as', 'name', 'root', 'kind', 'file', 'text', 'kind', 'ref', 'note', 'key', 'title',
  'path', 'status', 'categories', 'lane', 'persona', 'provider', 'model', 'reason', 'files', 'plan', 'summary', 'tests', 'type',
  'to', 'task', 'limit', 'since', 'for', 'state', 'question', 'options', 'backend', 'port', 'ticks', 'agentid',
  'location', 'test', 'branch', 'extend', 'ttl', 'tools', 'approve', 'plans', 'description', 'owner', 'number', 'fact', 'home', 'findings', 'errors']);

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  const missing = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { opt[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (VALUE_KEYS.has(k)) {
        if (nxt === undefined) missing.push(k);
        else { opt[k] = nxt; i++; }
      } else if (nxt === undefined || nxt.startsWith('--')) opt[k] = true;
      else { opt[k] = nxt; i++; }
    } else pos.push(a);
  }
  return { pos, opt, missing };
}

const list = (v) => (v === undefined || v === true ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean));
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
const say = (s) => process.stdout.write(s + '\n');

function fail(code, message, details) {
  const e = new S.PaError(code, message, details);
  throw e;
}

// ------------------------------------------------------------------ context

// Which project: --project <id>, PA_PROJECT, or the payload folder found from the current
// folder (an initialized adaptive-agents folder with config.toml). A payload found this
// way that is not yet in the registry is registered on the spot.
function projectIdFrom(opt) {
  if (opt.project) return opt.project;
  if (process.env.PA_PROJECT) return process.env.PA_PROJECT;
  const payload = findPayload();
  if (payload) {
    const cfg = readConfig(payload).project;
    // A registered payload whose central entry was removed is re-linked (same id, no other change).
    if (cfg?.id && !registryEntry(cfg.id)) registerProject({ id: cfg.id, name: cfg.name, root: rootOfPayload(payload), payload, project_json: path.join(payload, 'workspace', 'project.json') });
    return cfg?.id || null;
  }
  return null;
}

function ctx(opt, { needProject = true, needAgent = false } = {}) {
  const pid = projectIdFrom(opt);
  if (needProject && !pid) fail('no_project', 'no project here: run inside a project that has an adaptive-agents payload folder, pass --project <id>, or set PA_PROJECT. To set up a project, follow AGENT-SETUP.md in perpetual-adaptive-agents');
  let db = null;
  if (pid) {
    try { db = openProjectDb(pid); } catch (e) { fail('not_registered', e.message); }
  }
  const project = pid ? S.requireProject(db, pid) : null;
  const settings = loadSettings(pid);
  let agent = null;
  // Inside an agent session (PA_AGENT set by the runner) the identity cannot be switched
  // with --agent or --as. This is a guardrail, not a security boundary: see docs/design-paper.md, section 10.
  const envAgent = process.env.PA_AGENT;
  if (envAgent && ((opt.agent && opt.agent !== envAgent) || opt.as)) fail('identity', `this session is agent ${envAgent}; --agent and --as cannot change that`);
  const aid = envAgent || opt.agent;
  if (aid && project) agent = S.requireAgent(db, project.id, aid);
  if (needAgent && !agent) fail('no_agent', 'no agent identity: pass --agent <id or name> or set PA_AGENT');
  return { db, project, settings, agent, actor: agent ? agent.id : (opt.as || 'owner') };
}

async function post(c, m) {
  const msg = S.postMessage(c.db, c.project.id, { from: c.actor, ...m });
  msg.published = await publishBoard(c.settings, c.project.id, msg);
  return msg;
}

async function presence(c) {
  if (c.agent) { S.touchPresence(c.db, c.project.id, c.agent.id); await putPresence(c.settings, c.project.id, c.agent.id); }
}

function readText(opt) {
  if (opt.file) return fs.readFileSync(opt.file, 'utf8');
  if (typeof opt.text === 'string') return opt.text;
  fail('bad_input', 'pass --file <path> or --text "<text>"');
}

// ------------------------------------------------------------------ commands

const commands = {};
const help = {};
function cmd(name, usage, fn) { commands[name] = fn; help[name] = usage; }

cmd('help', 'pa help                                   this list', () => {
  say('pa: Perpetual Adaptive Agents\n');
  for (const u of Object.values(help)) say('  ' + u);
  say('\nProject: found from the current folder (its adaptive-agents payload), or --project <id>, or PA_PROJECT.');
  say('Agent identity: PA_AGENT (set by the runner), or --agent <id|name> outside an agent session.');
});

// ---- infrastructure

cmd('doctor', 'pa doctor                                 check node, database, NATS, assistant CLIs', async (a) => {
  const settings = loadSettings();
  const checks = { node: process.version, pa_home: paHome(), repo: REPO_ROOT };
  checks.registered_projects = readRegistry().projects.length;
  try { const pid = projectIdFrom({}); if (pid) { openProjectDb(pid); checks.project_here = { id: pid, database: projectPaths(pid).db }; } } catch (e) { checks.project_here = `ERROR ${e.message}`; }
  checks.nats = await natsStatus(settings.board.nats_url);
  checks.clis = {};
  for (const tool of ['claude', 'codex', 'copilot', 'nats-server']) {
    const r = spawnSync(tool, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 15000 });
    checks.clis[tool] = r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] : 'not found';
  }
  const local = path.join(homePaths().bin, process.platform === 'win32' ? 'nats-server.exe' : 'nats-server');
  if (fs.existsSync(local)) checks.clis['nats-server (pa bin)'] = local;
  out(checks);
});

function natsBinary() {
  const local = path.join(homePaths().bin, process.platform === 'win32' ? 'nats-server.exe' : 'nats-server');
  return fs.existsSync(local) ? local : 'nats-server';
}

cmd('nats', 'pa nats start|stop|status                  run the local message-board server', async ({ pos }) => {
  const hp = homePaths();
  const sub = pos[0] || 'status';
  if (sub === 'status') return out(await natsStatus(loadSettings().board.nats_url));
  if (sub === 'start') {
    if ((await natsStatus(loadSettings().board.nats_url)).connected) return say('NATS is already running.');
    if (!fs.existsSync(hp.natsConf)) fail('not_set_up', `no ${hp.natsConf}; run start.sh in perpetual-adaptive-agents first`);
    const log = fs.openSync(hp.natsLog, 'a');
    const child = spawn(natsBinary(), ['-c', hp.natsConf], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
    child.on('error', (e) => { say(`could not start nats-server: ${e.message}`); process.exitCode = 1; });
    child.unref();
    fs.writeFileSync(hp.natsPid, String(child.pid));
    await new Promise(r => setTimeout(r, 1200));
    return out({ started: true, pid: child.pid, log: hp.natsLog, ...(await natsStatus(loadSettings().board.nats_url)) });
  }
  if (sub === 'stop') {
    const pid = fs.existsSync(hp.natsPid) ? Number(fs.readFileSync(hp.natsPid, 'utf8')) : null;
    if (!pid) return say('No NATS process id recorded.');
    try { process.kill(pid); } catch (e) { return say(`could not stop pid ${pid}: ${e.message}`); }
    fs.rmSync(hp.natsPid, { force: true });
    return say(`Stopped NATS (pid ${pid}).`);
  }
  fail('bad_input', 'use start, stop or status');
});

// ---- the service

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function servicePid() {
  const f = homePaths().servicePid;
  const pid = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0;
  return pid && pidAlive(pid) ? pid : 0;
}
async function serviceStatus() {
  const settings = loadSettings();
  const port = serviceInfo().port;
  let dashboard = false;
  try { const r = await fetch(`http://127.0.0.1:${port}/api/projects`, { signal: AbortSignal.timeout(1500) }); dashboard = r.ok; } catch {}
  return {
    running: !!servicePid() || dashboard, pid: servicePid() || null,
    dashboard: dashboard ? `http://127.0.0.1:${port}` : 'not reachable',
    nats: await natsStatus(settings.board.nats_url),
    registered_projects: readRegistry().projects.map(p => ({ id: p.id, name: p.name, root: p.root })),
    log: path.join(homePaths().logs, 'service.log'),
  };
}

async function startNatsIfPossible() {
  const hp = homePaths();
  if ((await natsStatus(loadSettings().board.nats_url)).connected) return 'already running';
  if (!fs.existsSync(hp.natsConf)) return 'not set up (run start.sh)';
  const bin = natsBinary();
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return 'nats-server not installed (the board still works through the database)';
  ensureDir(path.dirname(hp.natsLog));
  const logFd = fs.openSync(hp.natsLog, 'a');
  const child = spawn(bin, ['-c', hp.natsConf], { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
  child.unref();
  fs.writeFileSync(hp.natsPid, String(child.pid));
  await new Promise(r => setTimeout(r, 1200));
  return (await natsStatus(loadSettings().board.nats_url)).connected ? `started (pid ${child.pid})` : `started but not answering yet; see ${hp.natsLog}`;
}

cmd('up', 'pa up [--foreground] [--port 4777]        start the service: NATS board, runner for every project, dashboard', async ({ opt }) => {
  if (opt.port) process.env.PA_PORT = String(opt.port);
  const nats = await startNatsIfPossible();
  if (servicePid()) return out({ service: 'already running', pid: servicePid(), nats, dashboard: `http://127.0.0.1:${serviceInfo().port}` });
  const script = path.join(REPO_ROOT, 'core', 'service.mjs');
  if (opt.foreground) {
    say(`NATS: ${nats}`);
    fs.writeFileSync(homePaths().servicePid, String(process.pid));
    await import(pathToFileURL(script).href);
    await new Promise(() => {});
  }
  ensureDir(homePaths().logs);
  const logFd = fs.openSync(path.join(homePaths().logs, 'service.log'), 'a');
  const child = spawn(process.execPath, [script], { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true, env: process.env });
  child.unref();
  fs.writeFileSync(homePaths().servicePid, String(child.pid));
  await new Promise(r => setTimeout(r, 1500));
  out({ service: pidAlive(child.pid) ? 'started' : 'failed to start (see the log)', pid: child.pid, nats, ...(await serviceStatus()) });
});

cmd('down', 'pa down [--nats]                          stop the service (and the NATS server with --nats)', async ({ opt }) => {
  const pid = servicePid();
  const res = { service: 'not running' };
  if (pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(pid); } catch {} }
    res.service = `stopped (pid ${pid})`;
  }
  fs.rmSync(homePaths().servicePid, { force: true });
  fs.rmSync(homePaths().runnerPid, { force: true });
  if (opt.nats) {
    const f = homePaths().natsPid;
    const npid = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0;
    if (npid) { try { process.kill(npid); res.nats = `stopped (pid ${npid})`; } catch { res.nats = 'not running'; } fs.rmSync(f, { force: true }); }
  }
  out(res);
});

cmd('service', 'pa service status                         is the service running; dashboard address; NATS; registered projects', async () => {
  out(await serviceStatus());
});

// ---- projects and planning

async function doRegister(pos, opt) {
  const target = pos[0] || opt.root || process.cwd();
  const approve = opt.approve === 'all' ? 'all' : list(opt.approve);
  return registerFolder({ path: target, location: opt.location, name: opt.name, kind: opt.kind, test_command: opt.test, main_branch: opt.branch,
    plans_folder: opt.plans, tools: list(opt.tools), approve_files: approve, dry_run: !!opt['dry-run'], copy: !!opt.copy, description: opt.description, owner: opt.owner });
}
cmd('register', 'pa register [PROJECT_FOLDER] [--location .agents] [--name N] [--tools claude,codex,copilot,cursor,kilocode] [--plans docs/plans] [--test "npm test"] [--copy] [--dry-run] [--approve all|path,path]   register a project (same as POST /api/projects/register)', async ({ pos, opt }) => {
  out(await doRegister(pos, opt));
});
cmd('init', 'pa init ...                               same as pa register', async ({ pos, opt }) => out(await doRegister(pos, opt)));

cmd('projects', 'pa projects [--forget ID]            every project registered with the service', async ({ opt }) => {
  if (opt.forget) { unregisterProject(opt.forget); return out({ forgotten: opt.forget }); }
  out(readRegistry().projects.map(p => {
    let phase = 'unknown', agents = 0;
    try { const db = openProjectDb(p.id); phase = S.getProject(db, p.id)?.phase; agents = S.listAgents(db, p.id).length; } catch { phase = 'payload missing'; }
    return { ...p, phase, agents };
  }));
});

cmd('project', 'pa project show | set [--name N] [--description T] [--owner NAME] [--plans FOLDER] [--test CMD] [--fact key=value]', async ({ pos, opt }) => {
  const sub = pos[0] || 'show';
  if (sub === 'list') return out(readRegistry().projects);
  const c = ctx(opt);
  const pp = projectPaths(c.project.id);
  if (sub === 'set') {
    if (c.agent && c.agent.role !== 'supervisor') fail('supervisor_only', 'only a project manager or the user changes project.json');
    const pj = readJson(pp.projectJson, {});
    const patch = {};
    if (opt.name) { c.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(String(opt.name).slice(0, 120), c.project.id); patch.name = String(opt.name).slice(0, 120); registerProject({ ...registryEntry(c.project.id), name: patch.name }); }
    if (opt.description !== undefined) patch.description = String(opt.description);
    if (opt.owner) patch.owner = { ...(pj.owner || {}), name: String(opt.owner) };
    if (opt.plans) { if (path.isAbsolute(opt.plans) || String(opt.plans).split(/[\\/]/).includes('..')) fail('bad_input', '--plans must be a folder inside the project'); patch.plans_folder = opt.plans; }
    if (opt.test !== undefined) patch.test_command = String(opt.test);
    if (opt.fact) { const i = String(opt.fact).indexOf('='); if (i < 1) fail('bad_input', '--fact key=value'); patch.facts = { ...(pj.facts || {}), [String(opt.fact).slice(0, i)]: String(opt.fact).slice(i + 1) }; }
    if (!Object.keys(patch).length) fail('bad_input', 'nothing to set');
    return out(updateProjectJson(pp.payload, patch));
  }
  out({ ...c.project, payload: pp.payload, workspace: pp.workspace, settings_file: pp.settings, project_json: readJson(pp.projectJson, null) });
});

// A project manager joins the project under a name and number it chooses itself. The first
// one becomes agent A00; more can join (A-numbers continue). Each is listed in project.json.
cmd('pm', 'pa pm join --name NAME --number N [--provider claude|codex|copilot] | list', async ({ pos, opt }) => {
  const c = ctx(opt);
  const sub = pos[0] || 'list';
  const pp = projectPaths(c.project.id);
  if (sub === 'list') return out(readJson(pp.projectJson, {}).project_managers || []);
  if (sub !== 'join') fail('bad_input', 'use join or list');
  if (!opt.name || !/^[A-Za-z][A-Za-z0-9]{1,23}$/.test(String(opt.name))) fail('bad_input', '--name: a single word of letters and digits, 2-24 characters, starting with a letter');
  const num = Number(opt.number);
  if (!Number.isInteger(num) || num < 0 || num > 99) fail('bad_input', '--number: a whole number from 0 to 99');
  const name = `${opt.name}-${String(num).padStart(2, '0')}`;
  const agents = S.listAgents(c.db, c.project.id);
  if (agents.some(a => a.name.toLowerCase() === name.toLowerCase())) fail('conflict', `the name ${name} is taken in this project`);
  const { createAgent } = await import('./planner.mjs');
  const first = !agents.some(a => a.role === 'supervisor');
  const a = createAgent(c.db, c.project, { name, provider: opt.provider, lane: 'Project manager: planning, supervision, the only one who talks to the user' }, c.settings, { role: 'supervisor', index: first ? 0 : undefined });
  const pj = readJson(pp.projectJson, {});
  const pms = [...(pj.project_managers || []), { agent_id: a.id, name: a.name, number: num, provider: a.provider, joined_at: new Date().toISOString(), first }];
  updateProjectJson(pp.payload, { project_managers: pms });
  writeManifests(c.db, c.project);
  await post({ ...c, actor: a.id }, { type: 'announce', to: 'all', text: `${a.name} (${a.id}) joined as a project manager.` });
  out({ agent_id: a.id, name: a.name, role: 'supervisor', instructions: path.join(a.folder, 'INSTRUCTIONS.md'), use_identity: `--agent ${a.id}` });
});

cmd('vision', 'pa vision add --file F | --text "..."   (verbatim, append-only)  | pa vision show', async ({ pos, opt }) => {
  const c = ctx(opt);
  if ((pos[0] || 'show') === 'show') return out(S.getVision(c.db, c.project.id));
  const text = readText(opt);
  const v = S.addVision(c.db, c.project.id, text);
  const pp = projectPaths(c.project.id);
  const file = path.join(pp.manifest, `01-vision${v > 1 ? `.v${v}` : ''}.md`);
  writeFileAtomic(file, text);
  S.upsertDocument(c.db, c.project.id, { key: '01-vision', title: 'Vision (owner\'s words, verbatim)', path: file, status: 'made', content: text });
  out({ version: v, file });
});

cmd('resource', 'pa resource add --kind folder|link|key_ref|access|expectation|constraint|tool --name N [--ref R] [--note T] | list', async ({ pos, opt }) => {
  const c = ctx(opt);
  if ((pos[0] || 'list') === 'list') return out(S.listResources(c.db, c.project.id));
  S.addResource(c.db, c.project.id, { kind: opt.kind, name: opt.name, value_ref: opt.ref ?? null, note: opt.note ?? null });
  out({ ok: true });
});

cmd('doc', 'pa doc add --key K --title T --path P [--status made|checked|approved] | status KEY STATUS | list', async ({ pos, opt }) => {
  const c = ctx(opt);
  const sub = pos[0] || 'list';
  if (sub === 'list') return out(S.listDocuments(c.db, c.project.id));
  if (sub === 'add') {
    const p = path.resolve(opt.path);
    const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (content === null) fail('bad_input', `document file not found: ${p}`);
    S.upsertDocument(c.db, c.project.id, { key: opt.key, title: opt.title || opt.key, path: p, status: opt.status || 'made', content });
    return out({ ok: true });
  }
  if (sub === 'status') {
    if (pos[2] === 'approved' && c.agent) fail('owner_only', 'only the owner marks a document approved');
    S.setDocumentStatus(c.db, c.project.id, pos[1], pos[2]);
    return out({ ok: true });
  }
  fail('bad_input', 'use add, status or list');
});

cmd('plan', 'pa plan validate FILE | import FILE         check or load the planning agent\'s plan.json', async ({ pos, opt }) => {
  const c = ctx(opt);
  const file = pos[1];
  if (!file) fail('bad_input', 'give the plan file path');
  const plan = readJson(file);
  if (pos[0] === 'validate') return out(validatePlan(plan, c.settings));
  if (pos[0] === 'import') {
    const r = importPlan(c.db, c.project, plan, c.settings);
    await post(c, { type: 'planning', text: `Plan imported: ${r.agents.length} agents created (${r.agents.map(a => a.name).join(', ')}). Waiting for owner approval.` });
    return out(r);
  }
  fail('bad_input', 'use validate or import');
});

cmd('approve', 'pa approve [--force]                      owner sign-off: start the work', async ({ opt }) => {
  const c = ctx(opt);
  if (c.agent) fail('owner_only', 'only the owner approves a plan');
  const pending = S.listDocuments(c.db, c.project.id).filter(d => d.status === 'made');
  if (pending.length && !opt.force) fail('docs_unchecked', `these documents are not checked yet: ${pending.map(d => d.key).join(', ')}. Mark them with \`pa doc status KEY checked|approved\`, or pass --force.`);
  S.setPhase(c.db, c.project.id, 'running');
  await post(c, { type: 'planning', text: 'Owner approved the plan. Work may begin.' });
  out({ phase: 'running' });
});

cmd('pause', 'pa pause | pa resume                       pause or resume a project', async ({ opt }) => {
  const c = ctx(opt); S.setPhase(c.db, c.project.id, 'paused'); out({ phase: 'paused' });
});
cmd('resume', '', async ({ opt }) => {
  const c = ctx(opt); S.setPhase(c.db, c.project.id, 'running'); out({ phase: 'running' });
});

cmd('agent', 'pa agent list | add --categories C1,C2 --lane T [--persona T] [--provider P] [--model M] | retire ID --reason T | reactivate ID | open ID [--vscode [--new-window]]', async ({ pos, opt }) => {
  const c = ctx(opt);
  const sub = pos[0] || 'list';
  if (sub === 'list') return out(S.agentStats(c.db, c.project.id, c.settings.runner.presence_ttl_seconds).map(a => ({ id: a.id, name: a.name, role: a.role, status: a.status, provider: a.provider, categories: a.categories, tasks: a.tasks, points: a.points, live: a.live })));
  if (sub === 'add') {
    if (c.agent && c.agent.role !== 'supervisor') fail('planner_only', 'only the planner or the owner adds agents');
    const a = createAgent(c.db, c.project, { name: opt.name, categories: list(opt.categories), lane: opt.lane, persona: opt.persona, provider: opt.provider, model: opt.model }, c.settings);
    // Its first list holds only the planning task, so its first run plans its own work.
    const l = S.createList(c.db, c.project.id, a.id, [], { createdBy: c.actor });
    writeListFile(c.db, c.project, a, l.listId);
    writeManifests(c.db, c.project);
    await post(c, { type: 'note', text: `New agent ${a.name} (${a.id}) joined for ${a.categories.join(', ')}.` });
    return out(a);
  }
  if (sub === 'retire' || sub === 'reactivate') {
    const a = S.requireAgent(c.db, c.project.id, pos[1]);
    S.setAgentStatus(c.db, c.project.id, a.id, sub === 'retire' ? 'retired' : 'active', opt.reason || null);
    if (sub === 'retire') S.releaseClaims(c.db, c.project.id, a.id);
    writeManifests(c.db, c.project);
    await post(c, { type: sub === 'retire' ? 'retire' : 'note', to: a.id, text: `${a.name} ${sub === 'retire' ? 'retired' : 'reactivated'} by ${c.actor}${opt.reason ? `: ${opt.reason}` : ''}` });
    return out({ ok: true });
  }
  if (sub === 'open') {
    // Headed mode: open the agent's own session in a window the owner can type into.
    const a = S.requireAgent(c.db, c.project.id, pos[1]);
    const tool = a.provider;
    const args = tool === 'claude' ? (a.session_id ? ['--resume', a.session_id] : [])
      : tool === 'codex' ? (a.session_id ? ['resume', a.session_id] : []) : [];
    const line = [tool, ...args].join(' ');
    if (opt.vscode) {
      // Open the agent's conversation as a VS Code editor tab (needs the Adaptive Agents extension).
      if (!['claude', 'codex'].includes(tool)) fail('bad_input', `opening in VS Code works for claude and codex agents, not ${tool}`);
      if (!a.session_id) fail('bad_input', `${a.name} has no session yet; it gets one on its first run`);
      const url = `vscode://frontside.evolution-agents/attach?tool=${tool}&session=${encodeURIComponent(a.session_id)}${opt['new-window'] ? '&window=new' : ''}`;
      const code = process.platform === 'win32' ? 'code.cmd' : 'code';
      const runCode = (args) => spawnSync(code, args, { stdio: 'ignore', shell: process.platform === 'win32' });
      if (runCode(['--reuse-window', c.project.root]).status !== 0) return out({ open_this_link: url, note: 'the VS Code "code" command was not found; open the link yourself' });
      runCode(['--open-url', url]);
      return out({ opened: a.name, in: 'vscode', link: url });
    }
    if (opt.print || !['claude', 'codex', 'copilot'].includes(tool)) return out({ run_this_in_a_terminal: `cd "${c.project.root}" && ${line}`, env: { PA_PROJECT: c.project.id, PA_AGENT: a.id } });
    const env = { ...process.env, PA_PROJECT: c.project.id, PA_AGENT: a.id, PA_HOME: paHome() };
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '"pa agent"', 'cmd', '/k', line], { cwd: c.project.root, env, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    else return out({ run_this_in_a_terminal: `cd "${c.project.root}" && PA_PROJECT=${c.project.id} PA_AGENT=${a.id} ${line}` });
    return out({ opened: a.name, command: line });
  }
  fail('bad_input', 'use list, add, retire, reactivate or open');
});

// ---- worker commands

cmd('whoami', 'pa whoami                                 who am I, where are my instructions, what is next', async ({ opt }) => {
  const c = ctx(opt, { needAgent: true });
  await presence(c);
  const a = c.agent;
  const stop = fs.existsSync(homePaths().stop) || fs.existsSync(projectPaths(c.project.id).stop) || a.status === 'stopped';
  const resets = S.openResets(c.db, c.project.id).filter(r => r.missing.includes(a.id));
  out({
    agent: { id: a.id, name: a.name, role: a.role, status: a.status, categories: a.categories, lane: a.lane, persona: a.persona },
    project: { id: c.project.id, name: c.project.name, root: c.project.root, phase: c.project.phase, kind: c.project.kind },
    instructions: path.join(a.folder, 'INSTRUCTIONS.md'),
    agent_folder: a.folder,
    payload_folder: projectPaths(c.project.id).payload,
    manifest_folder: projectPaths(c.project.id).manifest,
    plans_folder: path.join(c.project.root, 'docs', 'plans'),
    stop_requested: stop,
    reset_checkins_required: resets.map(r => ({ id: r.id, reason: r.reason })),
    unread_messages: S.unreadCount(c.db, c.project.id, a),
    next_task: S.nextTask(c.db, c.project.id, a.id),
    rules: { max_attempts: c.settings.tasks.max_attempts, max_attempts_hard: c.settings.tasks.max_attempts_hard, main_branch: c.settings.project?.main_branch || 'main', test_command: c.settings.project?.test_command || null, push: c.settings.project?.push === true },
  });
});

cmd('task', 'pa task next | show ID | list [--all] [--status s1,s2] | start ID --files a,b [--plan T] | step ID "T" | done ID --summary T [--files] [--tests T] [--findings T] [--errors T] | fail ID --reason T [--extend "why one more try"] | pause ID --reason T | resume ID | ask-user ID "question" | approve|decline|unblock|cancel ID', async ({ pos, opt }) => {
  const sub = pos[0] || 'next';
  if (['approve', 'decline', 'unblock', 'cancel'].includes(sub)) {
    const c = ctx(opt);
    if (c.agent && c.agent.role !== 'supervisor' && sub !== 'cancel') fail('owner_only', `only the owner or the planner can ${sub} a task`);
    if (sub === 'approve' && c.agent) fail('owner_only', 'only the owner approves new features');
    if (sub === 'cancel' && c.agent && c.agent.role !== 'supervisor') {
      const t = S.getTask(c.db, c.project.id, pos[1]);
      if (t && t.agent_id !== c.agent.id) fail('not_yours', `task ${pos[1]} belongs to ${t.agent_id}; ask on the board instead`);
    }
    const t = S.setTaskStatus(c.db, c.project.id, pos[1], sub, c.actor, opt.note || null);
    await post(c, { type: 'note', to: t.agent_id, task_id: t.id, text: `Task ${t.id} (${t.title}) ${sub}d by ${c.actor}${opt.note ? `: ${opt.note}` : ''}.` });
    return out(t);
  }
  if (sub === 'list') {
    const c = ctx(opt);
    return out(S.listTasks(c.db, c.project.id, { agentId: opt.all || !c.agent ? (opt.agentid || null) : c.agent.id, status: opt.status ? list(opt.status) : null }));
  }
  if (sub === 'show') {
    const c = ctx(opt);
    const t = S.getTask(c.db, c.project.id, pos[1]);
    if (!t) fail('not_found', `no task ${pos[1]}`);
    return out({ ...t, events: S.taskEvents(c.db, c.project.id, t.id) });
  }
  const c = ctx(opt, { needAgent: true });
  await presence(c);
  const me = c.agent;
  if (sub === 'next') {
    const t = S.nextTask(c.db, c.project.id, me.id);
    return out(t ? { task: t, priority_order: Object.keys(S.KIND_RANK) } : { task: null, note: 'No runnable tasks. Check the board (pa board read); if nothing is addressed to you, end this run.' });
  }
  const id = pos[1];
  if (!id) fail('bad_input', 'give the task id');
  if (sub === 'start') {
    const files = list(opt.files);
    try {
      const t = S.startTask(c.db, c.project.id, me.id, id, files, { ttlHours: 12 });
      const msg = await post(c, { type: 'announce', task_id: id, files, text: `Starting ${id}: ${t.title}.${opt.plan ? ` Plan: ${opt.plan}` : ''}${files.length ? ` Files: ${files.join(', ')}` : ''}` });
      return out({ task: t, announced: msg.id });
    } catch (e) {
      if (e.code === 'conflict') {
        await post(c, { type: 'conflict', task_id: id, files, to: 'all', text: `${me.name} wants ${files.join(', ')} for ${id} but they overlap claims held by ${[...new Set(e.details.conflicts.map(x => x.agent_id))].join(', ')}. Is anyone finishing soon?` });
      }
      throw e;
    }
  }
  if (sub === 'step') {
    const text = pos.slice(2).join(' ') || opt.text;
    S.stepTask(c.db, c.project.id, me.id, id, text);
    await post(c, { type: 'step', task_id: id, text: `${id}: ${text}` });
    return out({ ok: true });
  }
  if (sub === 'done') {
    const t = S.getTask(c.db, c.project.id, id);
    // Rule 3: a task's branch must be merged into main before the task can be completed.
    const branch = `aa/${me.name}/${id}`;
    const main = c.settings.project?.main_branch || 'main';
    const git = (...a) => spawnSync('git', ['-C', c.project.root, ...a], { encoding: 'utf8' });
    if (git('show-ref', '--verify', '--quiet', `refs/heads/${branch}`).status === 0 && git('merge-base', '--is-ancestor', branch, main).status !== 0)
      fail('not_merged', `branch ${branch} is not merged into ${main}. Run: bash ${projectPaths(c.project.id).payload.replace(/\\/g, '/')}/bin/merge-task.sh ${id}`);
    const points = t?.kind === 'planning' ? c.settings.tasks.points_planning : c.settings.tasks.points_task;
    const rec = S.completeTask(c.db, c.project.id, me.id, id, { summary: opt.summary, files: list(opt.files), tests: opt.tests ?? null, points });
    const file = path.join(me.folder, 'completed', `${id}.json`);
    writeJson(file, { ...rec, complete: true, findings: opt.findings && !/^none$/i.test(opt.findings) ? [String(opt.findings)] : [], errors: opt.errors && !/^none$/i.test(opt.errors) ? [String(opt.errors)] : [], agent_name: me.name, project_id: c.project.id });
    S.setCompletionPath(c.db, c.project.id, id, file);
    await post(c, { type: 'done', task_id: id, files: rec.files, text: `Done ${id}: ${opt.summary}${opt.tests ? ` Tests: ${opt.tests}` : ''} (+${points} points)` });
    const left = S.listTasks(c.db, c.project.id, { agentId: me.id, status: ['todo', 'in_progress'] }).filter(x => x.kind !== 'planning').length;
    if (left === 0 && t.kind !== 'planning') await post(c, { type: 'need_tasks', to: 'supervisor', text: `${me.name} has finished its list apart from the planning task.` });
    return out({ record: file, points, remaining_tasks: left });
  }
  if (sub === 'fail') {
    if (!opt.reason) fail('bad_input', 'say why: --reason "..."');
    const before = S.getTask(c.db, c.project.id, id);
    if (opt.extend && (before?.attempts ?? 0) + 1 < c.settings.tasks.max_attempts) fail('bad_input', `--extend is only for the attempt that reaches the limit of ${c.settings.tasks.max_attempts} and beyond (at most ${c.settings.tasks.max_attempts_hard})`);
    const r = S.failTask(c.db, c.project.id, me.id, id, opt.reason, c.settings.tasks.max_attempts, { hardMax: c.settings.tasks.max_attempts_hard, extend: opt.extend || null });
    // From the second failure on, show what other agents have recently done to the same
    // files: repeated failures are often caused by someone else's change.
    const files = before?.files || [];
    const related = r.attempts >= 2 ? S.recentMessages(c.db, c.project.id, 200)
      .filter(m => m.from_agent !== me.id && (m.files || []).some(f => files.some(g => f === g || f.startsWith(g + '/') || g.startsWith(f + '/'))))
      .slice(-10).map(m => ({ id: m.id, from: m.from_agent, type: m.type, text: m.text, at: m.created_at })) : [];
    if (r.blocked) {
      await post(c, { type: 'question', to: 'supervisor', task_id: id, text: `${me.name} stopped ${id} after ${r.attempts} attempts (loop limit): ${opt.reason}. I need one of: permission to try a different approach, approval to drop it and move on, or a decision on an alternative.` });
      return out({ ...r, related_board_activity: related, next: 'LOOP LIMIT REACHED. Stop working on this task. It is blocked and the Supervisor has been asked. Release it from your mind, check the board for crossed work, and take your next task (pa task next).' });
    }
    const left = c.settings.tasks.max_attempts - r.attempts;
    return out({ ...r, related_board_activity: related, next: r.attempts >= c.settings.tasks.max_attempts
      ? `Extended attempt ${r.attempts} of at most ${r.hard_max} recorded. If this one fails too, stop.`
      : `Attempt ${r.attempts} of ${c.settings.tasks.max_attempts}. Do not repeat the same approach. ${r.attempts >= 2 ? 'Check related_board_activity: another agent may have changed these files. ' : ''}${left === 1 ? 'Next failure stops the task unless you can justify one more try with --extend.' : ''}` });
  }
  if (sub === 'pause') {
    if (!opt.reason) fail('bad_input', 'say why and what you are waiting for: --reason "..."');
    const t = S.pauseTask(c.db, c.project.id, me.id, id, opt.reason);
    await post(c, { type: 'pause', task_id: id, files: t.files, text: `${me.name} paused ${id} (${t.title}): ${opt.reason}. Files released.` });
    return out({ task: t, next: 'Paused and files released. Take your next task, or end the run. Resume with: pa task resume ' + id });
  }
  if (sub === 'resume') {
    const t = S.resumeTask(c.db, c.project.id, me.id, id);
    await post(c, { type: 'resume', task_id: id, text: `${me.name} resumed ${id} (${t.title}).` });
    return out({ task: t, next: 'Start it again with pa task start (this claims the files again).' });
  }
  if (sub === 'ask-user') {
    const q = pos.slice(2).join(' ') || opt.text;
    if (!q) fail('bad_input', 'write the question for the user');
    const t = S.waitForUser(c.db, c.project.id, me.id, id, q);
    const m = await post(c, { type: 'ask_user', to: 'owner', task_id: id, needs_reply: true, text: `${me.name} asks the user about ${id} (${t.title}): ${q}` });
    return out({ task: t, question: m.id, next: 'This task now waits for the user and cannot continue until the Supervisor relays the answer. Take your next task.' });
  }
  fail('bad_input', 'unknown task command');
});

cmd('list', 'pa list new --file tasks.json            create your next list (the planning task does this)', async ({ pos, opt }) => {
  const c = ctx(opt, { needAgent: !opt['for'] });
  if (pos[0] !== 'new') fail('bad_input', 'use: pa list new --file tasks.json [--for AGENT (planner/owner only)]');
  const target = opt['for'] ? S.requireAgent(c.db, c.project.id, opt['for']) : c.agent;
  if (opt['for'] && c.agent && c.agent.role !== 'supervisor') fail('planner_only', 'only the planner or the owner creates lists for other agents');
  const raw = readJson(opt.file);
  const tasks = Array.isArray(raw) ? raw : raw.tasks;
  if (!Array.isArray(tasks)) fail('bad_input', 'the file must be a JSON array of tasks or {"tasks": [...]}');
  const createdBy = c.agent ? c.agent.id : 'owner';
  const r = S.createList(c.db, c.project.id, target.id, tasks, { createdBy: createdBy === target.id ? target.id : createdBy });
  const file = writeListFile(c.db, c.project, target, r.listId);
  c.db.prepare('UPDATE lists SET file = ? WHERE project_id = ? AND id = ?').run(file, c.project.id, r.listId);
  const proposed = r.tasks.filter(t => t.status === 'proposed');
  await post(c, { type: 'planning', to: 'supervisor', text: `${target.name} created list ${r.listId} with ${r.tasks.length} tasks${proposed.length ? `, including ${proposed.length} new-feature proposal(s) awaiting owner approval: ${proposed.map(t => `${t.id} ${t.title}`).join('; ')}` : ''}.` });
  for (const p of proposed) await post(c, { type: 'proposal', to: 'owner', task_id: p.id, text: `${target.name} proposes: ${p.title}. ${p.detail || ''}`.trim() });
  out({ ...r, file });
});

cmd('answer', 'pa answer MESSAGE_ID "answer"                relay the user’s answer to an ask_user question (Supervisor or the user only)', async ({ pos, opt }) => {
  const c = ctx(opt);
  if (c.agent && c.agent.role !== 'supervisor') fail('supervisor_only', 'only the Supervisor (or the user) answers questions meant for the user');
  const q = S.getMessage(c.db, pos[0]);
  if (!q || q.type !== 'ask_user') fail('not_found', `no ask_user question ${pos[0]}`);
  const text = pos.slice(1).join(' ') || opt.text;
  if (!text) fail('bad_input', 'give the answer');
  const m = await post(c, { type: 'user_answer', reply_to: q.id, to: q.from_agent, task_id: q.task_id, text: `The user answered: ${text}` });
  const t = q.task_id ? S.userAnswered(c.db, c.project.id, q.task_id, c.actor, text) : null;
  out({ answer: m.id, task: t });
});

cmd('lock', 'pa lock acquire NAME [--ttl 15] | release NAME     named locks, e.g. git:main while merging', async ({ pos, opt }) => {
  const c = ctx(opt, { needAgent: true });
  const name = pos[1];
  if (!name) fail('bad_input', 'give the lock name, e.g. git:main');
  if (pos[0] === 'acquire') {
    try { return out(S.acquireLock(c.db, c.project.id, c.agent.id, name, Number(opt.ttl) > 0 ? Number(opt.ttl) : 15)); }
    catch (e) { if (e.code === 'locked') process.exitCode = 3; throw e; }
  }
  if (pos[0] === 'release') return out(S.releaseLock(c.db, c.project.id, c.agent.id, name));
  fail('bad_input', 'use acquire or release');
});

cmd('config', 'pa config get KEY                         one setting for this project, e.g. project.test_command', async ({ pos, opt }) => {
  const c = ctx(opt);
  if (pos[0] !== 'get' || !pos[1]) fail('bad_input', 'use: pa config get section.key');
  const v = pos[1].split('.').reduce((o, k) => (o == null ? o : o[k]), c.settings);
  process.stdout.write((v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)) + '\n');
});

cmd('inbox', 'pa inbox                                  everything that needs the Supervisor or the user', async ({ opt }) => {
  const c = ctx(opt);
  const answered = new Set(c.db.prepare(`SELECT reply_to FROM messages WHERE project_id = ? AND reply_to IS NOT NULL`).all(c.project.id).map(r => r.reply_to));
  const askUser = S.recentMessages(c.db, c.project.id, 2000).filter(m => m.type === 'ask_user' && !answered.has(m.id));
  const tasks = S.listTasks(c.db, c.project.id);
  out({
    for_the_user: {
      questions: askUser.map(m => ({ message_id: m.id, from: m.from_agent, task: m.task_id, question: m.text, at: m.created_at, answer_with: `pa answer ${m.id} "<the user's answer>"` })),
      proposals: tasks.filter(t => t.status === 'proposed').map(t => ({ task: t.id, agent: t.agent_id, kind: t.kind, title: t.title, pitch: t.detail, decide_with: `pa task approve ${t.id}  |  pa task decline ${t.id} --note "..."` })),
    },
    for_the_supervisor: {
      unanswered_questions: S.unansweredQuestions(c.db, c.project.id).filter(m => m.type !== 'ask_user').map(m => ({ message_id: m.id, from: m.from_agent, to: m.to_agent, text: m.text })),
      blocked_tasks: tasks.filter(t => t.status === 'blocked').map(t => ({ task: t.id, agent: t.agent_id, title: t.title, attempts: t.attempts })),
      stuck_agents: S.listAgents(c.db, c.project.id).filter(a => a.status === 'stuck').map(a => ({ id: a.id, name: a.name })),
      open_resets: S.openResets(c.db, c.project.id),
    },
    inbox_file: projectPaths(c.project.id).inbox,
  });
});

cmd('proposals', 'pa proposals                              new-feature proposals waiting for the owner', async ({ opt }) => {
  const c = ctx(opt);
  out(S.listTasks(c.db, c.project.id, { status: ['proposed'] }).map(t => ({ id: t.id, agent: t.agent_id, title: t.title, detail: t.detail })));
});

cmd('retire', 'pa retire --reason T                      retire yourself (no worthwhile work left / owner declined)', async ({ opt }) => {
  const c = ctx(opt, { needAgent: true });
  if (!opt.reason) fail('bad_input', 'say why: --reason "..."');
  // Retiring is the outcome of planning, so an open planning task is completed (and scored),
  // not cancelled. Any other open task is cancelled.
  const planning = S.listTasks(c.db, c.project.id, { agentId: c.agent.id, status: ['todo', 'in_progress'] }).find(t => t.kind === 'planning');
  let planningDone = null;
  if (planning && !S.listTasks(c.db, c.project.id, { agentId: c.agent.id, status: ['in_progress'] }).some(t => t.id !== planning.id)) {
    if (planning.status === 'todo') S.startTask(c.db, c.project.id, c.agent.id, planning.id, []);
    const rec = S.completeTask(c.db, c.project.id, c.agent.id, planning.id, { summary: `Planning outcome: retire. ${opt.reason}`, points: c.settings.tasks.points_planning });
    const file = path.join(c.agent.folder, 'completed', `${planning.id}.json`);
    writeJson(file, { ...rec, complete: true, findings: [], errors: [], agent_name: c.agent.name, project_id: c.project.id });
    S.setCompletionPath(c.db, c.project.id, planning.id, file);
    planningDone = planning.id;
  }
  const open = S.listTasks(c.db, c.project.id, { agentId: c.agent.id, status: ['todo', 'in_progress'] });
  for (const t of open) S.setTaskStatus(c.db, c.project.id, t.id, 'cancel', c.agent.id, 'agent retired');
  S.setAgentStatus(c.db, c.project.id, c.agent.id, 'retired', opt.reason);
  S.releaseClaims(c.db, c.project.id, c.agent.id);
  // Remove the agent's git worktree if it holds no uncommitted work (its tasks are all on main).
  let worktree = null;
  const wt = path.join(projectPaths(c.project.id).workspace, 'worktrees', c.agent.name);
  if (fs.existsSync(wt)) {
    const dirty = spawnSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' });
    if (dirty.status === 0 && !dirty.stdout.trim()) worktree = spawnSync('git', ['-C', c.project.root, 'worktree', 'remove', wt], { encoding: 'utf8' }).status === 0 ? 'removed' : 'kept (git could not remove it)';
    else worktree = 'kept: it has uncommitted changes';
  }
  writeManifests(c.db, c.project);
  await post(c, { type: 'retire', to: 'all', text: `${c.agent.name} is retiring: ${opt.reason}` });
  out({ retired: true, planning_task_completed: planningDone, cancelled_tasks: open.map(t => t.id), worktree });
});

// ---- board

cmd('board', 'pa board read [--all] [--peek] [--limit N] | post --type T --text X [--to A] [--task ID] [--files a,b] | ask "T" [--to A] [--files] | reply MSGID "T" | who --files a,b | unanswered | claims', async ({ pos, opt }) => {
  const sub = pos[0] || 'read';
  const c = ctx(opt, { needAgent: ['read'].includes(sub) && !opt.all });
  await presence(c);
  if (sub === 'read') {
    const viewer = c.agent || { id: 'owner', name: 'owner', role: 'owner' };
    return out(S.readMessages(c.db, c.project.id, viewer, { peek: !!opt.peek, all: !!opt.all, limit: Number(opt.limit) > 0 ? Number(opt.limit) : 50, since: opt.since ?? null }));
  }
  if (sub === 'post') return out(await post(c, { type: opt.type || 'note', text: opt.text ?? pos.slice(1).join(' '), to: opt.to || 'all', task_id: opt.task ?? null, files: list(opt.files) }));
  if (sub === 'ask') {
    let to = opt.to || 'all';
    let text = pos.slice(1).join(' ') || opt.text;
    // A question to an agent that can no longer answer goes to the planner instead.
    if (!['all', 'supervisor', 'owner'].includes(to)) {
      const target = S.getAgent(c.db, c.project.id, to);
      if (!target || ['retired', 'stopped'].includes(target.status)) {
        text = `(for ${to}, who is ${target ? target.status : 'unknown'}; rerouted to the planner) ${text}`;
        to = 'supervisor';
      }
    }
    return out(await post(c, { type: 'question', text, to, task_id: opt.task ?? null, files: list(opt.files) }));
  }
  if (sub === 'reply') {
    const q = S.getMessage(c.db, pos[1]);
    if (!q) fail('not_found', `no message ${pos[1]}`);
    return out(await post(c, { type: 'answer', reply_to: q.id, to: q.from_agent, text: pos.slice(2).join(' ') || opt.text, task_id: q.task_id }));
  }
  if (sub === 'who') {
    const files = list(opt.files).map(f => f.replace(/\\/g, '/'));
    const claims = S.activeClaims(c.db, c.project.id).filter(cl => !files.length || files.some(f => f === cl.path || f.startsWith(cl.path + '/') || cl.path.startsWith(f + '/')));
    return out({ claims, answer: claims.length ? 'Yes: see claims. Ask the holder on the board before touching these files.' : 'Nobody holds a claim on these files.' });
  }
  if (sub === 'unanswered') return out(S.unansweredQuestions(c.db, c.project.id));
  if (sub === 'claims') return out(S.activeClaims(c.db, c.project.id));
  fail('bad_input', 'unknown board command');
});

// ---- control: stop, reset consensus

cmd('stop', 'pa stop [AGENT] [--all-projects]          stop one agent, this project, or everything', async ({ pos, opt }) => {
  if (opt['all-projects']) { writeFileAtomic(homePaths().stop, new Date().toISOString()); return out({ stopped: 'all projects' }); }
  const c = ctx(opt);
  if (pos[0]) {
    const a = S.requireAgent(c.db, c.project.id, pos[0]);
    S.setAgentStatus(c.db, c.project.id, a.id, 'stopped');
    await post(c, { type: 'stop', to: a.id, text: `Stop requested for ${a.name} by ${c.actor}${opt.reason ? `: ${opt.reason}` : ''}. Finish the current step safely, record it, and end the run.` });
    await publishControl(c.settings, c.project.id, { type: 'stop', agent: a.id });
    return out({ stopped: a.name });
  }
  writeFileAtomic(projectPaths(c.project.id).stop, new Date().toISOString());
  await post(c, { type: 'stop', to: 'all', text: `Stop requested for the whole project by ${c.actor}${opt.reason ? `: ${opt.reason}` : ''}.` });
  await publishControl(c.settings, c.project.id, { type: 'stop' });
  out({ stopped: c.project.id });
});

cmd('start', 'pa start [AGENT] [--all-projects]         clear a stop', async ({ pos, opt }) => {
  if (opt['all-projects']) { fs.rmSync(homePaths().stop, { force: true }); return out({ started: 'all projects' }); }
  const c = ctx(opt);
  if (pos[0]) {
    const a = S.requireAgent(c.db, c.project.id, pos[0]);
    if (a.status === 'retired') fail('bad_state', `${a.name} is retired; bring it back with: pa agent reactivate ${a.id}`);
    S.setAgentStatus(c.db, c.project.id, a.id, 'active'); S.setStuckRuns(c.db, c.project.id, a.id, 0);
    return out({ started: a.name });
  }
  fs.rmSync(projectPaths(c.project.id).stop, { force: true });
  out({ started: c.project.id });
});

cmd('reset', 'pa reset start --reason T | status [ID] | cancel ID   reset consensus: every live agent must check in', async ({ pos, opt }) => {
  const c = ctx(opt);
  if (pos[0] === 'start') {
    if (c.agent && c.agent.role !== 'supervisor') fail('planner_only', 'only the planner or the owner starts a reset');
    const r = S.startReset(c.db, c.project.id, c.actor, opt.reason || null);
    await post(c, { type: 'reset', to: 'all', text: `Reset ${r.id} started by ${c.actor}${opt.reason ? `: ${opt.reason}` : ''}. Every agent: finish your current step, release claims you no longer need, then run: pa checkin ${r.id}`, needs_reply: false });
    return out(r);
  }
  if (pos[0] === 'cancel') {
    if (c.agent && c.agent.role !== 'supervisor') fail('planner_only', 'only the planner or the owner cancels a reset');
    S.cancelReset(c.db, c.project.id, pos[1]);
    await post(c, { type: 'note', to: 'all', text: `Reset ${pos[1]} cancelled by ${c.actor}.` });
    return out({ cancelled: pos[1] });
  }
  if (pos[1]) return out(S.resetStatus(c.db, c.project.id, pos[1]));
  out(S.openResets(c.db, c.project.id));
});

cmd('checkin', 'pa checkin RESET_ID [--note T]            answer a reset', async ({ pos, opt }) => {
  const c = ctx(opt, { needAgent: true });
  const r = S.checkin(c.db, c.project.id, pos[0], c.agent.id, opt.note || null);
  await post(c, { type: 'checkin', to: 'all', text: `${c.agent.name} checked in to ${pos[0]}${opt.note ? `: ${opt.note}` : ''}.` });
  out(r);
});

// ---- decisions, reporting, runner, UI

cmd('decide', 'pa decide --file request.json | --state T --question Q --options a,b [--backend heuristic|systemone|ollama]', async ({ opt }) => {
  const settings = loadSettings(projectIdFrom(opt));
  const req = opt.file ? readJson(opt.file) : { state: opt.state || '', questions: { q: { type: opt.options ? 'choice' : (opt.type || 'score'), instructions: opt.question, options: list(opt.options) } } };
  const cfg = { ...settings.decide, ...(opt.backend ? { backend: opt.backend } : {}) };
  const res = await decide(req, cfg);
  try { const pid = projectIdFrom(opt); S.recordDecision(openProjectDb(pid), { projectId: pid, agentId: process.env.PA_AGENT || null, backend: res.backend, request: req, response: res }); } catch {}
  out(res);
});

cmd('status', 'pa status [--json]                        agents, tasks, usage, limits', async ({ opt }) => {
  const c = ctx(opt);
  const st = buildState(c.db, c.project.id, c.settings);
  if (opt.json) return out(st);
  say(`${st.project.name} (${st.project.id})  phase: ${st.project.phase}  root: ${st.project.root}`);
  say(`tasks ${st.totals.tasks_done}/${st.totals.tasks_total} done  points ${st.totals.points}  runs ${st.totals.runs}  tokens ${st.totals.tokens_in}/${st.totals.tokens_out}  spend $${st.totals.cost_usd} (today $${st.limits.spent_today_usd} of $${st.limits.daily_usd})`);
  for (const a of st.agents) say(`  ${a.id} ${a.name.padEnd(12)} ${a.role.padEnd(7)} ${a.status.padEnd(8)} ${String(a.tasks.done).padStart(3)}/${String(a.tasks.total).padEnd(3)} pts ${String(a.points).padStart(3)}  ${a.current_task ? `-> ${a.current_task.id} ${a.current_task.title}` : ''}`);
  if (st.unanswered.length) say(`unanswered questions: ${st.unanswered.length}`);
  if (st.resets.length) say(`open resets: ${st.resets.map(r => `${r.id} missing ${r.missing.join(',')}`).join('; ')}`);
});

cmd('scoreboard', 'pa scoreboard                             points: 1 per task, 10 per planning task', async ({ opt }) => {
  const c = ctx(opt); out(S.scoreboard(c.db, c.project.id));
});

cmd('snapshot', 'pa snapshot                               write <payload>/workspace/state.json now', async ({ opt }) => {
  const c = ctx(opt); writeProjectSnapshot(c.db, c.project.id, c.settings); out({ written: projectPaths(c.project.id).snapshot });
});

cmd('run', 'pa run [--all] [--until-idle] [--ticks N]  the runner: wakes agents when they have work (--all: every registered project)', async ({ opt }) => {
  const { runLoop } = await import('./runner.mjs');
  const ids = opt.all ? null : [ctx(opt).project.id];
  const r = await runLoop({ projectIds: ids, untilIdle: !!opt['until-idle'], maxTicks: opt.ticks ? Number(opt.ticks) : Infinity, log: (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`) });
  out(r);
});

cmd('ui', 'pa ui [--port 4777]                       open the dashboard (reads the database)', async ({ opt }) => {
  const { startDashboard } = await import('../dashboard/server.mjs');
  await startDashboard({ port: Number(opt.port || 4777), projectId: projectIdFrom(opt) });
  await new Promise(() => {});
});

// ------------------------------------------------------------------ main

const { pos, opt, missing } = parseArgs(process.argv.slice(2));
const name = pos.shift() || 'help';
const fn = commands[name];
try {
  if (missing.length) fail('bad_input', `missing value for --${missing.join(', --')}`);
  if (!fn) fail('unknown_command', `unknown command "${name}". Run: pa help`);
  await fn({ pos, opt });
} catch (e) {
  if (e instanceof S.PaError) {
    process.stderr.write(JSON.stringify({ error: e.code, message: e.message, ...e.details }, null, 2) + '\n');
    process.exitCode = ['conflict', 'locked'].includes(e.code) ? 3 : 2;
  } else {
    process.stderr.write(`${e.stack || e}\n`);
    process.exitCode = 1;
  }
} finally {
  if (name !== 'ui' && name !== 'run') { await closeConnections(); closeAll(); }
  else if (name === 'run') { await closeConnections(); closeAll(); }
}
