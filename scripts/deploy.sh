#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag>"
  echo "  Example: $0 v1.0.0"
  echo ""
  echo "Available tags:"
  git tag -l | sort -V | tail -10
  exit 1
fi

# ── Verify tag exists ─────────────────────────────────────────────────────────
if ! git tag -l | grep -qx "$TAG"; then
  echo "Error: tag '$TAG' not found"
  echo ""
  echo "Available tags:"
  git tag -l | sort -V | tail -10
  exit 1
fi

VERSION="${TAG#v}"
REPO_ROOT=$(git rev-parse --show-toplevel)
BUILDS_DIR="${REPO_ROOT}/builds"
ZIPNAME="tethernet-${VERSION}.zip"
ZIPPATH="${BUILDS_DIR}/${ZIPNAME}"

mkdir -p "$BUILDS_DIR"

echo "Building ${TAG}..."

# ── Clean export via git archive (no .git, no dev files in working tree) ──────
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

git archive "$TAG" | tar -x -C "$WORK"

# Remove dev-only paths
rm -rf \
  "${WORK}/scripts" \
  "${WORK}/test" \
  "${WORK}/.gitignore"

# Remove any markdown files at repo root
find "$WORK" -maxdepth 1 -name "*.md" -delete

# ── Zip ───────────────────────────────────────────────────────────────────────
(cd "$WORK" && zip -qr "$ZIPPATH" . -x "*.DS_Store")

SIZE=$(du -sh "$ZIPPATH" | cut -f1)
echo ""
echo "Built: builds/${ZIPNAME}  (${SIZE})"
echo ""
echo "Upload to Chrome Web Store:"
echo "  https://chrome.google.com/webstore/developer/dashboard"
