// start: check everything, create what is missing the first time, repair what is broken,
// and start the service if it is not already healthy. Safe to run any number of times,
// from any number of terminals or agents at once. Run it through start.sh.
//
//   bash start.sh                     first run asks before creating the central folder
//   bash start.sh --yes               accept the default central folder without asking
//   bash start.sh --home <folder>     use this folder as the central folder (first run only)
//   bash start.sh --port <n>          serve the dashboard and API on this port (default 4777)
//   bash start.sh --check             only report health; change nothing
//   bash start.sh --no-nats-download  never download the NATS server
//
// Steps:
//   1. lock: only one start runs at a time; a second one waits, then finds everything done
//   2. Node.js version
//   3. packages (node_modules) present
//   4. central folder: create it the first time (after asking), otherwise check and repair it
//   5. NATS server program: present, or downloaded and checksum-verified
//   6. already healthy? stop here and change nothing
//   7. clear leftovers of a crashed service, check the port is free, start NATS and the service
//   8. ask the health check again and report
// The result is printed as one JSON object. Exit code 0 = healthy, 1 = a problem (the
// message says what and how to fix it), 10 = a question for the user (first run).

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const val = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const WIN = process.platform === 'win32';
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
const NATS_VERSION = process.env.PA_NATS_VERSION || 'v2.15.1';
const report = { started_at: new Date().toISOString(), perpetual_adaptive_agents_folder: REPO, steps: [] };
const step = (name, status, detail) => { report.steps.push({ step: name, status, ...(detail ? { detail } : {}) }); process.stderr.write(`[start] ${name}: ${status}${detail ? ` - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}\n`); };
const finish = (code, extra = {}) => { Object.assign(report, extra, { finished_at: new Date().toISOString() }); process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exit(code); };
const fwd = (p) => p.replace(/\\/g, '/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// ---- 1. lock (inside perpetual-adaptive-agents, because the central folder may not exist yet)
const lockDir = path.join(REPO, '.start.lock');
async function lock() {
  const deadline = Date.now() + 180e3;
  for (;;) {
    try { fs.mkdirSync(lockDir); fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid)); return; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0; try { pid = Number(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8')); } catch {}
      let age = 0; try { age = Date.now() - fs.statSync(lockDir).mtimeMs; } catch { continue; }
      if ((pid && !alive(pid)) || age > 600e3) { fs.rmSync(lockDir, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) { step('lock', 'failed', `another start.sh (process ${pid}) has been running for over 3 minutes; if it is not, delete ${lockDir}`); finish(1); }
      await sleep(250);
    }
  }
}
const unlock = () => { try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {} };
process.on('exit', unlock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { unlock(); process.exit(130); });

await lock();
step('lock', 'held');

// ---- 2. Node.js
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) { step('node', 'failed', `Node ${process.version} is too old; install Node 22.13 or newer`); finish(1); }
step('node', 'ok', process.version);

// ---- 3. packages
const needed = ['smol-toml', '@nats-io/transport-node', '@nats-io/jetstream', '@nats-io/kv'];
const missingPkgs = needed.filter(p => !fs.existsSync(path.join(REPO, 'node_modules', ...p.split('/'), 'package.json')));
if (missingPkgs.length) {
  if (flag('check')) { step('packages', 'missing', missingPkgs.join(', ')); finish(1); }
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: REPO, stdio: ['ignore', 2, 2], shell: WIN });
  if (r.status !== 0) { step('packages', 'failed', 'npm install failed; see the messages above'); finish(1); }
  step('packages', 'installed', missingPkgs.join(', '));
} else step('packages', 'ok');

// From here the service's own modules can be loaded.
const P = await import('./paths.mjs');

// ---- 4. central folder
const pointer = P.HOME_POINTER;
let home = P.paHome();
let createdNow = false;
const markerOf = (h) => path.join(h, 'central-folder.json');
if (!fs.existsSync(markerOf(home))) {
  if (val('home')) home = path.resolve(val('home'));
  if (fs.existsSync(home) && fs.readdirSync(home).length && !fs.existsSync(markerOf(home))) {
    step('central folder', 'failed', `${home} exists, is not empty, and was not created by Perpetual Adaptive Agents; choose another folder with --home <folder>`);
    finish(1);
  }
  if (flag('check')) { step('central folder', 'missing', home); finish(1, { health: null }); }
  if (!flag('yes') && !val('home')) {
    const question = `Create the central folder for Perpetual Adaptive Agents at ${home}? It holds the list of registered projects, the NATS message-board server and its data, logs and settings. Nothing is installed anywhere else.`;
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const ans = (await new Promise(r => rl.question(`${question}\nPress Enter to accept, type another folder path, or type no: `, r))).trim();
      rl.close();
      if (/^n(o)?$/i.test(ans)) { step('central folder', 'declined by the user'); finish(1); }
      if (ans) home = path.resolve(ans);
    } else {
      step('central folder', 'needs the user', question);
      finish(10, { question, default: home, how_to_answer: 'ask the user, then run start.sh again with --yes (accept this folder) or --home "<folder the user chose>"' });
    }
  }
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(markerOf(home), JSON.stringify({ created_at: new Date().toISOString(), created_by: 'start.sh', perpetual_adaptive_agents_folder: REPO, version: VERSION }, null, 2) + '\n');
  const def = path.resolve(path.join(os.homedir(), P.DEFAULT_HOME_NAME));
  if (path.resolve(home).toLowerCase() !== def.toLowerCase() && !process.env.PA_HOME) fs.writeFileSync(pointer, home + '\n');
  process.env.PA_HOME = home;
  createdNow = true;
  step('central folder', 'created', home);
} else step('central folder', 'exists', home);
process.env.PA_HOME = home;
const hp = P.homePaths(home);
report.central_folder = home;

// Check and repair every part of the central folder. Each part is written only if missing or wrong.
const repaired = [];
const CHECK = flag('check');
const ensure = (p) => { if (!fs.existsSync(p)) { if (!CHECK) fs.mkdirSync(p, { recursive: true }); repaired.push(p); } };
const ensureFile = (f, content, { onlyIfMissing = false } = {}) => {
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  if (cur === content || (onlyIfMissing && cur !== null)) return;
  if (!CHECK) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); } repaired.push(f);
};
for (const d of [hp.projects, hp.logs, hp.locks, hp.bin, path.join(home, 'nats', 'data')]) ensure(d);
const port = Number(val('port') || P.serviceInfo().port || 4777);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { step('port', 'failed', `invalid port ${val('port')}`); finish(1); }
ensureFile(hp.serviceInfo, `# Written by start.sh. Where the Perpetual Adaptive Agents service is, and its port.\nrepo = "${fwd(REPO)}"\nversion = "${VERSION}"\nport = "${port}"\n`);
ensureFile(hp.settings, `# Device settings for Perpetual Adaptive Agents. Any key in\n# ${fwd(path.join(REPO, 'pa.default.toml'))}\n# may be overridden here; each project can override again in its adaptive-agents/config.toml.\n`, { onlyIfMissing: true });
ensureFile(hp.natsConf, `# NATS server for Perpetual Adaptive Agents (written by start.sh).\n# Listens on this computer only. JetStream (the persistent store) keeps its data in the folder below.\nserver_name: pa_local\nlisten: 127.0.0.1:4222\nmax_payload: 1MB\njetstream {\n  store_dir: "${fwd(path.join(home, 'nats', 'data'))}"\n  max_memory_store: 64MB\n  max_file_store: 1GB\n}\n`);
const cli = path.join(REPO, 'core', 'cli.mjs');
ensureFile(path.join(hp.bin, 'pa'), `#!/usr/bin/env sh\n# perpetual-adaptive-agents\nexec node "${fwd(cli)}" "$@"\n`);
if (!CHECK) try { fs.chmodSync(path.join(hp.bin, 'pa'), 0o755); } catch {}
ensureFile(path.join(hp.bin, 'pa.cmd'), `@echo off\r\nrem perpetual-adaptive-agents\r\nnode "${cli}" %*\r\n`);
// Projects whose folder disappeared are reported, never deleted.
const lost = P.readRegistry().projects.filter(p => !fs.existsSync(p.payload)).map(p => ({ id: p.id, name: p.name, payload: p.payload }));
step('central folder check', !repaired.length ? 'ok' : CHECK ? 'needs repair (run start.sh without --check)' : createdNow ? 'set up' : 'repaired', repaired.length ? repaired : undefined);
if (lost.length) step('projects', 'warning', { missing_folders: lost, fix: 'register them again, or remove them with: pa projects --forget <id>' });

// The `pa` command on PATH (Windows: the user PATH in the registry; elsewhere: reported).
if (WIN && !CHECK) {
  const ps = ["$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "$p = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
    "if (-not (($p -split ';') -contains $env:PA_BIN)) { $k.SetValue('Path', ($p.TrimEnd(';') + ';' + $env:PA_BIN).TrimStart(';'), [Microsoft.Win32.RegistryValueKind]::ExpandString); 'added' } else { 'present' }",
    '$k.Close()'].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', env: { ...process.env, PA_BIN: hp.bin } });
  step('pa on PATH', r.status === 0 ? r.stdout.trim() || 'ok' : 'could not change PATH', r.status === 0 ? (r.stdout.includes('added') ? 'open a new terminal to use pa' : undefined) : `add ${hp.bin} to PATH by hand`);
} else {
  const onPath = (process.env.PATH || '').split(path.delimiter).some(p => path.resolve(p) === path.resolve(hp.bin));
  step('pa on PATH', onPath ? 'present' : 'not on PATH', onPath ? undefined : `add to ~/.bashrc: export PATH="${fwd(hp.bin)}:$PATH"`);
}

// ---- 5. NATS server program
const natsUrl = 'nats://127.0.0.1:4222';
const natsReachable = () => new Promise(r => { const s = net.connect(4222, '127.0.0.1'); s.setTimeout(800); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); s.on('timeout', () => { s.destroy(); r(false); }); });
const natsBin = path.join(hp.bin, WIN ? 'nats-server.exe' : 'nats-server');
const onPathNats = spawnSync(WIN ? 'where' : 'which', ['nats-server'], { encoding: 'utf8' }).status === 0;
if (await natsReachable()) step('nats server', 'already running', `${natsUrl} (started earlier, or by docker compose)`);
else if (fs.existsSync(natsBin)) step('nats server', 'installed', natsBin);
else if (onPathNats) step('nats server', 'installed', 'found on PATH');
else if (flag('no-nats-download') || flag('check')) step('nats server', 'not installed', 'the board works through each project\'s database; agents are woken on a timer instead of instantly');
else {
  try {
    const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386' };
    const osName = WIN ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const ext = WIN ? 'zip' : 'tar.gz';
    const base = `nats-server-${NATS_VERSION}-${osName}-${archMap[process.arch] || 'amd64'}`;
    const url = `https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/${base}.${ext}`;
    const [res, sums] = await Promise.all([fetch(url, { signal: AbortSignal.timeout(120e3) }), fetch(`https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/SHA256SUMS`, { signal: AbortSignal.timeout(60e3) })]);
    if (!res.ok || !sums.ok) throw new Error(`download failed (HTTP ${res.status}/${sums.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const expected = (await sums.text()).split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(([, f]) => f === `${base}.${ext}`)?.[0];
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (!expected || expected !== actual) throw new Error(`checksum mismatch (expected ${expected}, got ${actual}); not installed`);
    const tmp = path.join(hp.bin, '.download'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const archive = path.join(tmp, `${base}.${ext}`); fs.writeFileSync(archive, buf);
    // Windows includes bsdtar at System32\tar.exe, which reads zip files (Git Bash's tar does not).
    const tarExe = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tarExe, ['-xf', archive, '-C', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`could not unpack the archive: ${r.stderr}`);
    fs.copyFileSync(path.join(tmp, base, WIN ? 'nats-server.exe' : 'nats-server'), natsBin);
    if (!WIN) fs.chmodSync(natsBin, 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
    step('nats server', 'downloaded', `${NATS_VERSION}, checksum verified, ${natsBin}`);
  } catch (e) {
    step('nats server', 'not installed', `${e.message}. The board works through each project's database until NATS is installed (or started with docker compose up -d)`);
  }
}

// ---- 6. already healthy?
const healthUrl = `http://127.0.0.1:${port}/api/health`;
async function getHealth() {
  try { const r = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
let health = await getHealth();
if (health?.service === 'perpetual-adaptive-agents' && health.ok && !flag('check')) {
  step('service', 'already running and healthy', `pid ${health.pid}`);
  finish(0, { health, dashboard: `http://127.0.0.1:${port}`, health_check: healthUrl });
}
if (flag('check')) { step('service', health ? (health.ok ? 'healthy' : 'unhealthy') : 'not running'); finish(health?.ok ? 0 : 1, { health, health_check: healthUrl }); }

// ---- 7. clear leftovers, check the port, start
for (const f of [hp.servicePid, hp.runnerPid]) {
  if (!fs.existsSync(f)) continue;
  const pid = Number(fs.readFileSync(f, 'utf8'));
  if (pid && alive(pid)) {
    if (health?.service === 'perpetual-adaptive-agents') {
      // Running but unhealthy: stop it so it can start clean.
      if (WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(pid); } catch {} }
      step('leftover', 'stopped an unhealthy service', `pid ${pid}`);
      await sleep(1000);
    } else if (f === hp.servicePid) {
      // The pid file names a live process that is not answering: probably reused by another program after a crash.
      step('leftover', 'cleared', `${f} named process ${pid}, which is not answering as the service (left over from a crash)`);
    }
  } else step('leftover', 'cleared', `${f} (process ${pid} is gone)`);
  fs.rmSync(f, { force: true });
}
const portFree = await new Promise(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(port, '127.0.0.1', () => s.close(() => r(true))); });
if (!portFree) { step('port', 'busy', `port ${port} is used by another program; stop it, or run start.sh --port <another port>`); finish(1); }
step('port', 'free', String(port));

const up = spawnSync(process.execPath, [cli, 'up'], { encoding: 'utf8', env: { ...process.env, PA_HOME: home, PA_PORT: String(port) } });
if (up.status !== 0) { step('service', 'failed to start', (up.stderr || up.stdout).trim().slice(-1500)); finish(1); }
let upOut = {}; try { upOut = JSON.parse(up.stdout); } catch {}
step('nats', typeof upOut.nats === 'object' && upOut.nats ? (upOut.nats.connected ? 'connected' : 'not running (the board works through each project\'s database)') : String(upOut.nats || 'unknown'));

// ---- 8. confirm
for (let i = 0; i < 40 && !(health = await getHealth())?.ok; i++) await sleep(250);
if (!health) { step('service', 'not answering', `see ${path.join(hp.logs, 'service.log')}`); finish(1, { log: path.join(hp.logs, 'service.log') }); }
step('service', health.ok ? 'started and healthy' : 'started but unhealthy', health.ok ? `pid ${health.pid}` : health.problems);
finish(health.ok ? 0 : 1, { health, dashboard: `http://127.0.0.1:${port}`, health_check: healthUrl });
