-- Add the SessionSource column that powers reviewing local branches and
-- GitButler virtual branches in addition to GitHub PRs. The shape lives in
-- `src/shared/source.ts`; here we just persist its canonical JSON.
--
-- For existing rows we synthesize a `github-pr` source from the legacy
-- owner/repo/number triple. `json_object` emits keys in argument order,
-- which matches the order `serializeSource()` writes in TypeScript, so
-- backfilled rows hash identically to a freshly-constructed source.
ALTER TABLE pr_sessions ADD COLUMN source_json TEXT;

UPDATE pr_sessions
   SET source_json = json_object('kind', 'github-pr', 'owner', owner, 'repo', repo, 'number', number)
 WHERE source_json IS NULL;

CREATE INDEX idx_sessions_source ON pr_sessions(source_json);
