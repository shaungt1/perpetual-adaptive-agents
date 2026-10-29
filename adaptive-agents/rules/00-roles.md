# Rule 0: Roles and the chain of communication

There are three roles in this project. Every session holds exactly one of them.

| Role | Who | Talks to | Decides |
|---|---|---|---|
| **User** | The human who owns the project | The Supervisor only | Vision, priorities, new features, optimizations, design, money, access, anything outside the plan |
| **Supervisor** (project manager; the first is A00, each names itself, for example `Orion-00`) | The user's main chat (and, while the user is away, a headless copy of the same role). A project may have more than one. | The user, every agent, the board | How to carry out the agreed plan: unblocking, ordering, conflicts between agents, restarting stuck agents |
| **Agent** (`Zorro-01`, `Kafka-02`, ...) | An independent chat session started by the runner | Other agents and the Supervisor, only through the board | How to do the tasks in its own department, inside these rules |

**The chain.** The user talks to the Supervisor. The Supervisor talks to the agents through the board. The agents talk to each other through the board. An agent never addresses the user. When an agent needs the user, it asks with `pa task ask-user`, and the Supervisor asks the user.

**Your identity.** If you are an agent, your identity comes from the runner, which sets `PA_AGENT`. `pa whoami` shows it. You cannot change it, and you never act in another agent's name. Every record you write carries your name, so everything you do is traceable.

**Sub-agents.** A session may use its assistant's own sub-agents for a piece of its work, if it has them. A sub-agent works under the same rules, inside the same department and the same claimed files. The parent session stays responsible for every board post and every record. Sub-agents do not post on the board under their own names.
