#!/usr/bin/env bash
# Open an existing agent session in a VS Code editor tab.
#   bash open-session.sh <claude|codex> <session-id> <project-folder> [--new-window]
# Normally called by `pa agent open <name> --vscode`, which looks the session id up for you.
set -euo pipefail
tool="${1:?tool: claude or codex}"; session="${2:?session id}"; folder="${3:?project folder}"
case "$tool" in claude|codex) ;; *) echo "tool must be claude or codex" >&2; exit 2;; esac
[[ "$session" =~ ^[A-Za-z0-9-]{8,80}$ ]] || { echo "invalid session id" >&2; exit 2; }
win=""; [[ "${4:-}" == "--new-window" ]] && win="&window=new"
command -v code >/dev/null 2>&1 || { echo "The VS Code 'code' command is not on PATH." >&2; exit 1; }
code --reuse-window "$folder"
code --open-url "vscode://frontside.evolution-agents/attach?tool=$tool&session=$session$win"
