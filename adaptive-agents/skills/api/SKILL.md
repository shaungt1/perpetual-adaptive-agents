---
name: api
description: Department playbook for apis. Endpoints and contracts: routes, request and response shapes, validation, versioning, API documentation.
---

# APIs

Read this playbook if your department is apis. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- route handlers and their validation
- request and response schemas and their documentation
- authentication hooks at the API edge (with the security department)
- API versioning and deprecation

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- every endpoint the front end or other clients need, from the plan and the board
- missing validation and inconsistent error formats
- undocumented or out-of-date endpoints
- slow endpoints and payloads that are too large

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- Contract tests or integration tests for every changed endpoint pass
- The API documentation matches the code
- Breaking changes were announced on the board, and the consumers confirmed them

## Pitfalls

- Breaking a response shape other departments depend on without warning
- Validating only on the client
