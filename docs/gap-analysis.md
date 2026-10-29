# Gap Analysis and Final Comparison

This document compares the system against its hard requirements (`requirements.md`) twice. Part 1 compares the material that existed before this build: the `evolution-agents` repository and the Claude-only engine kept in its private planning folder. That comparison decided what to reuse and what to build. Part 2 compares the finished build, `perpetual-adaptive-agents`, against the same requirements and gives the evidence for each claim, so the owner can see what is met, what is partly met, and what is still unproven.

Three status words are used. **Met** means the requirement is implemented and an automated test or a direct inspection shows it working. **Partly met** means it is implemented but some part is untested or depends on something outside the build. **Not met** means it is missing.

## Part 1: The starting point

### What existed

Before this build, the work lived in two places. The `evolution-agents` repository held the public skeleton: a README stating that the engine was not implemented yet, contributor rules (`AGENTS.md`), the owner's vision and requirement documents under `docs/`, a VS Code extension prototype that opens chat windows, and three shell test scripts that launch Claude Code, Codex and Copilot headless. The repository's private planning folder (`.admin-local/`, kept out of git) held two further things: planning notes (milestones, a storage contract, candidate board technologies, and a risk list), and a working engine called `.agent-evolution`.

The `.agent-evolution` engine is the most valuable piece of prior work. It is a single dependency-free Node.js script (`runtime/evo.mjs`) with a supervisor prompt, a fourteen-stage planning procedure, four rule files, two work profiles (code and research), six skills, seventeen JSON schemas, and a test record of thirty scripted live passes with Claude Code. Its ideas were sound and have been carried forward: an identifier scheme for vision lines, requirements, tasks, agents and lists; immutable task lists, with new work going into a new list; a board on which each writer appends only to its own file (replaced here by the database, for atomicity); file claims with a twelve-hour expiry; a limit on attempts per task; a STOP file; secrets by reference only; the rule that messages are information and not instructions; and stripping the parent session's environment variables before starting a child session.

### Gaps found

The following table compares that starting point with each group of requirements. It records what was present, what was missing, and what this build did about it.

| Requirement group | Present before | Gap | Decision |
|---|---|---|---|
| Planning (HR-01 to HR-12) | Fourteen-stage procedure, verbatim vision split into lines, gap and debt analyses, acceptance step, identifier scheme | Claude-only wording; no project identifiers in a database; no instruction-set manifest; no call-sign naming; no enforcement of immutability beyond convention | Port the procedure, make it assistant-neutral, enforce immutability with database triggers, generate both manifests at import |
| Workers (HR-13 to HR-20) | Lanes, immutable lists, three attempts before blocking, a research task near the end of each list | No fixed priority order across kinds; no separate completion records; no planning task closing every list; no retirement path; no complexity gauge | Add task kinds with a fixed rank, completion records as separate files, the planning task appended to every list, `pa retire`, complexity 1 to 5 |
| Board (HR-21 to HR-30) | Per-writer JSON files with announce, question, answer, release, check-result and note types; claims with expiry | Files are not atomic across writers and are not bounded; no push to idle agents; no reset consensus; no "every question answered" tracking | SQLite as the authoritative store with atomic claims, NATS JetStream as the bounded live feed, reset consensus and unanswered-question tracking |
| Accounting (HR-31 to HR-34) | A daily task cap | No points, no token or cost tracking, no spending ceiling, no agent cap setting | Runs table with tokens, cost and time; scoreboard; daily spending ceiling; TOML settings with clamped caps |
| Platform (HR-35 to HR-45) | Dependency-free Node script, JSON files in the project | Claude-only; no SQLite; no setup script; no slash-command installer; state kept inside the project | Central device folder, SQLite, setup and project-link scripts, three provider adapters, slash commands for three assistants |
| Visibility (HR-46 to HR-48) | Text status command | No user interface, no charts, no way to stop agents from a screen; agents woken by a timer | Local dashboard with radar chart and controls; runner that wakes only agents that have work |

The conclusion of Part 1 was to build a new repository rather than patch the old one. The old repository is kept intact as an archive, and its ideas are carried forward as described.

