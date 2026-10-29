// How each coding assistant is started headless, and how its output is read.
// A provider adapter returns the command line and a parser for the run's output
// (session id for resuming, tokens in/out, cost). Add a provider by adding one entry.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.mjs';

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Parse the last JSON object printed on stdout (Claude Code --output-format json and the mock).
function lastJson(stdout) {
  const s = stdout.trim();
  try { return JSON.parse(s); } catch {}
  const lines = s.split(/\r?\n/).reverse();
  for (const l of lines) { try { const o = JSON.parse(l); if (o && typeof o === 'object') return o; } catch {} }
  return null;
}

export const PROVIDERS = {
  claude: {
    build({ settings, prompt, sessionId, addDirs, model }) {
      const p = settings.providers.claude;
      const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', p.permission_mode || 'acceptEdits'];
      if (p.allowed_tools?.length) args.push('--allowedTools', ...p.allowed_tools);
      for (const d of addDirs) args.push('--add-dir', d);
      if (model || p.model) args.push('--model', model || p.model);
      if (sessionId) args.push('--resume', sessionId);
      return { cmd: p.command || 'claude', args };
    },
    parse(stdout) {
      const o = lastJson(stdout);
      if (!o) return {};
      const u = o.usage || {};
      return {
        session_id: o.session_id || null,
        tokens_in: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
        tokens_out: num(u.output_tokens),
        cost_usd: num(o.total_cost_usd ?? o.cost_usd),
        error: o.is_error ? (o.result || 'error') : null,
      };
    },
  },

  codex: {
    build({ settings, prompt, sessionId, addDirs, model }) {
      const p = settings.providers.codex;
      const args = ['exec', '--json', '--sandbox', p.sandbox || 'workspace-write', '--skip-git-repo-check'];
      for (const d of addDirs) args.push('--add-dir', d);
      if (model || p.model) args.push('--model', model || p.model);
      if (sessionId) args.push('resume', sessionId);
      args.push(prompt);
      return { cmd: p.command || 'codex', args };
    },
    parse(stdout) {
      const out = { tokens_in: 0, tokens_out: 0, cost_usd: 0, session_id: null };
      for (const line of stdout.split(/\r?\n/)) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'thread.started' && e.thread_id) out.session_id = e.thread_id;
        if (e.type === 'turn.completed' && e.usage) {
          out.tokens_in += num(e.usage.input_tokens);
          out.tokens_out += num(e.usage.output_tokens);
        }
      }
      return out;
    },
  },

  copilot: {
    build({ settings, prompt, addDirs, model }) {
      const p = settings.providers.copilot;
      const args = ['-p', prompt];
      if (p.allow_all_tools !== false) args.push('--allow-all-tools');
      for (const d of addDirs) args.push('--add-dir', d);
      if (model || p.model) args.push('--model', model || p.model);
      return { cmd: p.command || 'copilot', args };
    },
    parse() { return {}; }, // the Copilot CLI prints no machine-readable usage; time is still recorded
  },

  // Deterministic stand-in used by the tests. It behaves like a worker by calling the pa CLI.
  mock: {
    build({ settings }) {
      const p = settings.providers.mock || {};
      const script = path.isAbsolute(p.script || '') ? p.script : path.join(REPO_ROOT, p.script || 'tests/e2e/mock-agent.mjs');
      return { cmd: process.execPath, args: [script] };
    },
    parse: (stdout) => PROVIDERS.claude.parse(stdout),
  },
};

// Only letters, digits and a few punctuation marks reach the command line. The real
// instructions are in files the agent reads, so nothing important is lost, and no
// shell (cmd.exe on Windows) can misread the prompt.
export function safePrompt(s) {
  return String(s).replace(/[^A-Za-z0-9 .,:_\-()/]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Windows: npm-installed CLIs are .cmd shims that must run through cmd.exe.
export function resolveCommand(cmd, env = process.env) {
  if (process.platform !== 'win32' || path.isAbsolute(cmd)) return { file: cmd, viaCmd: /\.(cmd|bat)$/i.test(cmd) };
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.toLowerCase());
  for (const dir of (env.PATH || env.Path || '').split(';')) {
    if (!dir) continue;
    // A command given with its extension ("codex.cmd") is looked up as is; otherwise each PATHEXT extension is tried.
    const hasExt = /\.[a-z0-9]+$/i.test(cmd);
    for (const ext of hasExt ? [''] : exts) {
      const f = path.join(dir, cmd + ext);
      if (fs.existsSync(f)) return { file: f, viaCmd: /\.(cmd|bat)$/i.test(f) };
    }
  }
  return { file: cmd, viaCmd: false };
}

export function spawnSpec(cmd, args, env) {
  const r = resolveCommand(cmd, env);
  if (!r.viaCmd) return { file: r.file, args, options: {} };
  // cmd.exe expands %NAME% even inside quotes, and there is no reliable escape on a
  // command line, so arguments containing % are refused rather than silently changed.
  const bad = [r.file, ...args].find(a => String(a).includes('%'));
  if (bad) throw new Error(`cannot pass an argument containing % through cmd.exe: ${bad}`);
  const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
  const line = [q(r.file), ...args.map(q)].join(' ');
  return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}
