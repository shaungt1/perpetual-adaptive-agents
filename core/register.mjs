// Registering a project with the service.
//
// A project is any folder an agent works in. Registration is done by the service's API
// (POST /api/projects/register) or by `pa register <project folder>`; both call
// registerFolder() below, which:
//
//   1. checks the folder and finds the adaptive-agents payload copied into it (or copies it,
//      when asked to);
//   2. detects which assistant tools the project uses (from their folders) and which are
//      installed on this computer;
//   3. lists every file OUTSIDE the payload it would create or change (instruction files for
//      the detected tools, the plans folder) and changes only the ones the user approved;
//   4. creates the project's records INSIDE the payload: config.toml, workspace/project.json,
//      workspace/state.sqlite and the workspace folders;
//   5. records the project in the central folder (projects/<project id>/link.json), one file
//      per project, under a lock, so projects registered at the same moment never collide;
//   6. announces the project on its message-board channels (pa.<project id>.*).
//
// With dry_run it does steps 1-3 only and changes nothing. Running it again on a registered
// project keeps the project's id and records and only repairs what is missing.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse as parseToml } from 'smol-toml';
import {
  PAYLOAD_NAME, PAYLOAD_SOURCE, PAYLOAD_PARENTS, REPO_ROOT, payloadPaths, registerProject, registryEntry,
  copyDir, ensureDir, writeFileAtomic, writeJson, readJson, paHome, homePaths, withLock, readRegistry,
} from './paths.mjs';
import { openDb } from './db.mjs';
import * as S from './store.mjs';

const MARK_BEGIN = '<!-- adaptive-agents:begin -->';
const MARK_END = '<!-- adaptive-agents:end -->';
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;

// Files a complete payload must contain.
const REQUIRED = ['SUPERVISOR.md', 'README.md', 'protocol/message-board.md', 'rules', 'procedures/planning-session.md',
  'procedures/next-task-list.md', 'templates/agent.md', 'templates/supervisor-run.md', 'schemas', 'examples', 'bin/pa',
  'bin/task-branch.sh', 'bin/merge-task.sh'];

// Assistant tools and how each one is told about the payload. Every format below was checked
// against the tool's own documentation (see docs/research/research-notes.md, "Instruction files").
//   folder:  the project folder whose presence shows the project uses the tool
//   cli:     the command whose presence shows the tool is installed on this computer
export const TOOLS = {
  claude: { label: 'Claude Code', folder: '.claude', cli: 'claude' },
  codex: { label: 'OpenAI Codex', folder: '.codex', cli: 'codex' },
  copilot: { label: 'GitHub Copilot', folder: '.github', cli: 'copilot' },
  cursor: { label: 'Cursor', folder: '.cursor', cli: 'cursor' },
  kilocode: { label: 'Kilo Code', folder: '.kilocode', cli: 'kilocode' },
};

export function readConfig(payload) {
  const f = payloadPaths(payload).settings;
  if (!fs.existsSync(f)) return {};
  return parseToml(fs.readFileSync(f, 'utf8'));
}

// The project root for a payload: the folder that holds the dot-folder the payload sits in.
export function rootOfPayload(payload) {
  const parent = path.dirname(payload);
  return path.basename(parent).startsWith('.') ? path.dirname(parent) : parent;
}

const bad = (code, message, details) => new S.PaError(code, message, details);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (parent, child) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

