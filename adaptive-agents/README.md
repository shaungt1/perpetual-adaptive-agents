# adaptive-agents

This folder is the **Adaptive Agents payload**. Copied into a project, it lets one chat session act as a **project manager** (the Supervisor role): it plans the work with the user, splits it into departments, and has a team of independent chat sessions (**agents**) carry it out. Each agent works its own task lists, talks to the others on a shared **message board**, merges each finished task to `main`, and plans its next list when it finishes, until the work is done or the user stops it.

Everything the sessions need to read is in this folder. The **Perpetual Adaptive Agents service**, started from the `perpetual-adaptive-agents` folder with `start.sh`, provides what a folder cannot: the message board server (NATS), the runner that starts and wakes the agent sessions, and the dashboard and API at http://127.0.0.1:4777. The `pa` command connects the two.

## If you are a chat session reading this

- **The user asked you to set up the agents, and this folder is not registered yet** (there is no `workspace/project.json`): follow `AGENT-SETUP.md` in the `perpetual-adaptive-agents` folder.
- **The user asked you to plan, manage or supervise the agents:** you are a **project manager**. Read [SUPERVISOR.md](SUPERVISOR.md) now and follow it.
- **You were started as an agent:** the environment variable `PA_AGENT` is set, or your first message gives you a name like `Zorro-01`. Run `pa whoami`, then read the instructions file it prints and follow it.
- **None of these:** you have no role here. Do not edit anything in this folder.

## What is in this folder

| Path | What it is |
|---|---|
| `SUPERVISOR.md` | The project manager's standing orders: roles, start-up, the planning session, starting agents, watching the board, talking to the user. |
| `protocol/message-board.md` | The message board: every message type, when each must be posted, and how to respond. Every session follows it. |
| `rules/` | Rules every agent follows: roles, departments and priority, loop limits and escalation, git and worktrees, coding standards, records, safety, reasoning methods. |
| `procedures/` | Step-by-step procedures: the planning session, gap analysis, the next task list, shutting down and retiring. |
| `skills/` | One playbook per kind of department (front end, back end, APIs, AI, data, DevOps, testing, security, docs, research, content, design, finance). |
| `templates/` | The templates the system fills in to make each agent's instructions file. |
| `schemas/` | The exact shape of every structured file. |
| `examples/` | A filled-in example of every structured file, and which command writes each one. |
| `commands/` | Slash commands, copied into `.claude/commands` for projects that use Claude Code. |
| `bin/` | Git Bash scripts: `pa` (the agents' tool), `task-branch.sh` (a worktree and branch per task), `merge-task.sh` (test, merge to main, verify). |
| `VERSION` | The version of these instructions. |
| `config.toml` | Created at registration: this project's id, settings, and where the service is. |
| `workspace/` | Created at registration and filled by the project managers and agents: `project.json`, the manifests, each agent's folder with its task lists and completion records, run logs, the state snapshot, and the database. |

## Setting it up in a project

Follow `AGENT-SETUP.md` in the `perpetual-adaptive-agents` folder. In short: run `start.sh` there, check `http://127.0.0.1:4777/api/health`, copy this folder into the project (`.agents/` by default), and register the project with `POST /api/projects/register`. Registration creates `config.toml` and `workspace/` here, and changes files outside this folder only with the user's approval.

Commit this folder with the project. `workspace/` is git-ignored by its own `.gitignore`: it changes constantly while agents work, and the service reads it from here.

Big planning documents belong in the project's plans folder (`plans_folder` in `workspace/project.json`, `docs/plans` by default), not here.