## Part 2: Final comparison

This part checks every hard requirement against the finished build. The evidence column names the automated test (in `tests/`), the file that implements the requirement, or the reason something is unproven. The test suite has twenty-four tests: twenty-three passed in the build environment and one (NATS) was skipped there, because no NATS server could be installed in that environment.

### Planning

| ID | Status | Evidence |
|---|---|---|
| HR-01 | Met | `instructions/commands/pa-plan.md`, installed by setup for Claude Code and Codex (setup test run), and as a VS Code prompt file. Without a plugin, the owner can ask any session to follow `instructions/planning-agent.md`. |
| HR-02 | Met | `pa project create`; end-to-end test checks the `P-xxxxxx` identifier. |
| HR-03 | Met | `pa resource add` (folders, links, key references, access, expectations, constraints, tools); procedure stage 1. |
| HR-04 | Met | Database triggers refuse updates and deletes on `vision`; unit test "vision and master task list are immutable"; end-to-end test compares stored text byte for byte. |
| HR-05 | Partly met | The procedure requires the backtrace and the three analyses (stage 2 and stage 3). They are written by the planning agent, so their quality depends on the session; the test case does not exercise a real planning session. |
| HR-06 | Met | Triggers on `master_tasks`; import refuses a second import. Unit test. |
| HR-07 | Met | Categories in `plan.json`, validated at import. |
| HR-08 | Met | Seven documents required by the procedure plus three generated at import; `documents` table with made, checked and approved; `pa approve` refuses unchecked documents (end-to-end test). |
| HR-09 | Met | `core/planner.mjs` creates the folder, renders `templates/worker.md`, writes `lists/L1.json` and the agent manifest; end-to-end test checks names Iceman-X1 to Raptor-X4 and every instructions file. |
| HR-10 | Met | `instruction_sets` table and `instruction-manifest.json`. |
| HR-11 | Met | Runner launches nothing unless the project phase is `running`, which only `pa approve` sets. End-to-end test. |
| HR-12 | Met | `addResource` refuses values that look like keys; unit test "secrets are refused". |

### Workers

| ID | Status | Evidence |
|---|---|---|
| HR-13 | Met (by rule) and partly enforced | Lane rules in the worker template and rule 1. Enforced in code: an agent cannot start another agent's task (unit test). Cross-lane file edits are governed by claims and the rule, not by code. |
| HR-14 | Met (by rule) | Run-loop step 4 in the worker template. Not checkable by code. |
| HR-15 | Met | `KIND_RANK` and `nextTask`; unit test "next task follows priority". Agent-proposed features start as `proposed` and only the owner can approve them (end-to-end test). |
| HR-16 | Met | `completed/<task id>.json` per task plus the `completions` table; end-to-end test reads a record. |
| HR-17 | Met | `failTask` blocks at `tasks.max_attempts` (default 5, clamped 1 to 10) and asks the planner; unit test; end-to-end test shows a recorded failed attempt. |
| HR-18 | Met | `createList` appends a planning task; end-to-end test shows agent A01 creating a second list that again ends with a planning task. A defect found by this test (the second planning task was not appended while the first was in progress) was fixed. |
| HR-19 | Met | `pa retire`; stopping criteria in `planning-objective.md`; end-to-end test shows all four workers retiring. |
| HR-20 | Met | `startTask` refuses a second in-progress task; complexity column with a 1 to 5 check. |

### Board

