-- Review-summary tab: the agent writes a `summary.json` (overview prose +
-- manual-review notes) that lands here as JSON; `excluded_files_json` records
-- the files dropped from the agent diff by the skip-review globs at prep time.
ALTER TABLE pr_sessions ADD COLUMN summary_json TEXT;
ALTER TABLE pr_sessions ADD COLUMN excluded_files_json TEXT;
