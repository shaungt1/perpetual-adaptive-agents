# Adaptive Agents for VS Code

Optional. The service runs agents headless without it. This extension lets you **watch and talk to an agent's session inside VS Code**.

What it does:

- **Open an agent session** (`Adaptive Agents: Open an Agent Session`, or `pa agent open <name> --vscode`): opens the Claude Code or Codex conversation that an agent is running in, as an editor tab. You can read what it has done and type to it.
- **Start a new session** (`Adaptive Agents: Experimental Claude/Codex/Copilot Session`): starts a new conversation with a prompt and opens it in a new window. These came from the earlier prototype.

Needs the Claude Code extension (for Claude sessions), the Codex extension (for Codex sessions) or GitHub Copilot Chat (for Copilot).

## Install

From the repository folder, in Git Bash:

```bash
bash extensions/vscode/scripts/package.sh --install
```

This builds `extensions/vscode/.build/frontside.evolution-agents-0.4.0.vsix` and installs it. The extension id is kept as `frontside.evolution-agents` so it replaces the earlier prototype instead of installing a second copy. Reload VS Code afterwards.

## Links it understands

- `vscode://frontside.evolution-agents/attach?tool=claude&session=<id>` opens an existing session (add `&window=new` for its own window).
- `vscode://frontside.evolution-agents/open?tool=...&name=...&cwd=...&instructions=...&task=...` starts a new session. The instructions file must be inside the project's `.agents`, `.claude` or `tests/instructions` folder.

Prototype logs go to the system temp folder, never into a project.
