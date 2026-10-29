// Settings: pa.default.toml (repo) -> <PA_HOME>/pa.toml (device) -> the project's payload config.toml.
// Later files override earlier ones key by key. Caps are enforced here so that no
// file can raise the agent count above agents.hard_max (which itself cannot exceed 10).

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { REPO_ROOT, homePaths, projectPaths } from './paths.mjs';

export const ABSOLUTE_AGENT_CEILING = 10;

function readToml(file) {
  if (!fs.existsSync(file)) return {};
  return parse(fs.readFileSync(file, 'utf8'));
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

export function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = isObj(v) && isObj(a?.[k]) ? deepMerge(a[k], v) : v;
  }
  return out;
}

export function loadSettings(projectId = null) {
  let s = readToml(path.join(REPO_ROOT, 'pa.default.toml'));
  s = deepMerge(s, readToml(homePaths().settings));
  if (projectId) {
    let file = null;
    try { file = projectPaths(projectId).settings; } catch {}
    if (file) s = deepMerge(s, readToml(file));
  }
  return clamp(s);
}

export function clamp(s) {
  const a = s.agents || (s.agents = {});
  a.hard_max = Math.min(Number(a.hard_max ?? ABSOLUTE_AGENT_CEILING), ABSOLUTE_AGENT_CEILING);
  a.max_active = Math.max(1, Math.min(Number(a.max_active ?? 8), a.hard_max));
  a.max_concurrent = Math.max(1, Math.min(Number(a.max_concurrent ?? 3), a.max_active));
  const t = s.tasks || (s.tasks = {});
  t.max_attempts_hard = Math.max(1, Math.min(Number(t.max_attempts_hard ?? 5), 5));
  t.max_attempts = Math.max(1, Math.min(Number(t.max_attempts ?? 3), t.max_attempts_hard));
  return s;
}
