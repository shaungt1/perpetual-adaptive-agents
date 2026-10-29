// Adaptive Agents: VS Code adapter (carried over from the Evolution Agents prototype).
//
// It opens assistant sessions inside VS Code:
//  - "open" (prototype): start a new Claude Code, Codex or Copilot conversation with a prompt,
//    and open it in an editor tab;
//  - "attach" (new): open an EXISTING agent session, by its session id, in a Claude Code or
//    Codex editor tab, so the user can watch it and type to it. The `pa agent open <name> --vscode`
//    command calls this through a vscode:// link.
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const vscode = require("vscode");

const HELLO = {
  claude: "Reply exactly: Hello world from Claude Code.",
  codex: "Reply exactly: Hello world from Codex. Do not use tools and do not modify files.",
  copilot: "Reply exactly: Hello world from GitHub Copilot.",
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function activeWorkspacePath() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function transcriptPath(cwd, name, tool) {
  // Prototype diagnostics are temporary, not production persistence or project files.
  const runDirectory = path.join(os.tmpdir(), "evolution-agents-experiments");
  fs.mkdirSync(runDirectory, { recursive: true });
  const safeName = `${name}-${tool}`.replace(/[^A-Za-z0-9._-]/g, "-");
  const logPath = path.join(runDirectory, `${safeName}-${crypto.randomUUID()}.live.log`);
  fs.writeFileSync(
    logPath,
    `Evolution Agents experiment\nprovider=${tool}\nname=${name}\nworkspace=${cwd}\nstarted=${new Date().toISOString()}\n\n`,
    "utf8",
  );
  return logPath;
}

function appendTranscript(logPath, text) {
  fs.appendFileSync(logPath, text, "utf8");
}

function showTranscriptTerminal(cwd, name, logPath) {
  if (process.platform !== "win32") return;
  const shellPath = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const escapedPath = logPath.replace(/'/g, "''");
  const terminal = vscode.window.createTerminal({
    name: `Agent transcript: ${name}`,
    cwd,
    shellPath,
    shellArgs: [
      "-NoExit",
      "-NoProfile",
      "-Command",
      `Get-Content -LiteralPath '${escapedPath}' -Wait`,
    ],
  });
  terminal.show(true);
}

async function promptForTask(tool) {
  return vscode.window.showInputBox({
    prompt: `Instruction to send to ${tool}`,
    value: HELLO[tool],
    ignoreFocusOut: true,
  });
}

async function requireExtension(id, label) {
  const extension = vscode.extensions.getExtension(id);
  if (!extension) {
    throw new Error(`${label} is not installed in this VS Code profile.`);
  }
  await extension.activate();
  return extension;
}

async function detachActiveEditor() {
  await delay(250);
  await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
}

async function waitForActiveWebview(viewType, previousTab, timeoutMilliseconds = 10000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (
      activeTab &&
      activeTab !== previousTab &&
      activeTab.input &&
      activeTab.input.viewType === viewType
    ) {
      return;
    }
    await delay(100);
  }
  throw new Error(`${viewType} did not become the active editor in time.`);
}

function claudeExecutable(extensionPath) {
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(extensionPath, "resources", "native-binary", executable),
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".local", "bin", executable),
  ];
  const candidate = candidates.find((item) => fs.existsSync(item));
  if (!candidate) {
    throw new Error("The native Claude Code executable was not found.");
  }
  return candidate;
}

function runClaude(executable, cwd, prompt, name, logPath) {
  const sessionId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const processHandle = childProcess.spawn(
      executable,
      [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--session-id",
        sessionId,
        "--name",
        name,
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read",
        "Edit",
        "Write",
        "Bash",
      ],
      { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    processHandle.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendTranscript(logPath, text);
    });
    processHandle.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendTranscript(logPath, text);
    });
    processHandle.on("error", reject);
    processHandle.on("close", (exitCode) => {
      appendTranscript(logPath, `\n[process exited ${exitCode}]\n`);
      let result;
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "result") result = event;
        } catch {}
      }
      if (exitCode !== 0 || !result || result.is_error) {
        const details = (stderr || stdout).trim().slice(-1500);
        reject(
          new Error(
            `Claude did not create a conversation (exit ${exitCode}).${
              details ? ` ${details}` : ""
            }`,
          ),
        );
        return;
      }
      resolve(sessionId);
    });
  });
}

