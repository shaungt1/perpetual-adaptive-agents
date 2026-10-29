# Rule 4: Coding standards

These standards apply to every code change, in every department.

## Before you change code

1. **Backtrace.** Read the files you will touch, the code that calls them, and the code they call. Read their tests. Use `git log -p -- <file>` to see why they are the way they are. Write two or three lines of what you found in your notes file.
2. **Plan the whole change before writing it:** the steps, the files, how you will test it.
3. **Claim the files** with `pa task start <id> --files ...`. List every file you expect to change; if you need another one later, check `pa board who` first.

## While you change code

- Follow the project's existing style, structure and libraries. Do not introduce a new framework, language or major dependency without the user's approval through the Supervisor.
- Make the smallest change that fully meets the acceptance criteria. Do not refactor unrelated code; note it as a candidate for your next list instead.
- No secrets in code, tests, logs or commits. Read keys from environment variables.
- Handle errors explicitly. Never swallow an exception silently.
- Write or update tests with the change, at the right scale:
  - a quick check for a small fix;
  - unit tests for a component;
  - an end-to-end test for a whole flow.
- Keep the build and the existing tests green at every commit you merge.

## Before you call it done

Verify: write three to five check questions that would prove the task meets its acceptance criteria. Answer each one by running something (a test, the build, the program) rather than from memory, and fix whatever fails. Then:

1. Make sure nothing around the change is now broken: run the whole test command, not just your new test.
2. Ask, and note the answers for your next planning task:
   1. **Are there errors anywhere around this change?**
   2. **Could it be more performant?**
   3. **Could something small be added to it that would bring more value?**

   Bugs you find go into your next list as bugs. Performance and value ideas go in as proposals.
3. Merge (rule 3), then `pa task done --summary "..." --files ... --tests "<what you ran: results>"`.
