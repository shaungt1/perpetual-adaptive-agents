// Several agent processes race for the same file at the same moment.
// Exactly one may win the claim; the others must get a conflict (exit code 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'core', 'cli.mjs');

test('claims are atomic across processes', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-race-'));
  const env = { ...process.env, PA_HOME: path.join(tmp, 'home'), PA_NATS: 'off' };
  delete env.PA_AGENT; delete env.PA_PROJECT;
  const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  fs.mkdirSync(path.join(tmp, 'proj'));
  const p = JSON.parse(run(['register', path.join(tmp, 'proj'), '--copy', '--approve', 'all', '--name', 'race']).stdout);
  const N = 6;
  const plan = {
    categories: Array.from({ length: N }, (_, i) => ({ id: `C${i + 1}`, name: `lane ${i + 1}`, scope: 'One lane of the race test.', owns: [`src/c${i + 1}/`], out_of_scope: 'The other lanes and their files.', done_definition: 'Its task is finished and tests pass.' })),
    master_tasks: Array.from({ length: N }, (_, i) => ({ id: `T-00${i + 1}`, category: `C${i + 1}`, kind: 'bug', title: `t${i + 1}` })),
    agents: Array.from({ length: N }, (_, i) => ({ categories: [`C${i + 1}`], provider: 'mock', tasks: [`T-00${i + 1}`] })),
  };
  fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify(plan));
  assert.equal(run(['plan', 'import', path.join(tmp, 'plan.json'), '--project', p.id]).status, 0);

  const results = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const agent = `A0${i + 1}`;
    const c = spawn(process.execPath, [CLI, 'task', 'start', `${agent}-L1-1`, '--files', 'shared/config.json', '--project', p.id], { env: { ...env, PA_AGENT: agent } });
    c.on('exit', (code) => resolve(code));
  })));
  assert.equal(results.filter(c => c === 0).length, 1, `exactly one winner, got exit codes ${results}`);
  assert.equal(results.filter(c => c === 3).length, N - 1);
  const claims = JSON.parse(run(['board', 'claims', '--project', p.id]).stdout);
  assert.equal(claims.length, 1);
  const conflicts = JSON.parse(run(['board', 'read', '--all', '--peek', '--limit', '100', '--project', p.id]).stdout).filter(m => m.type === 'conflict');
  assert.equal(conflicts.length, N - 1, 'every loser posted a conflict to the board');
});