| ID | Status | Evidence |
|---|---|---|
| HR-21 | Met | Automatic announce, done, need-tasks, planning, proposal and retire messages; end-to-end test checks each type appears. |
| HR-22 | Met | `pa board who --files` and the conflict reply from `pa task start`. |
| HR-23 | Met | `unansweredQuestions`, planner wake-up on questions, rerouting of questions sent to retired agents; end-to-end test ends with zero unanswered questions. |
| HR-24 | Met | `pa stop [agent]`, `pa stop --all-projects`, dashboard buttons; end-to-end test "stop, pause and the daily spending ceiling". |
| HR-25 | Met | `pa reset start`, `pa checkin`; unit test "reset consensus completes only when every live agent checks in". |
| HR-26 | Met (by rule) | Rule 4; nothing in the code deletes project files. |
| HR-27 | Partly met | `core/nats.mjs` uses the official NATS JavaScript client (version 3) and creates the `PA_BOARD` stream and the `pa_presence` key-value bucket; setup writes the server configuration and downloads the official release with checksum verification. The integration test `tests/e2e/nats.test.mjs` exists but was skipped in the build environment because the server could not be installed there. It must be run once on the owner's computer. |
| HR-28 | Partly met | In SQLite, board messages older than `board.db_retention_days` (default 30) are pruned hourly, except questions still waiting for a reply (unit test). In NATS, the stream limits (age, count, size, discard oldest, duplicate window) are set in code and checked by the NATS test, which has not been run yet. |
| HR-29 | Met | `BEGIN IMMEDIATE` transactions; concurrency test: six processes race for one file, exactly one wins, five receive exit code 3 and post a conflict. Claims expire after twelve hours. |
| HR-30 | Met (by rule) | Worker template section 5, rule 2 item 6, rule 4 item 6; prompts on the command line are reduced to safe characters. |

### Accounting and limits

| ID | Status | Evidence |
|---|---|---|
| HR-31 | Met | Points per completion; end-to-end test checks 23 points for A01 and 12 for the others. |
| HR-32 | Met for Claude Code and Codex, partly for Copilot | Provider parsers read session id, tokens and cost (unit test with sample output). The Copilot command line prints no usage data, so only time is recorded for it. Stuck counts and average complexity are in the agent statistics. |
| HR-33 | Met | Daily spending ceiling and runs per agent per day; end-to-end test shows the ceiling stopping work. |
| HR-34 | Met | `pa.default.toml`; `clamp` enforces 8 by default and 10 at most; unit test. `docs.agent_writable` lists shared documents. |

### Platform and delivery

| ID | Status | Evidence |
|---|---|---|
| HR-35 | Met | Node's built-in SQLite driver, WAL mode, plain SQL migrations. No ORM was needed; see the design paper. |
| HR-36 | Met | `setup/setup.mjs`, run in a temporary home folder during the build. |
| HR-37 | Met | `setup/install-project.mjs` and `pa project create` write `.pa/project.toml` with the project id, PA_HOME and the NATS address. |
| HR-38 | Met | Commands installed as user-level files, plus project-level copies with `--with-commands`. |
| HR-39 | Met for Claude Code, partly for Codex and Copilot | Two live runs of the test case with Claude Code (Part 3). Codex and Copilot adapters are unit-tested but not yet run live. Headed mode: `pa agent open <id>` and the `/pa-work` command. |
| HR-40 | Met | Node only. Python was not needed. |
| HR-41 | Met by design | Project kind, categories and task kinds are content-neutral; nothing in the code assumes source code. Not yet exercised on a non-code project. |
| HR-42 | Met | Runner, NATS and dashboard are separate processes; the project receives only `.pa/project.toml`, `.pa/.gitignore` and `.pa/state.json`. No administrator rights are needed. |
| HR-43 | Partly met | `pa decide` speaks the System One request and response shape with three backends (heuristic, any System One endpoint, Ollama). Only the heuristic backend is tested. It is not yet called by the runner. |
| HR-44 | Met | No extension or MCP server was built. |
| HR-45 | Met | Repository with code, instructions, tests, research notes and these documents. |

### Visibility

| ID | Status | Evidence |
|---|---|---|
| HR-46 | Met | `pa ui` serves a dashboard with indicators, a radar chart, scoreboard, token chart, agents table, tasks, board feed, proposals, documents, claims and the vision. It accepts a project folder path. It was checked in a headless browser at desktop and phone widths, in dark and light themes, with no console errors. |
| HR-47 | Met | Stop and start per agent and per project, pause and resume, approve and decline proposals, unblock tasks, approve documents. Actions are accepted only from the local machine. |
| HR-48 | Met | The runner wakes an agent only for runnable tasks, messages addressed to it, stop requests or resets; broadcast notes do not wake anyone (unit test). With NATS running, board messages wake the runner at once; without it, the runner polls on its tick. |

