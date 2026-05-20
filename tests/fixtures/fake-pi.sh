#!/usr/bin/env bash
# Fake pi CLI for tests.
# Mirrors the production wiring: invoked as `pi --mode json`, prompt fed via
# stdin. Reads FINDINGS_PATH from the prompt and writes FAKE_PI_BODY (or a
# default) to it. Emits newline-delimited JSON events (the `pi --mode json`
# shape) so the runner's stall watchdog sees heartbeats and onResult fires on
# the terminal `agent_end` event.

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

# Skip flags so we behave like the real CLI invoked as `pi --mode json`.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      shift 2 ;;
    *)
      shift ;;
  esac
done

PROMPT=$(cat)

FINDINGS_PATH=$(echo "$PROMPT" | grep -oE 'FINDINGS_PATH=[^[:space:]]+' | head -n1 | cut -d= -f2)
if [[ -z "$FINDINGS_PATH" ]]; then
  FINDINGS_PATH=$(echo "$PROMPT" | sed -n 's/.*write[^/]*\(\/[^[:space:]]*findings\.json\).*/\1/p' | head -n1)
fi

echo '{"type":"session","version":3,"id":"fake","cwd":"'"$(pwd)"'"}'
echo '{"type":"agent_start"}'
sleep 0.05
echo '{"type":"tool_execution_start","toolCallId":"c1","toolName":"write","args":{"path":"'"$FINDINGS_PATH"'"}}'

if [[ "$FAKE_PI_STALL" == "1" ]]; then
  exec sleep 600
fi

if [[ "$FAKE_PI_FAIL" == "1" ]]; then
  echo '{"type":"tool_execution_end","toolCallId":"c1","toolName":"write","isError":true}'
  exit 1
fi

if [[ -n "$FAKE_PI_BODY" ]]; then
  echo "$FAKE_PI_BODY" > "$FINDINGS_PATH"
else
  cat > "$FINDINGS_PATH" <<'JSON'
[{"id":"R1","severity":"must","category":"Security","file":"a.ts","line":1,"title":"t","body":"b"}]
JSON
fi

# Also write the review summary (summary.json sits next to findings.json).
SUMMARY_PATH="$(dirname "$FINDINGS_PATH")/summary.json"
if [[ -n "$FAKE_PI_SUMMARY_BODY" ]]; then
  echo "$FAKE_PI_SUMMARY_BODY" > "$SUMMARY_PATH"
else
  cat > "$SUMMARY_PATH" <<'JSON'
{"overview":"Fake pi review summary.","manualReview":[{"file":"a.ts","reason":"fake reason"}]}
JSON
fi

sleep 0.05
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"review complete"}]}}'
echo '{"type":"agent_end","messages":[]}'
exit 0
