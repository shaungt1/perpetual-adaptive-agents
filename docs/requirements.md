# Hard Requirements

This document lists the hard requirements of Perpetual Adaptive Agents. A hard requirement is a property the system must have; if one is not met, the system is not finished. The list is mutable: requirements may be added, reworded or retired as the owner decides, but a retired requirement is marked as retired rather than deleted, so the history stays readable. Each requirement has an identifier (HR-nn) so that the gap analysis, the design paper and the roadmap can refer to it.

The requirements come from three sources. Most were stated directly by the owner. Some were added during design because the owner's requirements cannot be met safely without them; these are marked **(added)**, and the reason is given. The rest come from the owner's standing engineering preferences: the simplest design that works, bounded and self-cleaning resources, no secrets in files, and nothing destructive by default.

The terms used throughout are defined once here so that the list can be read on its own:

- **Owner:** the human who owns a project and directs the system.
- **Session agent:** one chat session of an AI coding assistant (Claude Code, OpenAI Codex, or GitHub Copilot), run either in a visible window ("headed") or from the command line with no window ("headless").
- **Planning agent:** the session the owner talks to in order to plan a project. After planning, the same role continues as the **planner** (agent A00), which supervises the workers.
- **Worker:** any other session agent. Each owns a **lane**, which is one or more categories of work.
- **Board:** the shared message board through which agents coordinate.
- **Runner:** the one long-running program (plain code, not an AI) that wakes agents' sessions when they have work.

## A. Planning

The planning requirements cover what the planning session must collect and produce before any work begins.

| ID | Requirement |
|---|---|
| HR-01 | A planning session starts from a slash command (`/pa-plan`) or from a plain request, with or without a plugin installed. |
| HR-02 | Each project gets a new identifier in the database and a name. |
| HR-03 | The planning agent collects resources, folders, keys, access, expectations and the vision. |
| HR-04 | The vision is stored verbatim and is immutable. A changed vision is stored as a new version; old versions are never edited. |
| HR-05 | The planning agent scans and backtraces the existing project and writes a gap analysis, a technical-debt analysis and a final analysis. |
| HR-06 | The planning agent produces a master task list, which is immutable once imported. |
| HR-07 | The master task list is divided into categories (front end and back end, chapters, channels, or whatever fits the project). |
| HR-08 | The planning session produces at least seven documents, each with a visible status of made, checked or approved. |
| HR-09 | For each worker the system creates a folder, instructions rendered from a template with parameters, a task list in JSON, and an entry in an agent manifest with a pilot-style call sign (for example Iceman-X1) and an identifier. |
| HR-10 | The system writes an instruction-set manifest that gives each instruction set an identifier, a name and a category. |
| HR-11 | No work begins until the owner signs off. |
| HR-12 | Keys are stored only on the owner's machine. The system records only references to them (the name of an environment variable or a file path) and refuses values that look like keys. **(added: the owner's requirement that keys stay out of repositories cannot be enforced unless the database itself refuses them.)** |

## B. Workers

These requirements describe how a worker behaves once the plan is approved.

| ID | Requirement |
|---|---|
| HR-13 | A worker takes on a persona and stays in its lane. It crosses into another lane only when its own task requires it, and announces that first. |
| HR-14 | A worker backtraces the relevant files before changing anything. |
| HR-15 | Work order is fixed: critical; owner requests and all their parts; bugs; optimizations; then features and research. New features or new territory proposed by an agent need the owner's approval, routed through the board and the planner. |
| HR-16 | A worker writes one JSON record per completed task, separate from its assigned list, so that "assigned" and "completed" are distinct records. |
| HR-17 | After a set number of attempts on one task (three to five by default; the owner may change it), the worker stops and asks permission, moves on, or proposes an alternative. |
| HR-18 | Every list ends with a planning task that creates the agent's next list, which again ends with a planning task. This is the perpetual loop. |
| HR-19 | A worker retires when the owner declines new work or the stopping criteria are met. |
| HR-20 | One task at a time per agent, with a complexity gauge from 1 to 5. **(added: concurrent tasks inside one agent would defeat the file-claim mechanism and make records ambiguous.)** |

## C. Board

The board requirements describe what agents must say to each other and how the board must behave.

