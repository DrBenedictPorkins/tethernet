#!/usr/bin/env bash
set -euo pipefail

MANIFEST="manifest.json"

usage() {
  echo "Usage: $0 [major|minor|patch]"
  echo "  Bumps manifest.json version, commits, and tags."
  echo "  Default: minor"
  exit 1
}

BUMP="${1:-minor}"
[[ "$BUMP" =~ ^(major|minor|patch)$ ]] || usage

# Read current version
CURRENT=$(jq -r '.version' "$MANIFEST")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

echo "Bumping $CURRENT → $NEW_VERSION ($BUMP)"

# Update manifest.json
TMP=$(mktemp)
jq --arg v "$NEW_VERSION" '.version = $v' "$MANIFEST" > "$TMP" && mv "$TMP" "$MANIFEST"

# Commit and tag
git add "$MANIFEST"
git commit -m "chore: release v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo "Tagged v${NEW_VERSION} — push with: git push && git push --tags"
