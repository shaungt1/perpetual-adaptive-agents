# Perpetual Adaptive Agents: Design Paper

> **Third version.** Setup is now `start.sh` (checks, creates the central folder `~/.perpetual-adaptive-agents` once with the user's permission, repairs, starts) and `AGENT-SETUP.md` (the formal steps for a chat). Projects are registered through `POST /api/projects/register`, each as its own file `projects/<id>/link.json`; the shared `registry.json` and the install scripts are gone. Each project has `workspace/project.json`, project managers name themselves, and the API and dashboard read each project from its JSON files. See HR-67 to HR-82 in `requirements.md`.
>
> **Second version.** Sections below that mention `~/.pa-agents/projects/<id>/`, the `.pa/` folder or `instructions/` describe the first version. Now the instructions and each project's records live in the payload folder `adaptive-agents/` inside the project (`config.toml` and `workspace/`), the service home `~/.pa-agents` keeps only the registry, settings, NATS files and logs, and one service (`pa up`) runs the runner and dashboard for every registered project. The planning agent is now the Supervisor. See `README.md` and `adaptive-agents/README.md`, and HR-52 to HR-66 in `requirements.md`.

## Executive summary

Perpetual Adaptive Agents is a local system that turns ordinary AI chat sessions into a coordinated, self-renewing workforce. The owner of a project plans the work once, in conversation with one session. The system then runs a small team of worker sessions, each confined to its own lane of the work. The workers take tasks in a fixed priority order, coordinate through a message board, record everything they finish, and close every list of tasks by planning the next one. That last step is what makes the system perpetual: work continues until the owner stops it or the workers conclude that nothing worthwhile is left, and then they retire.

The system is built from parts that already exist and are deliberately small:

- **Workers** are the coding assistants the owner already uses (Claude Code, OpenAI Codex, GitHub Copilot), started from the command line.
- **Records** are kept in one SQLite database file in a central folder on the owner's computer.
- **The live board** is a local NATS server with its JetStream persistence layer.
- **The runner** is one plain program that wakes a session only when that session has something to do.
- **The tool** is a command-line program, `pa`, through which every agent reads and writes the shared state.
- **The dashboard** is a local web page that shows agents, tasks, usage and a radar chart of progress, and lets the owner stop anything.

The thesis of this paper is that the hard part of running many agents is organization and bookkeeping, not intelligence. The sessions are already capable. What they lack is a reliable shared record, a fair and bounded way of being woken, a fixed set of rules about who may touch what, and a loop that renews their work without the owner writing prompts every day. The rest of this paper describes each mechanism in enough detail to rebuild it, gives the evidence that it works, addresses the main objections, and states what was deliberately left out.

## 1. Terms

The paper uses the following terms throughout. Each is defined once here so the paper can be read without any earlier material.

- **Owner:** the human who owns a project, approves the plan, and decides on anything new.
- **Session:** one conversation with an AI coding assistant. A session is **headless** when it is started from the command line with one instruction, does its work, and exits, leaving its conversation saved so it can be **resumed** later. It is **headed** when it runs in a visible window that a person can type into.
- **Agent:** a session with a role, an identity and a folder. The **planning agent** is the session the owner plans with. The **planner** (agent A00) is the supervising agent created by the plan. A **worker** is any other agent (A01, A02, and so on), named with a pilot-style call sign such as Iceman-X1.
- **Lane:** the categories of work a worker owns, such as "back end" or "chapters 1 to 4".
- **Task kinds:** `critical`, `owner_request`, `bug`, `optimization`, `feature`, `research` and `planning`. The kind fixes a task's place in the order of work.
- **Master task list:** every task the plan contains, fixed once imported.
- **List:** a numbered set of tasks assigned to one agent (A02-L1, A02-L2, and so on). A list never changes once created.
- **Board:** the shared message board.
- **Claim:** an agent's recorded hold on a file or folder while it works on a task.
- **Runner:** the one long-running program that decides when each agent's session should run.
- **PA_HOME:** the central folder on the owner's computer that holds the database, settings, instructions and project folders (by default `.pa-agents` in the user's home folder).
- **SQLite:** a database engine that stores a whole database in one file and runs inside the program that uses it, with no server.
- **NATS and JetStream:** NATS is an open-source messaging server shipped as one executable program. JetStream is its built-in layer that stores messages in limited "streams" and provides a key-value store.

