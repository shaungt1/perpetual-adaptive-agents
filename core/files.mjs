// Reading a project from its files.
//
// The service's API reads each registered project from the JSON files the project manager
// and the agents write into the project's own adaptive-agents/workspace/ folder. The files
// have fixed names, so any viewer can do the same:
//
//   workspace/project.json                       the project: name, description, owner, project managers
//   workspace/manifest/agent-manifest.json       every agent: number, name, departments, folders
//   workspace/manifest/master-tasks.json         the departments and the master task list (never edited)
//   workspace/agents/<name>/agent.json           one agent's identity
//   workspace/agents/<name>/lists/L<n>.json      each task list the agent was given or wrote (never edited)
//   workspace/agents/<name>/completed/<task>.json one record per finished task
//   workspace/state.json                         metrics, statuses and the message board, rewritten by the service
//
// A task is done when its completion record exists. Lists are never edited after they are
// written, so "done" is worked out here, not stored in the list.

import fs from 'node:fs';
import path from 'node:path';
import { payloadPaths } from './paths.mjs';

function read(file, problems, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') problems.push(`${label}: ${e.message}`); return null; }
}
const ls = (dir, ext = '.json') => { try { return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort(); } catch { return []; } };
const listNo = (f) => Number(f.replace(/^L/, '').replace(/\.json$/, '')) || 0;

export function readProjectFiles(payload) {
  const pp = payloadPaths(payload);
  const problems = [];
  const project = read(pp.projectJson, problems, 'project.json');
  const agentManifest = read(path.join(pp.manifest, 'agent-manifest.json'), problems, 'agent-manifest.json');
  const master = read(path.join(pp.manifest, 'master-tasks.json'), problems, 'master-tasks.json');
  const state = read(pp.snapshot, problems, 'state.json');
  const agents = [];
  let names = [];
  try { names = fs.readdirSync(pp.agents, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch {}
  const doneIds = new Map();
  for (const name of names) {
    const dir = path.join(pp.agents, name);
    const identity = read(path.join(dir, 'agent.json'), problems, `${name}/agent.json`);
    if (!identity) continue;
    const lists = ls(path.join(dir, 'lists')).sort((a, b) => listNo(a) - listNo(b)).map(f => read(path.join(dir, 'lists', f), problems, `${name}/lists/${f}`)).filter(Boolean);
    const completed = ls(path.join(dir, 'completed')).map(f => read(path.join(dir, 'completed', f), problems, `${name}/completed/${f}`)).filter(Boolean)
      .sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)));
    for (const c of completed) doneIds.set(c.task_id, c);
    const live = state?.agents?.find(a => a.id === identity.id) || null;
    const tasks = lists.flatMap(l => l.tasks.map(t => ({ ...t, list_id: l.list_id })));
    const statusOf = (t) => doneIds.has(t.id) ? 'done' : (state?.tasks?.find(x => x.id === t.id)?.status || t.status_at_creation || 'todo');
    agents.push({
      ...identity,
      status: live?.status || identity.status || 'active',
      live: !!live?.live,
      current: live?.current_task || null,
      lists: lists.map(l => ({ ...l, tasks: l.tasks.map(t => ({ ...t, status: statusOf(t), completion: doneIds.get(t.id) || null })) })),
      completed,
      counts: { tasks: tasks.length, done: tasks.filter(t => doneIds.has(t.id)).length, open: tasks.filter(t => !doneIds.has(t.id)).length },
      usage: live?.usage || null,
      points: live?.points ?? completed.reduce((s, c) => s + (c.points || 0), 0),
    });
  }
  agents.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const deptNames = Object.fromEntries((master?.departments || master?.categories || []).map(d => [d.id, d.name]));
  for (const a of agents) a.department_names = (a.categories || []).map(c => deptNames[c] ? `${c} ${deptNames[c]}` : c);
  // Master tasks: done when every task that came from it is done.
  const masterTasks = (master?.master_tasks || []).map(m => {
    const derived = agents.flatMap(a => a.lists.flatMap(l => l.tasks.filter(t => t.master_id === m.id).map(t => ({ agent: a.name, id: t.id, status: t.status }))));
    return { ...m, assigned: derived, status: derived.length && derived.every(d => d.status === 'done') ? 'done' : derived.some(d => d.status === 'done' || d.status === 'in_progress') ? 'in_progress' : derived.length ? 'assigned' : 'not assigned' };
  });
  return {
    read_at: new Date().toISOString(),
    payload,
    project,
    departments: master?.departments || master?.categories || [],
    master_tasks: masterTasks,
    agent_manifest: agentManifest,
    agents,
    metrics: state ? { totals: state.totals, limits: state.limits, categories: state.categories, scoreboard: state.scoreboard, phase: state.project?.phase, generated_at: state.generated_at } : null,
    board: state?.board || [],
    problems,
  };
}
