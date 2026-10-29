---
name: backend
description: Department playbook for back end. Server logic: services, business rules, background jobs, persistence and data access.
---

# Back end

Read this playbook if your department is back end. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- services and business logic
- background jobs and queues
- data access and persistence layers
- server configuration

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- each business rule in the plan and whether it is implemented and tested
- error handling: nothing swallowed, every failure observable
- slow queries, missing indexes, N+1 query patterns, missing caching
- concurrency and transaction safety

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- Unit tests for the logic and an integration test for the data path pass
- Migrations, if any, are reversible or have been agreed with the data department
- Logs and errors are meaningful

## Pitfalls

- Editing endpoint contracts owned by the API department
- Schema changes without announcing them on the board
