# AGENT-SETUP: setting up Adaptive Agents in a project

These are formal instructions for a chat session (Claude Code, Codex, Copilot, Cursor, Kilo Code or another assistant) that the user asked to set up Adaptive Agents in a project. Follow the steps in order. Do not skip a step, and do not go on to the next step while the current one reports a problem: tell the user exactly what it reported, and what fixes it.

The user is the person who asked you to do this. **The project** is the folder the user is working in (your current workspace), not this folder.

## What you are setting up

Perpetual Adaptive Agents has two parts:

| Part | Where it lives | What it does |
|---|---|---|
| **The service** | This folder, `perpetual-adaptive-agents`, run once per computer | Runs the NATS message board server, the **runner** (which starts and wakes agent sessions), and the dashboard and API at `http://127.0.0.1:4777`, for every registered project. Keeps one **central folder** (default `~/.perpetual-adaptive-agents`) with one entry per registered project. |
| **The payload** | The folder `adaptive-agents/` in this folder, copied into each project | Everything the sessions read: the project manager's orders, the message-board protocol, rules, procedures, skills, templates, schemas and examples. After registration, its `workspace/` holds that project's records as JSON files with fixed names, which the dashboard reads. |

After setup, you become the project's **project manager** (also called the Supervisor): you plan the work with the user, create the agents, and supervise them. You are the only session that talks to the user.

## Step 1. Start the service and check it

Run, in Git Bash (or any bash), from this folder:

```bash
bash start.sh
```

`start.sh` is safe to run any number of times, even while it is already running elsewhere. It checks Node.js and the packages, creates the central folder the first time (and only then), checks and repairs it every other time, makes sure the NATS server program is there, and starts the service unless it is already running and healthy. It prints one JSON object. Read it, then act on its exit code:

| Exit code | Meaning | What you do |
|---|---|---|
| `0` | The service is running and healthy. | Go to step 2. |
| `10` | First run: it needs the user's permission to create the central folder. The output has `question` and `default`. | Ask the user the question. If the user accepts the default, run `bash start.sh --yes`. If the user names another folder, run `bash start.sh --home "<that folder>"`. If the user says no, stop and tell the user nothing was installed. |
| `1` | A problem. The output's last step says what, and how to fix it (for example: Node.js missing, a port in use by another program, a folder that is not empty). | Tell the user the problem and the fix in plain words. Do not try workarounds the output does not mention. Run `start.sh` again after the fix. |

A NATS server that could not be downloaded is **not** a failure: the board then works through each project's database, and agents are woken on a timer instead of instantly. Tell the user, and continue.

## Step 2. Confirm health through the API

```bash
curl -s http://127.0.0.1:4777/api/health
```

(If `start.sh` was given `--port`, use that port everywhere instead of 4777.)

Continue only if `ok` is `true`. If not, `problems` lists each problem with its fix; tell the user and stop. `warnings` (such as NATS not running) do not stop you; mention them to the user.

## Step 3. Copy the payload into the project

1. **Is it already there?** Look for `adaptive-agents/SUPERVISOR.md` inside the project's `.agents/`, `.claude/`, `.codex/`, `.github/`, `.cursor/`, `.kilocode/` or `.vscode/` folder. If you find it, the project may already be set up: go to step 4 (registering again is safe and keeps the same project).
2. **Where to put it.** If the project has a `.agents/` folder, the payload goes in `.agents/adaptive-agents`. If it does not, ask the user where it should go, and offer `.agents/adaptive-agents` as the default. Use the answer as `<location>` below (for example `.agents`).
3. **Copy** the whole `adaptive-agents` folder from this folder into `<project>/<location>/adaptive-agents`. Copy it as it is. Do not copy a `workspace/` folder or a `config.toml` if you see one in the source; registration creates them.

## Step 4. Register the project: first a dry run

Registration tells the service where the project is. Ask it first what it would do, without changing anything:

```bash
curl -s -X POST http://127.0.0.1:4777/api/projects/register \
  -H "content-type: application/json" \
  -d '{"path": "<absolute path of the project>", "location": "<location>", "name": "<project name>", "tools": ["<your tool>"], "dry_run": true}'
```

