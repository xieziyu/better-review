#!/usr/bin/env bash
# Test shim for the `gh` CLI. Each branch covers a single command shape the
# server actually invokes; tests opt into specific behaviours by setting
# environment variables (FAKE_GH_*) before spawning the daemon / GhClient.
case "$1" in
  "auth")
    if [[ "$FAKE_GH_AUTHED" == "0" ]]; then echo "not logged in" >&2; exit 1; fi
    echo "Logged in"; exit 0 ;;
  "pr")
    case "$2" in
      "view")
        if [[ "$FAKE_GH_NOTFOUND" == "1" ]]; then echo "GraphQL: Could not resolve" >&2; exit 1; fi
        # Tests can override the head/base SHAs to match a real fixture repo.
        HEAD_OID="${FAKE_GH_HEAD_OID:-cafef00dcafef00dcafef00dcafef00dcafef00d}"
        BASE_OID="${FAKE_GH_BASE_OID:-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef}"
        cat <<JSON
{"number":1,"title":"Title","author":{"login":"alice"},"body":"Body","url":"https://github.com/o/r/pull/1","baseRefName":"main","headRefName":"feat","baseRefOid":"${BASE_OID}","headRefOid":"${HEAD_OID}"}
JSON
        exit 0 ;;
      "diff")
        echo "diff --git a/x b/x"; echo "@@ -0,0 +1 @@"; echo "+hi"
        exit 0 ;;
    esac ;;
  "api")
    # `gh api` is the catch-all for REST endpoints. Distinguish submit
    # (POST .../pulls/:n/reviews) from GET listReviews by sniffing the
    # raw arg list for `-X POST` — same URL, different verb.
    is_post=0
    for a in "$@"; do
      if [[ "$a" == "POST" ]]; then is_post=1; break; fi
    done
    shift
    if [[ "$1" == "--paginate" ]]; then shift; fi
    arg="$1"
    # Contents API: gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>
    # Tests opt in by setting FAKE_GH_CONTENTS_DIR to a directory whose layout
    # mirrors what the agent should see at the requested ref. The shim reads
    # the file from there, base64-encodes it, and emits the same JSON shape
    # the real Contents API returns. Files missing from the dir surface as
    # 404 so the snapshot path can exercise its skip-and-continue branch.
    if [[ "$arg" == repos/*/contents/* ]]; then
      if [[ -z "$FAKE_GH_CONTENTS_DIR" ]]; then
        echo "FAKE_GH_CONTENTS_DIR not set" >&2; exit 1
      fi
      # Strip "repos/<owner>/<repo>/contents/" prefix and any "?ref=..." suffix.
      path="${arg#repos/*/*/contents/}"
      path="${path%%\?*}"
      file="$FAKE_GH_CONTENTS_DIR/$path"
      if [[ ! -f "$file" ]]; then
        echo "HTTP 404: Not Found" >&2; exit 1
      fi
      content_b64=$(base64 < "$file" | tr -d '\n')
      printf '{"type":"file","encoding":"base64","content":"%s"}\n' "$content_b64"
      exit 0
    fi
    # Reviews list — strip query string before matching. POST to the
    # same URL is the submit endpoint and falls through to the submit
    # branch below.
    bare="${arg%%\?*}"
    if [[ "$bare" == repos/*/pulls/*/reviews && "$is_post" == "0" ]]; then
      if [[ -n "$FAKE_GH_REVIEWS_FILE" && -f "$FAKE_GH_REVIEWS_FILE" ]]; then
        cat "$FAKE_GH_REVIEWS_FILE"
      else
        echo '[]'
      fi
      exit 0
    fi
    # Inline review comments (pulls level).
    if [[ "$bare" == repos/*/pulls/*/comments ]]; then
      if [[ -n "$FAKE_GH_PR_COMMENTS_FILE" && -f "$FAKE_GH_PR_COMMENTS_FILE" ]]; then
        cat "$FAKE_GH_PR_COMMENTS_FILE"
      else
        echo '[]'
      fi
      exit 0
    fi
    # PR-level (issue) comments — main conversation thread.
    if [[ "$bare" == repos/*/issues/*/comments ]]; then
      if [[ -n "$FAKE_GH_ISSUE_COMMENTS_FILE" && -f "$FAKE_GH_ISSUE_COMMENTS_FILE" ]]; then
        cat "$FAKE_GH_ISSUE_COMMENTS_FILE"
      else
        echo '[]'
      fi
      exit 0
    fi
    # Compare endpoint. Surfaces force-push to rerun-context.
    if [[ "$bare" == repos/*/compare/* ]]; then
      if [[ "$FAKE_GH_COMPARE_NOTFOUND" == "1" ]]; then
        echo "HTTP 404: No common ancestor between bases" >&2
        exit 1
      fi
      if [[ -n "$FAKE_GH_COMPARE_FILE" && -f "$FAKE_GH_COMPARE_FILE" ]]; then
        cat "$FAKE_GH_COMPARE_FILE"
      else
        echo '{"status":"ahead","ahead_by":1,"behind_by":0,"total_commits":1,"files":[]}'
      fi
      exit 0
    fi
    # Submit (POST). The submit branch checks for `-X POST` (or fallback
    # when the URL ends in /reviews and we couldn't tell apart from list).
    if [[ "$FAKE_GH_SUBMIT_FAIL" == "1" ]]; then echo "HTTP 422" >&2; exit 1; fi
    REVIEW_ID="${FAKE_GH_REVIEW_ID:-99}"
    echo "{\"id\":${REVIEW_ID},\"html_url\":\"https://github.com/o/r/pull/1#pullrequestreview-${REVIEW_ID}\"}"
    exit 0 ;;
esac
echo "unsupported: $@" >&2; exit 2
