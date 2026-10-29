---
name: devops
description: Department playbook for devops. Build, continuous integration, environments, deployment and infrastructure.
---

# DevOps

Read this playbook if your department is devops. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- build scripts and tooling
- continuous integration pipelines
- environment configuration (never the secrets themselves)
- deployment scripts and infrastructure definitions

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- steps that are manual but should be scripted
- slow or flaky builds and tests
- missing health checks, logs and alerts
- differences between environments

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- The pipeline passes on main after your change
- Every new script runs in Git Bash on Windows as well as on Linux and macOS
- Deployments only with the user's approval through the Supervisor

## Pitfalls

- Deploying, or changing cloud resources, without approval
- Putting secrets in pipeline files
