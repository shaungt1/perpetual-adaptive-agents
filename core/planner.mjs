// Turning a plan into a running workforce.
//
// The Supervisor (the owner's main chat, following SUPERVISOR.md in the payload folder)
// writes plan.json. `pa plan import plan.json` then does the mechanical part here:
// validates the plan, stores the departments and the immutable master task list, names
// the agents, creates each agent's folder in workspace/agents/ from the agent template,
// creates every agent's first task list (with the planning task appended last), and writes
// the manifests the agents and the dashboard read.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectPaths, agentDir, ensureDir, writeJson, writeFileAtomic, readJson } from './paths.mjs';
import { tx } from './db.mjs';
import * as S from './store.mjs';

// Agent names: a memorable name plus the agent's number (Zorro-01, Kafka-02, ...).
export const CALL_SIGNS = ['Zorro', 'Kafka', 'Nova', 'Ronin', 'Banshee', 'Tesla', 'Juno', 'Maverick', 'Rumi', 'Valkyrie',
  'Orwell', 'Phoenix', 'Mamba', 'Sphinx', 'Hopper', 'Atlas', 'Kitsune', 'Lovelace', 'Odin', 'Echo'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The instructions an agent follows live in the project's own payload folder.
export function instructionsRoot(projectId) {
  return projectPaths(projectId).payload;
}

export function render(template, params) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (params[k] ?? `{{${k}}}`));
}

export const NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;
export const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/;
export const PROVIDER_NAMES = ['claude', 'codex', 'copilot', 'mock'];

// Names become folder names and window titles, and models and providers reach command
// lines, so all three are restricted to safe characters.
export function agentSpecErrors(spec, label) {
  const e = [];
  if (spec.name != null && !NAME_RE.test(spec.name)) e.push(`${label}: name "${spec.name}" must be letters, digits and dashes (up to 32), starting with a letter`);
  if (spec.model && !MODEL_RE.test(spec.model)) e.push(`${label}: model "${spec.model}" contains characters that are not allowed`);
  if (spec.provider && !PROVIDER_NAMES.includes(spec.provider)) e.push(`${label}: provider "${spec.provider}" is not one of ${PROVIDER_NAMES.join(', ')}`);
  return e;
}

export function validatePlan(plan, settings) {
  const errors = [];
  plan.categories = plan.categories || plan.departments;
  const cats = new Set();
  for (const c of plan.categories || []) {
    if (!c.id || !c.name) errors.push('every department needs an id and a name');
    // Each agent re-plans only inside its department, so a department must say exactly what it covers.
    for (const [k, what] of [['scope', 'what the department is responsible for'], ['owns', 'the files and folders it owns (a list)'], ['out_of_scope', 'what it must not touch or do'], ['done_definition', 'what "done" means for its work']]) {
      const v = c[k];
      if (k === 'owns' ? !(Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && x.trim())) : !(typeof v === 'string' && v.trim().length >= 10))
        errors.push(`department ${c.id || '?'} needs "${k}": ${what}`);
    }
    if (cats.has(c.id)) errors.push(`duplicate category ${c.id}`);
    cats.add(c.id);
  }
  if (!cats.size) errors.push('the plan needs at least one department');
  const masters = new Map();
  for (const t of plan.master_tasks || []) {
    if (!t.id || !t.title) errors.push('every master task needs an id and a title');
    if (masters.has(t.id)) errors.push(`duplicate master task ${t.id}`);
    if (!cats.has(t.category)) errors.push(`master task ${t.id} has unknown department ${t.category}`);
    if (!S.KINDS.includes(t.kind) || t.kind === 'planning') errors.push(`master task ${t.id} has invalid kind ${t.kind}`);
    masters.set(t.id, t);
  }
  const agents = plan.agents || [];
  if (!agents.length) errors.push('the plan needs at least one agent');
  if (agents.length > settings.agents.max_active)
    errors.push(`the plan has ${agents.length} agents but agents.max_active is ${settings.agents.max_active} (hard maximum ${settings.agents.hard_max})`);
  const assigned = new Map();
  plan.supervisor = plan.supervisor || plan.planner;
  if (plan.supervisor) errors.push(...agentSpecErrors(plan.supervisor, 'supervisor'));
  agents.forEach((a, i) => {
    errors.push(...agentSpecErrors(a, `agent #${i + 1}`));
    a.categories = a.categories || a.departments;
    if (!a.categories?.length) errors.push(`agent #${i + 1} needs at least one department`);
    for (const c of a.categories || []) if (!cats.has(c)) errors.push(`agent #${i + 1} has unknown department ${c}`);
    for (const t of a.tasks || []) {
      if (!masters.has(t)) errors.push(`agent #${i + 1} lists unknown master task ${t}`);
      if (assigned.has(t)) errors.push(`master task ${t} is assigned to two agents`);
      assigned.set(t, i);
    }
  });
  const unassigned = [...masters.keys()].filter(t => !assigned.has(t));
  return { ok: errors.length === 0, errors, warnings: unassigned.length ? [`unassigned master tasks: ${unassigned.join(', ')}`] : [] };
}

