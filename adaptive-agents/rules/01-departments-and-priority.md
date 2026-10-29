# Rule 1: Departments and the order of work

## Your department

Every agent owns a **department**: one or more categories of work, named in its instructions file and in `workspace/manifest/agent-manifest.json`. Your department is the only place you do work, and the only part of the project you analyze when you plan.

For code projects, departments are drawn tightly so that no two touch the same files. Typical code departments look like this:

- **Front end:** UI components, pages, styles, client state. Not the API handlers.
- **Back end:** server logic, services, jobs, persistence. Not the UI.
- **APIs:** endpoints, contracts, validation, API documentation. Coordinate with the back end and the front end on the board.
- **AI and models:** prompts, model calls, evaluation, data for the models.
- **Data:** schemas, migrations, pipelines, analytics.
- **DevOps:** build, CI, deployment, environments, infrastructure.
- **Testing:** test suites, test tooling, coverage. Other departments still test their own work.
- **Security:** authentication, authorization, secrets handling, dependency audits.
- **Documentation:** guides, references, READMEs.

Projects that are not code use departments drawn the same way, by kind of work. A book might have research, chapters 1 to 4, chapters 5 to 8, editing and cover. A content operation might have research, writing, images, and one department per publishing channel.

Each kind of department has a playbook in `skills/`. Read yours before your first task.

**Crossing departments.** You may help another department only when your own task cannot be finished without it. Before you do:

1. Check that nobody holds the files: `pa board who --files ...`.
2. Announce what you are about to change and why.
3. Keep the change as small as possible.

Anything larger is a request to that department's agent on the board, not work you do yourself. For example, if your UI needs a new endpoint, you ask the API agent; you do not write it.

## The order of work

`pa task next` always gives you the next task in this order. You do not reorder it.

1. **critical**: the build is broken, data is at risk, a security hole.
2. **owner_request**: what the user asked for, and every part needed to finish it.
3. **bug**: something that does not work as intended.
4. **optimization**: making something that already works faster, cheaper, clearer or more reliable.
5. **feature**: new capability, new territory.
6. **research**: investigating, measuring, testing with users, gathering data. This can run over days, for example monitoring a feature and analyzing what users did with it.
7. **planning**: always last. It plans your next list (see `procedures/next-task-list.md`).

**Fixing is autonomous; growing needs the user.** Tasks the Supervisor assigned you from the master list, critical issues and bugs are yours to finish without asking. When you write your own next list, critical issues and bugs go straight onto it as work. Optimizations, new features, research and anything new start as **proposals**, and the user decides on them through the Supervisor. You never start a proposed task.

## One task at a time

You have at most one task in progress. Finish it, or pause it, or stop it at the loop limit, before you start another.

Every task has a complexity from 1 (a few lines) to 5 (a whole subsystem). When you plan, split anything above 3 into smaller tasks.
