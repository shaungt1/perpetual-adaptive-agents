# Agent Launcher: Operating Guide and System Overview

This document explains how one coding-assistant session can start other sessions, hand each of them a set of instructions, and let them communicate through shared files. It is written for a single-agent test on Windows using the Git Bash terminal inside VS Code. It has three purposes: to describe how the system is meant to work, to give the exact commands for operating the two launcher scripts, and to record what has and has not been verified, so that the design can later be extended to multiple agents.

Status at the time of writing: none of the commands in this document have been run against current versions of the tools. The command-line options for Claude Code and Codex are recalled from memory and are believed to be correct. The options for GitHub Copilot are the least certain. Section 7 lists every known uncertainty, and each tool's own `--help` output is the authority when a command fails.

---

## 1. How the system is meant to work

The central fact behind this design is that a chat session cannot start other chat sessions by itself. A session can only produce text and call the tools it has been given. One of those tools is a shell (a program that runs typed commands), and a shell command can start any other program, including another coding assistant. The system is therefore built from three ordinary pieces, none of which is special to any one vendor.

The first piece is the **launcher**, a small script that starts one agent as a separate running program. The second piece is the **instruction file**, a Markdown text file that tells one agent what it is, what its goal is, and what rules it follows. The third piece is the **shared board**, a plain text file on disk to which every agent appends messages and from which every agent reads. The launcher gives each agent its instruction file; the board lets agents see each other's work.

A fourth principle ties these together: **state lives on disk, never inside a conversation.** Each agent starts with a blank memory and must read its instruction file and the board to learn where things stand. This is what allows an agent to be stopped, restarted, or replaced without losing anything.

### 1.1 The folder layout

The following layout is used throughout this document. Everything lives under a folder named `.agents` in the project's root folder (the top-level folder of the project).

```
your-project/
  .agents/
    spawn-agent.sh            launcher that runs an agent in the background (headless)
    spawn-live.sh             launcher that opens an agent in its own live window
    instructions/
      researcher.md           test instruction file 1
      swapi-tester.md         test instruction file 2
    board/
      board.jsonl             the shared board (created automatically)
    run/                      per-agent working files (created automatically)
      NAME.log                everything the agent printed
      NAME.pid                the process ID of the running agent
      NAME.session            the session ID, used to reopen the conversation
      NAME.done               a marker file an agent may create when it finishes
```

### 1.2 What the shared board is

The board is not a website, an application, or a service. It is one text file on the local disk, at `.agents/board/board.jsonl`. It is "shared" only in the sense that every agent is instructed to read and write that same file. It behaves like a notebook left on a desk: any agent may add a line at the bottom, and any agent may read everything written so far.

The extension `.jsonl` stands for JSON Lines. JSON (JavaScript Object Notation) is a text format for structured data, written as labeled fields, for example `{"from":"researcher","type":"status","text":"started"}`. In JSON Lines, each message occupies exactly one line, so appending a message never disturbs earlier ones. The file can be opened in VS Code at any time to read the full record of what the agents have said.

### 1.3 Key terms

The following terms recur in the rest of this document, so each is defined once here.

1. **Headless:** a session that runs without a screen or keyboard. It receives one instruction, does the work, prints a result, and ends. The `-p` option (short for "print") causes this behavior in Claude Code.
2. **Live (interactive) session:** a normal session in a terminal window where a person can type to the agent and read its replies as they happen.
3. **Process:** a running copy of a program.
4. **PID (process ID):** the number the operating system assigns to each running process. The launcher saves it so a specific agent can later be identified and stopped.
5. **Session ID:** a unique label for one conversation, saved so the same conversation can be reopened later. It is a different thing from a PID.
6. **API (application programming interface):** a web address that returns data for programs instead of a page for people. The test agent in Section 4 calls one.

---

## 2. Prerequisites

Before running any launcher, confirm the following four conditions. Each one is a common cause of failure.

1. **The terminal is Git Bash.** The scripts are written for bash, and the screenshot of the VS Code terminal list showed bash terminals. If the terminal is actually WSL (Windows Subsystem for Linux), the scripts may still run, but `spawn-live.sh` would need changes because it opens Windows windows.
2. **The coding tool is installed and signed in.** Run `claude --version` (or `codex --version`) in the terminal. If the command is not found, the launcher will fail for that tool.
3. **The scripts use LF line endings.** VS Code on Windows may save files with CRLF endings (a hidden carriage-return character at the end of each line), which makes bash fail with errors such as `\r: command not found`. For each `.sh` file, click `CRLF` at the bottom-right of the VS Code window, choose `LF`, and save.
4. **Commands are run from the project root.** The scripts use relative paths, so the terminal's current folder must be the project's top-level folder.

