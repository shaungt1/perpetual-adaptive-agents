#!/usr/bin/env bash
# Put this repository under version control and publish it to GitHub as a new repository.
#
#   bash scripts/publish-to-github.sh [repo name] [--private|--public]
#
# Needs git and the GitHub CLI (gh), signed in (gh auth status). Defaults: name
# perpetual-adaptive-agents, private. It refuses to run if the repository already has
# commits or a remote, so it can never overwrite anything.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:-perpetual-adaptive-agents}"
VIS="${2:---private}"
cd "$REPO"
command -v gh >/dev/null || { echo "GitHub CLI (gh) not found. Install it, then run: gh auth login" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not signed in to GitHub. Run: gh auth login" >&2; exit 1; }
if [ -d .git ] && git rev-parse --verify --quiet HEAD >/dev/null; then echo "This folder already has commits; publish it with git push instead." >&2; exit 1; fi
if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then echo "This folder already has a remote: $(git remote get-url origin)" >&2; exit 1; fi
[ -d .git ] || git init -q -b main
git add -A
git status --short | head -n 50
echo "($(git status --short | wc -l | tr -d ' ') files staged)"
git commit -q -m "Perpetual Adaptive Agents: service, adaptive-agents payload, dashboard, tests, docs"
gh repo create "$NAME" "$VIS" --source . --remote origin --push
echo "Published: $(git remote get-url origin)"
