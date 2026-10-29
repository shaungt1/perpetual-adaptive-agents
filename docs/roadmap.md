# Roadmap

This roadmap orders the remaining work by dependency and risk, not by date. Each stage lists what it delivers and how anyone can tell it is finished. A stage starts when the one before it is finished, and the owner may reorder or skip stages at any point. The first stage closes the three gaps that the final comparison (`gap-analysis.md`, Part 3) could not prove in the build environment, because every later stage depends on them.

## Stage 1: Prove it on the owner's computer

This stage turns "should work" into "works here".

1. In a chat in a real project on Windows, follow `AGENT-SETUP.md`. **Done when** `start.sh` reports healthy, `/api/health` shows NATS connected, and the project appears on the dashboard.
2. Run `npm test` with nats-server installed. **Done when** every test passes, the NATS integration test included.
3. Run `node tests/e2e/run-live.mjs --provider claude --usd 3` on Windows (it has passed twice on Linux), then with `--provider codex` and with `--provider copilot`. **Done when** each provider completes the eight test-case tasks, the dashboard shows tokens (and cost, for Claude Code, and for Codex once prices are set), and the run logs show no permission prompts that stalled a session.
4. Measure the planner's share of cost with the new wake-up interval, and fix whatever the live runs reveal (likely candidates: Copilot's tool-permission options and the Codex resume syntax, both taken from documentation and not yet executed). **Done when** step 3 passes without manual help.

## Stage 2: First real project

This stage uses the system for real work and lets the work correct the system.

1. Install the payload into a small real project and run a full Supervisor planning session of the owner's, with no more than four workers. **Done when** the owner has approved the plan and the runner has completed the first lists.
2. Record every rough edge in `future-changes.md` (the planner keeps it). **Done when** the owner has reviewed the list.
3. Tighten the worker and planner templates from what the sessions actually did. **Done when** a second run of the same project shows fewer stuck runs and fewer unanswered questions.

## Stage 3: Decisions and scheduling

This stage adds the pieces that make the system run unattended for days.

1. Choose a decision backend (a hosted System One endpoint, a local OpenJev decider, or Ollama) and wire `pa decide` into two places: classifying a stuck run (unclear task, impossible task, or misbehaving agent) and ranking proposals before the planner pitches them. **Done when** both decisions are recorded in the `decisions` table and shown on the dashboard.
2. Start the runner and NATS automatically at sign-in through Windows Task Scheduler, created by a `pa service install` command. **Done when** a restart of the computer resumes work without the owner opening a terminal.
3. Add calendar-based planning for content projects (for example, "plan next week's posts every Saturday"). **Done when** a weekly planning task appears on schedule for a content project.

## Stage 4: Editor integration and React dashboard

This stage brings the dashboard into the editor.

1. Done in part: `extensions/vscode` opens agent sessions as editor tabs (`pa agent open --vscode`). Next: show the dashboard in a side panel and the agents in the sidebar, reading the same database and NATS feed. **Done when** the owner can do everything the web dashboard does without leaving the editor.
2. Rebuild the dashboard in React with the same API (`/api/projects`, `/api/state`). **Done when** it shows everything the current page shows.
3. An MCP server (Model Context Protocol, a standard way to give a session extra tools) that exposes the `pa` commands as tools. **Done when** a session can use the board without a shell.
4. Push into running sessions through Claude Code channels or the Codex app-server protocol, if they have left their experimental status. **Done when** a stop request reaches a running session within seconds.

## Stage 5: Sharing

This stage makes the system usable by people other than the owner.

1. A one-command installer for Windows, macOS and Linux that bundles the NATS server. **Done when** a newcomer can install and run the test case by following the README alone.
2. Example projects of other kinds (a writing project and a weekly finance report). **Done when** each runs end to end with the mock provider in the test suite.
3. Multi-machine operation: one NATS server and one shared database service for a team. **Done when** two computers can run agents on the same project without conflicts.