## 2. What the system is, and what it is not

At its core, the system automates many chat sessions. One chat with the owner becomes a plan. The plan becomes a set of agents, each a session with written instructions, a lane, and a list of tasks. The agents keep working without the owner writing prompts, and the owner watches and steers from a dashboard or from any chat.

The system is not a new AI model, a new agent framework, or an editor extension. It does not give the sessions new abilities: the assistants already read and write files, run commands, search the web and test their work. It gives them what they lack when several of them share one project:

1. **A shared record:** who owns what, what is in progress, what is finished.
2. **A coordination channel** that cannot lose messages.
3. **Fixed rules** about lanes, order of work and safety.
4. **A wake-up mechanism**, because a headless session cannot hear anything while it is not running.
5. **A loop** that turns the end of one list into the start of the next.

The system is not limited to software. A project has a kind (code, writing, finance, content, or other), and its categories and tasks are written in plain language. A book project could have lanes for research, chapters, editing and cover design. A weekly finance project could have lanes for data collection, analysis and reporting. The only code-specific advice in the instruction set concerns branches and tests, and it applies only when the project is code.

## 3. Architecture

The system has seven components. For each one, the table below states what it is, how it is built, where it lives, how it is deployed, and what it interacts with.

| Component | What it is | Built with | Lives in | Deployed by | Interacts with |
|---|---|---|---|---|---|
| `pa` command-line tool | The single tool used by the owner, the planning agent and every worker | Node.js, `core/cli.mjs` | The repository; shims in `PA_HOME/bin` | Setup writes `pa` (for bash) and `pa.cmd` (for Windows) | SQLite, NATS, the files in `PA_HOME` |
| Record store | Authoritative state: projects, vision, documents, tasks, claims, board, runs, usage | SQLite through Node's built-in driver, SQL migrations | `PA_HOME/pa.sqlite` | Created by setup, migrated on first use | Every component |
| Board (live side) | Real-time feed of board messages, presence of live agents, wake-ups | NATS server with JetStream; official JavaScript client version 3 | Separate process on 127.0.0.1:4222; data in `PA_HOME/nats/data` | Setup writes the configuration and installs the server program; `pa nats start` runs it | `pa` (publishes), runner and dashboard (subscribe) |
| Runner | Wakes sessions that have work, enforces limits, records usage, detects stuck agents | Node.js, `core/runner.mjs` | Its own terminal, outside the editor | `pa run` (or a scheduled task) | SQLite, NATS, the assistant command-line tools |
| Provider adapters | How each assistant is started headless and how its output is read | Node.js, `core/providers.mjs` | The repository | None (code) | Claude Code, Codex, Copilot, mock |
| Instruction set | Planning procedure, worker and planner templates, rules, planning objective, schemas, slash commands | Markdown and JSON | Repository, copied to `PA_HOME/instructions` | Setup copies it and installs the slash commands | Sessions read it; the planner renders templates from it |
| Dashboard | Owner's view and controls | Node's built-in web server and one HTML page, no dependencies | `dashboard/` in the repository | `pa ui`, served on 127.0.0.1:4777 | SQLite (read and owner actions), the project's `.pa/state.json` as a fallback |

Two kinds of storage sit beside these components. In `PA_HOME/projects/<project id>/` the system keeps each project's planning documents, its agents' folders (instructions, lists, completion records, notes) and its run logs. In the project itself it writes only three small files under `.pa/`: a pointer to the project id (`project.toml`), a `.gitignore` that keeps the folder out of version control, and the snapshot that the dashboard or any other tool can read (`state.json`). Keeping state central follows the owner's requirement that nothing be copied into every project and that nothing heavy live inside the editor.

## 4. The lifecycle of a project

### 4.1 Planning

