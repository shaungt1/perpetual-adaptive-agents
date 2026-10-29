// NATS integration test. Runs only when a nats-server program is available
// (on PATH, or in <PA_HOME>/bin after setup); otherwise it is skipped.
// It starts a private server on a free port with its own JetStream folder, then checks:
// the board stream is created with limits, a board message posted through the CLI
// arrives on the live feed, de-duplication works, and presence lands in the KV bucket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'core', 'cli.mjs');
const exe = process.platform === 'win32' ? 'nats-server.exe' : 'nats-server';
const candidates = [path.join(process.env.PA_HOME || path.join(os.homedir(), '.perpetual-adaptive-agents'), 'bin', exe), 'nats-server'];
const natsBin = candidates.find(c => spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0);

const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('board messages reach NATS JetStream', { skip: natsBin ? false : 'nats-server not installed', timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-nats-'));
  const port = await freePort();
  const server = spawn(natsBin, ['-a', '127.0.0.1', '-p', String(port), '-js', '-sd', path.join(tmp, 'js')], { stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 800));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'pa.toml'), `[board]\nnats_url = "nats://127.0.0.1:${port}"\nmax_msgs = 50\n`);
    const env = { ...process.env, PA_HOME: home, PA_NATS: 'on' };
    delete env.PA_AGENT; delete env.PA_PROJECT;
    const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
    fs.mkdirSync(path.join(tmp, 'proj'));
    const p = JSON.parse(run(['register', path.join(tmp, 'proj'), '--copy', '--approve', 'all', '--name', 'nats']).stdout);

    const { connect } = await import('@nats-io/transport-node');
    const { jetstreamManager } = await import('@nats-io/jetstream');
    const { Kvm } = await import('@nats-io/kv');
    const nc = await connect({ servers: `nats://127.0.0.1:${port}` });
    const got = [];
    const sub = nc.subscribe(`pa.${p.id}.>`);
    (async () => { for await (const m of sub) got.push(JSON.parse(new TextDecoder().decode(m.data))); })();
    await nc.flush();

    const msg = JSON.parse(run(['board', 'post', '--type', 'note', '--text', 'hello board', '--project', p.id]).stdout);
    assert.equal(msg.published, true, 'CLI reports the message was published');
    for (let i = 0; i < 30 && !got.some(m => m.id === msg.id); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(got.some(m => m.id === msg.id && m.text === 'hello board'), 'live feed received it');

    const jsm = await jetstreamManager(nc);
    const info = await jsm.streams.info('PA_BOARD');
    assert.equal(info.config.max_msgs, 50, 'limits applied');
    assert.equal(info.config.discard, 'old');
    const before = info.state.messages;
    // Same message id again: JetStream drops the duplicate.
    const { jetstream } = await import('@nats-io/jetstream');
    const ack = await jetstream(nc).publish(`pa.${p.id}.board.all`, new TextEncoder().encode('{}'), { msgID: msg.id });
    assert.equal(ack.duplicate, true);
    assert.equal((await jsm.streams.info('PA_BOARD')).state.messages, before);

    // Presence through an agent command.
    fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify({ categories: [{ id: 'C1', name: 'x', scope: 'Everything about x in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }], master_tasks: [{ id: 'T-001', category: 'C1', kind: 'bug', title: 't' }], agents: [{ categories: ['C1'], provider: 'mock', tasks: ['T-001'] }] }));
    run(['plan', 'import', path.join(tmp, 'plan.json'), '--project', p.id]);
    run(['whoami', '--project', p.id], { PA_AGENT: 'A01' });
    const kv = await new Kvm(nc).open('pa_presence');
    const e = await kv.get(`${p.id}.A01`);
    assert.ok(e && e.value.length > 0, 'presence key written');
    await nc.drain();
  } finally {
    server.kill();
  }
});
