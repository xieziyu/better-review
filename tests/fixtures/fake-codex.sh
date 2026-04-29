#!/usr/bin/env bash
# Fake codex CLI for tests.
# Mirrors the production wiring: subcommand `exec`, prompt fed via stdin.
# Reads FINDINGS_PATH from the prompt and writes FAKE_CODEX_BODY (or a default)
# to it. Emits a few plain-text stdout lines so the runner's stall watchdog
# sees heartbeat events.

# Skip the leading `exec` subcommand and any flags so we behave like the real
# CLI when invoked as `codex exec --sandbox … -`.
case "$1" in
  exec) shift ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sandbox|--approval-policy|--color|--config|-c|--model)
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
