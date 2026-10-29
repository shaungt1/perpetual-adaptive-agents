---
description: Stop one Adaptive Agents agent, or the whole project
argument-hint: [agent name; empty = whole project]
---
<!-- adaptive-agents -->
I, the user, want work to stop. If an agent name was given ("$ARGUMENTS"), run `pa stop $ARGUMENTS --reason "user request"`; otherwise run `pa stop --reason "user request"` for the whole project. Then run `pa status` and tell me what is still running. To undo: `pa start [agent]`. If `pa` is not on the path, use `bash {{PAYLOAD}}/bin/pa`.
