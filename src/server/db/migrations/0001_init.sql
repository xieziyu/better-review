CREATE TABLE pr_sessions (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  repo        TEXT NOT NULL,
  number      INTEGER NOT NULL,
  title       TEXT,
  author      TEXT,
  url         TEXT,
  base_ref    TEXT,
  head_ref    TEXT,
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  workdir     TEXT NOT NULL,
  prompt_used TEXT NOT NULL,
  error       TEXT
);
CREATE INDEX idx_sessions_status ON pr_sessions(status);
CREATE INDEX idx_sessions_pr ON pr_sessions(owner, repo, number);

CREATE TABLE findings (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pr_sessions(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL,
  severity     TEXT NOT NULL,
  category     TEXT NOT NULL,
  file         TEXT,
  line         INTEGER,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  suggestion   TEXT,
  selected     INTEGER NOT NULL DEFAULT 1,
  edited       INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_findings_session_active ON findings(session_id, archived);

CREATE TABLE submissions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pr_sessions(id),
  event        TEXT NOT NULL,
  github_url   TEXT,
  payload_json TEXT NOT NULL,
  finding_ids  TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  error        TEXT
);