The owner starts a planning session with the slash command `/pa-plan` in any of the three assistants, or by asking any session to follow `instructions/planning-agent.md`. The procedure has ten stages, and it borrows the idea of taking an order: nothing proceeds until the owner confirms that the planning agent understood.

1. **Start.** The agent checks the installation (`pa doctor`), starts NATS if needed, and creates the project record, which gives the project its id.
2. **Collect.** The agent gathers the vision and stores it verbatim with `pa vision add`, along with expectations, priorities, spending limits, resources, key references, authority, and which assistant runs each worker.
3. **Scan and backtrace.** The agent studies the existing project, if there is one, and writes how it works and how it came to be.
4. **Analyze.** The agent writes the gap analysis, the technical-debt analysis, and the final analysis that turns both into a list of everything to build or fix.
5. **Master tasks.** The agent writes the master task list with categories, kinds and acceptance criteria.
6. **Workforce.** The agent decides how many workers there should be and what each one's lane and persona are.
7. **Documents.** The agent writes at least seven documents and registers each one.
8. **Import.** The agent writes `plan.json`, validates it, and imports it.
9. **Verify.** The agent checks every document against independent questions and marks it checked.
10. **Sign-off.** The owner approves.

Import is mechanical, which makes it reliable. `pa plan import` validates the plan (unknown categories, duplicate ids, tasks assigned twice, more agents than the cap) and stores the categories and the master task list. It creates the planner and the workers with their call signs and folders. It renders each worker's instructions from the template with that worker's parameters (identity, lane, persona, folders, attempt limit, point values, writable documents). It creates each worker's first list with the planning task appended. Finally, it writes the agent manifest and the instruction-set manifest. The project then waits in the phase `awaiting_approval`. `pa approve` refuses to start while any document is only "made" and not yet "checked". This turns the owner's rule ("no work before sign-off, and I want to see that each document was checked") into a gate in code.

### 4.2 Running

After approval, the runner takes over. On each tick, and immediately whenever a board message arrives through NATS, it looks at every agent and asks one question: does this agent have a reason to run now? An agent has a reason if it has a task to do or continue, a message addressed to it, a stop request, or a reset it has not answered. Broadcast notes and announcements do not wake anyone, because the agents read them at the start of their next run anyway. Waking every agent for every note would multiply cost by the number of agents.

The runner wakes an agent only within four limits:

1. the number of sessions allowed to run at once;
2. the agent's runs per day;
3. the project's daily spending ceiling;
4. the owner's stop and pause controls.

The planner has one more limit. It reads every status note, so in the live runs it was the largest single cost. It is therefore woken at most once per `runner.planner_min_interval_seconds` (two minutes by default), except when a question is waiting for an answer or a reset needs it.

To wake an agent, the runner resumes the agent's saved session with a short prompt: who the agent is, why it was woken, and the instruction to run `pa whoami` and follow its instructions file. It records the run (start, end, exit code, tokens in and out, cost, session id) from the assistant's machine-readable output, and stops a run that exceeds the time limit. A run counts as progress only if something changed state: a task started, failed, finished or was blocked, a list was created, a question was answered, or a reset was acknowledged (for the planner, any message it posts, since its work is mostly messages). Reading the board and posting step notes do not count. After several runs in a row without progress, the agent is marked stuck and the planner is told, so an agent that only talks is not woken forever.

Three further rules keep the runner robust. Waiting agents are woken in fair order: the planner first, then the agent with the fewest runs today, then the one that has waited longest. A run left open by a runner that crashed (its process is gone, or it is older than the time limit) is closed at the next tick, so its agent is woken again. And only one runner may run per device: it holds a lock file with its process id, and a lock left by a dead runner is taken over.

### 4.3 A worker's run

A worker's instructions describe a single loop, and every run follows it from the top, because a session remembers nothing that is not on disk or in the database.

