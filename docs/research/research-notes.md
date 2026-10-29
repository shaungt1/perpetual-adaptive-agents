# Research Notes

This file records the research behind the design, so that every technical choice can be traced to what was found. Each section says what was researched, what was found, how sure the finding is, and what the design took from it. Findings checked directly during the build (by running a command or opening a page) are marked **verified**. Findings that come from documentation read during earlier research, and that were not re-run, are marked **from documentation**. Anything still uncertain is marked **unverified**.

## 1. Running assistant sessions headless

A headless session is a chat session started from the command line with one instruction. It runs to the end of that instruction and exits, and its conversation is saved so it can be resumed later. All three assistants support this, with different options. The table below lists the options the provider adapters use (`core/providers.mjs`).

| Assistant | Start | Resume | Machine-readable output | Permissions | Extra folders |
|---|---|---|---|---|---|
| Claude Code | `claude -p "<prompt>"` | `--resume <session id>` | `--output-format json`: one JSON object with `session_id`, `usage` (input, output, cache tokens) and `total_cost_usd` (**verified** in the build environment) | `--permission-mode acceptEdits`, `--allowedTools ...` | `--add-dir <folder>` |
| Codex | `codex exec "<prompt>"` | `codex exec resume <session id> "<prompt>"` | `--json`: one JSON event per line, including `thread.started` (with `thread_id`) and `turn.completed` (with `usage`) (**from documentation**) | `--sandbox workspace-write` | `--add-dir <folder>` |
| Copilot command line | `copilot -p "<prompt>"` | not used by the adapter | none found | `--allow-all-tools` or `--allow-tool` | `--add-dir <folder>` |

Several findings shaped the runner. First, Claude Code's `--bare` option skips the subscription sign-in and requires an API key, so the adapter does not use it. Second, a session started from inside another session inherits the parent's identity variables. This was **verified** during the build: a child started without cleaning its environment reported the parent's session id. The runner therefore removes those variables (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT` and related ones) before starting a child. Third, on Windows, Codex and Copilot are installed by npm as `.cmd` wrapper scripts, which cannot be started directly. The adapter starts them through `cmd.exe` and reduces the prompt to letters, digits and simple punctuation, so that the Windows shell cannot misread it. The real instructions live in files the agent reads, so nothing is lost.

Push alternatives were also found: Claude Code "channels" (a research preview enabled with a development flag) and the Codex app-server protocol (experimental `turn/start` and `turn/steer` requests). Both could someday let the board speak to a running session directly. Both are experimental, so the design uses resume-on-demand instead and leaves push as a roadmap item.

## 2. The message board: NATS with JetStream

NATS is an open-source messaging server distributed as a single executable program. JetStream is its built-in persistence layer: it stores messages in "streams" and provides a key-value store. The findings that matter here are the following (**from documentation** unless marked):

1. A stream can be limited by message age (`max_age`), count (`max_msgs`) and total size (`max_bytes`). With the discard policy set to "old", the server deletes the oldest messages when a limit is reached. The defaults are unlimited, so the limits must be set; `core/nats.mjs` sets them from `pa.toml`.
2. A publisher can attach a message identifier (the `Nats-Msg-Id` header, `msgID` in the JavaScript client). Inside the stream's duplicate window, a second message with the same identifier is dropped. The board uses the message's database id, so a retried publish never creates a duplicate.
3. The key-value store supports atomic create, compare-and-set update, a time-to-live per bucket, and watching for changes. The board uses a key-value bucket with a time-to-live for presence (which agents are alive).
4. The server's documented minimum for a JetStream server is one processor core and 32 MiB of memory. It binds to all network interfaces unless told otherwise, so setup writes `listen: 127.0.0.1:4222`.
5. On Windows the server can be installed with Scoop (`scoop install main/nats-server`) or from the release archives. The latest release when this was written was **v2.15.1** (**verified** on the project's GitHub releases page: https://github.com/nats-io/nats-server/releases/latest). The release publishes `nats-server-v2.15.1-windows-amd64.zip`, archives for other systems, and a `SHA256SUMS` file (**verified** on the release's asset list), which setup uses to check the download.
6. The original JavaScript client package `nats` is deprecated. Its successor is split into `@nats-io/transport-node`, `@nats-io/jetstream` and `@nats-io/kv`, version 3.4.0 at build time (**verified**: npm printed the deprecation notice, and the function signatures were checked in the installed type definitions).

