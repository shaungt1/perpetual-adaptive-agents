#!/usr/bin/env bash
# Package the VS Code extension into extensions/vscode/.build/*.vsix.
#   bash extensions/vscode/scripts/package.sh            build only
#   bash extensions/vscode/scripts/package.sh --install  build and install into VS Code
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vsix="$(node "$here/package.mjs")"
echo "Packaged: $vsix"
if [[ "${1:-}" == "--install" ]]; then
  command -v code >/dev/null 2>&1 || { echo "The VS Code 'code' command is not on PATH." >&2; exit 1; }
  code --install-extension "$vsix" --force
fi
