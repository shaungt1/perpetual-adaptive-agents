// start.sh: first run asks, creates the central folder once, starts the service and reports
// health; later runs change nothing; a crashed service is restarted; two starts at once do
// not collide; a busy port and a foreign folder are refused with a clear message; --check
// changes nothing. Each case uses its own home folder and port.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const START = path.join(REPO, 'start.sh');
const CLI = path.join(REPO, 'core', 'cli.mjs');
const haveBash = spawnSync('bash', ['--version']).status === 0;

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-start-'));
  const port = 5100 + Math.floor(Math.random() * 800);
  const env = { ...process.env, HOME: home, USERPROFILE: home, PA_HOME_POINTER: path.join(home, 'pointer'), PA_NATS: 'off' };
  delete env.PA_HOME; delete env.PA_AGENT; delete env.PA_PROJECT; delete env.PA_PORT;
  const start = (...args) => {
    const r = spawnSync('bash', [START, '--port', String(port), '--no-nats-download', ...args], { encoding: 'utf8', env, input: '' });
    let json = null; try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, json, err: r.stderr };
  };
  const central = path.join(home, '.perpetual-adaptive-agents');
  const stop = () => spawnSync(process.execPath, [CLI, 'down'], { env: { ...env, PA_HOME: central } });
  return { home, port, env, start, central, stop };
}
const files = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort() : [];

test('first run asks, --yes creates once, second run changes nothing, --check only reports', { skip: !haveBash, timeout: 90000 }, async () => {
  const s = setup();
  try {
    const q = s.start();
    assert.equal(q.code, 10, 'asks the user first');
    assert.match(q.json.question, /Create the central folder/);
    assert.ok(!fs.existsSync(s.central), 'nothing created before the user answers');

    const first = s.start('--yes');
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.health.ok, true);
    assert.equal(first.json.health.central_folder.path, s.central);
    for (const f of ['central-folder.json', 'service.toml', 'pa.toml', 'nats/nats.conf', 'bin/pa', 'bin/pa.cmd', 'projects', 'logs', 'locks']) assert.ok(fs.existsSync(path.join(s.central, f)), f);
    const health = await (await fetch(`http://127.0.0.1:${s.port}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.runner.running, true);

    const before = files(s.central).filter(f => !f.startsWith('logs') && !f.endsWith('.pid'));
    const mtimes = Object.fromEntries(before.map(f => [f, fs.statSync(path.join(s.central, f)).mtimeMs]));
    const second = s.start();
    assert.equal(second.code, 0);
    assert.ok(second.json.steps.some(x => x.step === 'service' && /already running and healthy/.test(x.status)));
    assert.ok(second.json.steps.some(x => x.step === 'central folder check' && x.status === 'ok'));
    for (const f of before) assert.equal(fs.statSync(path.join(s.central, f)).mtimeMs, mtimes[f], `${f} untouched`);

    s.stop();
    fs.rmSync(path.join(s.central, 'pa.toml'));
    const check = s.start('--check');
    assert.equal(check.code, 1, 'not running is reported');
    assert.ok(!fs.existsSync(path.join(s.central, 'pa.toml')), '--check repairs nothing');
    assert.ok(check.json.steps.some(x => x.step === 'central folder check' && /needs repair/.test(x.status)));
    const fixed = s.start();
    assert.equal(fixed.code, 0);
    assert.ok(fs.existsSync(path.join(s.central, 'pa.toml')), 'repaired on a normal run');
  } finally { s.stop(); }
});

test('a crashed service is restarted; two starts at the same moment start one service', { skip: !haveBash, timeout: 90000 }, async () => {
  const s = setup();
  try {
    assert.equal(s.start('--yes').code, 0);
    const pid = Number(fs.readFileSync(path.join(s.central, 'service.pid'), 'utf8'));
    process.kill(pid, 'SIGKILL');
    await new Promise(r => setTimeout(r, 500));
    const run = () => new Promise(resolve => { const c = spawn('bash', [START, '--port', String(s.port), '--no-nats-download'], { env: s.env }); let out = ''; c.stdout.on('data', d => out += d); c.on('exit', code => resolve({ code, json: JSON.parse(out) })); });
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(a.code, 0); assert.equal(b.code, 0);
    const started = [a, b].filter(r => r.json.steps.some(x => x.step === 'service' && /started and healthy/.test(x.status)));
    assert.equal(started.length, 1, 'exactly one of them started the service');
    assert.notEqual(a.json.health.pid, pid);
    assert.equal(a.json.health.pid, b.json.health.pid);
  } finally { s.stop(); }
});

test('a busy port and a foreign folder are refused with the fix', { skip: !haveBash, timeout: 60000 }, async () => {
  const s = setup();
  const blocker = net.createServer().listen(s.port, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  try {
    const r = s.start('--yes');
    assert.equal(r.code, 1);
    assert.ok(r.json.steps.some(x => x.step === 'port' && x.status === 'busy' && /--port/.test(x.detail)));
  } finally { blocker.close(); s.stop(); }

  const t = setup();
  const foreign = path.join(t.home, 'my-stuff');
  fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'important.txt'), 'keep me');
  const r = t.start('--home', foreign);
  assert.equal(r.code, 1);
  assert.match(r.json.steps.at(-1).detail, /not empty/);
  assert.deepEqual(fs.readdirSync(foreign), ['important.txt'], 'nothing written into the foreign folder');
});

test('a chosen central folder is remembered for later runs', { skip: !haveBash, timeout: 60000 }, () => {
  const s = setup();
  const chosen = path.join(s.home, 'pa-central');
  try {
    const r = s.start('--home', chosen);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(path.join(s.home, 'pointer'), 'utf8').trim(), chosen);
    assert.equal(s.start().json.central_folder, chosen);
  } finally { spawnSync(process.execPath, [CLI, 'down'], { env: { ...s.env, PA_HOME: chosen } }); }
});