## 3. The record store: SQLite

SQLite is a database engine that keeps a whole database in one file and runs inside the program that uses it, with no server. Node.js includes a SQLite driver, `node:sqlite` with the class `DatabaseSync`, without a flag from version 22.13 (**verified** on Node 22.22). It needs no native compilation, which matters on Windows, where the common alternative (`better-sqlite3`) must be built or must download a prebuilt binary.

Many short-lived processes write to the same file, one per agent command. Write-ahead logging (WAL) lets readers proceed while one writer writes, and a busy timeout makes a second writer wait instead of failing. Claims need a check-then-write that no other process can interleave, so they run inside `BEGIN IMMEDIATE` transactions, which take the write lock at the start. The concurrency test **verified** this: six processes racing for the same file produce exactly one winner.

An object-relational mapper was considered and not used. The schema has about twenty small tables and every query is short; a mapper would add a dependency and a build step without removing any real complexity.

## 4. Decision models ("System One")

The owner asked for a fast decision model in the style of Jev. These findings come from earlier research (**from documentation**), and their details should be re-checked before the decision step is wired into the runner.

1. **Jev** is TypeSafe's decision model, offered as a hosted API. It is not open source.
2. **GLiDE** is a decision model from Fastino. Fastino describes its weights as open, and offers a hosted endpoint that accepts the same request shape (`POST /v1/systemone`, model `fastino/GLiDE`).
3. **OpenJev** is an MIT-licensed open-source project. It provides a small web server with a page for trying decisions, and three modes: "parallel" and "oneshot", which call any OpenAI-compatible endpoint (so a local Ollama server works), and "decider", which serves a 2-billion-parameter decision model that needs an NVIDIA graphics card with about 4 GB of memory and exposes the same `/v1/systemone` endpoint.
4. The shared request shape is a JSON object with a `state` (text or JSON describing the situation) and named `questions`, each of type `choice`, `score` or `noul`, with instructions and criteria. The answer gives, per question, a choice with a confidence and per-option probabilities, a score, or (for `noul`) free text. The exact meaning of `noul` was not confirmed; the adapter treats it as free text (**unverified**).

The design took the request shape, not any one model. `pa decide` accepts that shape and sends it to one of three backends: a dependency-free heuristic (always available and used in tests), any URL that speaks the System One shape (a hosted model or a local OpenJev decider), or Ollama with a JSON-schema answer. The owner can therefore switch between hosted and local models by changing one line in `pa.toml`.

## 5. Prompt-engineering methods

The owner's prompt-engineering reference collection describes forty-nine methods. Its own guidance is to combine a few rather than stack many: one input-cleaning step, one reasoning method, one verification method, and at most one expensive multi-agent method. The instruction set follows that guidance (rule 5): System 2 Attention to clean input, with "spotlighting" so that untrusted content is treated as data; plan-then-execute (ReWOO) and least-to-most decomposition for doing the work; Chain of Verification before a task is marked done; Reflexion after a failure; self-ask in the planning session; and multi-agent debate only for expensive planner decisions.

## 6. Instruction files

Registration writes a short pointer to the payload into the file each assistant reads on its own, and only for the assistants a project uses. Each location below was checked against the tool's own documentation in October 2026:

- **GitHub Copilot** reads repository-wide instructions from `.github/copilot-instructions.md`, and the documentation also describes `AGENTS.md` files used by agents ([Adding repository custom instructions for GitHub Copilot](https://docs.github.com/copilot/how-tos/custom-instructions/adding-repository-custom-instructions-for-github-copilot)).
- **Cursor** reads project rules from `.cursor/rules/*.mdc` (a plain `.md` file there is ignored); a rule with `alwaysApply: true` in its front matter applies to every chat. It also reads `AGENTS.md` in the project root ([Cursor: Rules](https://cursor.com/docs/rules)).
- **Kilo Code** includes every file in `.kilocode/rules/` automatically (kept for backward compatibility); newer projects list rule files under `instructions` in `kilo.jsonc`, which registration does not edit ([Kilo Code: Custom Rules](https://kilo.ai/docs/customize/custom-rules)).
- **Claude Code** reads `CLAUDE.md` and loads slash commands from `.claude/commands/`; **Codex** reads `AGENTS.md`. These two were used in the live runs.

Because `AGENTS.md` is read by Codex, Cursor and Copilot agents, registration always offers it.
