#!/usr/bin/env bash
# Push OUT_DIR to the `data` branch as ONE commit (force-push), so the repo never grows from history.
set -euo pipefail
OUT="${OUT_DIR:-/opt/nisar/out}"
: "${GITHUB_REPO:?set GITHUB_REPO, e.g. MUSA-ANN1/DancingWithTheSARs}"
URL="${PUSH_URL:-https://github.com/${GITHUB_REPO}.git}"
cd "$OUT"
rm -rf .git
git init -q -b data
git config user.name "nisar-server"
git config user.email "nisar-server@users.noreply.github.com"
git add -A
git commit -q -m "NISAR data $(date -u +%F)"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"
  git -c http.extraheader="Authorization: Basic ${AUTH}" push -q -f "$URL" data
else
  git push -q -f "$URL" data
fi
echo "published to branch 'data' of ${GITHUB_REPO}"
