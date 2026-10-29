# Example files

Filled-in examples of every structured file in an Adaptive Agents project, from a small notes tool. Each one has the same shape as the real file; only the values are invented. The exact rules for each shape are in `../schemas/`.

| Example | The real file | Written by | When |
|---|---|---|---|
| `project.json` | `workspace/project.json` | registration, then `pa project set` and `pa pm join` | at registration; updated as the project manager learns about the project |
| `plan.json` | `<plans folder>/plan.json` (for example `docs/plans/plan.json`) | the project manager | at the end of planning, before `pa plan import` |
| `master-tasks.json` | `workspace/manifest/master-tasks.json` | `pa plan import` | once; never edited |
| `agent-manifest.json` | `workspace/manifest/agent-manifest.json` | `pa plan import`, `pa agent add`, `pa pm join` | whenever an agent joins or changes status |
| `agent.json` | `workspace/agents/<name>/agent.json` | `pa plan import` or `pa agent add` | when the agent is created |
| `task-list-L1.json` | `workspace/agents/<name>/lists/L1.json` | `pa plan import` | the agent's first list; never edited |
| `task-list-L2-written-by-the-agent.json` | `workspace/agents/<name>/lists/L2.json` | the agent, with `pa list new` | at its planning task; bugs and critical items start as `todo`, optimizations, features and research start as `proposed` and wait for the user |
| `completion-record.json` | `workspace/agents/<name>/completed/<task id>.json` | the agent, with `pa task done` | once per finished task; never edited |

A task is done when its completion record exists. Lists are never changed after they are written; the dashboard works out what is done from the completion records.
