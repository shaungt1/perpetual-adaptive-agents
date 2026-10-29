// The runner: the one long-running process. It is plain code, not an AI session.
//
// An idle headless session cannot hear anything; it only exists while it runs. So the
// runner decides when each agent's session should run again ("wakes" it) and resumes
// that session with a short prompt. It wakes an agent when the agent has runnable
// tasks, unread board messages addressed to it, or a reset it has not checked in to,
// and only within the caps: concurrent sessions, runs per agent per day, and the
// daily spending ceiling. It records every run (time, tokens, cost), detects agents
// that run without making progress (stuck), honors STOP, and writes the UI snapshot.
//
// It ticks every runner.tick_seconds, and immediately when a NATS board message
// arrives (if NATS is running).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { openProjectDb } from './db.mjs';
import { loadSettings } from './config.mjs';
import { homePaths, projectPaths, ensureDir, paHome, REPO_ROOT, readRegistry } from './paths.mjs';
import * as S from './store.mjs';
import { PROVIDERS, safePrompt, spawnSpec } from './providers.mjs';
import { writeProjectSnapshot } from './snapshot.mjs';
import { subscribeProject, putPresence, publishBoard } from './nats.mjs';

const running = new Map();   // key project:agent -> { child, runId, timer }
const lastPrune = new Map();

export function stopRequested(projectId) {
  return fs.existsSync(homePaths().stop) || fs.existsSync(projectPaths(projectId).stop);
}

// Child sessions must not inherit the parent session's identity variables, or the
// assistant CLI may think it is nested inside another session.
export function childEnv(project, agent) {
  const env = { ...process.env };
  const identity = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION_ID|REMOTE_SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|SESSION_ORIGIN|MESSAGING_\w+)|CODEX_THREAD_ID|CODEX_SESSION_ID)$/;
  for (const k of Object.keys(env)) if (identity.test(k)) delete env[k];
  ensureShims();
  const bin = homePaths().bin;
  const sep = process.platform === 'win32' ? ';' : ':';
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = `${bin}${sep}${env[pathKey] || ''}`;
  env.PA_HOME = paHome();
  env.PA_PROJECT = project.id;
  env.PA_PAYLOAD = projectPaths(project.id).payload;
  env.PA_AGENT = agent.id;
  env.PA_REPO = REPO_ROOT;
  return env;
}

// The `pa` command must be on the agent's PATH. Setup writes these shims; the runner
// re-creates them if they are missing (for example in a separate PA_HOME used for testing).
export function ensureShims() {
  const bin = ensureDir(homePaths().bin);
  const cli = path.join(REPO_ROOT, 'core', 'cli.mjs');
  const sh = path.join(bin, 'pa');
  if (!fs.existsSync(sh)) { fs.writeFileSync(sh, `#!/usr/bin/env sh\nexec node "${cli.replace(/\\/g, '/')}" "$@"\n`); try { fs.chmodSync(sh, 0o755); } catch {} }
  const cmd = path.join(bin, 'pa.cmd');
  if (!fs.existsSync(cmd)) fs.writeFileSync(cmd, `@echo off\r\nnode "${cli}" %*\r\n`);
  // The payload's bin/pa script finds the service through this file.
  const info = homePaths().serviceInfo;
  if (!fs.existsSync(info)) fs.writeFileSync(info, `repo = "${REPO_ROOT.replace(/\\/g, '/')}"\n`);
}

function wakeReason(db, project, agent) {
  if (S.openResets(db, project.id).some(r => r.missing.includes(agent.id))) return 'reset check-in required';
  const mail = S.wakeCount(db, project.id, agent);
  if (mail) return `${mail} board message(s) addressed to you`;
  if (S.hasRunnableWork(db, project.id, agent.id)) return 'runnable tasks';
  return null;
}

