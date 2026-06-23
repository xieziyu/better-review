#!/usr/bin/env bash
# Test shim for the GitButler CLI (`but`). Simulates the two flag spellings
# that `but status` JSON output went through across CLI versions, so the
# version-compat fallback in src/server/gitbutler/cli.ts can be exercised
# without a real `but` install.
#
# FAKE_BUT_MODE selects which generation to emulate:
#   modern (default) — GitButler CLI >= 0.20: accepts `status --format json`,
#                       rejects the legacy `status --json`.
#   legacy           — older CLI: accepts `status --json`, rejects
#                       `status --format json`.
#   setup_required   — a plain git repo without a GitButler project (prints
#                       the structured error on stdout, exits 1).
#
# The emitted JSON is a minimal one-stack/one-branch status — enough for
# parseButStatus + foldStatusToVBranches.

MODE="${FAKE_BUT_MODE:-modern}"

emit_status_json() {
  cat <<'JSON'
{
  "unassignedChanges": [],
  "stacks": [
    {
      "cliId": "g0",
      "branches": [
        {
          "cliId": "es",
          "name": "feat/example",
          "commits": [
            { "cliId": "c1", "commitId": "1111111111111111111111111111111111111111", "message": "feat: example" }
          ]
        }
      ]
    }
  ],
  "mergeBase": { "cliId": "", "commitId": "0000000000000000000000000000000000000000" }
}
JSON
}

emit_unexpected_argument() {
  # clap-style usage error on stderr, nothing on stdout, exit 2.
  echo "error: unexpected argument '$1' found" >&2
  echo "" >&2
  echo "Usage: but status [OPTIONS]" >&2
  exit 2
}

emit_setup_required() {
  # Structured error on stdout (parsed by butJson), human line on stderr.
  cat <<'JSON'
{ "error": "setup_required", "message": "No GitButler project found at .", "hint": "run `but setup` to configure the project" }
JSON
  echo "Error: Setup required" >&2
  exit 1
}

case "$1" in
  "status")
    if [[ "$MODE" == "setup_required" ]]; then
      emit_setup_required
    fi
    # Inspect the flags actually passed.
    has_format_json=0
    has_legacy_json=0
    prev=""
    for a in "$@"; do
      if [[ "$prev" == "--format" && "$a" == "json" ]]; then has_format_json=1; fi
      if [[ "$a" == "--json" ]]; then has_legacy_json=1; fi
      prev="$a"
    done
    if [[ "$MODE" == "modern" ]]; then
      if [[ "$has_format_json" == "1" ]]; then emit_status_json; exit 0; fi
      if [[ "$has_legacy_json" == "1" ]]; then emit_unexpected_argument "--json"; fi
    elif [[ "$MODE" == "legacy" ]]; then
      if [[ "$has_legacy_json" == "1" ]]; then emit_status_json; exit 0; fi
      if [[ "$has_format_json" == "1" ]]; then emit_unexpected_argument "--format"; fi
    fi
    # No recognized JSON flag for this mode.
    emit_unexpected_argument "${2:-?}" ;;
  *)
    echo "fake-but: unhandled command '$1'" >&2
    exit 2 ;;
esac
