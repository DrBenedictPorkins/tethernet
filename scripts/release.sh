#!/usr/bin/env bash
set -euo pipefail

MANIFEST="manifest.json"
BUMP="${1:-minor}"

usage() {
  echo "Usage: $0 [major|minor|patch]"
  echo "  Tags current main as the release, then bumps version for next dev cycle."
  echo "  Default: minor"
  exit 1
}

[[ "$BUMP" =~ ^(major|minor|patch)$ ]] || usage

# Must be on main
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main (currently on '$BRANCH')"
  exit 1
fi

# Must have clean working tree — staged, unstaged, and untracked
if ! git diff --quiet; then
  echo "Error: unstaged changes present — commit first"
  exit 1
fi
if ! git diff --cached --quiet; then
  echo "Error: staged changes present — commit first"
  exit 1
fi
if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Error: untracked files present — commit or add to .gitignore first"
  exit 1
fi

# Read current version from manifest.json
CURRENT=$(jq -r '.version' "$MANIFEST")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Tag current commit as the release
TAG="v${CURRENT}"
echo "Tagging v${CURRENT}..."
git tag "$TAG"

# Bump version for next dev cycle
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

tmp=$(mktemp)
jq --arg v "$NEW_VERSION" '.version = $v' "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"

git add "$MANIFEST"
git commit -m "chore: begin v${NEW_VERSION} development"

echo ""
echo "Released:    $TAG  ← deploy this"
echo "Dev version: v${NEW_VERSION}  ← now on main"
echo ""
echo "Push: git push && git push --tags"