export function candidates(db, project, settings) {
  const out = [];
  for (const a of S.listAgents(db, project.id)) {
    if (!['active', 'idle'].includes(a.status)) continue;
    if (running.has(`${project.id}:${a.id}`)) continue;
    if (S.openRuns(db, project.id).some(r => r.agent_id === a.id)) continue;
    const reason = wakeReason(db, project, a);
    if (!reason) {
      if (a.status === 'active' && a.role === 'worker') S.setAgentStatus(db, project.id, a.id, 'idle');
      continue;
    }
    if (S.runsToday(db, project.id, a.id) >= settings.limits.daily_runs_per_agent) continue;
    // The planner reads every status note, so waking it for each one is the main cost of a
    // busy project. It is woken at most once per planner_min_interval_seconds, unless a
    // question is waiting for an answer or a reset needs it.
    if (a.role === 'supervisor' && !reason.startsWith('reset')) {
      const last = db.prepare('SELECT MAX(started_at) AS t FROM runs WHERE project_id = ? AND agent_id = ?').get(project.id, a.id).t;
      const recent = last && Date.now() - Date.parse(last) < (settings.runner.planner_min_interval_seconds ?? 0) * 1000;
      const urgent = S.unansweredQuestions(db, project.id).some(q => q.from_agent !== a.id && ['all', 'supervisor', a.id, a.name].includes(q.to_agent));
      if (recent && !urgent) { out.deferred = (out.deferred || 0) + 1; continue; }
    }
    out.push({ agent: a, reason });
  }
  // Planner first, then fair share: fewest runs today, then the longest wait since the last run.
  const lastStart = (id) => db.prepare('SELECT MAX(started_at) AS t FROM runs WHERE project_id = ? AND agent_id = ?').get(project.id, id).t || '';
  for (const c of out) { c.today = S.runsToday(db, project.id, c.agent.id); c.last = lastStart(c.agent.id); }
  return out.sort((x, y) =>
    ((y.agent.role === 'supervisor') - (x.agent.role === 'supervisor')) || (x.today - y.today) || (x.last < y.last ? -1 : x.last > y.last ? 1 : 0));
}

