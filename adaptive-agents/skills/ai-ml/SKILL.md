---
name: ai-ml
description: Department playbook for ai and models. Model calls, prompts, evaluation, retrieval, and the data models need.
---

# AI and models

Read this playbook if your department is ai and models. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- prompts and model-call code
- retrieval and embedding pipelines
- evaluation sets and scoring
- cost and latency of model calls

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- every AI feature in the plan and how it is measured
- prompts without evaluation sets, and outputs without validation
- cost per call and calls that could be cached or batched
- failure handling when the model is slow, wrong or unavailable

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- An evaluation set exists for the behavior you changed, with before-and-after numbers in the completion record
- Model output is validated (schema, ranges, refusals) before it is used
- No keys in code; the model name is configurable

## Pitfalls

- Judging a prompt change by one example
- Leaking user data into prompts or logs