1. **`pa whoami`** reports the agent's identity, lane, instruction path, stop requests, pending resets, unread messages and next task.
2. **`pa board read`** shows new messages. Every question addressed to the agent is answered.
3. **`pa task next`** returns the agent's task in fixed order: critical, owner requests (with all their parts), bugs, optimizations, features, research, and the planning task last.
4. **Backtrace.** The worker reads the files involved and how they came to be.
5. **Plan.** The worker writes down the steps and the files.
6. **`pa task start <id> --files ... --plan ...`** claims the files atomically and announces the start. If another agent holds an overlapping claim, nothing changes, a conflict is posted to the board, and the worker asks, waits, or moves on.
7. **Work.** The worker reports each meaningful step with `pa task step`.
8. **Verify.** The worker writes check questions against the acceptance criteria and answers each one by running something.
9. **`pa task done`** writes a completion record file separate from the assigned list, scores the points, releases the claims, and announces the result.

A failed attempt is recorded with `pa task fail`. After the configured number of attempts (five by default), the task is blocked, its claims are released, and the planner is asked to give permission, let the worker move on, or approve an alternative.

### 4.4 The planning loop and retirement

Every list ends with a planning task, whose objective is always the same: decide what the agent should do next. The worker re-reads its records, its lane, the vision and the gap analysis, then writes a new list in priority order and creates it with `pa list new`. The system appends a new planning task to that list, so the loop continues without anyone writing a prompt. A completed planning task is worth ten points, against one point for an ordinary task, because good planning is worth more than any single task.

New features and new territory are handled differently from fixes. When an agent puts a `feature` task in its own list, the task starts as `proposed` and cannot be started. The planner pitches it to the owner in two sentences, and only the owner can approve or decline it. When nothing critical, requested, broken or clearly worth optimizing remains, and the owner has declined the agent's proposals, the agent retires with a stated reason. This stopping rule answers the owner's concern that a self-renewing system must know when to stop, instead of changing things until they break.

### 4.5 A worked example

The repository's test case shows the cycle end to end on a tiny notes program.

1. **Vision.** The owner wants to add, list and delete notes from the command line, keep them across restarts, have them tested, and have a two-minute guide.
2. **Plan.** The plan has four categories (storage, command line, guide, tests) and eight master tasks, two per worker.
3. **Workers.** After import, the project has a planner, Oracle-X0, and four workers: Iceman-X1 (storage), Viper-X2 (command line), Falcon-X3 (guide) and Raptor-X4 (tests).
4. **Running.** Once the owner approves, the runner wakes three sessions at a time. Viper-X2's first attempt fails on purpose and is recorded, and the second succeeds. Falcon-X3 asks Iceman-X1 a question about the storage API. Because Iceman-X1 has already retired, the question is rerouted to the planner, who answers it.
5. **Planning loop.** Iceman-X1's planning task produces a second list with one bug and one feature proposal (a web page for the notes, which the vision mentions as a later wish). It fixes the bug, and its second planning task concludes that nothing worthwhile is left, so it retires. The proposal waits in the owner's inbox.
6. **Result.** All eight master tasks are done, each worker has completion records, the scoreboard shows 23 points for Iceman-X1 and 12 for each of the others, and every question has an answer.

## 5. The record store

SQLite is the authoritative record because the system's correctness depends on two properties that only a transactional store gives cheaply: no message is lost, and no two agents can win the same claim. The schema has about twenty tables, grouped as follows:

- **Planning:** projects, vision, resources, documents, categories, master tasks, agents, instruction sets.
- **Work:** lists, tasks, task events, completions, claims.
- **Board:** messages, read cursors, resets, reset check-ins.
- **Operations:** runs, presence, decisions.

Immutability is enforced by the database, not by convention. Triggers refuse any update or delete on the vision and on the master task list, and any change to a task's assigned content (its list, agent, order, kind, title, detail or acceptance). Only a task's progress fields, such as status, attempts, files and times, can change. A changed vision is stored as a new version, and a changed plan is a new list.

Many short-lived processes share the file, one per `pa` command. Write-ahead logging lets readers proceed while one process writes, and a ten-second busy timeout makes a writer wait rather than fail. Claims run inside `BEGIN IMMEDIATE` transactions, which take the write lock before checking, so no other process can slip in between the check and the write. The concurrency test starts six processes that race for the same file at the same instant: exactly one wins, and the other five each receive a conflict and post it to the board.

