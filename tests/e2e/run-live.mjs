#!/usr/bin/env node
// Live run of the test case with real assistant sessions. This spends real tokens.
//
//   node tests/e2e/run-live.mjs [--provider claude|codex|copilot] [--model <name>] [--usd 2]
//
// It uses its own central folder (<home>/.perpetual-adaptive-agents-live-test) so it never touches your real
// projects, copies the sample project into it, imports the four-agent plan with the chosen
// provider, approves it, runs the runner until every agent is idle or retired, and prints the
// status. Afterwards, open the dashboard with:
//   PA_HOME=<that folder> node core/cli.mjs ui --project <id>      (Git Bash)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CASE = path.join(REPO, 'tests', 'e2e', 'test-case');
const CLI = path.join(REPO, 'core', 'cli.mjs');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const provider = opt('provider', 'claude');
const usd = opt('usd', '2');
const model = opt('model', '');

const HOME = path.join(os.homedir(), '.perpetual-adaptive-agents-live-test');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const PROJECT = path.join(HOME, 'workspaces', `notes-lite-${stamp}`);
const env = { ...process.env, PA_HOME: HOME };
delete env.PA_AGENT; delete env.PA_PROJECT;

function pa(args, { inherit = false } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd: PROJECT, stdio: inherit ? 'inherit' : 'pipe' });
  if (r.status !== 0) { console.error(`pa ${args.join(' ')} failed:\n${r.stderr}`); process.exit(1); }
  try { return JSON.parse(r.stdout); } catch { return r.stdout; }
}

fs.mkdirSync(path.dirname(PROJECT), { recursive: true });
fs.cpSync(path.join(CASE, 'sample-project'), PROJECT, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: PROJECT });
const p = pa(['register', PROJECT, '--copy', '--approve', 'all', '--name', 'notes-lite live test']);
fs.appendFileSync(path.join(p.payload, 'config.toml'), `${model ? `\n[providers.${provider}]\nmodel = "${model}"\n` : ''}\n[agents]\ndefault_provider = "${provider}"\nmax_concurrent = 2\n\n[limits]\ndaily_usd = ${usd}\ndaily_runs_per_agent = 6\n\n[runner]\ntick_seconds = 5\nrun_timeout_minutes = 15\n`);
const prompt = fs.readFileSync(path.join(CASE, 'planning-prompt.md'), 'utf8');
fs.writeFileSync(path.join(p.payload, 'vision.txt'), prompt.slice(prompt.indexOf('My vision:')));
pa(['vision', 'add', '--file', path.join(p.payload, 'vision.txt')]);
pa(['doc', 'add', '--key', '07-plan', '--title', 'Plan of action', '--path', path.join(CASE, 'plan.md')]);
const plan = JSON.parse(fs.readFileSync(path.join(CASE, 'plan.json'), 'utf8'));
plan.planner = { provider };
for (const a of plan.agents) a.provider = provider;
fs.writeFileSync(path.join(p.payload, 'plan.json'), JSON.stringify(plan, null, 2));
console.log(pa(['plan', 'import', path.join(p.payload, 'plan.json')]));
for (const d of pa(['doc', 'list'])) pa(['doc', 'status', d.key, 'checked']);
pa(['approve']);
console.log(`project ${p.id} in ${PROJECT}\nrunning ${provider} agents (ceiling $${usd})...`);
pa(['run', '--until-idle'], { inherit: true });
pa(['status'], { inherit: true });
console.log(`\nDashboard: set PA_HOME=${HOME} and run: node "${CLI}" ui --project ${p.id}`);