async function showClaudeSession(sessionId, { newWindow = true } = {}) {
  await requireExtension("anthropic.claude-code", "Claude Code");
  const previousTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  await vscode.commands.executeCommand(
    "claude-vscode.primaryEditor.open",
    sessionId,
    undefined,
  );
  await waitForActiveWebview("claudeVSCodePanel", previousTab);
  if (newWindow) await detachActiveEditor();
}

async function openClaude(prompt, cwd = activeWorkspacePath(), name = "claude-chat") {
  if (!cwd) {
    throw new Error("Open a workspace folder before launching Claude.");
  }
  const extension = await requireExtension("anthropic.claude-code", "Claude Code");
  const logPath = transcriptPath(cwd, name, "claude");
  showTranscriptTerminal(cwd, name, logPath);
  const sessionId = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Starting persistent Claude conversation",
      cancellable: false,
    },
    () => runClaude(claudeExecutable(extension.extensionPath), cwd, prompt, name, logPath),
  );
  await showClaudeSession(sessionId);
}

async function openCopilot(prompt) {
  await requireExtension("github.copilot-chat", "GitHub Copilot Chat");
  await vscode.commands.executeCommand("workbench.action.chat.open");
  await vscode.commands.executeCommand("workbench.action.chat.newChat", {
    inputValue: prompt,
    agentMode: true,
  });
  await delay(250);
  await vscode.commands.executeCommand("workbench.action.chat.openInNewWindow");
}

function codexExecutable(extensionPath) {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const architecture = process.arch === "x64" ? "x86_64" : "aarch64";
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const candidate = path.join(
    extensionPath,
    "bin",
    `${platform}-${architecture}`,
    executable,
  );
  if (!fs.existsSync(candidate)) {
    throw new Error(`Codex executable was not found at ${candidate}`);
  }
  return candidate;
}

function runCodex(executable, cwd, prompt, logPath) {
  return new Promise((resolve, reject) => {
    const processHandle = childProcess.spawn(
      executable,
      ["-a", "never", "exec", "--sandbox", "danger-full-access", "--json", "-C", cwd, prompt],
      { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";

    processHandle.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendTranscript(logPath, text);
    });
    processHandle.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendTranscript(logPath, text);
    });
    processHandle.on("error", reject);
    processHandle.on("close", (exitCode) => {
      appendTranscript(logPath, `\n[process exited ${exitCode}]\n`);
      let threadId;
      let completed = false;
      let failed = false;
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "thread.started") {
            threadId = event.thread_id;
          }
          if (event.type === "turn.completed") completed = true;
          if (event.type === "turn.failed") failed = true;
        } catch {
          // Codex may print a non-JSON status line before its JSONL events.
        }
      }

      if (exitCode !== 0 || !threadId || !completed || failed) {
        const details = (stderr || stdout).trim().slice(-1500);
        reject(
          new Error(
            `Codex did not create a conversation (exit ${exitCode}).${
              details ? ` ${details}` : ""
            }`,
          ),
        );
        return;
      }
      resolve(threadId);
    });
  });
}

async function showCodexThread(threadId, { newWindow = true } = {}) {
  await requireExtension("openai.chatgpt", "Codex");
  const resource = vscode.Uri.from({
    scheme: "openai-codex",
    authority: "route",
    path: `/local/${threadId}`,
  });
  await vscode.commands.executeCommand(
    "vscode.openWith",
    resource,
    "chatgpt.conversationEditor",
    { preview: false },
  );
  if (newWindow) await detachActiveEditor();
}

