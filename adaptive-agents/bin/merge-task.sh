#!/usr/bin/env bash
# Test and merge one task's branch into main, then verify main and clean up.
#
#   bash <payload>/bin/merge-task.sh <task id>
#
# Steps: take the git:main lock (one merge at a time) -> rebase the branch onto main ->
# run the project's test command -> record a merge commit for the task on main (so the whole
# task can be undone with one `git revert -m 1 <merge commit>`) -> verify main holds exactly
# the tested files -> push main only if the user allowed it (project.push = true) -> delete
# the branch (its commits stay reachable through the merge commit) -> release the lock ->
# announce on the board. If any step fails, nothing is merged and the lock is released.
set -euo pipefail
TASK="${1:?usage: merge-task.sh <task id>}"
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PA="$BIN/pa"
unix() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
WHO="$("$PA" whoami)"
field() { printf '%s' "$WHO" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const v=($1);process.stdout.write(v==null?'':String(v))})"; }
NAME="$(field 'o.agent.name')"
ROOT="$(unix "$(field 'o.project.root')")"
PAYLOAD="$(unix "$(field 'o.payload_folder')")"
MAIN="$(field 'o.rules.main_branch')"; MAIN="${MAIN:-main}"
TEST="$(field 'o.rules.test_command')"
PUSH="$(field 'o.rules.push')"
WT="$PAYLOAD/workspace/worktrees/$NAME"
BRANCH="aa/$NAME/$TASK"
fail() { echo "merge-task: $*" >&2; exit 1; }

[ -e "$WT/.git" ] || fail "no worktree at $WT; run task-branch.sh first"
[ "$(git -C "$WT" rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || fail "your worktree is not on $BRANCH"
[ -z "$(git -C "$WT" status --porcelain)" ] || fail "commit your changes first (git -C \"$WT\" status)"

got=""
for _ in $(seq 1 90); do
  if "$PA" lock acquire git:main --ttl 15 >/dev/null 2>&1; then got=1; break; fi
  sleep 10
done
[ -n "$got" ] || fail "could not get the git:main lock in 15 minutes; ask on the board who holds it (pa board claims)"
trap '"$PA" lock release git:main >/dev/null 2>&1 || true' EXIT

if ! git -C "$WT" rebase -q "$MAIN"; then
  git -C "$WT" rebase --abort || true
  fail "rebase onto $MAIN conflicts; see rules/03-git-and-worktrees.md, 'When the rebase conflicts'"
fi
if [ -n "$TEST" ]; then
  (cd "$WT" && bash -c "$TEST") || fail "tests failed on the rebased branch ($TEST); nothing was merged"
fi
SHA="$(git -C "$WT" rev-parse HEAD)"
OLD="$(git -C "$ROOT" rev-parse "$MAIN")"
git -C "$ROOT" merge-base --is-ancestor "$OLD" "$SHA" || fail "$MAIN moved while testing; run the script again"
# One merge commit per task: its first parent is the old main, its second the task's last commit,
# and its files are exactly the tested files.
MERGE="$(git -C "$ROOT" commit-tree "$SHA^{tree}" -p "$OLD" -p "$SHA" -m "Merge task $TASK ($NAME) from $BRANCH" -m "Tested with: ${TEST:-no test command}. Undo the whole task with: git revert -m 1 <this commit>")"
if [ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = "$MAIN" ]; then
  git -C "$ROOT" merge -q --ff-only "$MERGE" || fail "$MAIN could not move to the merge commit; the project folder may have uncommitted changes in the same files"
else
  git -C "$ROOT" update-ref "refs/heads/$MAIN" "$MERGE" "$OLD" || fail "$MAIN moved; run the script again"
fi
# Verify: main is the merge commit, and its files are exactly the tested files.
[ "$(git -C "$ROOT" rev-parse "$MAIN")" = "$MERGE" ] || fail "$MAIN does not point at the merge commit"
[ "$(git -C "$ROOT" rev-parse "$MAIN^{tree}")" = "$(git -C "$ROOT" rev-parse "$SHA^{tree}")" ] || fail "$MAIN does not hold the tested files"
if [ "$PUSH" = "true" ] && git -C "$ROOT" remote get-url origin >/dev/null 2>&1; then
  git -C "$ROOT" push -q origin "$MAIN" && "$PA" board post --type push --task "$TASK" --text "$NAME pushed $MAIN (${MERGE:0:8}) to origin." >/dev/null
fi
git -C "$WT" checkout -q --detach "$MAIN"
git -C "$ROOT" branch -q -d "$BRANCH"
"$PA" board post --type merge --task "$TASK" --text "$NAME merged $BRANCH into $MAIN as merge commit ${MERGE:0:8} (undo: git revert -m 1 ${MERGE:0:8}); tests ${TEST:+($TEST) }passed; main verified; branch deleted." >/dev/null
echo "merged $BRANCH into $MAIN as $MERGE"
