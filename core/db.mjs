// SQLite access through Node's built-in driver (node:sqlite, Node 22.13+).
// No ORM: the schema is small, the queries are plain SQL in store.mjs, and the
// built-in driver needs no native compilation on Windows.
//
// Concurrency: many short-lived CLI processes (one per agent command) share one
// database file. WAL journal mode lets readers run while one writer writes;
// busy_timeout makes a writer wait instead of failing; BEGIN IMMEDIATE takes the
// write lock up front so claim-style "check then write" steps are atomic.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ensureDir, REPO_ROOT, projectPaths } from './paths.mjs';

// node:sqlite prints an "experimental" warning on some Node versions; silence only that one.
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === 'string' ? w : w?.message;
  if (msg && /SQLite is an experimental feature/i.test(msg)) return;
  return origEmit.call(process, w, ...rest);
};
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const cache = new Map();

// Each project has its own database file inside its payload folder (workspace/state.sqlite).
export function openProjectDb(projectId) {
  return openDb(projectPaths(projectId).db);
}

export function openDb(file) {
  if (!file) throw new Error('openDb needs a database file path');
  // A long-running process (the service) keeps databases open. If the file was deleted or
  // replaced since (for example, a project's workspace folder was removed and the project
  // registered again), the open handle points at the old file: drop it and open the new one.
  if (cache.has(file)) {
    const c = cache.get(file);
    let ino = null; try { ino = fs.statSync(file).ino; } catch {}
    if (ino !== null && ino === c.__ino) return c;
    try { c.close(); } catch {}
    cache.delete(file);
  }
  ensureDir(path.dirname(file));
  // busy_timeout must be in force before anything else touches the file, or a process
  // that opens the database while another is checkpointing fails at once.
  let db;
  for (let attempt = 0; ; attempt++) {
    try {
      db = new DatabaseSync(file, { timeout: 10000 });
      db.exec('PRAGMA busy_timeout = 10000;');
      db.exec('PRAGMA journal_mode = WAL;');
      break;
    } catch (e) {
      try { db?.close(); } catch {}
      if (attempt < 20 && /busy|locked/i.test(String(e.message))) { sleepMs(50 + Math.random() * 100); continue; }
      throw e;
    }
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  migrate(db);
  try { db.__ino = fs.statSync(file).ino; } catch {}
  cache.set(file, db);
  return db;
}

export function closeAll() {
  for (const db of cache.values()) { try { db.close(); } catch {} }
  cache.clear();
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(REPO_ROOT, 'core', 'migrations');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    tx(db, () => {
      // Checked inside the write transaction, so two processes never apply the same migration.
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(f)) return;
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
    });
  }
}

// Run fn inside BEGIN IMMEDIATE ... COMMIT. Retries a few times if the lock is busy
// beyond busy_timeout (rare, but possible with many agents).
export function tx(db, fn) {
  if (db.__txDepth > 0) {            // already inside a transaction: join it
    db.__txDepth++;
    try { return fn(); } finally { db.__txDepth--; }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      if (attempt < 20 && /busy|locked/i.test(String(e.message))) { sleepMs(50 + Math.random() * 100); continue; }
      throw e;
    }
    db.__txDepth = 1;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    } finally {
      db.__txDepth = 0;
    }
  }
}

export const now = () => new Date().toISOString();
