#!/usr/bin/env bash
# Fake codex CLI for tests.
# Mirrors the production wiring: subcommand `exec`, prompt fed via stdin.
# Reads FINDINGS_PATH from the prompt and writes FAKE_CODEX_BODY (or a default)
# to it. Emits a few plain-text stdout lines so the runner's stall watchdog
# sees heartbeat events.

# Diagnostic probe used by tests that need to assert spawn cwd + argv. Tests
# opt in by setting BETTER_REVIEW_SPAWN_PROBE to a path; the shim writes the
# cwd on the first line and then the full argv (one arg per line) there
# before doing anything else.
if [[ -n "$BETTER_REVIEW_SPAWN_PROBE" ]]; then
  {
    pwd
    for arg in "$@"; do
      printf '%s\n' "$arg"
    done
  } > "$BETTER_REVIEW_SPAWN_PROBE"
fi

# Optional env probe so tests can assert env vars propagated through spawn.
# Kept separate from the argv probe so existing argv parsing still works.
if [[ -n "$BETTER_REVIEW_SPAWN_ENV_PROBE" ]]; then
  printf 'CODEX_HOME=%s\n' "${CODEX_HOME:-}" > "$BETTER_REVIEW_SPAWN_ENV_PROBE"
fi

# Skip the leading `exec` subcommand and any flags so we behave like the real
# CLI when invoked as `codex exec --sandbox … -`.
case "$1" in
  exec) shift ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sandbox|--approval-policy|--color|--config|-c|--model|-C|--add-dir)
      shift 2 ;;
    --skip-git-repo-check|-)
      shift ;;
    *)
      shift ;;
  esac
done

PROMPT=$(cat)

FINDINGS_PATH=$(echo "$PROMPT" | grep -oE 'FINDINGS_PATH=[^[:space:]]+' | head -n1 | cut -d= -f2)
if [[ -z "$FINDINGS_PATH" ]]; then
  FINDINGS_PATH=$(echo "$PROMPT" | sed -n 's/.*write[^/]*\(\/[^[:space:]]*findings\.json\).*/\1/p' | head -n1)
fi

echo "codex starting up"
# Real codex 0.125+ writes its progress lines (banner, prompt echo, tool calls)
# to stderr, not stdout. Mirror that here so the runner tests cover stderr.
echo "codex stderr banner" >&2
sleep 0.05
echo "codex reading workspace"

if [[ "$FAKE_CODEX_STALL" == "1" ]]; then
  exec sleep 600
fi

if [[ "$FAKE_CODEX_FAIL" == "1" ]]; then
  echo "codex aborted" >&2
  exit 1
fi

if [[ -n "$FAKE_CODEX_BODY" ]]; then
  echo "$FAKE_CODEX_BODY" > "$FINDINGS_PATH"
else
  cat > "$FINDINGS_PATH" <<'JSON'
[{"id":"R1","severity":"must","category":"Security","file":"a.ts","line":1,"title":"t","body":"b"}]
JSON
fi

sleep 0.05
echo "codex turn complete"
exit 0
