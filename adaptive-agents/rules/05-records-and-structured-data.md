# Rule 5: Records and structured data

Everything the team does is recorded as structured data. The dashboard and the next session depend on it, so records must be correct. Never edit these files by hand: the `pa` command writes them.

## Where records live

| Record | Where | Written by |
|---|---|---|
| Agent manifest: every agent's number, name, department, instructions, task-list folder and resources | `workspace/manifest/agent-manifest.json` | plan import, `pa agent add` |
| Instruction-set manifest | `workspace/manifest/instruction-manifest.json` | plan import |
| Master task list (immutable) | `workspace/manifest/master-tasks.json` | plan import |
| The vision, verbatim | `workspace/manifest/01-vision.md` | `pa vision add` |
| Your instructions | `workspace/agents/<your name>/INSTRUCTIONS.md` | plan import |
| Your assigned task lists (immutable) | `workspace/agents/<your name>/lists/L1.json`, `L2.json`, ... | plan import, `pa list new` |
| Your completion records, one per task | `workspace/agents/<your name>/completed/<task id>.json` | `pa task done` |
| Your working notes (you write these) | `workspace/agents/<your name>/notes.md` | you |
| Questions waiting for the user | `workspace/owner-inbox.md` | the Supervisor |
| Full state for the dashboard | `workspace/state.json` | the runner |
| Everything above, plus the board, runs, tokens and cost | `workspace/state.sqlite` | the `pa` command and the runner |

## Identifiers

- Master tasks: `T-001`. Lists: `<agent id>-L<n>` (`A01-L2`). Tasks: `<list>-<n>` (`A01-L2-3`).
- Agents: id `A01` and name `Zorro-01`. The first project manager is `A00`, under the name it chose (for example `Orion-00`); more project managers continue the numbering.

## Assigned and completed are separate

A list never changes after it is created. Nobody edits a task's title, detail or acceptance. Progress (status, attempts, files) is tracked in the database, and what you actually did goes into a separate completion record. New work always becomes a new list.

## Task statuses

| Status | Meaning |
|---|---|
| `todo` | Ready to be worked. |
| `in_progress` | Started and claimed. At most one per agent. |
| `paused` | Yielded to another agent or waiting on one; files released. |
| `waiting_user` | Needs the user's decision; cannot move until it is recorded. |
| `blocked` | Stopped at the loop limit; the Supervisor decides. |
| `proposed` | An optimization, feature or research idea waiting for the user. |
| `done`, `declined`, `cancelled` | Final. |

## Points

Every completed task earns 1 point. Every completed planning task earns 10 points, because good planning is worth more than any one task. Retiring completes your planning task, since retiring is a planning outcome. The scoreboard is `pa scoreboard`.

Time, tokens and cost for every run are recorded by the runner. You do not report them yourself.
