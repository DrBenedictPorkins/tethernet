#!/usr/bin/env bash
set -euo pipefail

MANIFEST="manifest.json"
BUMP="${1:-minor}"

[[ "$BUMP" =~ ^(major|minor|patch)$ ]] || { echo "Usage: $0 [major|minor|patch]  (default: minor)"; exit 1; }

# ── Branch detection ──────────────────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$BRANCH" == "main" ]]; then
  MODE="release"
elif [[ "$BRANCH" == hotfix/* ]]; then
  MODE="hotfix"
  if [[ "$BUMP" != "patch" ]]; then
    echo "Error: hotfix branches only allow 'patch' bumps"
    exit 1
  fi
else
  echo "Error: releases must be from 'main' or 'hotfix/*' (currently on '$BRANCH')"
  exit 1
fi

# ── Clean tree ────────────────────────────────────────────────────────────────
if ! git diff --quiet; then
  echo "Error: unstaged changes — commit first"
  exit 1
fi
if ! git diff --cached --quiet; then
  echo "Error: staged changes — commit first"
  exit 1
fi
if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Error: untracked files — commit or add to .gitignore first"
  exit 1
fi

# ── Read + compute version ────────────────────────────────────────────────────
CURRENT=$(jq -r '.version' "$MANIFEST")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# ── Release flow ──────────────────────────────────────────────────────────────
if [[ "$MODE" == "release" ]]; then
  # Tag current state first (manifest already at release version), then bump for dev
  TAG="v${CURRENT}"
  echo "Tagging ${TAG}..."
  git tag "$TAG"

  tmp=$(mktemp)
  jq --arg v "$NEW_VERSION" '.version = $v' "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"
  git add "$MANIFEST"
  git commit -m "chore: begin v${NEW_VERSION} development"

  echo ""
  echo "Released:    ${TAG}  ← deploy this"
  echo "Dev version: v${NEW_VERSION}  ← now on main"
  echo ""
  echo "Push: git push && git push --tags"

else
  # Hotfix: v{CURRENT} tag already exists — bump first so the tag lands on the correct version
  TAG="v${NEW_VERSION}"
  echo "Hotfix: bumping ${CURRENT} → ${NEW_VERSION}..."

  tmp=$(mktemp)
  jq --arg v "$NEW_VERSION" '.version = $v' "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"
  git add "$MANIFEST"
  git commit -m "chore: release v${NEW_VERSION}"

  echo "Tagging ${TAG}..."
  git tag "$TAG"

  echo ""
  echo "Released:    ${TAG}  ← deploy this"
  echo ""
  echo "Push:  git push origin ${BRANCH} && git push --tags"
  echo "Then cherry-pick fix commits to main if needed."
fi
