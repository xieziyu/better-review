#!/usr/bin/env bash
# Fake claude CLI for tests.
# Reads -p "..." prompt; expects FINDINGS_PATH="..." line in prompt.
# Writes FAKE_CLAUDE_BODY (env, JSON array) to that path, emits stream-json events.

PROMPT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) PROMPT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

FINDINGS_PATH=$(echo "$PROMPT" | grep -oE 'FINDINGS_PATH=[^[:space:]]+' | head -n1 | cut -d= -f2)
if [[ -z "$FINDINGS_PATH" ]]; then
  FINDINGS_PATH=$(echo "$PROMPT" | sed -n 's/.*write[^/]*\(\/[^[:space:]]*findings\.json\).*/\1/p' | head -n1)
fi

echo '{"type":"system","subtype":"init"}'
sleep 0.05
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"'"$FINDINGS_PATH"'"}}]}}'

if [[ "$FAKE_CLAUDE_STALL" == "1" ]]; then
  exec sleep 600
fi

if [[ "$FAKE_CLAUDE_FAIL" == "1" ]]; then
  echo '{"type":"result","subtype":"error_max_turns"}'
  exit 1
fi

if [[ -n "$FAKE_CLAUDE_BODY" ]]; then
  echo "$FAKE_CLAUDE_BODY" > "$FINDINGS_PATH"
else
  cat > "$FINDINGS_PATH" <<'JSON'
[{"id":"R1","severity":"must","category":"Security","file":"a.ts","line":1,"title":"t","body":"b"}]
JSON
fi

sleep 0.05
echo '{"type":"result","subtype":"success"}'

if [[ "$FAKE_CLAUDE_LINGER" == "1" ]]; then
  exec sleep 600
fi

exit 0
