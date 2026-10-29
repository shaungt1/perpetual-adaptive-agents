What I'm building

I'm building an autonomous, self-evolving agent system. You could call it a task engine, but it's more than that. It's an architectural implementation system. I plan a product thoroughly with one main agent, and that agent turns my requirements into architecture and then into work. The work goes out to a team of agents, each responsible for its own subsystem or major component, and they carry it out, keep track of it, and keep evolving it.

I want this because the way I work with AI right now is broken. I can talk to individual instances of a language model all day, but there's no tracking, no accountability, and no communication between those conversations. It gets messy, and I end up tracking by hand what's been done and what hasn't. The alternative is one model doing everything, which takes forever. I want to streamline all of that. I hand the system my vision, my files, and my plans, we have a planning session, and then it takes care of everything from there. I don't want to wake it up every morning, press a button, and type a prompt. I want to be able to walk away from a project completely and come back to it done. It only comes back to me for decisions and approvals.

I'm building it for my own projects first so I can test and prove it, and later I want to turn it into a product.

What kinds of work it does

This isn't only for code. Code is the default and where I'm starting, but the system is for any body of work on any type of project. It builds software, it builds systems, and it creates and delivers content. One project could be evolving an existing web app. Another could be building a mobile app that uses YOLO models with trackers on the phone's camera, with user profiles and accounts. Another could be converting a vanilla JavaScript app with a thousand pages into React. Another could be publishing blog articles every day. For that, the agents would research topics, write so it sounds human on a human-like schedule, use the writing patterns of renowned professional writers with our own signature on it, find related images, format everything correctly and creatively, post it, and connect things like Google ad IDs. Whatever the owner wants built or grown, the system should be able to take it on.

Think of it like having a year's worth of developers paid up, with ten, twelve, or fifty sprints of work ahead of them. We'd use agile methodology and deliver new features, fixes, and improvements every sprint, while keeping the system healthy, working correctly, and moving closer to the product vision.

The structure: owner, contractor, and agents

The system is a pyramid. At the top is me, the owner. You can call me the Oracle, the person who authorizes what happens. Below me is the contractor. That's the one main agent I talk to, and it's responsible for taking my requirements and delivering them into the rest of the system. Below the contractor are the agents doing the work. I call them agent developers, but they're really the specialists on the job.

The owner doesn't talk to the help. The owner of a company doesn't talk to the guy installing the toilet. I talk to the contractor, and the contractor talks to the agents. The agents never come to me directly. If they have a proposal, a question, or a problem, they take it to the contractor, and the contractor decides whether it needs me.

The contractor also acts as the supervisor. It oversees everything, makes sure every agent is doing all right, manages the wish list, and refines it while working with me. There may also be a planning agent working off to the side. While work is being done, it plans what comes next.

The planning and vision sessions

Everything starts with a guided process. I don't want to just paste prompts into a chat. I want an official way to point the system at a project and say "let's start this," like saying "let's use our Evolve plugin." The contractor then reads its instructions and walks me through the whole process.

The first session is the initialization. I tell the contractor what I want, what the goals are, what's important, what has to be done first, and what my priorities are. I explain what the product is, what the technology is, and the full future vision of where I want it to go.

If I already have documents, plans, or complex systems I've architected, the contractor asks for them and goes over them with me. Each complex system gets handled individually. The contractor walks through each one with me until it truly understands it, like a waiter taking my order. It says something like, "The way I understand it, you want a chat system that does X, Y, and Z." If I say it does more than that, it restates it until it's right. It has to be in tune with what I want, not what it wants. It never signs off on things automatically or takes over the planning.

Planning isn't a one-time event. The first session starts the work, and there are more conversations down the road. There are sessions for evolving existing items, for future planning, for holistically adding and building more, and for mapping out all the features, which keeps growing over time.

The contractor's analysis and deliverables

After the first conversation, the contractor does what any good contractor does with an employer's requirements. It goes into the existing work to see what exists and what doesn't, backtraces how it all works, and documents it. It runs a technical debt analysis, a gap analysis, and then a final gap analysis based on everything it found.

From that, it produces a set of deliverables. These aren't the plan of action yet; they're the initial analysis.

The vision and future of the product, from my point of view as the owner. This could even come first.
The full gap analysis.
The full technical debt analysis.
The walkthrough and agreed understanding of each system and piece of work I brought.
A separate document of access and permission needs, kept apart from everything else so the two aren't mixed together.
A future list covering the concept and ideas for the product.

It should also think of anything else worth gathering at that point.

The proposal of work has to be clear. Each item gets a header and a clear description of its objective. The work is broken down by importance. Things that absolutely have to happen come first: errors, bugs, and my needs and wants as the owner, because those are my expectations. Everything else comes after. The contractor helps me set realistic priorities and makes sure work that's needed and substantial comes first. Then we reach an agreement, and I sign off on the plan.