### Robustness

| ID | Status | Evidence |
|---|---|---|
| HR-49 | Met | Runner lock file and stale-run reaping; test "a run left open by a dead runner is closed ... only one runner at a time". |
| HR-50 | Met (as a guardrail) | Identity switching, owner-only commands and cross-agent cancels are refused inside a session; the dashboard requires its page token, a JSON body and its own host. Tests "agents cannot switch identity ..." and "dashboard actions need the page token ...". The design paper (section 10) states that these are not a security boundary. |
| HR-51 | Met | Progress counts state changes only; test "a session that leaves a background process ..." shows runs without progress ending in `stuck`. |

### Independent review

After the first build passed its tests, a separate reviewer that had not seen the build's reasoning read the code and ran its own experiments against it. It reported twenty-three findings. All were addressed, and each fix that can be tested has a regression test in `tests/unit/hardening.test.mjs`. The table below summarizes them by severity, with the fix applied.

| Severity | Finding | Fix |
|---|---|---|
| High | The runner crashed when a session's background process wrote output after the session exited | Logs written through a stream; a run finishes on the pipes closing, with a short fallback after exit |
| High | A run left open by a dead runner blocked its agent forever | Stale runs closed at every tick; one runner per device |
| High | Agents could switch identity or cancel other agents' tasks | Identity fixed by the session; ownership checked; limits documented as guardrails |
| High | Dashboard actions were open to any local page; two script-injection paths | Page token, host and origin checks, JSON only; no inline handlers; boot data escaped |
| Medium-high | "database is locked" when many processes opened the database at once | Busy timeout set before anything else, retries on open; migrations checked inside their transaction |
| Medium | A task could be failed without being started; owner and agent actions could race; stuck detection rarely fired; unfair wake order; stopping one agent did not end its session; no spending ceiling for Codex or Copilot; two runners possible; one bad agent could stop the runner | Each fixed in the store or runner; Codex cost estimated from configured prices; daily token ceiling added |
| Windows | Git's own `tar` cannot unpack the NATS zip; line endings broke command installation; unsafe agent names and `%` in arguments; `.cmd` commands named with their extension | System `tar.exe` called by full path; line endings normalized and `.gitattributes` added; names, models and providers validated; `%` refused through `cmd.exe`; command lookup fixed |
| Low | Closed NATS connections cached; resets that could never finish; PATH update could change the type of the user's PATH; small command-line parsing bugs | Long-lived processes reconnect and resubscribe; resets wait only for wakeable agents and can be cancelled; PATH written as an expandable registry value; option values parsed strictly |

## Part 3: Live runs, and what is still unproven

After a restart of the build environment, Claude Code there could run independent headless sessions, so the test case was run twice with real sessions (Claude Code, Sonnet model), using `tests/e2e/run-live.mjs`. The comparison below gives the measured results of both runs. The first run exposed two defects, which were fixed before the second.

| Measure | First live run | Second live run (after fixes) |
|---|---|---|
| Master tasks completed | 8 of 8 (11 of 11 including planning tasks) | 8 of 8 (12 of 12 including planning tasks) |
| Tests written by the agents | 13, all passing | 14, all passing |
| Agents retired with a stated reason | 4 of 4 | 4 of 4 |
| Questions left unanswered | 0 | 0 |
| Session runs | 10 | 10 |
| Total cost | $1.43 | $1.94 |
| Worker usage recorded | No: sessions were ended by the runner when the agents retired themselves, so their usage output was lost | Yes: every run exited normally, with tokens and cost recorded |
| Planning points on retirement | Lost: retiring cancelled the planning task | Scored: retiring completes the planning task |

The agents' work was checked independently. The storage worker made notes persist through an atomic write (a temporary file, then a rename) and refused to overwrite a corrupt data file. The command-line worker implemented add, list and delete with usage messages and exit codes. The guide worker verified its guides by running the commands. The test worker's tests pass when run outside the system. The planner answered the owner in `owner-inbox.md` with one optional proposal (a `notes` command entry in `package.json`) and did not start it, as the rules require.

