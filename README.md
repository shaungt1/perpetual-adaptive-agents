# Perpetual Adaptive Agents

Perpetual Adaptive Agents runs a team of AI chat sessions (Claude Code, OpenAI Codex, GitHub Copilot and others) on a project, code or not. One chat, the **project manager** (also called the Supervisor), plans the work with you and splits it into departments. It then creates the **agents**. Each agent works its own task lists, talks to the others on a message board, merges each finished task to `main`, and plans its next list. They keep going until the work is done or you stop them. Only the project manager talks to you, and nothing new (an optimization, a feature, research) starts without your yes.

**To set it up in a project, open a chat in that project and tell it: "Follow AGENT-SETUP.md in `<path to perpetual-adaptive-agents>`."** [AGENT-SETUP.md](AGENT-SETUP.md) has the formal steps the chat follows; this README is an overview.

## How it fits together

```
 perpetual-adaptive-agents/          one per computer; you leave it alone
   start.sh  ── checks, creates once, repairs, starts ──►  THE SERVICE (localhost)
   adaptive-agents/  (the payload)                          · NATS message board (one channel set per project)
        │                                                   · runner: starts and wakes agent sessions
        │ copied into each project                          · dashboard + API  http://127.0.0.1:4777
        ▼                                                   · central folder ~/.perpetual-adaptive-agents
 project A/.agents/adaptive-agents/workspace/  (JSON files) ◄── read by the service through its registered path
 project B/.agents/adaptive-agents/workspace/  (JSON files) ◄──
```

| Part | Where | What |
|---|---|---|
| **The service** | This folder; started with `bash start.sh`, stopped with `bash stop.sh` | NATS message board, the runner, and the dashboard and API for every registered project. |
| **The central folder** | `~/.perpetual-adaptive-agents` (or the folder you choose at the first `start.sh`) | One entry per registered project (`projects/<id>/link.json`), the NATS server program and its data, settings, logs, locks. Created once, after asking you. |
| **The payload** | `adaptive-agents/`, copied into each project | What every session reads (orders, board protocol, rules, procedures, skills, templates, schemas, examples), and, in `workspace/`, the project's records as JSON files with fixed names. |

## What happens

1. The chat in your project runs `start.sh` here and checks `http://127.0.0.1:4777/api/health`.
2. It copies `adaptive-agents/` into your project (`.agents/` by default) and registers the project through the API. It changes files outside that folder (such as `AGENTS.md`) only with your approval.
3. It becomes a project manager under a name it chooses, writes `workspace/project.json`, and plans the work with you: vision, gap analysis, the master task list, departments, agents.
4. On your approval, the service starts the agents. Each task gets its own git worktree and branch, is tested, merged to `main`, and verified, and leaves a completion record. Every list ends with a planning task; the next list stays inside the agent's department, and anything beyond fixes waits for your yes.
5. You watch and steer on the dashboard: all projects, then each project's metrics, master task cards (where you can object to a task or ask to remove it), agents, each agent's task lists and completion records, and the message board.

## Requirements

- Node.js 22.13 or newer, Git, and bash (on Windows, Git for Windows provides Git Bash).
- At least one signed-in assistant command line for the agents: `claude`, `codex` or `copilot`.
- The NATS server is downloaded by `start.sh` (checksum-verified), or run it in Docker with `docker compose up -d` here. Without it, the board works through each project's database.

## Commands

| Command | What it does |
|---|---|
| `bash start.sh` | Check, create once, repair, start. Safe to repeat. `--check` only reports. |
| `bash stop.sh` | Stop the service and the NATS server it started. |
| `pa projects` | Every registered project. |
| `pa status`, `pa inbox` | One project at a glance; what waits for you. |
| `pa proposals`, `pa task approve <id>`, `pa task decline <id>` | Decide on proposed work. |
| `pa stop [agent]`, `pa start [agent]` | Stop or restart one agent or the whole project. |
| `pa agent open <agent> --vscode` | Open an agent's conversation inside VS Code (needs the extension below). |
| `pa help` | Every command. |

`start.sh` puts `pa` on your PATH (on Windows, in your user PATH; open a new terminal afterwards).

## Optional: VS Code extension

`extensions/vscode/` opens agent sessions as VS Code editor tabs, so you can watch an agent and type to it. Install it with `bash extensions/vscode/scripts/package.sh --install`.

## Settings

Defaults are in `pa.default.toml`. Override them for the computer in `<central folder>/pa.toml`, or for one project in its `adaptive-agents/config.toml`: agent cap (8, at most 10), sessions at once, attempts per task (3, at most 5 with a written reason), the project manager's minimum wake interval, daily spending and token ceilings, and the providers.

## Folder map

| Path | Contents |
|---|---|
| `start.sh`, `stop.sh` | Start and stop the service. |
| `AGENT-SETUP.md` | The formal setup steps for a chat. |
| `adaptive-agents/` | The payload copied into projects. |
| `core/` | The `pa` command, start-up checks, registration, records, runner, providers, planner, service. |
| `dashboard/` | The dashboard and API server and page. |
| `extensions/vscode/` | The optional VS Code extension. |
| `scripts/` | `publish-to-github.sh`. |
| `docker-compose.yml` | Optional: NATS in Docker. |
| `tests/` | Unit, end-to-end (mock sessions), start-up, git workflow, NATS and live tests. |
| `docs/` | Requirements, design paper, gap analysis, roadmap, research, and `origins/` (the original vision documents). |

## Tests

```bash
npm test                                         # everything that needs no paid session
node tests/e2e/run-live.mjs --provider claude    # a real run with Claude Code (spends tokens)
```

## Status

See `docs/gap-analysis.md` (what is proven, with evidence) and `docs/roadmap.md` (what is left).
