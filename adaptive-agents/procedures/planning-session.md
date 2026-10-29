# Procedure: the planning session (Supervisor)

The Supervisor runs this procedure with the user present. Its output is a plan the user has approved, a workforce of agents with folders, instructions and first task lists, and the manifest. Nothing is built during the session.

The procedure has nine stages.

## Stage 1: Interview the user (take the order)

Ask, listen, and confirm each answer back to the user before moving on, until the user says it is right.

1. **Vision.** Ask what the user wants this project to become, including the large and long-term ideas. Save it **exactly in the user's words**: write it to a file and run `pa vision add --file <file>`. Never reword, fix or summarize it. A changed vision is a new version (`pa vision add` again); old versions are kept.
2. **Existing plans and feature lists.** Ask for everything the user already has: feature lists, plans, designs, maps, architecture notes. Some of these are folders several levels deep with instructions and layouts. Read every one. For each, tell the user in a few sentences what you understood, and correct it until the user agrees. Record each folder or file: `pa resource add --kind folder --name "<what it is>" --ref <path>`.
3. **Priorities and expectations.** Ask what matters most, what is required and what is a wish, and how much may be spent per day. The daily spending limit goes in `config.toml` under `[limits] daily_usd`.
4. **Keys and access.** Ask which accounts, services and keys the work needs. Record only the name of the environment variable or file that holds each one: `pa resource add --kind key_ref --name "<what it is>" --ref <ENV_VAR_NAME>`. Never write a key's value anywhere.
5. **Authority.** Ask which of these the agents may do without asking:
   - merge to main (normally yes, after tests pass);
   - push to the remote (`[project] push = true` in `config.toml` only if the user says yes);
   - deploy;
   - publish.

   Record each answer with `pa resource add --kind constraint`.
6. **Private folders.** Ask whether any folders must never be touched (for example a private `.admin-local/` folder). Record them as constraints and in the plan document.
7. **Tools.** Ask which assistant runs the agents (`claude`, `codex` or `copilot`) and whether the user cares about models. Then ask for the project's test command and set it: `[project] test_command` in `config.toml`, for example `npm test`.

## Stage 2: Backtrace the project

Read the project's structure, main files, configuration, tests, documentation and history (`git log`). Trace how the main parts connect and how they came to be.

Write the result to `<plans folder>/backtrace.md` in the project. Big planning documents always go in the project's `<plans folder>/` folder.

## Stage 3: Gap analysis

Follow [gap-analysis.md](gap-analysis.md). The result is `<plans folder>/gap-analysis.md`, with three parts: what is missing, what is weak (technical debt), and the final combined list.

## Stage 4: The giant list

Combine into one list:

- everything from the user's feature lists;
- everything from the final analysis;
- every bug you found.

Give every item:

- an id (`T-001`, ...);
- a kind (`critical`, `owner_request`, `bug`, `optimization`, `feature`, `research`);
- a title and a detail;
- acceptance criteria a stranger could test;
- a complexity from 1 to 5 (split anything above 3);
- a source (the vision line, the feature list or the finding it came from).

Prioritize it with the user: critical first, then the user's requests and all their parts, then bugs, then optimizations, then features, then research. Write it to `<plans folder>/master-task-list.md` as a readable table.

## Stage 5: Departments

Split the list into departments by kind of work, so that no two departments touch the same files (see `rules/01-departments-and-priority.md` and the playbooks in `skills/`). Fewer, clearer departments beat many overlapping ones. Every task belongs to exactly one department.

## Stage 6: The workforce

Assign one agent per department, or one agent to several small departments. The cap is 8 agents (`agents.max_active`), with a hard maximum of 10.

For each agent, write:

- a lane sentence: what it owns, in files and folders;
- a persona: the specialist it should act as, in one or two sentences;
- its resources: the folders, documents and plans it should read;
- its first tasks: master task ids, in priority order.

The system names the agents (Zorro-01, Kafka-02, ...).

## Stage 7: Write and import the plan

Write `<plans folder>/plan.json`. The schema is `schemas/plan.schema.json`, and `examples/plan.json` is a complete example. Every department must say exactly what it covers, because each agent later re-plans only inside its department: `scope`, `owns` (the files and folders only it changes), `out_of_scope` and `done_definition`. Import refuses a department without them. A short example:

```json
{
  "departments": [{ "id": "C1", "name": "API", "scope": "The HTTP endpoints, their contracts and input validation.", "owns": ["src/api/", "docs/api/"], "out_of_scope": "The database schema and the web front end; ask those departments on the board.", "done_definition": "Each endpoint matches its contract, has tests, and is merged to main with the tests passing." }],
  "master_tasks": [{ "id": "T-001", "category": "C1", "kind": "owner_request", "title": "...", "detail": "...", "acceptance": "...", "complexity": 2, "source": "feature list: docs/features/api.md" }],
  "agents": [{ "departments": ["C1"], "lane": "Owns src/api/ and docs/api/.", "persona": "A careful API designer.", "provider": "claude", "resources": ["docs/plans/api-map.md"], "tasks": ["T-001"] }],
  "supervisor": { "provider": "claude" }
}
```

Then:

1. `pa plan validate <plans folder>/plan.json` and fix every error.
2. `pa plan import <plans folder>/plan.json`. This creates each agent's folder, its rendered instructions, its first task list (ending with the planning task), and the manifests in `workspace/manifest/`.
3. Register your planning documents: `pa doc add --key <key> --title "<title>" --path <file>` for the backtrace, the gap analysis, the master list and the plan.

## Stage 8: Verify

Check the plan against the questions in `SUPERVISOR.md`, section 6. For each document that passes, run `pa doc status <key> checked`.

## Stage 9: Approval and start

Present the plan to the user briefly:

- the departments;
- the agents and their first tasks;
- the limits;
- what will come back to the user for decisions.

Only on the user's explicit yes, run `pa approve`. Make sure the service is running (`pa service status`). Then tell the user the agents are starting and where to watch: the dashboard at http://127.0.0.1:4777.