The live runs also showed that the planner is the largest cost: in the second run, its six runs cost $1.08 of $1.94, because it was woken for every status note. The planner is now woken at most once every two minutes (`runner.planner_min_interval_seconds`), except for unanswered questions and resets. This change is covered by the automated tests but has not yet been measured in a live run.

Three things remain unproven, and they are the first items on the roadmap. First, Codex and Copilot have not been run live; their adapters follow their documentation and their command lines are unit-tested. Second, the NATS integration test was skipped because the server program could not be installed in the build environment; it runs automatically wherever `nats-server` is installed. Third, nothing was run on Windows. The code handles Windows paths, `.cmd` command shims, the system `tar.exe` and process-tree termination, but those paths have only been reasoned about and reviewed, not executed.

## Part 4: Second version (payload, Supervisor, service)

| ID | Status | Evidence |
|---|---|---|
| HR-52 | Met | `core/service.mjs` (`pa up`, `pa down`, `pa service status`) runs the runner over every registry entry and the dashboard; `/api/projects` lists them all. |
| HR-53 | Met | `adaptive-agents/` with `bin/install.sh` and `scripts/install-into.sh`; `core/install.mjs` registers the payload path. Test: `protocol.test.mjs` (cwd discovery, register through the API). |
| HR-54 | Met | `adaptive-agents/SUPERVISOR.md`, `procedures/planning-session.md`, `pa plan import` writes the manifest and agent folders. |
| HR-55 | Met | `pa task ask-user`, `pa answer` (Supervisor or user only), `pa inbox`. Test: pause / ask-user / answer. |
| HR-56 | Met | `createList` makes only critical and bug tasks `todo` for agent-written lists. Test: growth gating. |
| HR-57 | Met | `pa task fail` with `--extend`, hard maximum 5, related board activity from the second failure. Test: loop limits. |
| HR-58 | Met | `protocol/message-board.md`, message types branch/merge/push/pause/resume/shutdown, mentions wake the agent. Test: mentions. |
| HR-59 | Met | Conflict procedure in `protocol/message-board.md`; `pa task pause` releases files. |
| HR-60 | Met | `bin/task-branch.sh`, `bin/merge-task.sh`; `pa task done` refuses an unmerged branch. Test: `git-flow.test.mjs`. |
| HR-61 | Met | `CALL_SIGNS` in `core/planner.mjs`. |
| HR-62 | Met | Planning task appended to every list; `procedures/next-task-list.md`. |
| HR-63 | Met | `procedures/planning-session.md` writes to `docs/plans/`. |
| HR-64 | Met | `scripts/*.sh`, payload `bin/*.sh`, extension `scripts/package.sh`. |
| HR-65 | Met | `rules/06-safety.md` and `AGENTS.md` rule 1; nothing in the code writes there. |
| HR-66 | Partly met | `extensions/vscode` 0.4.0 adds an attach route and `pa agent open --vscode`. Not yet run on the owner's VS Code. |

## Part 5: Third round (setup, registration, visibility)

Every test named below is in `tests/` and passes in `npm test`.

