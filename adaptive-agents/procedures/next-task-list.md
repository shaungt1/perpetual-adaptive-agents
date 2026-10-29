# Procedure: making your next task list (the last task of every list)

Every task list ends with a planning task. Its objective is always the same: **decide what you should do next in your department, and write it as your next list, or retire.** Doing this is what keeps the work going without anyone writing prompts. The new list ends with a new planning task, so the loop continues.

A completed planning task is worth 10 points.

## Steps

1. **Start the task:** `pa task start <planning task id> --plan "plan next list"`. There are no files to claim.
2. **Make sure your work is on main.** Every task before this one must be merged (rule 3). If anything is not, finish it first.
3. **Backtrace your department.** Read:
   - your completion records (`completed/`);
   - your notes, including the answers you wrote to the three questions after each task;
   - the board (`pa board read --all --peek --limit 100`);
   - the current state of every file in your department on `main`.
4. **Run a gap analysis on your department.** Follow [gap-analysis.md](gap-analysis.md), comparing your department with the vision (`workspace/manifest/01-vision.md`), the master task list (`workspace/manifest/master-tasks.json`), and the planning documents in the plans folder (`plans_folder` in `workspace/project.json`). Stay inside your department's definition (scope, owned files, out of scope) in `workspace/manifest/master-tasks.json`; anything outside it goes to the project manager on the board. Write the result into your notes.
5. **Choose candidates, in this order:**
   1. **Unfinished master tasks** in your department, and anything the user asked for.
   2. **Critical issues and bugs** you found. These go on your list as work, and you do them without asking.
   3. **Optimizations**: make something that works faster, cheaper, clearer or more reliable. These are proposals.
   4. **Features and new territory**: what would make your department's part of the product more valuable. Think about what is around the things you built:
      - Are there errors near them?
      - Could they be more performant?
      - What could be added to them that would bring more value?

      These are proposals.
   5. **Research**: things worth measuring, testing with users, or watching over days before deciding. These are proposals.

   Drop anything outside your department. Post it on the board for the right agent instead.
6. **Size each task** with a complexity from 1 to 5, and split anything above 3.
7. **Write the list** as JSON (schema: `schemas/task-list.schema.json`), save it in your folder, and create it:

   ```json
   { "tasks": [
     { "kind": "bug", "title": "Empty data file crashes the loader", "detail": "...", "acceptance": "Empty file loads as no notes; test added", "complexity": 1 },
     { "kind": "optimization", "title": "Cache the parsed config", "detail": "Two sentences: what it is, and why it is worth it.", "acceptance": "...", "complexity": 2 },
     { "kind": "feature", "title": "Export notes as CSV", "detail": "Two sentences: what it is, and why it is worth it.", "acceptance": "...", "complexity": 3 }
   ] }
   ```

   Then run `pa list new --file <that file>`. Do not include a planning task; the system adds one. Bugs and critical issues become `todo`. Optimizations, features and research become `proposed`, and the Supervisor takes each one to the user. Write their `detail` as a two-sentence pitch.
8. **Finish:** `pa task done <planning task id> --summary "<n> tasks planned: ..."`.

## When to retire instead

Retire with `pa retire --reason "..."` instead of making a list when any of these is true:

- Your department has nothing left that is critical, requested or broken, and the user has declined your proposals, or you have none worth making.
- Your last two lists held only marginal optimizations, meaning changes to things that already work, made for their own sake.
- The Supervisor or the user told you your department is finished.

Retiring completes your planning task and scores it. Retiring is a good outcome: the system must know when to stop, rather than changing things until they break.
