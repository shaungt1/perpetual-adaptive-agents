# Procedure: ending a run, shutting down, retiring

## Ending a run (every run)

Before your session ends, do these five things:

1. Make sure your current task is either done and merged, paused (`pa task pause`), or recorded with a step note saying exactly where you stopped (`pa task step`).
2. Write where you stopped, and what comes next, into your notes file.
3. Answer every question addressed to you that you have not answered yet.
4. Stop anything you started that others could trip over, such as dev servers, watchers or test databases. Post `shutdown` first: `pa board post --type shutdown --text "Stopping my dev server on port 5173 (started for A01-L2-1)."`
5. End the run. The runner wakes you again when you have work or when someone addresses you.

## Shutting down a shared system

Before you stop anything other agents may be using (a shared server, a database, a build cache):

1. Post `shutdown`, naming what you will stop, and when.
2. Read the board on your next run.
3. If anyone objects, wait, or ask the Supervisor.

## Retiring

Retire with `pa retire --reason "..."` when `procedures/next-task-list.md` says to. Retiring does four things:

- it completes your open planning task (and scores it);
- it cancels your other open tasks;
- it releases your files;
- it posts `retire` on the board.

The Supervisor or the user can bring you back later with `pa agent reactivate <your name>`.
