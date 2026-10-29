---
name: testing
description: Department playbook for testing. Test suites, test tooling, coverage and end-to-end checks. Other departments still test their own work; this department strengthens the safety net.
---

# Testing

Read this playbook if your department is testing. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- test infrastructure and shared fixtures
- end-to-end and integration suites
- coverage measurement
- flaky-test hunting

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- requirements in the plan with no test
- flaky or slow tests
- untested error paths
- tests that check implementation details instead of behavior

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- New tests fail before the fix and pass after it
- The whole suite passes on main
- Flaky tests are fixed or quarantined with a note on the board

## Pitfalls

- Rewriting another department's code to make it testable without asking
- Deleting failing tests
