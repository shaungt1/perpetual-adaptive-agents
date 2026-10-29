-- Perpetual Adaptive Agents: initial schema.
-- SQLite is the authoritative record. NATS carries the live feed; if NATS is down,
-- nothing is lost, because every board message is written here first.

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,               -- P-xxxxxx
  name        TEXT NOT NULL,
  root        TEXT NOT NULL,                  -- absolute path of the project folder
  kind        TEXT NOT NULL DEFAULT 'code',   -- code | writing | finance | content | other
  phase       TEXT NOT NULL DEFAULT 'planning'
              CHECK (phase IN ('planning','awaiting_approval','running','paused','stopped')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The owner's vision, verbatim. Append-only: a changed vision is a new row.
CREATE TABLE IF NOT EXISTS vision (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  version     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project_id, version)
);
CREATE TRIGGER IF NOT EXISTS vision_no_update BEFORE UPDATE ON vision
BEGIN SELECT RAISE(ABORT, 'vision is immutable; append a new version instead'); END;
CREATE TRIGGER IF NOT EXISTS vision_no_delete BEFORE DELETE ON vision
BEGIN SELECT RAISE(ABORT, 'vision is immutable'); END;

-- Resources gathered at planning: folders, links, expectations, access needs.
-- Secrets are never stored: a key is recorded only as the NAME of an environment
-- variable or a path to a file on the owner's machine (value_ref).
CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  kind        TEXT NOT NULL CHECK (kind IN ('folder','link','key_ref','access','expectation','constraint','tool')),
  name        TEXT NOT NULL,
  value_ref   TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The planning documents and their visible status.
CREATE TABLE IF NOT EXISTS documents (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  key         TEXT NOT NULL,                  -- e.g. 01-vision
  title       TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'made' CHECK (status IN ('made','checked','approved')),
  sha256      TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS categories (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  id          TEXT NOT NULL,                  -- C1, C2 ...
  name        TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (project_id, id)
);

-- The master task list. Immutable once imported.
CREATE TABLE IF NOT EXISTS master_tasks (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  id          TEXT NOT NULL,                  -- T-001
  category_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  detail      TEXT,
  acceptance  TEXT,
  source      TEXT,                           -- vision line, gap finding, owner request
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, id)
);
CREATE TRIGGER IF NOT EXISTS master_no_update BEFORE UPDATE ON master_tasks
BEGIN SELECT RAISE(ABORT, 'master task list is immutable'); END;
CREATE TRIGGER IF NOT EXISTS master_no_delete BEFORE DELETE ON master_tasks
BEGIN SELECT RAISE(ABORT, 'master task list is immutable'); END;

CREATE TABLE IF NOT EXISTS agents (
  project_id    TEXT NOT NULL REFERENCES projects(id),
  id            TEXT NOT NULL,                -- A01 (the supervisor is A00)
  name          TEXT NOT NULL,                -- pilot call sign, e.g. Iceman-X1
  role          TEXT NOT NULL CHECK (role IN ('supervisor','worker')),
  categories    TEXT NOT NULL DEFAULT '[]',   -- JSON array of category ids (the lane)
  lane          TEXT,                         -- one-sentence lane description
  persona       TEXT,
  provider      TEXT NOT NULL,
  model         TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','idle','stuck','stopped','retired')),
  session_id    TEXT,
  folder        TEXT,
  stuck_runs    INTEGER NOT NULL DEFAULT 0,
  retire_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  retired_at    TEXT,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, name)
);

-- Instruction-set manifest: which instruction files exist, per category.
CREATE TABLE IF NOT EXISTS instruction_sets (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  id          TEXT NOT NULL,                  -- IS-01
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  path        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

-- Task lists. A list is immutable once created; new work becomes a new list.
CREATE TABLE IF NOT EXISTS lists (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  id          TEXT NOT NULL,                  -- A01-L1
  agent_id    TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  created_by  TEXT NOT NULL,                  -- supervisor | agent id | owner
  file        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE IF NOT EXISTS tasks (
  project_id     TEXT NOT NULL REFERENCES projects(id),
  id             TEXT NOT NULL,               -- A01-L1-3
  list_id        TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  master_id      TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('critical','owner_request','bug','optimization','feature','research','planning')),
  title          TEXT NOT NULL,
  detail         TEXT,
  acceptance     TEXT,
  complexity     INTEGER NOT NULL DEFAULT 2 CHECK (complexity BETWEEN 1 AND 5),
  status         TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','in_progress','paused','waiting_user','done','blocked','proposed','declined','cancelled')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  files          TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at     TEXT,
  done_at        TEXT,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS tasks_by_agent ON tasks(project_id, agent_id, status);
-- The assigned content of a task never changes; only its progress fields do.
CREATE TRIGGER IF NOT EXISTS task_content_immutable
BEFORE UPDATE OF list_id, agent_id, seq, master_id, kind, title, detail, acceptance ON tasks
BEGIN SELECT RAISE(ABORT, 'assigned task content is immutable; create a new list instead'); END;

CREATE TABLE IF NOT EXISTS task_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL,                  -- start | step | done | fail | blocked | approve | decline | unblock
  text        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Completion records: separate from the assigned list (assigned vs completed).
CREATE TABLE IF NOT EXISTS completions (
  project_id  TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  summary     TEXT NOT NULL,
  files       TEXT NOT NULL DEFAULT '[]',
  tests       TEXT,
  points      INTEGER NOT NULL,
  record_path TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, task_id)
);

-- File claims: "I am working on these files". One holder per path.
CREATE TABLE IF NOT EXISTS claims (
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);

-- The board.
CREATE TABLE IF NOT EXISTS messages (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,           -- uuid, also the NATS de-duplication id
  project_id  TEXT NOT NULL,
  from_agent  TEXT NOT NULL,
  to_agent    TEXT NOT NULL DEFAULT 'all',    -- all | supervisor | owner | <agent id or name>
  type        TEXT NOT NULL,
  text        TEXT NOT NULL,
  task_id     TEXT,
  files       TEXT NOT NULL DEFAULT '[]',
  reply_to    TEXT,
  needs_reply INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS messages_by_project ON messages(project_id, seq);

CREATE TABLE IF NOT EXISTS read_cursors (
  project_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  last_seq    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, agent_id)
);

CREATE TABLE IF NOT EXISTS resets (
  id           TEXT PRIMARY KEY,              -- R-xxxxxx
  project_id   TEXT NOT NULL,
  started_by   TEXT NOT NULL,
  reason       TEXT,
  expected     TEXT NOT NULL,                 -- JSON array of agent ids that must check in
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS reset_checkins (
  reset_id    TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  note        TEXT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (reset_id, agent_id)
);

-- Every session run the runner starts.
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  provider    TEXT NOT NULL,
  reason      TEXT,
  pid         INTEGER,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT,
  exit_code   INTEGER,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  session_id  TEXT,
  progressed  INTEGER NOT NULL DEFAULT 0,
  log_path    TEXT
);

CREATE TABLE IF NOT EXISTS presence (
  project_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_id)
);

CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT,
  agent_id    TEXT,
  backend     TEXT NOT NULL,
  request     TEXT NOT NULL,
  response    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