- `name`: what the user calls the project. If unknown, leave it out; the folder name is used, and the user can rename it in the dashboard later.
- `tools`: the assistant tools this project is used with: any of `claude`, `codex`, `copilot`, `cursor`, `kilocode`. Always include your own. Leave it out to use the tools detected from the project's folders (`.claude`, `.codex`, `.github`, `.cursor`, `.kilocode`).
- `plans_folder` (optional): where the planning documents go, inside the project. The default is `docs/plans`.
- On Windows, write paths with forward slashes, for example `C:/Users/name/projects/app`.

The answer lists, under `files_outside_payload`, every file **outside** the `adaptive-agents` folder that registration would create or change, and why. Each is one of:

- `AGENTS.md`: a short marked section pointing to the payload (read by Codex, Cursor, Copilot and Kilo Code agents);
- `CLAUDE.md` and `.claude/commands/pa-*.md`: only for projects that use Claude Code;
- `.github/copilot-instructions.md`: only for projects that use GitHub Copilot;
- `.cursor/rules/adaptive-agents.mdc`: only for projects that use Cursor;
- `.kilocode/rules/adaptive-agents.md`: only for projects that use Kilo Code;
- the plans folder, if it does not exist yet.

An existing file is never replaced: a marked section is appended to it, or updated if it is already there.

**Show the user this list, with the reason for each file, and ask which ones they approve.** Without these files, a new chat in the project will not know the payload exists, so recommend at least `AGENTS.md` and the file for the tool the user uses.

## Step 5. Register the project

Send the same request without `dry_run`, with the user's answer:

```bash
curl -s -X POST http://127.0.0.1:4777/api/projects/register \
  -H "content-type: application/json" \
  -d '{"path": "<absolute path of the project>", "location": "<location>", "name": "<project name>", "tools": ["<your tool>"], "approve_files": ["AGENTS.md", "CLAUDE.md"]}'
```

`approve_files` is the list the user approved, or `"all"`. Registration:

1. creates `config.toml` and `workspace/` inside the project's `adaptive-agents` folder: `workspace/project.json` (the project's identity), the database, and the folders for agents, manifests and run logs;
2. adds the project to the central folder, as its own file `projects/<project id>/link.json`, so two projects never write the same file;
3. writes only the approved files outside the payload, and lists the others under `files_not_changed`;
4. announces the project on its message-board channels, `pa.<project id>.*`.

Registering a project again keeps its id and records and only repairs what is missing.

If the answer has `"error"`, it has a `message` that says what is wrong and how to fix it, for example:

| `error` | Meaning |
|---|---|
| `not_found` | The project folder does not exist: check the path. |
| `payload_missing` | No `adaptive-agents` folder at the expected place: do step 3, or send the `location` you used. |
| `payload_incomplete` | The copy is missing files: copy it again. |
| `bad_input` | A value is wrong (for example a location outside the project); the message says which. |

Without the service, the same registration is `pa register <project folder> --location <location> --tools <tool> --dry-run`, then `--approve <files>`, using `node <this folder>/core/cli.mjs` in place of `pa`.

Tell the user, in two or three sentences, what was created and where. The dashboard now shows the project at `http://127.0.0.1:4777`.

## Step 6. Become the project manager

Read `<project>/<location>/adaptive-agents/SUPERVISOR.md` completely and follow it. It starts with joining the project under a name and number you choose, describing the project in `workspace/project.json`, and planning the work with the user.

The `pa` command is your tool from here on. If `pa` is not found, use `bash <project>/<location>/adaptive-agents/bin/pa`.

## Reference

| Item | Where |
|---|---|
| The service's health | `GET http://127.0.0.1:4777/api/health` |
| Every registered project | `GET http://127.0.0.1:4777/api/projects` |
| One project, read from its files | `GET http://127.0.0.1:4777/api/projects/<id>/files` |
| Dashboard | `http://127.0.0.1:4777` (all projects, then each project's overview, master task list, agents and message board) |
| Stop the service | `bash stop.sh` in this folder |
| The central folder | `~/.perpetual-adaptive-agents` unless the user chose another at the first `start.sh` |
| Examples of every record | `adaptive-agents/examples/` |
