#!/usr/bin/env bash
case "$1" in
  "auth")
    if [[ "$FAKE_GH_AUTHED" == "0" ]]; then echo "not logged in" >&2; exit 1; fi
    echo "Logged in"; exit 0 ;;
  "pr")
    case "$2" in
      "view")
        if [[ "$FAKE_GH_NOTFOUND" == "1" ]]; then echo "GraphQL: Could not resolve" >&2; exit 1; fi
        cat <<'JSON'
{"number":1,"title":"Title","author":{"login":"alice"},"body":"Body","url":"https://github.com/o/r/pull/1","baseRefName":"main","headRefName":"feat"}
JSON
        exit 0 ;;
      "diff")
        echo "diff --git a/x b/x"; echo "@@ -0,0 +1 @@"; echo "+hi"
        exit 0 ;;
    esac ;;
  "api")
    if [[ "$FAKE_GH_SUBMIT_FAIL" == "1" ]]; then echo "HTTP 422" >&2; exit 1; fi
    echo '{"id":99,"html_url":"https://github.com/o/r/pull/1#pullrequestreview-99"}'
    exit 0 ;;
esac
echo "unsupported: $@" >&2; exit 2
