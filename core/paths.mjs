// Where everything lives.
//
// Two places, with two different jobs:
//
// 1. The CENTRAL FOLDER (default ~/.perpetual-adaptive-agents). One per computer, created
//    once by start.sh. It holds what the service needs for every project: one folder per
//    registered project (projects/<project id>/link.json: the project's name and folder
//    paths), the NATS configuration and data, device settings, the `pa` command launcher,
//    logs, and lock files. Each project has its own file, so two projects never write the
//    same file. Its location can be changed once, at the first start.sh; the choice is kept
//    in <perpetual-adaptive-agents>/.pa-home (or the PA_HOME environment variable).
//
// 2. The PAYLOAD FOLDER, `adaptive-agents/`, copied into each project (for example to
//    <project>/.agents/adaptive-agents). It holds the instructions the agents follow, the
//    project's settings (config.toml) and everything the agents produce in workspace/:
//    project.json, the manifests, each agent's folder, task lists and completion records,
//    run logs, the state snapshot, and the database the agents keep their records in.
//    The service reads a project by reading its payload folder.
//
// REPO_ROOT is the perpetual-adaptive-agents folder (the service's code, and the master
// copy of the payload in REPO_ROOT/adaptive-agents).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAYLOAD_NAME = 'adaptive-agents';
export const PAYLOAD_SOURCE = path.join(REPO_ROOT, PAYLOAD_NAME);
// Folders inside a project where a payload may live, checked in this order.
export const PAYLOAD_PARENTS = ['.agents', '.claude', '.codex', '.github', '.cursor', '.kilocode', '.vscode', ''];

export const DEFAULT_HOME_NAME = '.perpetual-adaptive-agents';
export const HOME_POINTER = process.env.PA_HOME_POINTER || path.join(REPO_ROOT, '.pa-home');

export function paHome() {
  if (process.env.PA_HOME) return path.resolve(process.env.PA_HOME);
  try { const p = fs.readFileSync(HOME_POINTER, 'utf8').trim(); if (p) return path.resolve(p); } catch {}
  return path.resolve(path.join(os.homedir(), DEFAULT_HOME_NAME));
}

export const homePaths = (home = paHome()) => ({
  home,
  settings: path.join(home, 'pa.toml'),
  projects: path.join(home, 'projects'),
  serviceInfo: path.join(home, 'service.toml'),
  natsConf: path.join(home, 'nats', 'nats.conf'),
  natsData: path.join(home, 'nats', 'data'),
  natsPid: path.join(home, 'nats', 'nats.pid'),
  natsLog: path.join(home, 'nats', 'nats.log'),
  bin: path.join(home, 'bin'),
  logs: path.join(home, 'logs'),
  locks: path.join(home, 'locks'),
  stop: path.join(home, 'STOP'),
  runnerPid: path.join(home, 'runner.pid'),
  servicePid: path.join(home, 'service.pid'),
});

// service.toml in the central folder: where perpetual-adaptive-agents is, and the port.
export function serviceInfo() {
  const out = { port: 4777 };
  try {
    for (const l of fs.readFileSync(homePaths().serviceInfo, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) out[m[1]] = m[1] === 'port' ? Number(m[2]) : m[2];
    }
  } catch {}
  if (process.env.PA_PORT) out.port = Number(process.env.PA_PORT);
  return out;
}

