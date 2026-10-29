# Contributor rules

These rules apply to anyone, person or AI session, who changes this repository.

1. Never read from, write to, or change `.admin-local/` or any other private folder of the owner unless the owner says so in that conversation. Never commit credentials, runtime transcripts, run logs, databases, `node_modules`, payload workspaces, or packaged extensions.
2. Do not commit, push or publish without the owner's instruction.
3. Preserve the owner's vision verbatim wherever it is quoted (`docs/owner-vision.md`, `docs/origins/`). Never reword it.
4. Keep reusable prompts, templates and skills generic: refer to "the user", never to a named person.
5. The payload (`adaptive-agents/`) must stay self-sufficient: everything a session needs is inside it, and it refers to the service only through the `pa` command.
6. Prefer the smallest design that meets a requirement. When something is left out, say what and why.
7. Every change to `core/` comes with a test, and `npm test` must pass before a change is called done.
8. Scripts are Git Bash (`.sh`). Use PowerShell only where nothing else works.
9. `README.md` is an overview. Setup instructions for chats live in `AGENT-SETUP.md`; keep the two consistent.
10. Requirements live in `docs/requirements.md`. When a change adds, alters or retires a requirement, update that file and `docs/gap-analysis.md` in the same change.
11. Only cite web addresses that were opened and checked.