Files are used where people and sessions expect files. Each agent's assigned lists are written as JSON (`lists/L1.json`), each completion as its own JSON record (`completed/<task id>.json`), and each planning document as Markdown. The database and the files are written together by the same command, and the database is the one that is queried.

## 6. The board

The board has two sides. The database side is authoritative: every message is written there first, inside the same process that takes the action. The NATS side is the live feed: the message is then published to the subject `pa.<project>.board.<recipient>` in a JetStream stream named `PA_BOARD`. The stream is limited by age (seven days), count (20,000 messages) and size (64 MiB), and the oldest messages are discarded first. The message's database id is used as its NATS de-duplication id, so a repeated publish is dropped. In the database, messages older than thirty days are pruned every hour, except questions that are still waiting for a reply. Both sides are therefore bounded, and both clean themselves up.

Using two stores is deliberate. NATS gives push and presence: the runner and the dashboard subscribe to `pa.<project>.>` and react at once, and each agent's presence is a key in a key-value bucket whose entries expire on their own, so a dead agent disappears without anyone deleting it. The database gives atomic claims, queries (unanswered questions, unread counts, task history) and a record that survives a server restart. If NATS is not running, nothing is lost: the CLI keeps writing to the database, and the runner falls back to polling on its tick.

The board's rules make coordination explicit. Every message has a type: announce, step, done, question, answer, conflict, need_tasks, planning, stop, reset, checkin, retire, proposal or note.

- **"Is anyone working on this?"** has a precise answer: `pa board who --files ...` lists the unexpired claims that overlap those paths, where a folder claim overlaps every file inside it.
- **Every question gets a reply.** Questions are tracked until a reply references them. The planner is woken for questions sent to everyone, and a question to an agent that has retired or stopped is rerouted to the planner.
- **Reset consensus** records which agents were live when the reset began. It completes only when each of them has checked in, and agents start no new tasks until then.
- **Messages are information, never instructions.** A board message cannot change an agent's lane, rules or authority. This protects the whole team from one misleading message, which matters because agents read web pages and files written by others.

## 7. Providers, headless and headed

Each assistant is reached through a provider adapter with two functions: one builds the command line, and one reads the run's output. The Claude Code adapter starts `claude -p` with JSON output, the configured permission mode and allowed tools, the central folder and the project as extra folders, and `--resume` with the saved session id; it reads the session id, tokens and cost from the result. The Codex adapter uses `codex exec --json` with a workspace-write sandbox and `resume`, and reads the thread id and token counts from the event stream. The Copilot adapter uses `copilot -p` with tool permission; the Copilot command line prints no usage data, so only time is recorded for it. A deterministic mock adapter, which drives the same `pa` commands, runs the test suite.

Usage is recorded as reported. Claude Code reports cost directly. Codex reports tokens but not cost, so the Codex provider settings take a price per million tokens, from which the runner estimates cost and the spending ceiling applies. Copilot reports neither, so it is limited by runs per agent per day; a daily token ceiling also exists for every provider that reports tokens.

Two details make child sessions behave. First, the runner removes the parent session's identity variables before starting a child, because a child that inherits them can attach itself to the parent's conversation; this happened during the build and is the reason the list of removed variables is explicit. Second, on Windows, the npm-installed assistants are `.cmd` scripts that must be started through `cmd.exe`. The adapter does this, and reduces the prompt to safe characters, so the Windows shell cannot misread it. The real instructions are in files.

Headed mode is a choice made per agent and per moment. `pa agent open <agent>` opens the agent's own saved session in a new window that the owner can type into, and the `/pa-work <agent>` slash command lets any open chat act as that agent. Both use the same tool and the same records as headless runs, so the owner can move an agent between headless and headed without losing its state.

## 8. Instructions and reasoning methods