---

## 3. The two launchers

Two scripts are provided because the two ways of running an agent suit different jobs. The headless launcher is for agents that work on their own; the live launcher is for agents that should open where a person can watch and type to them. Their full source is in Appendices A and B.

### 3.1 `spawn-agent.sh`: the headless launcher

Set up once by marking the file as runnable:

```bash
chmod +x .agents/spawn-agent.sh
```

Run an agent:

```bash
.agents/spawn-agent.sh <tool> <agent-name> <instruction-file> ["first task text"]
```

The four arguments mean the following. `<tool>` is `claude`, `codex`, `copilot`, or `ollama:<model>`. `<agent-name>` is any short name without spaces and is used to name the agent's log and ID files. `<instruction-file>` is the path to the agent's Markdown instruction file. The optional fourth argument is the first task, given in quotation marks; if omitted, the agent is told to begin the work described in its instruction file.

Example:

```bash
.agents/spawn-agent.sh claude swapi-tester .agents/instructions/swapi-tester.md "Run your steps."
```

What the script does, in order:

1. Creates the `.agents/run` and `.agents/board` folders if they do not exist.
2. Stops with a message if the instruction file is missing.
3. Stops with a message if an agent of the same name is already running, by checking the saved PID.
4. Builds the opening prompt, which names the agent, points at its instruction file, and states the task.
5. Starts the chosen tool in the background, with `nohup` (which keeps the process alive if the terminal is closed) and a trailing `&` (which returns the terminal to you immediately).
6. Saves the process ID to `NAME.pid`, and, for Claude, saves the session ID to `NAME.session`.
7. Prints the PID and the log path.

Two options in the Claude branch deserve explanation. `--append-system-prompt` places the contents of the instruction file into the new session's standing instructions, so the agent treats them as rules and not as a one-time request. `--permission-mode acceptEdits` together with `--allowedTools` lets the agent edit files and run shell commands without stopping to ask, which is necessary because a background session has no one present to approve each action. The consequences of that are covered in Section 6.

The Ollama branch produces a single text answer and nothing more, because Ollama is a model server with no file access or tool use of its own. Running a local model as a real agent requires one of the other tools to be pointed at Ollama, which is not built here.

### 3.2 `spawn-live.sh`: the live-window launcher

Set up once:

```bash
chmod +x .agents/spawn-live.sh
```

Run an agent in its own window:

```bash
.agents/spawn-live.sh <tool> <agent-name> <instruction-file> ["first task text"]
```

Example:

```bash
.agents/spawn-live.sh claude swapi-tester .agents/instructions/swapi-tester.md "Run your steps."
```

This script does not use `-p`, so the agent is an ordinary interactive session. It asks Windows to open a new console window (`cmd //c start`), and inside that window it runs the tool with the instruction file injected and the first message already sent. The final `exec bash` keeps the window open after the agent finishes, so the output stays readable. Because no permission flags are passed, the agent will ask before running commands or writing files, which is useful during testing.

The script does not write a log file, a PID file, or a session ID file, because the window itself is the record. Supported tools are `claude` and `codex` only.

### 3.3 Choosing between them

The headless launcher fits agents that should work unattended and be reopened only when a person wants to inspect or redirect them. The live launcher fits testing, and any agent a person wants to watch and type to from the start. A headless agent cannot be typed to while it is running, because it is busy until its task ends.

---

## 4. The test procedure

The purpose of the test is to prove three things: that a second session can be started with injected instructions, that the agent can reach the internet, and that the agent can write to the shared board. Two instruction files are provided; their contents are in Appendix C.

1. **`researcher.md`** proves launch and board writing only. It asks the agent to append a "started" line to the board and create a marker file.
2. **`swapi-tester.md`** adds an internet call. It asks the agent to fetch the record for person number 1 from the Star Wars API (a free public test API) and post the name, height, and birth year to the board.

Run the second test with either launcher, then check the following four results.

1. `.agents/run/luke.json` exists and contains the person's record.
2. `.agents/board/board.jsonl` has a new line. At the time of writing, the API returned the name Luke Skywalker, height 172, and birth year 19BBY, so a correct run should post those values.
3. `.agents/run/swapi-tester.done` exists.
4. If anything fails, `.agents/run/swapi-tester.log` (headless launcher only) holds the output, and the board should contain an error line written by the agent.

If all four hold, launch, instruction injection, internet access, and board writing are each confirmed.

---

## 5. Operating commands

This section lists the commands used day to day. Each is given with its purpose. Commands that refer to `NAME` expect the agent name chosen at launch.

### 5.1 Reopen an agent's conversation and talk to it