async function openCodex(prompt, cwd = activeWorkspacePath(), name = "codex-chat") {
  if (!cwd) {
    throw new Error("Open a workspace folder before launching Codex.");
  }
  const extension = await requireExtension("openai.chatgpt", "Codex");
  const logPath = transcriptPath(cwd, name, "codex");
  showTranscriptTerminal(cwd, name, logPath);
  const threadId = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Starting Codex conversation",
      cancellable: false,
    },
    () => runCodex(codexExecutable(extension.extensionPath), cwd, prompt, logPath),
  );
  await showCodexThread(threadId);
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function requestFromUri(uri) {
  const query = new URLSearchParams(uri.query);
  const tool = query.get("tool");
  const name = query.get("name");
  const cwd = query.get("cwd");
  const instructionFile = query.get("instructions");
  const task = query.get("task");

  if (!HELLO[tool]) {
    throw new Error(`Unsupported chat tool: ${tool || "(missing)"}`);
  }
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error("The agent name is missing or invalid.");
  }
  if (!cwd || !instructionFile || !task) {
    throw new Error("The launcher request is missing cwd, instructions, or task.");
  }

  const resolvedInstruction = fs.realpathSync(instructionFile);
  const instructionRoots = [path.join(path.resolve(cwd), ".agents"), path.join(path.resolve(cwd), ".claude"), path.join(path.resolve(cwd), "tests", "instructions")];
  if (path.extname(resolvedInstruction).toLowerCase() !== ".md" || !instructionRoots.some((root) => fs.existsSync(root) && isInside(fs.realpathSync(root), resolvedInstruction))) {
    throw new Error("The Markdown instruction file must be inside .agents, .claude or tests/instructions.");
  }
  const instructions = fs.readFileSync(resolvedInstruction, "utf8");
  return {
    tool,
    name,
    cwd,
    prompt: [
      `You are agent '${name}'.`,
      `Your instruction file is ${instructionFile}.`,
      "Follow these standing instructions:",
      instructions,
      `Task: ${task}`,
    ].join("\n\n"),
  };
}

// Attach to an existing agent session (started headless by the Adaptive Agents runner).
function attachRequestFromUri(uri) {
  const query = new URLSearchParams(uri.query);
  const tool = query.get("tool");
  const session = query.get("session");
  if (!["claude", "codex"].includes(tool)) throw new Error(`Attaching is supported for claude and codex, not ${tool || "(missing)"}`);
  if (!session || !/^[A-Za-z0-9-]{8,80}$/.test(session)) throw new Error("The session id is missing or invalid.");
  return { tool, session, newWindow: query.get("window") === "new" };
}

async function open(tool, prompt, cwd, name) {
  if (tool === "claude") return openClaude(prompt, cwd, name);
  if (tool === "codex") return openCodex(prompt, cwd, name);
  if (tool === "copilot") return openCopilot(prompt);
  throw new Error(`Unsupported chat tool: ${tool}`);
}

async function reportErrors(operation) {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Adaptive Agents: ${message}`);
  }
}

function registerPromptCommand(context, command, tool) {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async () => {
      const prompt = await promptForTask(tool);
      if (prompt) await reportErrors(() => open(tool, prompt, undefined, `${tool}-chat`));
    }),
  );
}

function activate(context) {
  registerPromptCommand(context, "evolutionAgents.experimental.openClaude", "claude");
  registerPromptCommand(context, "evolutionAgents.experimental.openCodex", "codex");
  registerPromptCommand(context, "evolutionAgents.experimental.openCopilot", "copilot");

  for (const tool of Object.keys(HELLO)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `evolutionAgents.experimental.hello${tool[0].toUpperCase()}${tool.slice(1)}`,
        () => reportErrors(() => open(tool, HELLO[tool], undefined, `${tool}-hello`)),
      ),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("adaptiveAgents.attachSession", async () => {
      const tool = await vscode.window.showQuickPick(["claude", "codex"], { placeHolder: "Which assistant runs the agent?" });
      if (!tool) return;
      const session = await vscode.window.showInputBox({ prompt: "Session id (pa agent list shows it)", ignoreFocusOut: true });
      if (!session) return;
      await reportErrors(() => (tool === "claude" ? showClaudeSession(session, { newWindow: false }) : showCodexThread(session, { newWindow: false })));
    }),
  );

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) =>
        reportErrors(async () => {
          if (uri.path === "/attach") {
            const r = attachRequestFromUri(uri);
            if (r.tool === "claude") return showClaudeSession(r.session, { newWindow: r.newWindow });
            return showCodexThread(r.session, { newWindow: r.newWindow });
          }
          if (uri.path !== "/open") {
            throw new Error(`Unknown URI route: ${uri.path}`);
          }
          const request = requestFromUri(uri);
          await open(request.tool, request.prompt, request.cwd, request.name);
        }),
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