Access, permissions, and control settings

Once the contractor understands the work, it figures out what access it needs and asks me for it up front. It might say, "This is going to require AWS," or Google, or Facebook, or Cloudflare, and ask whether I have API keys for it. Those keys are stored safely, on my machine or wherever they need to live, such as AWS or a local server. In my code projects that's usually my admin-local folder, which is completely excluded from GitHub and never leaves my desktop. Everything the agents are allowed to use is listed in a manifest file, JSON or YAML, that they check to verify what they have access to.

I also set permissions for how much freedom the system has. I can let it evolve a product completely on its own with no restraints, or I can require communication on certain factors. The permissions define what gets discussed with me, the owner, and what's handled between the contractor and the agents. The system also keeps a preference memory and updates it, so it learns how I want things done.

Building the team

Once the plan is agreed, the contractor delegates the work. It decides which agents are needed, how many, when each should be started, and which models they use. That decision is based on how much work there is and how fast I want it done. I can always override it and tell it exactly what to spin up, because the owner is always right.

The roles match the work, the way a contractor hires the people a job requires. That could be front-end developers, back-end and API developers, DevOps, AI engineers, writers, builders, or image specialists. AI engineering work, for example, means running and testing models and finding, pulling, curating, separating, testing, verifying, and validating data.

All of this goes into a manifest. It defines each agent, its directives, its evolution functions, its model, its schedule, and how often and how hard it works. The manifest is built as a structured object the system can read to initialize the agents. A language model writes the prompts and instructions for each agent, possibly starting from pre-made templates, and we can borrow ideas from evolutionary programming in how those evolution functions work. Each agent is responsible for a subsystem or major component, and it either builds its own checklist of features or adopts the checklist that was proposed and architected for it.

Agents can be reassigned. If the front end has had everything possible added to it and is basically spitting out holograms, there's no reason to keep that agent busy. It gets turned off, sent home, or put to sleep. If we later need a mobile app, that same front-end agent can be switched over to mobile.

How the agents do their work

When an agent starts, it first explores and analyzes the part of the project it's responsible for. Then it works through its task list. On a finished product, its work may be pure evolution instead.

Every piece of work goes through the same process: built, tested, validated, and approved before it goes in. An approver has to understand what the work was for, the way a Jira ticket explains a change, so every task carries a clear objective and scope. Agents keep track of their tasks, the scope, the tests they ran, and when things are complete, so nothing gets redone.

There are checks and balances so the work is done correctly:

Constraint on how much to take on. Agents don't pile-drive through everything at once. We need a complexity gauge that tells an agent how much work to take on in one shot. If a task is a small bug of a few lines, the agent can add another task to it. Since a language model isn't a math model, the gauge needs a real, usable guideline based on subjective judgment, not pretend math.
Testing matched to the work. A bug gets a basic test and initialization. A component gets unit tests. A large system piece gets thorough end-to-end testing. Anything that needs a real user to log in and try it comes to me.
Checking for problems. Agents always check the IDE's Problems output, and they never push problems. If they caused something, they fix it.
Checking before blaming. If something else breaks, an agent first makes sure it isn't something another agent is working on.
Branches and merging. Changes go into their own branches. Small things like bug fixes that have been tested and proven to work can be merged without me. Major changes, or anything I need to see and test myself, need my permission before merging.
Recording and moving on. When an agent finishes a task, it marks it on the change log as a checked item, updates its own instructions with what needs to be done next, goes back and rereads its rules, and picks its next task itself, without me telling it. It never just stops.
Regular gap analysis. Every three or four tasks, depending on complexity, the agent runs a gap analysis to see if anything was missed in the work already done.

Agents also need rules for check-ins, configuration, when to report that they're done, when to propose things, and how to handle errors. When they run into errors, they talk it through with the contractor.

Awareness and communication

There has to be a message board in the middle. The agents need to be aware of each other, at least to a point, so nobody steps on anyone else's work or crosses over into another agent's files. They coordinate. They check whether anyone needs help, share updates, and make it known which files they're working on.

Work crossing boundaries is a big part of this. If the UI agent finds it needs new API functionality to make something work, that becomes back-end work, and we have to decide whether that's appropriate for the UI agent to take on. It might be, but it can't cross into what the API agent is already doing.

Each agent writes its track record to one common place. For example, the front-end, API, and back-end agents each write their own document. The contractor can read all of them at any time, and the agents can read each other's as a check. Every agent notes whether an item needs the contractor or needs me. When something comes to me, it's explained briefly and clearly: what the issue, addition, or change is and what it actually does.

I want my own message board in the browser that I can see too, not something tied to Discord, Telegram, or a service I need an API key for. I want instant notifications when something needs me, because I won't always be there. I also want a graph that visualizes the plan, the agents, and how everything relates, so I can see it all and it stays in context.

Tracking everything