// ---------------------------------------------------------------- locks
// A lock is a folder created with mkdir, which either succeeds or fails as one step, so two
// processes can never both hold it. The holder's process id is written inside. A lock whose
// holder has died, or that is older than staleMs, is taken over.

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export function withLock(name, fn, { timeoutMs = 60000, staleMs = 120000 } = {}) {
  const dir = path.join(homePaths().locks, `${name}.lock`);
  ensureDir(path.dirname(dir));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'pid'), String(process.pid)); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0, age = 0;
      try { pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')); } catch {}
      try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch { continue; }
      if ((pid && !alive(pid)) || age > staleMs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} continue; }
      if (Date.now() > deadline) throw Object.assign(new Error(`timed out waiting for the ${name} lock (held by process ${pid || 'unknown'}); if no other setup or registration is running, delete ${dir}`), { code: 'lock_timeout' });
      sleep(100);
    }
  }
  try { return fn(); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// The paths inside one payload folder.
export function payloadPaths(payload) {
  const ws = path.join(payload, 'workspace');
  return {
    payload,
    settings: path.join(payload, 'config.toml'),
    workspace: ws,
    db: path.join(ws, 'state.sqlite'),
    manifest: path.join(ws, 'manifest'),
    docs: path.join(ws, 'manifest'),
    agents: path.join(ws, 'agents'),
    runs: path.join(ws, 'runs'),
    snapshot: path.join(ws, 'state.json'),
    projectJson: path.join(ws, 'project.json'),
    inbox: path.join(ws, 'owner-inbox.md'),
    stop: path.join(ws, 'STOP'),
  };
}

// ---------------------------------------------------------------- registry
// The registry is the folder <central folder>/projects/, one sub-folder per project with a
// link.json file. Registering writes only that project's own file, under a lock.

const linkFile = (id) => path.join(homePaths().projects, id, 'link.json');

export function readRegistry() {
  const dir = homePaths().projects;
  const projects = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return { projects }; }
  for (const n of names.sort()) {
    try { projects.push(JSON.parse(fs.readFileSync(path.join(dir, n, 'link.json'), 'utf8'))); } catch {}
  }
  return { projects };
}

export function registerProject(entry) {
  if (!/^P-[0-9a-f]{6}$/.test(entry.id)) throw new Error(`invalid project id ${entry.id}`);
  return withLock('registry', () => {
    const norm = (p) => path.resolve(p).toLowerCase();
    // The same project folder registered under an older id is replaced, never duplicated.
    for (const p of readRegistry().projects) {
      if (p.id !== entry.id && norm(p.payload) === norm(entry.payload)) fs.rmSync(path.dirname(linkFile(p.id)), { recursive: true, force: true });
    }
    const prev = readJson(linkFile(entry.id), null);
    const rec = { ...prev, ...entry, registered_at: prev?.registered_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    writeJson(linkFile(entry.id), rec);
    return rec;
  });
}

export function unregisterProject(id) {
  return withLock('registry', () => fs.rmSync(path.dirname(linkFile(id)), { recursive: true, force: true }));
}

export function registryEntry(projectId) {
  if (!/^P-[0-9a-f]{6}$/.test(String(projectId))) return null;
  return readJson(linkFile(projectId), null);
}

// The paths of a registered project (by id).
export function projectPaths(projectId) {
  const e = registryEntry(projectId);
  if (!e) throw Object.assign(new Error(`project ${projectId} is not registered; register it: pa register <project folder>  (see AGENT-SETUP.md)`), { code: 'not_registered' });
  return { ...payloadPaths(e.payload), dir: e.payload, root: e.root };
}

export function agentDir(projectId, agent) {
  return path.join(projectPaths(projectId).agents, agent.name);
}

// Find the payload folder for the current working directory: an explicit PA_PAYLOAD,
// or the nearest ancestor folder that contains <parent>/adaptive-agents/config.toml.
export function findPayload(start = process.cwd()) {
  if (process.env.PA_PAYLOAD && fs.existsSync(path.join(process.env.PA_PAYLOAD, 'config.toml'))) return path.resolve(process.env.PA_PAYLOAD);
  let dir = path.resolve(start);
  for (;;) {
    if (path.basename(dir) === PAYLOAD_NAME && fs.existsSync(path.join(dir, 'config.toml'))) return dir;
    for (const parent of PAYLOAD_PARENTS) {
      const p = path.join(dir, parent, PAYLOAD_NAME);
      if (fs.existsSync(path.join(p, 'config.toml'))) return p;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// ---------------------------------------------------------------- files

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Write a file atomically: write a temporary file next to it, then rename.
// A reader never sees a half-written file.
export function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  // On Windows, an antivirus scanner or search indexer can hold the target for a moment.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (i < 10 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); continue; }
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
  }
}

export function writeJson(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

export function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

// Copy a folder, skipping names in `skip` at its top level.
export function copyDir(src, dst, skip = []) {
  ensureDir(dst);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