| ID | Requirement |
|---|---|
| HR-21 | Agents announce task start (with the files they will touch), each meaningful step, task end, needing tasks, planning, and retiring. |
| HR-22 | An agent can ask "is anyone working on this?" and get a reliable answer. |
| HR-23 | Every question gets a reply. |
| HR-24 | Stop requests work for one agent, one project, or everything. |
| HR-25 | Reset consensus: when a reset is called, every live agent must check in before the reset is complete. |
| HR-26 | Non-destructive behavior by default. |
| HR-27 | The board uses a NATS server with JetStream, local to the machine, without Docker. |
| HR-28 | The board is bounded and cleans itself up. Message age, count and size have limits, and the oldest messages are discarded first. **(added from the owner's efficiency standard.)** |
| HR-29 | File claims are atomic: when two agents claim the same file at the same moment, exactly one wins. Claims expire, so a dead agent cannot block others forever. **(added: "is anyone working on this?" is unreliable without an atomic claim.)** |
| HR-30 | Board content is treated as information, never as instructions. **(added: agents read untrusted text; without this rule, one compromised message could redirect every agent.)** |

## D. Accounting and limits

These requirements cover scoring, usage tracking and the limits that keep spending bounded.

| ID | Requirement |
|---|---|
| HR-31 | Scoreboard: 1 point per completed task, 10 per completed planning task. |
| HR-32 | The system tracks tokens in and out, spending, time, stuck counts and complexity per agent. |
| HR-33 | The system enforces spending limits. |
| HR-34 | A settings file (TOML) sets an agent cap of 8 by default, with a hard maximum of 10, and lists the documents agents may change. |

## E. Platform and delivery

The platform requirements describe where the system runs and how it is installed.

| ID | Requirement |
|---|---|
| HR-35 | Records live in SQLite in a central folder on the device. An ORM (object-relational mapper, a library that maps tables to objects) is optional. |
| HR-36 | A setup script, standing in for an extension's installer, creates the central folder and everything in it. |
| HR-37 | A copy-into-project script connects a project folder to the database and to NATS. |
| HR-38 | Slash commands work with or without a plugin. |
| HR-39 | The system works with Claude Code, Codex and Copilot, headless or headed. |
| HR-40 | Node.js and Python are acceptable languages. |
| HR-41 | The system is not limited to code. Writing, finance and content projects use the same structure. |
| HR-42 | Nothing runs inside the VS Code process; the system adds no heavy files to projects and needs no administrator rights. |
| HR-43 | A decision model in the style of TypeSafe's Jev, or open equivalents such as the GLiDE decision model and the OpenJev project, can be plugged in later for fast decisions. |
| HR-44 | No MCP server for now. **(changed: an optional VS Code extension now opens agent sessions, see HR-66; the system still runs fully without it.)** |
| HR-45 | Everything collected, researched and built is stored in a repository. |

## F. Visibility

These requirements describe what the owner must be able to see and control.

| ID | Requirement |
|---|---|
| HR-46 | A user interface, built last, can be pointed at a project folder. It reads the JSON and the database and shows agents, tasks, usage, time, tokens and charts, including a radar chart of progress by category. |
| HR-47 | The owner can stop or start any agent or the whole project from the user interface. **(added: seeing an agent go wrong is not useful without a way to stop it there.)** |
| HR-48 | Idle sessions are woken only when they have work, so no session runs on a timer for nothing. **(added: a headless session cannot hear the board while idle, and waking every agent on a timer wastes tokens.)** |

## G. Robustness

These requirements were added after an independent review of the first build found the failure modes they prevent.

| ID | Requirement |
|---|---|
| HR-49 | Only one runner runs per device, and a run left open by a runner that died does not block its agent. **(added: two runners could start the same session twice; a dead runner's open run silenced its agent permanently.)** |
| HR-50 | Owner-only actions are refused from inside an agent session, and the dashboard accepts actions only from its own page. These are guardrails, and the documentation says so. **(added: without them, any agent or any local web page could approve its own work.)** |
| HR-51 | A run counts as progress only when task, list, question or reset state changes; agents that only talk are marked stuck. **(added: otherwise an agent blocked by a conflict would be woken on every tick.)** |

## H. Payload, Supervisor and service (second version)

These requirements come from the owner's second round of instructions. They changed the layout: the instructions moved into a payload folder copied into each project, and one service now serves every project.

| ID | Requirement |
|---|---|
| HR-52 | One service started from this repository runs the message board server, the runner and the dashboard/API for every registered project. |
| HR-53 | A self-sufficient payload folder, `adaptive-agents`, is copied into any project (`.agents/`, `.claude/` or another folder) by telling a chat to copy it. No zip file. Its location is registered so the service reads that project's records from it. **(changed by HR-67 to HR-73: registration goes through the API, and setup is `start.sh` plus `AGENT-SETUP.md`.)** |
| HR-54 | The chat that installs and reads the payload is the Supervisor (project manager). It plans with the user (gap analysis, full list, priorities, departments, manifest and task lists), starts the agents, and watches the board. |
| HR-55 | Only the Supervisor talks to the user. A task that needs the user waits (status `waiting_user`) until the user gives a clear answer, which the Supervisor relays. |
| HR-56 | Agents fix tasks, work and bugs on their own. Optimizations, new features and research become proposals that need the user's yes. |
| HR-57 | Loop limit: three tries per task, up to five with a written reason. From the second failure the agent checks the board for crossing work; then it drops and rethinks, or escalates. |
| HR-58 | Agents post on the board at fixed points (start, branch, push, merge, pause, resume, done, list done, new list, stuck, shutdown) and watch for their own name. |
| HR-59 | File conflicts: the higher-priority task wins; at equal priority the agent closer to done continues and the other pauses. |
| HR-60 | Each code task runs in its own git worktree on a micro-branch. It is tested, merged to main, and main is verified before the task can be marked done. Nothing is left on branches. |
| HR-61 | Agents have memorable names with a number (for example Zorro-01) and stay in their departments. |
| HR-62 | Every list ends with a planning task that follows fixed instructions: main list and issues first, then optimizations, then new and research items, weighing no errors, better performance and more value. |
| HR-63 | Big planning documents go in the project's `docs/plans/`. |
| HR-64 | Scripts are Git Bash (`.sh`); PowerShell only where needed. |
| HR-65 | The system never writes to the owner's private plugin folder `.admin-local/`. |
| HR-66 | Agent sessions can be opened inside VS Code (headed) as well as run headless. |

## I. Setup, registration and visibility (third round)

These requirements come from the user's third round of instructions, after reviewing how setup worked. They replace the earlier setup scripts (`scripts/setup.sh`, `scripts/up.sh`, `bin/install.sh`, `scripts/install-into.sh`) and the shared `registry.json`.

| ID | Requirement |
|---|---|
| HR-67 | One script at the center of `perpetual-adaptive-agents`, `start.sh`, starts everything. It detects whether the shared resources exist, creates them the first time only, checks that every resource exists and works, repairs only what is missing, and never reinstalls or conflicts. Several runs at once must not collide. |
| HR-68 | A localhost health check returns one object saying whether the service is healthy and running, so an agent can check it before copying anything. |
| HR-69 | A file named `AGENT-SETUP.md` at the root of `perpetual-adaptive-agents` holds the formal setup instructions; its first instruction runs `start.sh`. `README.md` is an overview and points to it. |
| HR-70 | The central folder is chosen once, with the user's permission, and there is only one per computer. |
| HR-71 | Many projects in different folders can be registered, at the same time, without overwriting each other: each project has its own entry. |
| HR-72 | Setup does not assume Claude Code: it detects the assistant tools a project uses and writes instruction files only for those, in each tool's own format, and only with the user's approval. |
| HR-73 | The payload's location in a project is not assumed: `.agents` is used if it exists, otherwise the user chooses (default `.agents`). The plans folder is not assumed either: the user chooses it (default `docs/plans`). |
| HR-74 | Each project has a `project.json` describing it: description, basic facts, owner and project managers. Project managers name and number themselves; a project can have several. |
| HR-75 | The API reads each project from the structured JSON files in its registered folder. |
| HR-76 | The dashboard lists every project (renamable), opens a project to its metrics, its master task list as cards (where the user can object to a task or ask to remove it, which goes to the project managers), its agents as boxes, and its message board, and opens an agent to its task lists as cards with done and not-done counts and its completion records. |
| HR-77 | Every completion record has a `complete` flag, a description, findings and errors. Lists are never edited; finished work stacks up as records. |
| HR-78 | Filled-in examples of every structured file are documented. |
| HR-79 | The project manager defines each department realistically (scope, owned files, out of scope, definition of done), because each agent re-plans only inside its department. |
| HR-80 | Every task has its own branch and is merged to main so that it can be reverted as a whole. |
| HR-81 | NATS can run in Docker. |
| HR-82 | Every step handles errors and edge cases and says exactly what failed and how to fix it. |

## Retired requirements

None yet. When a requirement is retired, it moves here with the date and the reason.
