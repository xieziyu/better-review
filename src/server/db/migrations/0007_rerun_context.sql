-- Carries the PR head sha each session reviewed against, so reruns can
-- compute `lastReviewedSha..currentHead` even when the prior session never
-- successfully submitted (failed / cancelled runs still count).
ALTER TABLE pr_sessions ADD COLUMN head_sha TEXT;

-- The numeric GitHub review id returned by `POST /pulls/:n/reviews`. We
-- already log `github_url` (a string with `#pullrequestreview-<id>`) but
-- parsing that for the canonical id is brittle.
ALTER TABLE submissions ADD COLUMN github_review_id INTEGER;

-- Maps each inline comment we posted to the originating finding and the
-- GitHub comment id. Used by:
--  - rerun-context.ts to recover "which prior comments were ours" without
--    refetching the whole review payload.
--  - submit-dedup.ts to skip proposed comments that duplicate ones we have
--    already posted in a prior submission for the same PR.
-- Drop-to-body rows are recorded with file/line null so we still have a
-- record (currently unused; reserved for future body-level dedup).
CREATE TABLE submission_comments (
  id                TEXT PRIMARY KEY,
  submission_id     TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  finding_db_id     TEXT,
  github_comment_id INTEGER,
  file              TEXT,
  line              INTEGER,
  start_line        INTEGER,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_submission_comments_submission ON submission_comments(submission_id);
CREATE INDEX idx_submission_comments_finding ON submission_comments(finding_db_id);