export function detectTools(root) {
  const folders = {};
  for (const f of ['.agents', '.claude', '.codex', '.github', '.cursor', '.kilocode', '.kilo', '.vscode']) folders[f] = fs.existsSync(path.join(root, f));
  const files = {};
  for (const f of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']) files[f] = fs.existsSync(path.join(root, f));
  const installed = {};
  for (const [k, t] of Object.entries(TOOLS)) installed[k] = which(t.cli);
  const in_project = Object.entries(TOOLS).filter(([k, t]) =>
    folders[t.folder] || (k === 'claude' && files['CLAUDE.md']) || (k === 'copilot' && files['.github/copilot-instructions.md']) || (k === 'kilocode' && folders['.kilo'])).map(([k]) => k);
  return { folders, files, installed, in_project, vscode: folders['.vscode'] };
}

// Where the payload is (or will be) in a project.
export function locatePayload(root, location) {
  if (location !== undefined && location !== null && location !== '') {
    const loc = String(location);
    if (path.isAbsolute(loc) || loc.split(/[\\/]/).includes('..')) throw bad('bad_input', `location must be a folder inside the project, like .agents; got ${loc}`);
    return { payload: path.join(root, loc, PAYLOAD_NAME), found: fs.existsSync(path.join(root, loc, PAYLOAD_NAME, 'SUPERVISOR.md')) };
  }
  for (const parent of PAYLOAD_PARENTS) {
    const p = path.join(root, parent, PAYLOAD_NAME);
    if (fs.existsSync(path.join(p, 'SUPERVISOR.md'))) return { payload: p, found: true };
  }
  return { payload: path.join(root, '.agents', PAYLOAD_NAME), found: false };
}

function pointerBlock(rel) {
  return `${MARK_BEGIN}
## Adaptive Agents

This project uses Adaptive Agents. Its instructions and records live in \`${rel}/\`.

- If the user asks you to set up, plan, supervise or manage the agents, you are a **project manager**: read \`${rel}/SUPERVISOR.md\` and follow it.
- If you were started as an agent (the environment variable PA_AGENT is set, or your prompt names you), run \`pa whoami\` and follow the instructions file it prints.
- The \`pa\` command is the agents' tool. If it is not on the path, use \`bash ${rel}/bin/pa\`.
${MARK_END}
`;
}

// Every file outside the payload that registration may create or change, for the chosen tools.
function plannedFiles(root, payload, tools, plansFolder) {
  const rel = path.relative(root, payload).replace(/\\/g, '/');
  const block = pointerBlock(rel);
  const list = [];
  const marked = (file, why, tool) => list.push({ path: file, tool, why, kind: 'marked-section', content: block });
  marked('AGENTS.md', 'read by Codex, Cursor, GitHub Copilot and Kilo Code agents', 'all');
  if (tools.includes('claude')) {
    marked('CLAUDE.md', 'read by Claude Code at the start of every session', 'claude');
    const src = path.join(payload, 'commands');
    const srcFiles = fs.existsSync(src) ? fs.readdirSync(src).filter(f => f.endsWith('.md')) : fs.readdirSync(path.join(PAYLOAD_SOURCE, 'commands')).filter(f => f.endsWith('.md'));
    for (const f of srcFiles) {
      const text = fs.readFileSync(path.join(fs.existsSync(src) ? src : path.join(PAYLOAD_SOURCE, 'commands'), f), 'utf8').replace(/\r\n/g, '\n').replaceAll('{{PAYLOAD}}', rel);
      list.push({ path: `.claude/commands/${f}`, tool: 'claude', why: `the /${f.replace(/\.md$/, '')} slash command in Claude Code`, kind: 'own-file', content: text });
    }
  }
  if (tools.includes('copilot')) marked('.github/copilot-instructions.md', 'read by GitHub Copilot for every chat in this repository', 'copilot');
  if (tools.includes('cursor')) list.push({ path: '.cursor/rules/adaptive-agents.mdc', tool: 'cursor', why: 'a Cursor project rule applied to every chat', kind: 'own-file', content: `---\ndescription: Adaptive Agents\nalwaysApply: true\n---\n${block}` });
  if (tools.includes('kilocode')) list.push({ path: '.kilocode/rules/adaptive-agents.md', tool: 'kilocode', why: 'a Kilo Code project rule (files in .kilocode/rules are read automatically)', kind: 'own-file', content: block });
  if (plansFolder && !fs.existsSync(path.join(root, plansFolder))) list.push({ path: `${plansFolder.replace(/\\/g, '/')}/`, tool: 'all', why: 'the folder for the planning documents', kind: 'folder' });
  return list.map(f => {
    const abs = path.join(root, f.path);
    let action = 'create';
    if (f.kind === 'folder') action = 'create folder';
    else if (fs.existsSync(abs)) {
      const cur = fs.readFileSync(abs, 'utf8');
      if (f.kind === 'own-file') action = cur === f.content ? 'unchanged' : (cur.includes('adaptive-agents') ? 'update' : 'skip: a file with this name exists and was not written by Adaptive Agents');
      else action = cur.includes(MARK_BEGIN) ? (cur.includes(f.content) ? 'unchanged' : 'update marked section') : 'append marked section';
    }
    return { ...f, action };
  });
}

function applyFile(root, f) {
  const abs = path.join(root, f.path);
  if (f.kind === 'folder') { ensureDir(abs); return; }
  if (f.kind === 'own-file') { writeFileAtomic(abs, f.content); return; }
  let text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (text.includes(MARK_BEGIN)) text = text.replace(new RegExp(`${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n?`), () => f.content);
  else text = (text && !text.endsWith('\n') ? text + '\n' : text) + (text ? '\n' : '') + f.content;
  writeFileAtomic(abs, text);
}

const tomlString = (v) => JSON.stringify(String(v ?? ''));

const HEADER = [
  "# Adaptive Agents: this project's settings.",
  '# [project] identifies the project (do not change id). [service] tells this folder where the',
  '# Perpetual Adaptive Agents service is. Written at registration.',
  "# Any key from the service's pa.default.toml (agents, tasks, runner, limits, board, providers)",
  '# may be overridden below.',
];

function writeConfig(payload, p) {
  const f = payloadPaths(payload).settings;
  const existing = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  // Keep every section the user added; replace only [project] and [service].
  let rest = '', skip = false;
  for (const l of existing.split(/\r?\n/)) {
    if (/^\s*\[(project|service)\]\s*$/.test(l)) { skip = true; continue; }
    if (/^\s*\[/.test(l)) skip = false;
    if (!skip && !HEADER.includes(l)) rest += l + '\n';
  }
  writeFileAtomic(f, `${HEADER.join('\n')}
[project]
id = ${tomlString(p.id)}
name = ${tomlString(p.name)}
kind = ${tomlString(p.kind)}
root = ${tomlString(p.root.replace(/\\/g, '/'))}
main_branch = ${tomlString(p.main_branch || 'main')}
test_command = ${tomlString(p.test_command || '')}

[service]
repo = ${tomlString(REPO_ROOT.replace(/\\/g, '/'))}
home = ${tomlString(paHome().replace(/\\/g, '/'))}
version = ${tomlString(VERSION)}
` + (rest.trim() ? '\n' + rest.trim() + '\n' : ''));
}

// workspace/project.json: the project's description, owner and project managers. It is
// created at registration and kept up to date by `pa project set` and `pa pm join`.
export function updateProjectJson(payload, patch) {
  const f = payloadPaths(payload).projectJson;
  const cur = readJson(f, {});
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  if (!next.created_at) next.created_at = next.updated_at;
  writeJson(f, next);
  return next;
}

export function payloadVersion(payload) {
  try { return fs.readFileSync(path.join(payload, 'VERSION'), 'utf8').trim(); } catch { return null; }
}

export async function registerFolder(input = {}) {
  const warnings = [];
  if (!input.path || typeof input.path !== 'string') throw bad('bad_input', 'give "path": the project folder');
  const root = path.resolve(input.path);
  if (!fs.existsSync(root)) throw bad('not_found', `project folder does not exist: ${root}`);
  if (!fs.statSync(root).isDirectory()) throw bad('bad_input', `not a folder: ${root}`);
  if (inside(REPO_ROOT, root)) throw bad('bad_input', `${root} is inside perpetual-adaptive-agents itself; register the project you want agents to work on`);
  if (inside(paHome(), root)) throw bad('bad_input', `${root} is inside the central folder ${paHome()}; register a project folder`);
  try { fs.accessSync(root, fs.constants.W_OK); } catch { throw bad('no_access', `cannot write to ${root}`); }

  let { payload, found } = locatePayload(root, input.location);
  if (!found) {
    if (!input.copy) throw bad('payload_missing', `no adaptive-agents folder at ${payload}. Copy perpetual-adaptive-agents/adaptive-agents there first, or send "copy": true to have the service copy it.`, { expected: payload, source: PAYLOAD_SOURCE });
  } else {
    const missing = REQUIRED.filter(r => !fs.existsSync(path.join(payload, r)));
    if (missing.length) throw bad('payload_incomplete', `the adaptive-agents folder at ${payload} is missing ${missing.join(', ')}; copy it again from ${PAYLOAD_SOURCE}`, { missing });
    const pv = payloadVersion(payload);
    if (pv !== VERSION) warnings.push(`the adaptive-agents folder is version ${pv || 'unknown'} and the service is ${VERSION}; copy it again to update the instructions (workspace/ and config.toml are kept)`);
  }

  const detected = detectTools(root);
  const unknown = (input.tools || []).filter(t => !TOOLS[t]);
  if (unknown.length) throw bad('bad_input', `unknown tools ${unknown.join(', ')}; known: ${Object.keys(TOOLS).join(', ')}`);
  const tools = input.tools?.length ? input.tools : detected.in_project;
  const cfg = found ? readConfig(payload) : {};
  const prevJson = found ? readJson(payloadPaths(payload).projectJson, {}) : {};
  const plansFolder = input.plans_folder ?? prevJson.plans_folder ?? 'docs/plans';
  if (path.isAbsolute(plansFolder) || plansFolder.split(/[\\/]/).includes('..')) throw bad('bad_input', 'plans_folder must be a folder inside the project, like docs/plans');
  const files = plannedFiles(root, payload, tools, plansFolder);
  const approve = input.approve_files === 'all' ? files.map(f => f.path) : (Array.isArray(input.approve_files) ? input.approve_files : []);
  const plan = {
    project_root: root, payload, payload_found: found, will_copy_payload: !found,
    existing_id: cfg.project?.id || null, already_registered: !!(cfg.project?.id && registryEntry(cfg.project.id)),
    detected_tools: detected, tools, plans_folder: plansFolder,
    created_inside_payload: ['config.toml', 'workspace/.gitignore', 'workspace/project.json', 'workspace/state.sqlite', 'workspace/agents/', 'workspace/manifest/', 'workspace/runs/'],
    central_folder_entry: null,
    files_outside_payload: files.map(({ content, ...f }) => ({ ...f, approved: approve.includes(f.path) })),
    warnings,
  };
  if (input.dry_run) return { dry_run: true, ...plan, how_to_apply: 'call again without dry_run, with "approve_files": [the paths the user approved] or "all"' };

  const key = crypto.createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 12);
  const result = withLock(`register-${key}`, () => {
    if (!found) copyDir(PAYLOAD_SOURCE, payload, ['workspace', 'config.toml']);
    const pp = payloadPaths(payload);
    for (const d of [pp.workspace, pp.agents, pp.runs, pp.manifest]) ensureDir(d);
    writeFileAtomic(path.join(pp.workspace, '.gitignore'), '# The workspace holds the agents\' live records. They change constant­ly while agents work,\n# so git ignores them. The service reads them from here.\n*\n!.gitignore\n'.replace('­', ''));
    const current = readConfig(payload);
    const id = current.project?.id || `P-${crypto.randomBytes(3).toString('hex')}`;
    const db = openDb(pp.db);
    let project = S.getProject(db, id);
    const name = String(input.name || current.project?.name || path.basename(root)).slice(0, 120);
    if (!project) project = S.createProject(db, { id, name, root, kind: input.kind || current.project?.kind || 'code' });
    else {
      if (!same(project.root, root)) db.prepare('UPDATE projects SET root = ? WHERE id = ?').run(root, id);
      if (input.name && input.name !== project.name) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(input.name, id);
    }
    project = S.getProject(db, id);
    writeConfig(payload, { ...project, test_command: input.test_command ?? current.project?.test_command, main_branch: input.main_branch ?? current.project?.main_branch });
    const pj = updateProjectJson(payload, {
      id, name: project.name, kind: project.kind,
      description: prevJson.description ?? input.description ?? '',
      facts: prevJson.facts ?? {},
      owner: prevJson.owner ?? (input.owner ? { name: String(input.owner) } : null),
      project_managers: prevJson.project_managers ?? [],
      root, payload, plans_folder: plansFolder, tools,
      main_branch: input.main_branch ?? current.project?.main_branch ?? 'main',
      test_command: input.test_command ?? current.project?.test_command ?? '',
      board: { channels: `pa.${id}.>`, board: `pa.${id}.board.*`, control: `pa.${id}.control` },
      service: { repo: REPO_ROOT, home: paHome(), version: VERSION },
    });
    const link = registerProject({ id, name: project.name, root, payload, project_json: pp.projectJson });
    const applied = [], skipped = [];
    for (const f of files) {
      if (f.action === 'unchanged') continue;
      if (f.action.startsWith('skip')) { skipped.push({ path: f.path, reason: f.action }); continue; }
      if (!approve.includes(f.path)) { skipped.push({ path: f.path, reason: 'not approved by the user' }); continue; }
      applyFile(root, f); applied.push({ path: f.path, action: f.action });
    }
    return { id, project, pj, link, applied, skipped };
  });

  // Announce the project on its channels (best effort: without NATS, the database board still works).
  let board = 'not announced: NATS not reachable (the board works through the database)';
  try {
    const { loadSettings } = await import('./config.mjs');
    const { publishBoard } = await import('./nats.mjs');
    const ok = await publishBoard(loadSettings(result.id), result.id, { id: `registered-${result.id}-${Date.now()}`, type: 'note', from_agent: 'service', to_agent: 'all', text: `Project ${result.project.name} registered.`, created_at: new Date().toISOString() });
    if (ok) board = `announced on pa.${result.id}.board.all`;
  } catch (e) { board = `not announced: ${e.message}`; }

  return {
    id: result.id, name: result.project.name, root, payload,
    already_registered: plan.already_registered, copied_payload: !found,
    project_json: payloadPaths(payload).projectJson, config: payloadPaths(payload).settings, database: payloadPaths(payload).db,
    central_folder_entry: path.join(homePaths().projects, result.id, 'link.json'),
    board: { channels: `pa.${result.id}.>`, status: board },
    tools, files_changed: result.applied, files_not_changed: result.skipped, warnings,
    phase: result.project.phase,
  };
}
