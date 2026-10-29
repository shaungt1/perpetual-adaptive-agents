// The git workflow every code task follows, using the payload's own Git Bash scripts:
// task-branch.sh (worktree + micro-branch + board announcement) -> commit -> pa task done is
// refused while unmerged -> merge-task.sh (lock, rebase, tests, fast-forward main, verify,
// delete branch, announce) -> pa task done succeeds. Skipped where bash or git is missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'core', 'cli.mjs');
const have = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;

test('branch, refuse unmerged done, merge to main, done', { skip: have('bash') && have('git') ? false : 'bash or git missing', timeout: 60000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-git-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'service.toml'), `repo = "${REPO.replace(/\\/g, '/')}"\n`);
  const env = { ...process.env, PA_HOME: home, PA_NATS: 'off', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' };
  delete env.PA_AGENT; delete env.PA_PROJECT; delete env.PA_PAYLOAD;
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  const sh = (cmd, extra = {}, cwd = proj) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8', env: { ...env, ...extra }, cwd });
  const ok = (r) => { assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); return r.stdout.trim(); };
  ok(sh('git init -q -b main && echo "# demo" > README.md && echo ok > ok.txt && git add -A && git commit -q -m init'));
  const pa = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd: proj });
  const init = JSON.parse(ok(pa(['register', proj, '--copy', '--approve', 'all', '--test', 'test -f ok.txt'])));
  // The payload, CLAUDE.md and AGENTS.md are committed by the user; workspace runtime files are ignored.
  ok(sh('git add -A && git commit -q -m "add adaptive-agents payload"'));
  fs.writeFileSync(path.join(tmp, 'plan.json'), JSON.stringify({
    departments: [{ id: 'C1', name: 'Docs', scope: 'Everything about Docs in this test project.', owns: ['src/c1/'], out_of_scope: 'Other departments and their files.', done_definition: 'Its tasks are finished and the tests pass.' }],
    master_tasks: [{ id: 'T-001', category: 'C1', kind: 'owner_request', title: 'Write the guide' }],
    agents: [{ departments: ['C1'], provider: 'mock', tasks: ['T-001'] }],
    supervisor: { provider: 'mock' },
  }));
  ok(pa(['plan', 'import', path.join(tmp, 'plan.json')]));
  const agent = { PA_AGENT: 'A01' };
  ok(pa(['task', 'start', 'A01-L1-1', '--files', 'docs/guide.md'], agent));

  const bin = path.join(init.payload, 'bin').replace(/\\/g, '/');
  const wt = ok(sh(`bash "${bin}/task-branch.sh" A01-L1-1`, agent)).split('\n').pop();
  assert.ok(fs.existsSync(path.join(wt, 'README.md')), 'worktree checked out');
  assert.equal(ok(sh('git rev-parse --abbrev-ref HEAD', {}, wt)), 'aa/Zorro-01/A01-L1-1');
  assert.ok(!ok(sh('git status --porcelain')).includes('worktrees'), 'the worktree is ignored by the main checkout');

  fs.mkdirSync(path.join(wt, 'docs'));
  fs.writeFileSync(path.join(wt, 'docs', 'guide.md'), '# Guide\n');
  ok(sh('git add -A && git commit -q -m "A01-L1-1: write the guide"', {}, wt));

  const early = pa(['task', 'done', 'A01-L1-1', '--summary', 'guide written'], agent);
  assert.equal(early.status, 2, 'done is refused while the branch is not merged');
  assert.match(early.stderr, /not_merged/);

  ok(sh(`bash "${bin}/merge-task.sh" A01-L1-1`, agent));
  assert.ok(fs.existsSync(path.join(proj, 'docs', 'guide.md')), 'main (the user\'s checkout) has the change');
  assert.equal(sh('git show-ref --verify --quiet refs/heads/aa/Zorro-01/A01-L1-1').status, 1, 'branch deleted');
  assert.equal(ok(sh('git rev-list --parents -n 1 main')).split(' ').length, 3, 'main is a merge commit for the task (two parents)');
  assert.match(ok(sh('git log -1 --format=%s main')), /^Merge task A01-L1-1 \(Zorro-01\)/);
  // The whole task can be undone with one revert, then restored.
  ok(sh('git revert --no-edit -m 1 main'));
  assert.ok(!fs.existsSync(path.join(proj, 'docs', 'guide.md')), 'one revert undoes the task');
  ok(sh('git revert --no-edit HEAD'));
  assert.equal(JSON.parse(ok(pa(['board', 'claims']))).filter(c => c.path === 'lock:git:main').length, 0, 'lock released');

  ok(pa(['task', 'done', 'A01-L1-1', '--summary', 'guide written', '--files', 'docs/guide.md', '--tests', 'test -f ok.txt: pass'], agent));
  const types = JSON.parse(ok(pa(['board', 'read', '--all', '--peek', '--limit', '50']))).map(m => m.type);
  for (const t of ['announce', 'branch', 'merge', 'done']) assert.ok(types.includes(t), `board has ${t}`);
});