function launch(db, project, agent, reason, settings, onExit) {
  const provider = PROVIDERS[agent.provider];
  if (!provider) throw new S.PaError('bad_provider', `unknown provider ${agent.provider}`);
  const pp = projectPaths(project.id);
  ensureDir(pp.runs);
  if (!PROVIDERS[agent.provider]) throw new S.PaError('bad_provider', `unknown provider ${agent.provider}`);
  const prompt = safePrompt(
    `You are ${agent.name} (agent ${agent.id}), the ${agent.role} of project ${project.name} (${project.id}). ` +
    `Reason for this run: ${reason}. First run the shell command: pa whoami. ` +
    `Then read your INSTRUCTIONS.md (path printed by pa whoami) and follow it until this run's work is done.`);
  const addDirs = [paHome(), project.root];
  const { cmd, args } = provider.build({ settings, prompt, sessionId: agent.session_id, addDirs, model: agent.model });
  const env = childEnv(project, agent);
  const logPath = path.join(pp.runs, `${new Date().toISOString().replace(/[:.]/g, '-')}-${agent.id}.log`);
  const runId = S.startRun(db, project.id, agent.id, agent.provider, reason, logPath);
  const marker = S.progressMarker(db, project.id, agent.id);
  // A write stream, not a raw descriptor: output that arrives after the session exits
  // (from processes it left running) can never land in a closed or reused file.
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  log.on('error', () => {});
  const write = (d) => { if (!log.closed && !log.destroyed && !log.writableEnded) log.write(d); };
  write(`# run ${runId} ${agent.name} ${new Date().toISOString()} reason: ${reason}\n# ${cmd} ${args.map(a => (a.length > 80 ? a.slice(0, 77) + '...' : a)).join(' ')}\n`);
  if (agent.status === 'idle') S.setAgentStatus(db, project.id, agent.id, 'active');
  S.touchPresence(db, project.id, agent.id);
  putPresence(settings, project.id, agent.id).catch(() => {});

  const key = `${project.id}:${agent.id}`;
  let stdout = '';
  let child = null;
  let timer = null;
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    running.delete(key);
    log.end();
    try {
      const u = provider.parse(stdout) || {};
      const price = settings.providers?.[agent.provider] || {};
      if (!u.cost_usd && (price.usd_per_mtok_in || price.usd_per_mtok_out))
        u.cost_usd = ((u.tokens_in || 0) * (price.usd_per_mtok_in || 0) + (u.tokens_out || 0) * (price.usd_per_mtok_out || 0)) / 1e6;
      const progressed = S.progressMarker(db, project.id, agent.id) > marker;
      S.endRun(db, runId, { exit_code: code ?? -1, tokens_in: u.tokens_in || 0, tokens_out: u.tokens_out || 0, cost_usd: u.cost_usd || 0, session_id: u.session_id || null, progressed });
      if (u.session_id) S.setAgentSession(db, project.id, agent.id, u.session_id);
      const tokens = (u.tokens_in || 0) + (u.tokens_out || 0);
      if (settings.limits.max_tokens_per_run > 0 && tokens > settings.limits.max_tokens_per_run) {
        const m = S.postMessage(db, project.id, { from: 'runner', to: 'supervisor', type: 'note', text: `${agent.name} used ${tokens} tokens in one run (limit ${settings.limits.max_tokens_per_run}). Log: ${logPath}` });
        publishBoard(settings, project.id, m).catch(() => {});
      }
      S.touchPresence(db, project.id, agent.id);
      const fresh = S.getAgent(db, project.id, agent.id);
      if (progressed) S.setStuckRuns(db, project.id, agent.id, 0);
      else if (['active', 'idle'].includes(fresh.status)) {
        const n = fresh.stuck_runs + 1;
        S.setStuckRuns(db, project.id, agent.id, n);
        if (n >= settings.runner.stuck_after_runs) {
          S.setAgentStatus(db, project.id, agent.id, 'stuck');
          const m = S.postMessage(db, project.id, { from: 'runner', to: 'supervisor', type: 'note', text: `${fresh.name} (${fresh.id}) made no progress in ${n} consecutive runs and is marked stuck. Last log: ${logPath}` });
          publishBoard(settings, project.id, m).catch(() => {});
        }
      }
      onExit?.({ agent: fresh, code, usage: u, progressed });
    } catch (e) {
      onExit?.({ agent, code, error: e });
    }
  };

  try {
    const spec = spawnSpec(cmd, args, env);
    child = spawn(spec.file, spec.args, { cwd: project.root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...spec.options });
  } catch (e) {
    // A command that cannot even start counts as a run without progress, so a broken
    // provider setting ends with the agent marked stuck instead of a retry every tick.
    write(`spawn failed: ${e.message}\n`);
    running.set(key, { child: null, runId, timer: null });
    finish(-1);
    return runId;
  }
  S.setRunPid(db, runId, child.pid ?? null);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => { if (stdout.length < 4e6) stdout += d; write(d); });
  child.stderr.on('data', d => write(d));
  timer = setTimeout(() => { write('\n# timeout: stopping run\n'); killTree(child); }, settings.runner.run_timeout_minutes * 60e3);
  running.set(key, { child, runId, timer });
  // 'close' fires after the process has exited AND its output pipes are closed.
  // If the session left a background process holding the pipes, 'exit' fires first;
  // in that case the run is finished a few seconds after 'exit'.
  child.on('close', (code) => finish(code));
  child.on('exit', (code) => setTimeout(() => finish(code), 5000).unref?.());
  child.on('error', (e) => { write(`\nprocess error: ${e.message}\n`); finish(-1); });
  return runId;
}

// On Windows a session started through cmd.exe has child processes; kill the whole tree.
function killTree(child) {
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { child.kill(); } catch {} }
}

export function stopAll(projectId = null) {
  for (const [key, r] of running) {
    if (projectId && !key.startsWith(projectId + ':')) continue;
    if (r.child) killTree(r.child);
  }
}

