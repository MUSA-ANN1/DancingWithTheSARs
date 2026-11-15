#!/usr/bin/env bash

set -euo pipefail
OUT="${OUT_DIR:-/opt/nisar/out}"
: "${GITHUB_REPO:?set GITHUB_REPO, e.g. MUSA-ANN1/DancingWithTheSARs}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required to publish the data branch}"
URL="${PUSH_URL:-https://github.com/${GITHUB_REPO}.git}"
PUBLISH_DIR="$(mktemp -d)"
trap 'rm -rf "$PUBLISH_DIR"' EXIT

AUTH="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" clone -q --branch data --single-branch "$URL" "$PUBLISH_DIR"

cp -a "$OUT/." "$PUBLISH_DIR/"
cd "$PUBLISH_DIR"
git config user.name "nisar-server"
git config user.email "nisar-server@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "No new NISAR products to publish."
  exit 0
fi

git commit -q -m "NISAR data $(date -u +%F)"
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" push -q origin data
echo "Published NISAR products to branch 'data' of ${GITHUB_REPO} without replacing existing history."
