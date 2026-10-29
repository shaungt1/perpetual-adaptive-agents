#!/usr/bin/env bash
# Stop Perpetual Adaptive Agents: the runner and dashboard, and the NATS server start.sh
# started. Agents in the middle of a task are stopped; their work is on their task branches.
#   bash stop.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/core/cli.mjs" down --nats