```bash
claude --resume "$(cat .agents/run/NAME.session)"
```

This opens the saved conversation of a headless Claude agent as a normal live session, with its full history, so instructions can be typed to it. It applies only to agents started with `spawn-agent.sh`, since that script saves the session ID. It should be run after the agent has finished.

### 5.2 Send an agent another instruction without opening it

```bash
claude -p "Your next instruction here" --resume "$(cat .agents/run/NAME.session)"
```

This runs one more turn of that conversation headlessly, prints the reply, and ends. It is the mechanism a controlling script would use to keep an agent working turn after turn.

### 5.3 Watch an agent's output as it is written

```bash
tail -f .agents/run/NAME.log
```

`tail -f` displays the end of a file and keeps updating as lines are added. Press Control and C together to stop watching; this does not stop the agent.

### 5.4 Watch the shared board as messages arrive

```bash
tail -f .agents/board/board.jsonl
```

This is the quickest way to see the agents communicating. The same file can also be opened normally in VS Code.

### 5.5 Check whether an agent is still running

```bash
kill -0 "$(cat .agents/run/NAME.pid)" && echo running || echo stopped
```

`kill -0` sends no signal; it only tests whether the process exists. Its behavior with Git Bash process numbers on Windows has not been verified.

### 5.6 Stop an agent

The dependable method is Windows Task Manager: find the process belonging to that agent (for Claude Code and Codex this is typically a `node` process) and choose End Task. The saved PID is a Git Bash number and may not match the number Windows uses, so `kill` and `taskkill` with that number are unverified. This is an open item in Section 7.

### 5.7 Clear a stale PID record

If an agent was stopped but the launcher still refuses to start that name, delete the saved PID file:

```bash
rm .agents/run/NAME.pid
```

### 5.8 Reset the board for a fresh test

```bash
rm .agents/board/board.jsonl
```

The file is recreated by the next agent that appends to it. Nothing else depends on its prior contents in the single-agent test.

---

## 6. Safety considerations

An agent started by `spawn-agent.sh` can edit files and run shell commands in the project without asking. The risk is that an instruction file with a mistake in it will act on real files. Three practices reduce that risk: keep instruction files short and specific; run agents on a separate git branch so any damage can be discarded; and keep secrets such as API keys out of the project folder and out of instruction files. The live launcher is safer for testing because it asks before acting.

---

## 7. Known uncertainties and troubleshooting

The following items are unverified or likely to need adjustment. The list is given so that none of them is mistaken for confirmed behavior.

1. **Option names.** The Claude Code options (`-p`, `--session-id`, `--resume`, `--append-system-prompt`, `--permission-mode`, `--allowedTools`) and the Codex commands (`codex exec`, `--full-auto`) are recalled from memory. The Copilot options (`-p`, `--allow-all-tools`) are the least certain. If a launch fails with an unknown-option error, run the tool with `--help` and correct the script.
2. **`cmd //c start` from Git Bash.** This is the most likely point of failure in `spawn-live.sh`. If no window opens, or it opens and closes at once, the exact message printed in the terminal is what is needed to fix it.
3. **Resuming a session that is still running.** It is not known whether this is safe. Reopen a session only after the agent has finished.
4. **Stopping agents by saved PID** (Section 5.6).
5. **Session ID generation.** Git Bash usually has no `uuidgen`, so the script falls back to PowerShell to generate the ID. This fallback has not been run.
6. **Command not found for the tool.** The tool is not installed or not on the path; see Section 2.
7. **`\r: command not found` or similar.** The script has CRLF line endings; see Section 2.

---

## 8. What is not built yet

The current build proves one agent can be launched, instructed, and observed. The following pieces from the full design do not exist yet, and each would be added after this test succeeds.

1. **A manifest:** one file listing every agent, its goal, and the path to its instruction file, read by a single script that launches all of them.
2. **A relaunch loop:** a wrapper outside the model that starts an agent, lets it finish one unit of work, and starts it again with fresh context. This is what makes an agent persistent, since every session ends when its task ends.
3. **Claims and heartbeats on the board:** a record per area of work stating which agent owns it and when it last reported alive, so one agent can see that another is already working there and wait, and can detect one that has died.
4. **Decision rules:** written rules for what an agent may decide alone and what must be posted for the owner.
5. **Local-model agents:** pointing Claude Code, Codex, or Copilot at an Ollama server, so agents run on local hardware.
6. **Scheduling:** starting agents on a timer instead of by hand.

---

## Appendix A: `.agents/spawn-agent.sh`