// The full definition of each of an agent's departments, from the master task file.
function departmentText(projectId, ids) {
  const master = readJson(path.join(projectPaths(projectId).manifest, 'master-tasks.json'), {});
  const deps = (master.departments || master.categories || []).filter(d => ids.includes(d.id));
  if (!deps.length) return '';
  return deps.map(d => `**Department ${d.id}: ${d.name}**\n- Scope: ${d.scope || d.description || ''}\n- Owns: ${(d.owns || []).map(o => `\`${o}\``).join(', ')}\n- Out of scope: ${d.out_of_scope || ''}\n- Done means: ${d.done_definition || ''}`).join('\n\n');
}

function agentParams(project, agent, settings, extra = {}) {
  const pp = projectPaths(project.id);
  return {
    project_id: project.id, project_name: project.name, project_root: project.root, project_kind: project.kind,
    agent_id: agent.id, agent_name: agent.name, role: agent.role,
    categories: (agent.categories || []).join(', '), lane: agent.lane || '', persona: agent.persona || 'A careful senior specialist in this lane.',
    agent_folder: agent.folder, payload_folder: pp.payload, manifest_folder: pp.manifest, docs_folder: pp.manifest,
    plans_folder: path.join(project.root, readJson(pp.projectJson, {}).plans_folder || 'docs/plans'), inbox_file: pp.inbox,
    department_definitions: departmentText(project.id, agent.categories || []),
    resources: (agent.resources || []).map(r => `- ${r}`).join('\n') || '- (none listed; use the project and the manifest folder)',
    instructions_root: instructionsRoot(project.id), max_attempts: settings.tasks.max_attempts, max_attempts_hard: settings.tasks.max_attempts_hard,
    main_branch: settings.project?.main_branch || 'main', test_command: settings.project?.test_command || '(see the project README)',
    points_task: settings.tasks.points_task, points_planning: settings.tasks.points_planning,
    agent_writable: (settings.docs.agent_writable || []).join(', '),
    ...extra,
  };
}

// Create one agent: database row, folder, rendered instructions, identity file.
export function createAgent(db, project, spec, settings, { role = 'worker', index } = {}) {
  const bad = agentSpecErrors({ ...spec, provider: spec.provider || settings.agents.default_provider }, 'agent');
  if (bad.length) throw new S.PaError('bad_input', bad.join('; '));
  const existing = S.listAgents(db, project.id);
  const workers = existing.filter(a => a.role === 'worker' && a.status !== 'retired');
  if (role === 'worker' && workers.length >= settings.agents.max_active)
    throw new S.PaError('cap', `agent cap reached: ${workers.length} active workers, agents.max_active = ${settings.agents.max_active}`);
  const n = index ?? (role === 'supervisor' && !existing.some(a => a.role === 'supervisor') ? 0 : Math.max(0, ...existing.map(a => Number(a.id.slice(1)))) + 1);
  const id = `A${String(n).padStart(2, '0')}`;
  const used = new Set(existing.map(a => a.name));
  let name = spec.name;
  if (!name) {
    name = role === 'supervisor' ? 'Supervisor-00' : `${CALL_SIGNS[(n - 1) % CALL_SIGNS.length]}-${String(n).padStart(2, '0')}`;
    while (used.has(name)) name += 'b';
  }
  const agent = {
    id, name, role, categories: spec.categories || [], lane: spec.lane || null, persona: spec.persona || null,
    provider: spec.provider || settings.agents.default_provider, model: spec.model || null,
    resources: spec.resources || [],
  };
  agent.folder = agentDir(project.id, agent);
  S.insertAgent(db, project.id, agent);
  ensureDir(path.join(agent.folder, 'lists'));
  ensureDir(path.join(agent.folder, 'completed'));
  const tpl = fs.readFileSync(path.join(instructionsRoot(project.id), 'templates', role === 'supervisor' ? 'supervisor-run.md' : 'agent.md'), 'utf8');
  const text = render(tpl, agentParams(project, agent, settings));
  writeFileAtomic(path.join(agent.folder, 'INSTRUCTIONS.md'), text);
  writeJson(path.join(agent.folder, 'agent.json'), { ...agent, project_id: project.id, created_at: new Date().toISOString() });
  if (!fs.existsSync(path.join(agent.folder, 'notes.md')))
    writeFileAtomic(path.join(agent.folder, 'notes.md'), `# Working notes for ${name}\n\nThe agent keeps its own notes here between runs.\n`);
  const isId = `IS-${id.slice(1)}`;
  db.prepare(`INSERT OR REPLACE INTO instruction_sets (project_id, id, name, category, path, sha256) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(project.id, isId, `${name} instructions`, role === 'supervisor' ? 'supervision' : agent.categories.join(','), path.join(agent.folder, 'INSTRUCTIONS.md'), sha(text));
  return S.getAgent(db, project.id, id);
}

// Write a list to the agent's folder as JSON (the assigned record).
export function writeListFile(db, project, agent, listId) {
  const tasks = S.listTasks(db, project.id, { agentId: agent.id }).filter(t => t.list_id === listId)
    .map(({ id, seq, master_id, kind, title, detail, acceptance, complexity, status }) => ({ id, seq, master_id, kind, title, detail, acceptance, complexity, status_at_creation: status }));
  const file = path.join(agent.folder, 'lists', `${listId.split('-').pop()}.json`);
  writeJson(file, { list_id: listId, agent_id: agent.id, agent_name: agent.name, project_id: project.id, immutable: true, created_at: new Date().toISOString(), tasks });
  return file;
}

export function writeManifests(db, project) {
  const pp = projectPaths(project.id);
  const depts = Object.fromEntries(db.prepare('SELECT * FROM categories WHERE project_id = ?').all(project.id).map(c => [c.id, c.name]));
  const agents = S.listAgents(db, project.id).map(a => {
    const info = (() => { try { return JSON.parse(fs.readFileSync(path.join(a.folder, 'agent.json'), 'utf8')); } catch { return {}; } })();
    return {
      number: Number(a.id.slice(1)), id: a.id, name: a.name, role: a.role,
      departments: a.categories.map(c => ({ id: c, name: depts[c] || c })), lane: a.lane, persona: a.persona,
      provider: a.provider, model: a.model, status: a.status, session_id: a.session_id,
      folder: a.folder,
      instructions: path.join(a.folder, 'INSTRUCTIONS.md'),
      task_lists_folder: path.join(a.folder, 'lists'),
      completed_folder: path.join(a.folder, 'completed'),
      notes: path.join(a.folder, 'notes.md'),
      resources: info.resources || [],
    };
  });
  writeJson(path.join(pp.manifest, 'agent-manifest.json'), {
    project_id: project.id, project_name: project.name, project_root: project.root, payload: pp.payload,
    generated_at: new Date().toISOString(),
    how_to_use: 'Find your entry by number or name. Read your instructions file first; it points to your rules, your task lists and your resources. Stay in your department.',
    agents,
  });
  const sets = db.prepare('SELECT * FROM instruction_sets WHERE project_id = ? ORDER BY id').all(project.id);
  writeJson(path.join(pp.manifest, 'instruction-manifest.json'), { project_id: project.id, generated_at: new Date().toISOString(), instruction_sets: sets });
}

export function importPlan(db, project, plan, settings) {
  const v = validatePlan(plan, settings);
  if (!v.ok) throw new S.PaError('invalid_plan', 'plan is invalid', { errors: v.errors });
  if (db.prepare('SELECT 1 FROM master_tasks WHERE project_id = ? LIMIT 1').get(project.id))
    throw new S.PaError('already_imported', 'this project already has a master task list (it is immutable). Add agents with `pa agent add` and new work with `pa list new`.');
  const pp = projectPaths(project.id);
  ensureDir(pp.manifest);
  // Written first: each agent's instructions include its departments' definitions from this file.
  const masterFile = path.join(pp.manifest, 'master-tasks.json');
  writeJson(masterFile, { project_id: project.id, immutable: true, created_at: new Date().toISOString(), departments: plan.categories, master_tasks: plan.master_tasks });
  let created;
  try { created = tx(db, () => {
    const insC = db.prepare('INSERT INTO categories (project_id, id, name, description) VALUES (?, ?, ?, ?)');
    for (const c of plan.categories) insC.run(project.id, c.id, c.name, c.scope ?? c.description ?? null);
    const insT = db.prepare('INSERT INTO master_tasks (project_id, id, category_id, kind, title, detail, acceptance, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of plan.master_tasks) insT.run(project.id, t.id, t.category, t.kind, t.title, t.detail ?? null, t.acceptance ?? null, t.source ?? null);
    if (!S.listAgents(db, project.id).some(a => a.role === 'supervisor'))
      createAgent(db, project, { provider: plan.supervisor?.provider, model: plan.supervisor?.model, lane: 'Project manager: planning, supervision, the only one who talks to the user' }, settings, { role: 'supervisor' });
    const masters = new Map(plan.master_tasks.map(t => [t.id, t]));
    const out = [];
    for (const spec of plan.agents) {
      const agent = createAgent(db, project, spec, settings);
      const tasks = (spec.tasks || []).map(id => ({ ...masters.get(id), master_id: id }));
      const list = S.createList(db, project.id, agent.id, tasks, { createdBy: 'supervisor' });
      out.push({ agent, list });
    }
    for (const d of plan.documents || []) S.upsertDocument(db, project.id, d);
    return out;
  }); } catch (e) { fs.rmSync(masterFile, { force: true }); throw e; }
  for (const { agent, list } of created) {
    const file = writeListFile(db, project, agent, list.listId);
    db.prepare('UPDATE lists SET file = ? WHERE project_id = ? AND id = ?').run(file, project.id, list.listId);
  }
  writeManifests(db, project);
  for (const [key, title, file] of [
    ['master-tasks', 'Master task list (immutable)', 'master-tasks.json'],
    ['agent-manifest', 'Agent manifest', 'agent-manifest.json'],
    ['instruction-manifest', 'Instruction-set manifest', 'instruction-manifest.json'],
  ]) {
    const p = path.join(pp.manifest, file);
    S.upsertDocument(db, project.id, { key, title, path: p, status: 'made', content: fs.readFileSync(p, 'utf8') });
  }
  if (project.phase === 'planning') S.setPhase(db, project.id, 'awaiting_approval');
  return { agents: created.map(c => ({ id: c.agent.id, name: c.agent.name, list: c.list.listId, tasks: c.list.tasks.length })), warnings: v.warnings };
}
