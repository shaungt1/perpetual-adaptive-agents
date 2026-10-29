An autonomous, self-evolving agent system. It's an architectural implementation system, and it can also be called a task engine. The owner, a human, plans a product comprehensively with one main agent, the contractor. The contractor turns those requirements into architecture and work. That work is delegated to a team of agents, each one owning a subsystem or major component. The agents carry out the work, coordinate with each other, and keep evolving the product until the owner is satisfied, or for as long as the owner wants it to keep growing.
It isn't limited to code. It builds systems, creates and delivers content, and carries out any body of work on any kind of project. Code is the first use case, and VS Code is where it has to work first. The owner proves it on their own projects, then turns it into a product. It should work across the AI coding tools the owner already uses, such as Claude Code and Codex, not just one.
The owner talks only to the contractor, never to the agents doing the work. Planning is comprehensive, and it happens more than once: the first session starts the work, and more sessions follow as the product evolves. In the first session, the contractor:
1. Learns the owner's vision, goals, priorities, and expectations, and the full future of the product.
2. Reads everything the owner already has, including documents, plans, and complex system designs. It walks through each one with the owner and confirms its understanding back to them, like taking an order, until it's exactly what the owner wants rather than what the contractor wants.
3. Studies what already exists: a tech debt analysis, a gap analysis, and a final gap analysis based on everything it found.
4. Produces its deliverables: the vision and future of the product from the owner's point of view, the analyses, an initial plan of action, and a separate document of the access and permissions the work requires.
5. Prioritizes with the owner. The owner's needs and wants come first, along with errors and bugs, then everything else, in a realistic order.
6. Gathers the keys and access the work needs up front, stores them only on the owner's machine (for example, a local admin folder kept out of GitHub), and sets which decisions it can make alone and which need the owner.
7. Gets the owner's sign-off before any work begins.
The contractor feeds the agreed plan into a system that breaks it into subsystems and major components and assigns each to an agent.
1. It decides which roles are needed and how many agents, based on the amount of work and how fast the owner wants it done. The owner can override any of it.
2. Roles match the work: front end, back end, APIs, DevOps, AI engineering and data, writing, images, or whatever the project calls for.
3. Each agent builds or adopts a checklist of the features that were proposed or architected for its area.
4. Agents can be reassigned when needs change, like a front-end agent moving to a new mobile app, or sent idle when their area has nothing left.
1. Each agent starts by exploring and understanding the part of the project it's responsible for.
2. It picks its own next task from its checklist and uses a complexity gauge to decide how much to take on at once.
3. Every piece of work is built, tested, validated, and approved before it goes in. Testing scales with the work: a simple check for small fixes, unit tests for components, end-to-end tests for whole systems, and the owner's own testing when it needs a real user.
4. It checks for errors and problems and never pushes anything broken. If something breaks, it checks whether another agent's work caused it before acting.
5. Work goes on its own branch. Small proven work is merged without the owner, and major changes need the owner's permission.
6. It records finished work on the change log, keeps its own track record, updates its own instructions with what comes next, and runs a gap analysis every few tasks.
7. It keeps going without stopping until its work is done.
A message board sits in the middle of the system. Through it, every agent knows what the others are working on, and nobody steps on another agent's work. Agents coordinate across boundaries. For example, if the UI agent finds it needs a new API, it works that out with the API agent instead of doing it itself.
The contractor and the agents can read each other's track records. Agents report to the contractor. The contractor decides what needs the owner and brings it to them briefly and clearly: what the issue or change is and what it does.
The owner has full control at all times. The system runs inside VS Code, where the owner can watch the work, step in, stop or redirect any agent, and call on agents at any time. Agents can run in the background or be talked to directly. Nothing major happens to the product, such as an agent changing the whole design, without the owner being able to see it and stop it.
The owner doesn't wake the agents up, press a button, or write a prompt each day. The system keeps working on its own, whether on a schedule like every morning or nonstop if the owner wants it running around the clock. The owner can walk away for days or weeks and come back to finished work.
When the planned work runs out, the system goes back to the product's goals and evolves it.
1. Agents research similar products, tools, and new technology, compare them against the product, and look for features, systems, and channels that would make it more valuable and competitive. That could be an email system, marketing, a mobile or desktop app, or new integrations.
2. They protect what the business depends on and don't break what's working.
3. They can wait to gather real usage data, such as hotspots and user interactions, and make informed changes.
4. Each agent keeps a wish list. The contractor pitches the proposals to the owner in a couple of sentences each.
5. The owner says yes or no. A no sends the agent looking for other things to evolve. A yes becomes a new plan with its own requirements and gap analysis.
6. Agents with nothing worth doing go idle, run tests, or are reassigned, and the system knows when to stop instead of changing things until they break.
The plan of action, change log, future-changes list, and the owner's preferences are living documents. They're updated after every piece of work, and nothing is ever removed from the plan's history. Every agent works under shared rules, templates, and prompt-engineering methods, held to professional engineering standards and strong user experience and interface design.