| ID | Status | Evidence |
|---|---|---|
| HR-67 | Met | `start.sh` and `core/start.mjs`. Tests in `tests/e2e/start.test.mjs`: the first run asks; `--yes` creates once; a second run changes no file; `--check` changes nothing; a crashed service is restarted; two runs at the same moment start exactly one service. |
| HR-68 | Met | `GET /api/health` in `dashboard/server.mjs` (central folder, runner heartbeat, NATS, each project's folder). Tested in `start.test.mjs` and `protocol.test.mjs`. |
| HR-69 | Met | `AGENT-SETUP.md`; `README.md` points to it. |
| HR-70 | Met | `start.sh` asks before creating the central folder (exit code 10 when no terminal); `--home` chooses another, remembered in `.pa-home`; a non-empty folder not made by the service is refused. Tested. |
| HR-71 | Met | `registry.json` removed; each project is `projects/<id>/link.json`, written under a lock. Test: four projects registering at the same moment are all registered. |
| HR-72 | Met | `core/register.mjs` detects `.claude`, `.codex`, `.github`, `.cursor`, `.kilocode`; formats checked against each tool's documentation (`docs/research/research-notes.md`). The dry run lists every file and why; only approved files are written. Tested (a Cursor project gets no Copilot file; an unapproved `CLAUDE.md` is not written; an existing `AGENTS.md` keeps its text). |
| HR-73 | Met | `locatePayload` finds the copy wherever it is or uses the given location; `plans_folder` is chosen at registration, stored in `project.json`, used by every instruction. |
| HR-74 | Met | `workspace/project.json` (schema `schemas/project.schema.json`), `pa project set`, `pa pm join` (self-chosen name and number, several allowed). Tested. |
| HR-75 | Met | `core/files.mjs`, `GET /api/projects/<id>/files`. Tested. |
| HR-76 | Met | `dashboard/index.html` views: all projects (rename), project (overview, master task cards with Object / Ask to remove, agents, board), agent page. Checked in a browser; the feedback reached the project manager's board and the rename reached `project.json`. |
| HR-77 | Met | `pa task done --findings --errors`; record has `complete: true`; schema updated. |
| HR-78 | Met | `adaptive-agents/examples/` with a README naming the command that writes each file. |
| HR-79 | Met | `pa plan validate` refuses a department without scope, owns, out of scope or done definition; each agent's instructions include its departments' definitions. Tested. |
| HR-80 | Met | `bin/merge-task.sh` records one merge commit per task. Test `git-flow.test.mjs`: main is a two-parent merge commit; one `git revert -m 1` undoes the task. |
| HR-81 | Met | `docker-compose.yml`; `start.sh` uses a NATS already listening on 4222. The Docker path itself was not run here (no Docker in the build environment). The NATS server itself is now proven: `start.sh` downloaded v2.15.1, verified its checksum and started it; `tests/e2e/nats.test.mjs` passes (live feed, stream limits, duplicate dropping, presence); the live run ran with NATS push on. |
| HR-82 | Met for setup and registration | Each start-up step and each registration error has a message with the fix (tested: busy port, foreign folder, missing folder, missing payload). |

### Live run of the third version (real Claude Code sessions)

A fresh project was set up exactly as `AGENT-SETUP.md` describes, with the service running on a clean computer (no central folder beforehand):

1. `start.sh` asked before creating the central folder (exit code 10), created it on `--yes`, downloaded and checksum-verified the NATS server, and started the service; `/api/health` reported `ok` with NATS connected.
2. The payload was copied to `.agents/adaptive-agents`; the dry-run registration listed eight files outside it (AGENTS.md, CLAUDE.md, five Claude Code commands, `docs/plans/`) with reasons; all were approved and written; the project got its own `projects/<id>/link.json`.
3. The project manager joined as `Orion-00`, filled `project.json`, imported a four-department plan, and the user approved it.
4. Result: all 8 master tasks done, 14 of 16 tasks done, 10 task merge commits on `main` (one per code task), no branches left, 16 tests written by the agents all passing on `main`. Two optimizations were proposed and wait for the user; a worker's question to the project manager was answered on the board.

Two defects were found and fixed during the run:

- **Database handle kept after its file was deleted.** The service kept a project's database open; when the project's `workspace/` was deleted and the project registered again, writes went to the deleted file. `openDb` now reopens a file whose identity changed (test: `hardening.test.mjs`).
- **Spending overshot the ceiling by one run.** With a $4 ceiling the run reached $4.48, because one run was always allowed while under the ceiling. A run now starts only if the spending so far plus every run in flight plus this one, at the average cost, stays within the ceiling. After the ceiling was raised to $7 to finish the test, the run stopped at $6.46 with no further launch.
- Also fixed: records written when an agent retires now carry `complete`, `findings` and `errors`, and a retiring agent's clean worktree is removed.