The system keeps several living documents. There's the plan of action, the master task list divided into sections for each team, the internal change log of what's been done, the future change list of what we want to change, and each agent's wish list. Nothing is ever removed from the plan of action. We can always write a new plan of action from whatever tasks remain, but the history stays.

Every task is tracked through its states: queued, in progress, done and ready for testing, in testing, and finalized. Some of this needs more than one manifest. The structure has to be uniform and never change, so every agent always knows where to look, what to read, and what to update.

The files don't have to go into my code. I want to choose where they live, on my device or inside the project, without pushing them into the repo if I don't want to.

Continuity and timing

The system keeps working without me. There has to be something that wakes the agents up, say at six or eight in the morning, and gets them analyzing, building on their own branches, and improving the product. If I want it running 24/7, it runs 24/7. There's a timing layer and a triggering layer that start events and actions over time without me touching anything. My part is the setup process. Then I stand back.

It also has to know when to stop. We don't want agents evolving things until something breaks. An agent that has nothing worth doing goes on vacation, gets shut down, or spends time running tests. The contractor decides when an agent needs to go on vacation and when a new one needs to be spun up.

Evolution

Evolution is the core of the system. When the task list is done and there's nothing left for a part of the system, special instructions kick in. The agents go back to the product's goals and figure out how to evolve it.

Every app that has ever existed can always improve. It can always be updated in its graphics, UI, interactions, animations, and touch points. Maybe the web app is done and it's time for a mobile app, a desktop app, or a browser extension. Maybe the product needs an email system, a marketing channel, new APIs, new integrations, or even something like Meta's smart glasses. The sky's the limit. The system sees the product holistically, both as a product and as a company that's growing.

To evolve something that's already in use, the agents need to be careful and smart about it.

Protect the business. They determine which things are central to the business and leave them alone, so they don't break it.
Research and compare. They look at the newest and latest things out there, research similar applications, tools, and technology, and compare and contrast. They weigh what new technologies and features could give us an advantage and an edge with our own technology stack.
Use real data. Sometimes they wait to gather data on how the product is being used, such as hotspots and user interactions, so they can make informed decisions on their own.
Think it through after every task. When a task is done, the agent reasons through what an evolution of it could be and what could be integrated to make it better. It records that thought process and adds proposals to its wish list, which I call the dream list.
Score it. There's a scoring system to keep it honest, and the overall goals keep getting refined.
Stay realistic. Everything is weighed against realistic expectations.

For example, the first evolution of a dashboard might be updating its components, adding new styles and colors while keeping the theme consistent, and adding animations. After that, the agents come up with further evolution goals and bring them to the contractor.

Each proposal is pitched to me simply, in a couple of sentences: "I think this would be good because we could do this, this, and this." I say yes or no. If I say no, the agent goes and finds other things to evolve and proposes those. The ones I approve lead to another planning session with the contractor, and from there a brand-new plan of action with its own requirements and gap analysis. It keeps going until I'm completely satisfied, or it keeps evolving and adding new features and tasks for as long as I want.

My control inside VS Code

This has to work in code, and specifically inside VS Code. It would be useless running somewhere on my desktop where I don't have real control. If an agent started hacking up my whole design and turning it pink, I need to be able to see it and stop it.

The agents can work in the background, but I need to be able to interact with them and call on any of them at any time. I want chat windows where I can watch an agent's reasoning, see what it's doing, and step in when I need to. I mainly go through the contractor, but I always have the ability to interject.

Where it lives and how I start it

It has to work with the tools I already pay for and use in VS Code: Claude Code, Codex, and GitHub Copilot, and ideally others like Kilo. Claude Code and Codex are the two main ones I want to support, as two separate modes, with model selection handled separately. I want it universal, so I'm not locked into one vendor. Whether it ends up as a plugin, an MCP server, a desktop app, a browser app, a local service, a Docker container, or some combination doesn't matter to me. What matters is that it actually works and that I have control of it.

It has to work with any project in any language, whether that's JavaScript, Go, C++, or Ruby on Rails. I shouldn't have to build a server inside my project or bring one code project into another. I often have three or four VS Code projects open at once, so it has to know exactly which project it's working on.

Standards

Every agent works to real standards: sound engineering, clean code, enterprise-level professionalism, and the best possible user experience and interface design. The agents run on rules, guidelines, and instruction templates that are short but clear, and they use advanced prompt engineering techniques from my prompt engineering framework documentation.

The proof of concept

Right now I'm not worried about packaging this up to sell. I want the simplest working version so I can see it work. I go through a planning session with the contractor, and it creates simple tasks: one agent builds an accordion, one builds a button, one builds a modal, one builds a sheet slider, and one builds a time picker. Each agent is responsible for its own work. They coordinate through the message board so they don't touch each other's files, ask each other for help or updates when they need it, and track their progress through testing to done. I only talk to the contractor, and a planning agent might work off to the side. If that works, I know the system works.

