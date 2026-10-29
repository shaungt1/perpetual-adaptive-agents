# Rule 3: Git, branches, worktrees and merging

This rule applies to code projects (project kind `code`). For other kinds of project, skip to the last section.

Two terms first:

- A **branch** is a separate line of commits.
- A **worktree** is a second working folder of the same git repository, checked out to a different branch. Every agent works in its own worktree, so agents never change files in each other's folders or in the user's own working folder.

## Every task, every time

1. **Branch.** Run `bash <payload>/bin/task-branch.sh <task id>`. It does four things:
   - creates (or reuses) your worktree at `<payload>/workspace/worktrees/<your name>`;
   - starts a micro-branch `aa/<your name>/<task id>` from the current `main`;
   - prints the folder path;
   - announces the branch on the board.

   Work only inside that folder.
2. **Commit small.** Make one commit per meaningful step, with a message that starts with the task id: `A01-L1-2: load notes from JSON on start`.
3. **Test.** Run the project's test command (`pa config get project.test_command`) and the checks your task needs. Never merge anything broken.
4. **Merge.** Run `bash <payload>/bin/merge-task.sh <task id>`. It does seven things, in order:
   1. takes the `git:main` lock, so only one agent merges at a time; if someone else holds it, it waits;
   2. rebases your branch onto the latest `main`;
   3. runs the test command on the rebased branch;
   4. records one **merge commit** for the task on `main`, whose files are exactly your tested files, so the whole task can be undone later with one command: `git revert -m 1 <merge commit>` (no rewritten history);
   5. checks that `main` now points at that merge commit and holds exactly the tested files, which means main is fine;
   6. pushes `main` if, and only if, the user allowed pushing during planning (`project.push = true`);
   7. deletes your branch (its commits stay in the history through the merge commit), releases the lock, and posts the `merge` message with the merge commit's id.

   If any step fails, nothing is merged, the lock is released, and the script tells you why.
5. **Only then** run `pa task done`. `pa task done` refuses to complete a task while its branch `aa/<your name>/<task id>` exists and is not merged into `main`. **You may not start the next task until your work is on `main`.**

## Never

- Never commit directly to `main`, and never work in the user's own working folder.
- Never force-push, rewrite published history, or delete someone else's branch.
- Never leave a task's branch unmerged when you move on. A branch is temporary; nothing stays on it.
- Never undo another task by hand-editing files. To undo a whole task, the project manager decides, and it is reverted with `git revert -m 1 <its merge commit>` (the commit id is in the task's `merge` message on the board).
- Never resolve a merge conflict in another department's files by guessing. Ask that agent on the board.

## When the rebase conflicts

1. Read who changed the conflicting lines: `git log main -- <file>`, and the board.
2. If the conflict is only in your department's files, resolve it, re-run the tests, and run the merge script again.
3. If it is in someone else's files, run `git rebase --abort`, ask them on the board, and pause the task until they answer.

## Projects that are not code

Writing, research, content and finance projects may not use git. In that case:

- keep your work in your department's folders;
- name every output file after its task id;
- record every result with `pa task done --files ...`.

The board rules apply exactly the same way.
