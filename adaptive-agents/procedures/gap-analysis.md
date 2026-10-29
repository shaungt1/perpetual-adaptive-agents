# Procedure: gap analysis

The Supervisor uses this for the whole project during planning. Each agent uses it for its own department during every planning task.

A gap analysis compares **what exists** with **what should exist** and lists the difference. It has three parts, always in this order.

## Part 1: Gaps (what is missing)

For every requirement, compare it with the current code or content and record the requirement, what exists, and what is missing. Requirements come from:

- the vision;
- the user's feature lists;
- the master task list;
- for an agent, its department's share of all three.

A requirement with nothing built is a gap. A requirement that is partly built is a gap too, recording only the missing part.

## Part 2: Technical debt (what is weak)

For everything that exists in the scope, look for:

- code or content that works but is fragile, duplicated, unclear or untested;
- errors that are swallowed, logged and ignored, or worked around;
- shortcuts with comments like TODO, FIXME, HACK or "temporary";
- slow paths, wasteful calls, missing caching or limits;
- dependencies that are outdated or unmaintained;
- missing documentation for anything a newcomer would need.

## Part 3: Final analysis (the list)

Merge both parts into one list of tasks, each with a kind:

| Kind | Use it for |
|---|---|
| `critical` | Broken builds, data at risk, security holes. |
| `bug` | Anything that does not work as intended. |
| `optimization` | Anything that works but should be faster, cheaper, clearer or more reliable. |
| `feature` | New capability or territory. |
| `research` | Unknowns that need measuring, testing with users, or gathering data first. |

For each task, also ask the three questions from the coding standards:

1. Are there errors around it?
2. Could it be more performant?
3. Could something be added that brings more value?

Order the list: critical, then the user's requests, then bugs, then optimizations, then features, then research.

Write it where your procedure says: the Supervisor writes `<plans folder>/gap-analysis.md`; an agent writes it into its notes before writing its next list.
