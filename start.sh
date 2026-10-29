#!/usr/bin/env bash
# Start Perpetual Adaptive Agents: check everything, create what is missing the first time,
# repair what is broken, and start the service (NATS message board, runner, dashboard and API)
# unless it is already running and healthy. Safe to run any number of times, even at once.
#
#   bash start.sh                    (first run asks before creating the central folder)
#   bash start.sh --yes              accept the default central folder without asking
#   bash start.sh --home "<folder>"  choose the central folder (first run only)
#   bash start.sh --port 4777        dashboard and API port
#   bash start.sh --check            report health only, change nothing
#
# Prints one JSON object. Exit code: 0 healthy, 1 problem (the output says what and how to
# fix it), 10 a question for the user (first run, when no terminal is attached).
# Health at any time: http://127.0.0.1:4777/api/health
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo '{"ok": false, "step": "node", "problem": "Node.js is not installed or not on PATH", "fix": "install Node.js 22.13 or newer from nodejs.org (or: nvm install 22), then run start.sh again"}'
  exit 1
fi
exec node "$HERE/core/start.mjs" "$@"
