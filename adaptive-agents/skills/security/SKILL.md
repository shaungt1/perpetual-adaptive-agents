---
name: security
description: Department playbook for security. Authentication, authorization, secrets handling, input safety and dependency health.
---

# Security

Read this playbook if your department is security. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- authentication and session handling
- authorization checks
- secrets handling (references only)
- dependency audits and updates

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- endpoints or actions without authorization checks
- injection risks in queries, shell commands and templates
- secrets in code, logs or history
- dependencies with known vulnerabilities

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- Each fix has a test that would have caught the problem
- Findings with severity are posted to the Supervisor; critical ones are tasks of kind critical
- Nothing sensitive appears in the completion record

## Pitfalls

- Publishing details of a vulnerability on the board before it is fixed (send them to the Supervisor only)
- Changing other departments' code without coordination