// A stopped agent's running session is ended at once, not left to its time limit.
// (A retiring agent is not killed: it usually retired itself and is finishing its run.)
function stopRemovedAgents(db, projectId) {
  for (const [key, r] of running) {
    if (!key.startsWith(projectId + ':') || !r.child) continue;
    const a = S.getAgent(db, projectId, key.slice(projectId.length + 1));
    if (!a || a.status === 'stopped') killTree(r.child);
  }
}

// One pass over one project. Returns what it did.
export function tick(db, projectId, { onExit } = {}) {
  const settings = loadSettings(projectId);
  const project = S.requireProject(db, projectId);
  const did = { launched: [], skipped: null };
  // Runs left open by a runner that died (and not owned by this runner) are closed.
  const minePids = new Set([...running.values()].map(r => r.child?.pid).filter(Boolean));
  S.reapStaleRuns(db, projectId, settings.runner.run_timeout_minutes, (pid) => minePids.has(pid) || S.pidAlive(pid));
  stopRemovedAgents(db, projectId);
  if (stopRequested(projectId)) { stopAll(projectId); did.skipped = 'STOP requested'; }
  else if (project.phase !== 'running') did.skipped = `project phase is ${project.phase}`;
  else if (settings.limits.daily_usd > 0 && S.spendToday(db, projectId) >= settings.limits.daily_usd) did.skipped = 'daily spending ceiling reached';
  else if (settings.limits.daily_tokens > 0 && S.tokensToday(db, projectId) >= settings.limits.daily_tokens) did.skipped = 'daily token ceiling reached';
  if (!did.skipped) {
    const inFlight = [...running.keys()].filter(k => k.startsWith(projectId + ':')).length;
    let slots = settings.agents.max_concurrent - inFlight;
    // Spending is only known when a run ends, so runs already in flight count at the average
    // cost of a recent run. Without this, several runs started just under the ceiling can
    // together overshoot it by several runs' worth.
    if (settings.limits.daily_usd > 0) {
      const avg = S.averageRunCost(db, projectId);
      // A run starts only if the spending so far, plus every run in flight and this one at the
      // average cost, stays within the ceiling. Before any run has finished there is no average,
      // so the first run is allowed.
      if (avg > 0) slots = Math.min(slots, Math.floor((settings.limits.daily_usd - S.spendToday(db, projectId)) / avg) - inFlight);
    }
    const cands = candidates(db, project, settings);
    did.deferred = cands.deferred || 0;
    for (const c of cands.slice(0, Math.max(0, slots))) {
      let runId = null;
      try { runId = launch(db, project, c.agent, c.reason, settings, onExit); }
      catch (e) { did.errors = [...(did.errors || []), `${c.agent.name}: ${e.message}`]; continue; }
      if (runId) did.launched.push({ agent: c.agent.id, name: c.agent.name, reason: c.reason, run: runId });
    }
  }
  if (!lastPrune.has(projectId) || Date.now() - lastPrune.get(projectId) > 3600e3) {
    S.pruneMessages(db, projectId, settings.board.db_retention_days);
    lastPrune.set(projectId, Date.now());
  }
  try { writeProjectSnapshot(db, projectId, settings); } catch (e) { did.errors = [...(did.errors || []), `snapshot: ${e.message}`]; }
  return did;
}

export const runningCount = (projectId) => [...running.keys()].filter(k => !projectId || k.startsWith(projectId + ':')).length;

// The loop. untilIdle: return once nothing is running and nothing would be launched
// (used by tests and for "run until this batch is done").
// Only one runner per device: two runners would each think they own the sessions and
// could start the same agent twice. The lock is a file holding the runner's process id;
// a lock left by a runner that died is taken over.
export function acquireRunnerLock() {
  const f = homePaths().runnerPid;
  ensureDir(path.dirname(f));
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return () => { try { if (fs.readFileSync(f, 'utf8') === String(process.pid)) fs.rmSync(f); } catch {} }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const other = Number(fs.readFileSync(f, 'utf8'));
      if (other && other !== process.pid && S.pidAlive(other)) throw new S.PaError('runner_running', `another runner is already running (process ${other}); stop it first, or remove ${f} if that process is not a runner`);
      fs.rmSync(f, { force: true });
    }
  }
  throw new S.PaError('runner_lock', `could not take the runner lock ${f}`);
}

