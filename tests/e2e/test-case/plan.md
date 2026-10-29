# notes-lite: plan of action (test case)

This short plan is the human-readable form of `plan.json` in the same folder. It is what the planning agent would write as `07-plan-of-action.md` for the test project.

## Categories and agents

The work splits into four categories, one agent each, so no two lanes share files.

| Category | Agent (assigned at import) | Lane | First tasks |
|---|---|---|---|
| C1 Storage | A01 (Iceman-X1) | `src/store.js` and the data file | T-001 persist notes to a JSON file; T-002 delete a note |
| C2 Command line | A02 (Viper-X2) | `src/cli.js` | T-003 `add` and `list` commands; T-004 `delete` command |
| C3 Guide | A03 (Falcon-X3) | `docs/` | T-005 two-minute usage guide; T-006 command reference |
| C4 Tests | A04 (Raptor-X4) | `test/` | T-007 store tests; T-008 command-line tests |

## Order of work

Owner requests come first (all eight tasks are owner requests or their parts), then any bugs the agents find, then optimizations. The web page in the vision is future work: an agent may propose it, and it waits for the owner.

## Limits and authority

At most four agents, three running at once, five dollars a day. Agents may merge small proven changes to the working branch; publishing and anything else go to the owner.
