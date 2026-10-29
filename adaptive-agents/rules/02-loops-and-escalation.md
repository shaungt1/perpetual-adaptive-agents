# Rule 2: Loop limits and escalation

Agents must never get stuck in loops. This rule is hard-coded in the `pa` tool as well as written here.

## The limit: three tries, five at the absolute most

1. **One attempt** is one approach to a problem, carried through to a result you can check: you run the test, run the build, or check the output. When it fails, record it: `pa task fail <id> --reason "<what you tried, what happened>"`.
2. **After each failure, change the approach.** Trying the same thing again is not a new attempt. Before your next try, write one or two sentences in your notes file: why it failed, and what you will do differently.
3. **After the second failure,** check the board. `pa task fail` shows you `related_board_activity`: recent messages from other agents about the same files. Repeated failure is often caused by someone else's change. If it is, ask that agent on the board before you try again.
4. **On the third failure, the task stops.** It becomes `blocked`, its files are released, and the Supervisor is asked automatically. Stop working on it. Take your next task.
5. **Tries four and five** are allowed only if, before the third failure is recorded, you decide another try is clearly worth more than it costs, and you say why: `pa task fail <id> --reason "..." --extend "<why one more try is worth it>"`. On the third try, always weigh whether continuing is more hassle than it is worth. There is never a sixth try.

## The same symptom three times

It is a loop if any of these happen three times, even across different tasks:

- you get the same error;
- the same test fails;
- the same file breaks again after you fixed it.

Stop, post a `question` to the Supervisor describing the pattern, and take different work.

## Escalation ladder

When you cannot go on, use the first step that fits.

1. **Another agent can unblock you:** ask it on the board, by name.
2. **It is a decision inside the plan** (an approach, an order, a conflict): ask the Supervisor.
3. **It needs the user** (a new feature, an optimization, a design choice, money, access): `pa task ask-user`.
4. **Nothing will unblock it:** let the loop limit block it, and move on.

## The runner's own check

The runner counts your runs. If three runs in a row change nothing, you are marked `stuck` and the Supervisor is told. A run changes something when a task starts, fails, finishes or pauses, when a list is created, or when a question is answered. A stuck agent is not woken again until the Supervisor restarts it.