// Heartbeat read by the service's health check: when the loop last completed a pass.
export const heartbeat = { started_at: null, last_pass_at: null, passes: 0, tick_seconds: null, nats_push: false, error: null };

export async function runLoop({ projectIds, untilIdle = false, maxTicks = Infinity, log = console.log } = {}) {
  const release = acquireRunnerLock();
  heartbeat.started_at = new Date().toISOString();
  const onSignal = () => { stopAll(); release(); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  // projectIds = null means every project in the registry, re-read on every pass, so a
  // project registered while the service runs is picked up without a restart.
  const listIds = () => projectIds || readRegistry().projects.map(p => p.id);
  const dbOf = (pid) => openProjectDb(pid);
  let wake = null;
  const sleep = (ms) => new Promise(r => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; });
  // One live-feed subscription per project. If NATS is not running yet, the runner polls
  // and tries to subscribe again every minute, so starting NATS later turns push on.
  const subs = new Map();
  let lastTry = 0;
  const trySubscribe = async () => {
    lastTry = Date.now();
    for (const pid of listIds()) {
      if (subs.get(pid) && !subs.get(pid).isClosed()) continue;
      const sub = await subscribeProject(loadSettings(pid), pid, () => wake?.());
      if (sub) subs.set(pid, sub); else subs.delete(pid);
    }
  };
  await trySubscribe();
  log(`runner: watching ${projectIds ? projectIds.join(', ') : 'every registered project'}; NATS push ${subs.size ? 'on' : 'off (polling)'}`);
  let ticks = 0;
  const lastSkip = new Map();
  try {
    for (;;) {
      if (subs.size < listIds().length && Date.now() - lastTry > 60e3) {
        const before = subs.size;
        await trySubscribe();
        if (subs.size > before) log('runner: NATS push on');
      }
      let launched = 0;
      let deferred = 0;
      for (const pid of listIds()) {
        let did;
        try {
          did = tick(dbOf(pid), pid, { onExit: ({ agent, code, progressed, error }) => { log(`runner: ${agent.name} finished (exit ${code}, ${error ? `error: ${error.message}` : progressed ? 'progress' : 'no progress'})`); wake?.(); } });
        } catch (e) {
          log(`runner: ${pid} tick failed: ${e.message}`);
          did = { launched: [], skipped: null };
        }
        for (const e of did.errors || []) log(`runner: ${pid} error: ${e}`);
        launched += did.launched.length;
        deferred += did.deferred || 0;
        for (const l of did.launched) log(`runner: woke ${l.name} (${l.reason})`);
        if (!untilIdle && (did.skipped || null) !== (lastSkip.get(pid) || null)) {
          log(did.skipped ? `runner: ${pid} waiting: ${did.skipped}` : `runner: ${pid} active`);
          lastSkip.set(pid, did.skipped || null);
        }
        if (did.skipped && untilIdle && runningCount(pid) === 0) return { ticks, reason: did.skipped };
      }
      ticks++;
      heartbeat.last_pass_at = new Date().toISOString(); heartbeat.passes = ticks; heartbeat.nats_push = subs.size > 0;
      // Idle means nothing running, nothing launched, and nobody waiting out a wake-up interval.
      if (untilIdle && launched === 0 && runningCount() === 0 && deferred === 0) return { ticks, reason: 'idle' };
      if (ticks >= maxTicks) return { ticks, reason: 'max ticks' };
      const ids = listIds();
      const secs = ids.length ? Math.min(...ids.map(pid => loadSettings(pid).runner.tick_seconds)) : loadSettings().runner.tick_seconds;
      heartbeat.tick_seconds = secs;
      await sleep(untilIdle ? Math.min(secs * 1000, 250) : secs * 1000);
    }
  } finally {
    for (const sub of subs.values()) { try { sub.unsubscribe(); } catch {} }
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    release();
  }
}