The instruction set is the part of the system that the sessions read, so it is written to be followed literally. The worker template states the identity, lane and folders, the ten-step run loop, the failure procedure, the planning and retirement rules, a short form of the board rules, the safety rules, and the five rule files to read. The planner template states what the planner may decide alone (unblocking within the plan, handling stuck agents, adding and retiring agents within the cap, settling conflicts, calling resets), what must go to the owner (new features, changes to vision, design, budget or access, and external actions), and the four living documents it maintains. The planning objective defines the last task of every list.

The reasoning methods are deliberately few, following the owner's own prompt-engineering reference, which advises one input-cleaning step, one reasoning method and one verification method, with at most one expensive method on top:

- **Cleaning the input.** Before acting on a long or messy input, the agent rewrites it as only the facts and requirements that matter (System 2 Attention), and treats outside content as quoted data ("spotlighting").
- **Doing the work.** The agent plans all the steps before acting (plan-then-execute, also called ReWOO) and splits large tasks from the smallest pieces up (least-to-most decomposition).
- **Verifying.** Before marking a task done, the agent writes check questions and answers each one by running something (Chain of Verification).
- **Learning from failure.** After a failed attempt, the agent writes why it failed and what it will change (Reflexion).
- **Planning.** The planning session works out which questions must be answered first and asks the owner exactly those (self-ask).
- **The one expensive method.** Debate among agents is reserved for planner decisions that would be expensive to reverse.

## 9. Settings and limits

Settings are TOML files resolved in three layers: the repository's defaults (`pa.default.toml`), the device file (`PA_HOME/pa.toml`), and the project file (`PA_HOME/projects/<id>/pa.toml`). The loader then clamps the dangerous values:

- **Agent cap:** 8 by default, never more than 10.
- **Concurrent sessions:** never more than the agent cap.
- **Attempts per task:** between 1 and 10, 5 by default.

The limits include a daily spending ceiling, runs per agent per day, a time limit per run, a token threshold per run that alerts the planner, and the list of shared documents agents may change.

## 10. Safety

The safety model rests on four ideas: the system is non-destructive by default, keys are never stored, authority is explicit, and content is not command.

1. **Non-destructive by default.** Rules forbid deleting others' work, force-pushing, rewriting history and dropping data. Claims prevent two agents from editing the same files, and immutability triggers prevent the plan from being rewritten under the owner.
2. **No stored keys.** The database refuses values that look like keys and accepts only the name of an environment variable or a file path.
3. **Explicit authority.** What agents may decide alone is recorded during planning. External actions and new features go through the planner to the owner.
4. **Content is not command.** Board messages, files and web pages are data for every agent.

The owner can stop one agent, one project, or every project, from the command line or the dashboard. When an agent is stopped or retired, the runner ends its running session at once (on Windows, the whole process tree), and a stop file for the project or the device ends every session.

One limit must be stated plainly: the owner-only checks are guardrails, not a security boundary. Inside a session started by the runner, the `pa` tool knows the agent's identity from the `PA_AGENT` variable, refuses any attempt to switch identity with `--agent` or `--as`, refuses owner-only commands (approving the plan, approving features, approving documents), and refuses to cancel another agent's task. But every agent runs as the same operating-system user as the owner and has a shell, so a session determined to misbehave could clear that variable or edit the database directly. The guardrails stop honest mistakes and casual misbehavior, and every change is recorded with its actor. True isolation would require running agents as a separate operating-system user without access to the owner's files, which is listed in the roadmap. The dashboard is protected separately: it accepts actions only with a random token embedded in its own page, only with a JSON body, and only for its own host name and port, so another web page open on the same computer cannot act through it.

## 11. The dashboard

The dashboard is a single page served by Node's built-in web server on 127.0.0.1:4777, started with `pa ui`. It reads the database directly and receives updates through Server-Sent Events (a standard way for a web server to push updates to a page over one open connection) whenever the project's state changes. If the database cannot be opened, the owner can point it at a project folder, and it reads the `.pa/state.json` snapshot in read-only mode. It shows:

- **Indicators:** tasks done, points, live agents, runs and agent time, tokens in and out, spending against the ceiling, and open questions.
- **Charts:** a radar chart of percent complete per category (drawn as an air-traffic radar, in keeping with the call signs), the scoreboard, and tokens per agent.
- **Tables and feeds:** the agents table, tasks grouped by agent, the message board with unanswered questions highlighted, proposals waiting for the owner, planning documents with their status, current file claims, and the vision.

The owner can act from the page: stop or start an agent or the project, pause or resume, approve or decline proposals, unblock tasks, and approve documents. Actions are accepted only from the local machine.

## 12. Decisions

`pa decide` gives agents and the runner a fast, structured decision step in the "System One" request shape used by decision models such as TypeSafe's Jev and the open GLiDE and OpenJev projects. A request names the state and asks typed questions: a choice among options, a score, or free text. The answer carries a choice with a confidence and per-option probabilities, a score, or text. Three backends are available: a dependency-free heuristic, any endpoint that speaks the System One shape (hosted, or local through OpenJev's decider), and Ollama with a JSON-schema answer. Every decision is recorded. The adapter exists and is tested with the heuristic backend; wiring it into the runner (for example, to classify a stuck run) is a roadmap item, because doing so before the owner has chosen a backend would hard-code a guess.

## 13. Objections considered

**"NATS alone would be simpler than NATS plus SQLite."** NATS can store messages and keys, and its key-value store has atomic create, so claims could live there. But the system's questions are relational: which questions have no reply, which tasks are runnable for this agent in priority order, how many points and tokens per agent. JetStream would make those queries the application's job. SQLite answers them in one query, survives restarts as one file, and needs no server. NATS remains the right tool for what it does best, push and presence, so each store does the job it is good at.

**"Plain files would be simpler than any database."** The earlier engine used per-writer files, and they work for one or two agents. They cannot make a claim atomic across processes, they grow without bound, and every reader must parse every file. The concurrency test shows the property that files lack.

**"An ORM would make the code cleaner."** The schema is small and the queries are short. An object-relational mapper would add a dependency and, for most of them, a build step, without removing complexity. Plain SQL in one module is easier to read and to audit.

**"A timer that wakes every agent every few minutes is simpler than a runner with wake rules."** It is simpler to write and expensive to run: each wake-up is a paid session. The runner's rules wake only agents with a reason, and NATS makes that immediate.

**"The VS Code extension should come first."** The owner asked for it later. More importantly, an extension is only a view on state; with the state in a database and a dashboard already reading it, the extension becomes a thin client rather than the place where the system lives.

## 14. What was left out, and why

Several things were left out on purpose. Each is small to add later, and leaving it out keeps the first version simple and honest.

1. **A VS Code extension and an MCP server:** deferred at the owner's request.
2. **Push into running sessions** (Claude Code channels, the Codex app-server protocol): both are experimental, and resume-on-demand works with every assistant today.
3. **Automatic merging and pushing:** the authority to merge is recorded during planning and exercised by the agents under the rules. The runner never touches version control, because a mistake there is the hardest to undo.
4. **Python:** not needed. One language keeps installation to a single runtime.
5. **Docker:** not needed. Everything runs as ordinary programs without administrator rights.
6. **A decision model in the runner:** the adapter exists, but the backend is the owner's choice.

## 15. Conclusion

The system meets its purpose by keeping every mechanism small and every rule explicit. The sessions supply the intelligence. The database supplies a record that cannot be silently changed. The board supplies coordination that cannot lose a message. The runner supplies wake-ups that cost nothing when there is nothing to do. The planning task supplies the perpetual loop, and the retirement rule supplies its end. The automated tests demonstrate the full cycle with a deterministic stand-in for the sessions, the atomicity of claims across processes, and every rule that can be checked by code. The same cycle has also run twice with real Claude Code sessions, which completed every task, wrote passing tests of their own, retired with stated reasons, and cost under two dollars per run. What remains to be proven is the same cycle with Codex and Copilot, the NATS integration on a machine where the server is installed, and the first run on Windows. Those are the first steps of the roadmap.
