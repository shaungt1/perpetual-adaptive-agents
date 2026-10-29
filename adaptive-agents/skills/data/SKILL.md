---
name: data
description: Department playbook for data. Schemas, migrations, pipelines, analytics and data quality.
---

# Data

Read this playbook if your department is data. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- database schemas and migrations
- data pipelines and imports
- analytics events and reports
- data quality checks

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- schema needs from the plan and the board
- migrations that are not reversible or not tested
- missing constraints and indexes
- data that is collected but never used, or needed but never collected

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- Migrations are tested forward (and backward where possible) on a copy of the data
- Schema changes are announced on the board before they merge
- Data checks pass

## Pitfalls

- Destructive migrations without the user's approval
- Changing a column other departments read without telling them