```bash
#!/usr/bin/env bash
# Usage: .agents/spawn-agent.sh <tool> <agent-name> <instruction-file> ["first task text"]
# tool = claude | codex | copilot | ollama:<model>
set -euo pipefail

TOOL="$1"; NAME="$2"; INSTR="$3"
TASK="${4:-Begin the work described in your instruction file.}"

ROOT="$(pwd)"
RUN="$ROOT/.agents/run"
mkdir -p "$RUN" "$ROOT/.agents/board"
LOG="$RUN/$NAME.log"
PIDF="$RUN/$NAME.pid"

[ -f "$INSTR" ] || { echo "Instruction file not found: $INSTR"; exit 1; }

# Refuse to start a second copy of the same agent name
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  echo "Agent '$NAME' is already running (PID $(cat "$PIDF"))."; exit 1
fi

PROMPT="You are agent '$NAME'. Your instruction file is $INSTR. Read it completely before doing anything, and follow it. Task: $TASK"

case "$TOOL" in
  claude)
    SID="$(uuidgen 2>/dev/null || powershell.exe -NoProfile -Command '[guid]::NewGuid().ToString()' | tr -d '\r')"
    echo "$SID" > "$RUN/$NAME.session"
    nohup claude -p "$PROMPT" \
      --session-id "$SID" \
      --append-system-prompt "$(cat "$INSTR")" \
      --permission-mode acceptEdits \
      --allowedTools "Read" "Edit" "Write" "Bash" \
      > "$LOG" 2>&1 &
    ;;
  codex)
    nohup codex exec --full-auto "$PROMPT" > "$LOG" 2>&1 &
    ;;
  copilot)
    nohup copilot -p "$PROMPT" --allow-all-tools > "$LOG" 2>&1 &
    ;;
  ollama:*)
    MODEL="${TOOL#ollama:}"
    nohup ollama run "$MODEL" "$(cat "$INSTR")

$PROMPT" > "$LOG" 2>&1 &
    ;;
  *) echo "Unknown tool: $TOOL"; exit 1 ;;
esac

echo $! > "$PIDF"
echo "Started '$NAME' with $TOOL (PID $(cat "$PIDF")). Log: $LOG"
```

## Appendix B: `.agents/spawn-live.sh`

```bash
#!/usr/bin/env bash
# Usage: .agents/spawn-live.sh <tool> <agent-name> <instruction-file> ["first task text"]
# tool = claude | codex
set -euo pipefail

TOOL="$1"; NAME="$2"; INSTR="$3"
TASK="${4:-Begin the work described in your instruction file.}"

[ -f "$INSTR" ] || { echo "Instruction file not found: $INSTR"; exit 1; }

# Passed to the new window as environment variables, which avoids quoting problems
export ROOT="$(pwd)"
export INSTR NAME
export PROMPT="You are agent '$NAME'. Your instruction file is $INSTR. Read it completely before doing anything, and follow it. Task: $TASK"

case "$TOOL" in
  claude)
    cmd //c start "$NAME" bash -c 'cd "$ROOT"; claude --append-system-prompt "$(cat "$INSTR")" "$PROMPT"; exec bash'
    ;;
  codex)
    cmd //c start "$NAME" bash -c 'cd "$ROOT"; codex "$PROMPT"; exec bash'
    ;;
  *) echo "Unknown tool: $TOOL"; exit 1 ;;
esac

echo "Opened a new window for '$NAME' using $TOOL."
```

## Appendix C: test instruction files

### `.agents/instructions/researcher.md`

```markdown
# Agent: researcher

Goal: prove that this agent was launched and can write to the shared board.

Do these steps in order, then stop:

1. Append one line to .agents/board/board.jsonl in exactly this form:
   {"from":"researcher","type":"status","text":"started"}
2. Create a file .agents/run/researcher.done containing the single word: finished
3. Stop. Do nothing else.
```

### `.agents/instructions/swapi-tester.md`

```markdown
# Agent: swapi-tester

Goal: prove that this agent was launched, can fetch data from the internet, and can post to the shared board.

Do these steps in order, then stop:

1. Fetch https://swapi.dev/api/people/1/ by running this command in the terminal:
   curl -s https://swapi.dev/api/people/1/ -o .agents/run/luke.json
2. Read .agents/run/luke.json and find the "name", "height" and "birth_year" fields.
3. Append one line to .agents/board/board.jsonl in exactly this form, filled in with the real values:
   {"from":"swapi-tester","type":"result","text":"NAME, height HEIGHT, born BIRTH_YEAR"}
4. Create the file .agents/run/swapi-tester.done containing the single word: finished
5. If any step fails, append one line to .agents/board/board.jsonl in this form instead, describing the error, and then stop:
   {"from":"swapi-tester","type":"error","text":"DESCRIBE WHAT FAILED"}
Do nothing else.
```
