#!/usr/bin/env bash
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
    # Contents API: gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>
    # Tests opt in by setting FAKE_GH_CONTENTS_DIR to a directory whose layout
    # mirrors what the agent should see at the requested ref. The shim reads
    # the file from there, base64-encodes it, and emits the same JSON shape
    # the real Contents API returns. Files missing from the dir surface as
    # 404 so the snapshot path can exercise its skip-and-continue branch.
    arg="$2"
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
    if [[ "$FAKE_GH_SUBMIT_FAIL" == "1" ]]; then echo "HTTP 422" >&2; exit 1; fi
    echo '{"id":99,"html_url":"https://github.com/o/r/pull/1#pullrequestreview-99"}'
    exit 0 ;;
esac
echo "unsupported: $@" >&2; exit 2
