// The full state of one project as one JSON object. The runner writes it to
// <payload>/workspace/state.json on every tick; the dashboard serves the same object.

import path from 'node:path';
import fs from 'node:fs';
import * as S from './store.mjs';
import { writeJson, projectPaths, homePaths } from './paths.mjs';

export function buildState(db, projectId, settings) {
  const project = S.requireProject(db, projectId);
  const vision = S.getVision(db, projectId);
  const agents = S.agentStats(db, projectId, settings.runner.presence_ttl_seconds);
  const totals = agents.reduce((t, a) => {
    t.tasks_done += a.tasks.done; t.tasks_total += a.tasks.total; t.points += a.points;
    t.tokens_in += a.usage.tokens_in; t.tokens_out += a.usage.tokens_out; t.cost_usd += a.usage.cost_usd;
    t.seconds += a.usage.seconds; t.runs += a.usage.runs; t.live += a.live ? 1 : 0; t.stuck += a.status === 'stuck' ? 1 : 0;
    return t;
  }, { tasks_done: 0, tasks_total: 0, points: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, seconds: 0, runs: 0, live: 0, stuck: 0 });
  totals.cost_usd = Number(totals.cost_usd.toFixed(4));
  const runs = db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 200').all(projectId).reverse();
  return {
    generated_at: new Date().toISOString(),
    project,
    payload: projectPaths(projectId).payload,
    stop_requested: fs.existsSync(projectPaths(projectId).stop) || fs.existsSync(homePaths().stop),
    vision: vision.length ? { version: vision.at(-1).version, text: vision.at(-1).text, versions: vision.length } : null,
    documents: S.listDocuments(db, projectId),
    categories: S.categoryProgress(db, projectId),
    agents,
    totals,
    limits: { daily_usd: settings.limits.daily_usd, spent_today_usd: Number(S.spendToday(db, projectId).toFixed(4)), max_active: settings.agents.max_active, hard_max: settings.agents.hard_max, max_concurrent: settings.agents.max_concurrent },
    scoreboard: S.scoreboard(db, projectId),
    tasks: S.listTasks(db, projectId),
    claims: S.activeClaims(db, projectId),
    board: S.recentMessages(db, projectId, 150),
    unanswered: S.unansweredQuestions(db, projectId),
    resets: S.openResets(db, projectId),
    runs,
  };
}

// The snapshot is written into the project's payload folder (workspace/state.json), so
// anything that can read the folder can read the full state without the database.
export function writeProjectSnapshot(db, projectId, settings) {
  const state = buildState(db, projectId, settings);
  writeJson(projectPaths(projectId).snapshot, state);
  return state;
}
