#!/usr/bin/env bash
# Create (or reuse) this agent's git worktree and start a micro-branch for one task.
#
#   bash <payload>/bin/task-branch.sh <task id>
#
# The worktree is <payload>/workspace/worktrees/<agent name> (ignored by git). The branch
# is aa/<agent name>/<task id>, started from the current main. Prints the worktree path;
# work only inside it. Announces the branch on the message board.
set -euo pipefail
TASK="${1:?usage: task-branch.sh <task id>}"
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PA="$BIN/pa"
unix() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
WHO="$("$PA" whoami)"
field() { printf '%s' "$WHO" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const v=($1);process.stdout.write(v==null?'':String(v))})"; }
NAME="$(field 'o.agent.name')"
ROOT="$(unix "$(field 'o.project.root')")"
PAYLOAD="$(unix "$(field 'o.payload_folder')")"
MAIN="$(field 'o.rules.main_branch')"; MAIN="${MAIN:-main}"
WT="$PAYLOAD/workspace/worktrees/$NAME"
BRANCH="aa/$NAME/$TASK"

git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository: $ROOT (rule 3: non-code projects skip branches)" >&2; exit 2; }
git -C "$ROOT" rev-parse --verify --quiet "$MAIN" >/dev/null || { echo "branch $MAIN does not exist in $ROOT" >&2; exit 2; }
if [ ! -e "$WT/.git" ]; then
  mkdir -p "$(dirname "$WT")"
  git -C "$ROOT" worktree add --detach "$WT" "$MAIN" >/dev/null
fi
cd "$WT"
if [ -n "$(git status --porcelain)" ]; then
  echo "your worktree $WT has uncommitted changes; commit them on their task branch or ask the Supervisor" >&2; exit 2
fi
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout -q "$BRANCH"
else
  git checkout -q --detach "$MAIN"
  git checkout -q -b "$BRANCH"
fi
"$PA" board post --type branch --task "$TASK" --text "$NAME created branch $BRANCH from $MAIN (worktree workspace/worktrees/$NAME)." >/dev/null
echo "$WT"
