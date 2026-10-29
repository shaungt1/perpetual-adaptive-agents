# Evolution: Automating Many AI Chat Sessions to Plan, Build, and Keep Improving Any Project

*Design paper. "Evolution" is the working name for the process. The final product name will be chosen last.*

---

## Executive Summary

I am describing a system that takes a group of AI chat sessions and automates them so that they work together on a project without me having to talk to each one. Every one of these sessions already lives inside a code editor (Visual Studio Code, called VS Code in this paper), and every one is powered by an existing AI coding tool: GitHub Copilot, OpenAI Codex, or Anthropic's Claude Code. Each session already has tools, internet access, the ability to read and write files, the ability to call outside services, and the ability to write and run its own scripts. I do not need to invent any of those abilities. What I need to build is the organization around them: a planning method, a set of written rules, a manifest that lists the sessions and what each one owns, a message board where the sessions tell each other what they are doing, and a way for me to see everything that is happening.

I talk to one session, which I call the primary. It acts like a building contractor: I tell it what I want, it plans the whole job with me, it divides the work into categories, it hires a worker session for each category, and it manages those workers. The workers never talk to me. They plan, build, test, validate, and finish their own checklists on their own branches, they report to a shared message board, and they never stop until their work is done. When the planned work runs out, they look at my original vision, imagine what could be added, and bring proposals back through the primary for me to approve or reject. The result is a project that keeps evolving, like a basic car that is gradually turned into a Lamborghini or a BMW, while I check in only now and then.

The system is not limited to code. The same structure can run a blog, a social media operation, a weekly financial spreadsheet, or any other body of work.

This paper describes how the whole system is supposed to work and why. It ends with a single proposal, for the message board, because that is the one piece of technology we have chosen so far.

---

## 1. What I Am Building and Why

The core of this idea is simple, and I want to say it plainly before going into detail. I am taking a bunch of chat sessions and automating them. That is technically all that is happening. Instead of one chat session that I talk to, I have many sessions, and instead of me directing each one, one of them is put in charge. I delegate to that one, and it delegates to the others.

I want this because a single session is limited by how much I can supervise it and by how much one session can hold in mind. If I could have ten sessions open and each one owned a piece of the project, work would move much faster, but only if they do not step on each other and only if I do not have to be the one coordinating them. So I want them coordinated by a primary session, communicating through a message board, and working nonstop in the background, so that I can sit back, check in every once in a while, make sure they are on the right track, and revert if they are not. Reverting is always possible because every worker does its work on its own branch (a separate line of changes in version control, explained in the terms section).

The goal is for the project to evolve. A project starts as something basic that works. The sessions keep analyzing it, finding gaps, paying down technical debt, adding features, improving performance, improving usability, and improving the experience, until it has been taken from basic to excellent. It is like taking a basic car that gets you back and forth and evolving it over time into a Lamborghini or a BMW. The sessions are autonomous, which means I do not have to worry about them day to day.

The system is not only for software. Code is the first use case because I can prove it on my own projects, and code is where VS Code works best, but the structure is general. If it can handle code, it can handle everything else easily: a person who wants to publish blog articles, run a social media presence, post videos, or produce weekly spreadsheets and financial analysis can use the same system. That person would open an editor, install the tools, talk to their primary session, and let the workers handle the rest.

I intend to prove this on my own projects first and then turn it into a product that other people can use. It should work with the AI coding tools people already have, whichever of them they use, not just one of them.

---

## 2. Terms Used in This Paper

I am defining these terms now because they appear throughout, and because I want anyone reading this to understand it without any other background.

- **Session, agent, sidekick, helper.** These all mean the same thing: one chat session with an AI coding tool. I use "agent" most often, but a session does not have to be visible in a chat window. It can be in the foreground or the background, connected to a window or not. Any session I start is a session in this sense.
- **Owner.** The human being. This is me, or whoever uses the system. The word "owner" must be written explicitly into the instructions, because the sessions need to know exactly who the human is.
- **Primary.** The one session that the owner talks to directly. It is also called the contractor or the supervisor. It plans with the owner, creates and manages the other sessions, reads the message board, decides what needs the owner's attention, and merges or publishes finished work. Any session can be made the primary, because all sessions are the same kind of thing. The primary is simply the one that is given that role.
- **Worker.** Any session that is not the primary. A worker owns one category of work, follows its own checklist, and never speaks to the owner.
- **VS Code.** Visual Studio Code, a widely used code editor made by Microsoft. An editor like this is also called an IDE (integrated development environment). Other editors such as Cursor work in a similar way. I describe VS Code because it is the first target.
- **GitHub Copilot, OpenAI Codex, Claude Code.** Three AI coding assistants. Each can run inside the editor as a chat window, and each can also be started from a command line.
- **Ollama.** A program that runs AI models on a person's own computer. Using a local model through one of the tools above is preferable where it works, because it keeps work on the owner's machine.
- **Command line (CLI).** A text interface where a program is started by typing a command. The three assistants can all be started this way, which means a session can run without any chat window being open.
- **Headless.** A session that runs without a visible window. It receives instructions, does its work, and its conversation is saved so it can be resumed later.
- **MCP (Model Context Protocol).** A standard way to give an AI session an extra tool. An MCP server is a small program that provides tools to the session that connects to it.
- **API (application programming interface).** A web address or interface that programs, rather than people, talk to in order to fetch or send data.
- **Skill.** A packaged set of instructions, usually a markdown file named `SKILL.md` along with scripts and reference files, that an AI session loads when a task matches the skill's description. This paper borrows the skill packaging style.
- **Manifest.** A short, structured file that lists the workers: who each one is, what it owns, where its instructions are, what tools it needs, and where it reports. Structured means a strict machine-readable format such as JSON (JavaScript Object Notation) or TOML (Tom's Obvious Minimal Language).
- **Branch and merge.** In version control (git), a branch is a separate line of changes that does not affect the main version. Merging brings a finished branch into the main version.
- **Unit test and end-to-end test.** A unit test checks one small component. An end-to-end test checks a whole system working together from start to finish.
- **Gap analysis.** A review that compares what exists with what is supposed to exist and lists what is missing.
- **Technical debt.** Shortcuts, weak spots, and unfinished work in an existing project that will cost more to fix later than they would now.
- **Micro sprint.** A small chunk of work, sized so that a worker can finish it, test it, and mark it off.
- **Message board.** A shared place where the sessions post short notes about what they are doing, what they have finished, and what problems they have. It is explained fully in section 11.
- **Radar chart.** A chart that looks like an air-traffic radar screen: several spokes radiate from the center, one per category, and a shape is drawn across them to show how much has been completed in each category.

---

## 3. What Every Session Already Is

Every session in this system is a chat session running in VS Code, powered by Copilot, Codex, or Claude Code. These sessions are not simple chat boxes. Each one already comes with a full set of abilities: tools, internet access, connections to MCP servers, the ability to read, write, and delete files anywhere I allow, the ability to create structured objects, the ability to call APIs, the ability to write custom scripts and run them, the ability to use agents of their own, and the ability to produce artifacts. Everything that an assistant like the one I am talking to right now can do to look something up on the web or to build something I ask for, these sessions can do as well. Each session keeps its own state, which means it remembers its own conversation.

This matters because it keeps the design simple. I do not need to give the sessions new abilities. If a session needs to reach an endpoint, it can. If it needs a script, it can write one. If it needs to write a record, it can. What the sessions need is organization: clear instructions, clear roles, a clear list of work, and a clear way to tell each other what they are doing. That is the system I am describing.

A session can be started in more than one way. It can be opened as a visible chat window inside the editor. It can also be started from the command line with no window, given its instructions, and resumed later because its conversation is saved. This means that I can open ten sessions and see ten windows, or I can have ten sessions working in the background and see them only through a dashboard. Whether I can see them in a chat window or not is irrelevant, as long as the work is really happening and I have visibility into it.

I have already proven the basic mechanics. I have scripts that start a session, give it its instructions, send it further messages, check its status, show its logs, and stop it. I have an editor extension that opens live chat windows. I have a first message board, a simple file that sessions read and write. In one test, one assistant started the Copilot command line headlessly and gave it a prompt, and Copilot used its own file-editing tool to append a line to the board; a second prompt resumed the same saved conversation. I have also shown that sessions can connect to outside interfaces and write results back to a file. So the pieces I need already work. What I want now is to organize them into a permanent system.

Most people will use only one of the three tools, because they will use whichever one they have in their own editor, and they will use whichever models that tool offers. I may use Claude Code or Codex for everything, or someone else may use Copilot for everything. The system must work with any of them, and it must allow switching or mixing if someone wants that. Because of this, the system needs some choices to be made up front: which tool or tools will be used for the primary, which for the workers, and whether any local model will be used. Those choices should be asked at the start and recorded.

---

## 4. The Chain of Command

The structure is a hierarchy, like a real contractor and a crew. I talk to the supervisor, the contractor. I do not talk to their hired help.

The owner talks only to the primary. The primary talks to the workers. The workers talk to the primary and to each other through the message board, but they never talk to the owner, at any time, and not even to ask a question. If a worker needs something from the owner, it asks the primary, and the primary decides whether to answer it itself or to bring it to the owner. This must be an explicit rule in every worker's instructions, and the primary's instructions must define the human as the owner so that there is no ambiguity about who that is.

The roles can change. A worker can be retired when its work is done, and new workers can be created when new work appears. The primary decides this, based on the amount of work and how fast the owner wants it finished, and the owner can override any of those decisions. A worker can also be reassigned when needs change, for example when a front-end worker is moved to a new mobile application, and a worker with nothing left to do can be sent idle. Because every session is the same kind of thing, any of them could be promoted to primary.

The owner has full control at all times. The system runs inside the editor so that the owner can watch the work, step in, and stop or redirect any worker. Workers can run in the background or be talked to directly when the owner wants that. Nothing major, such as a worker deciding to change the whole design of the product, may happen without the owner being able to see it and stop it.

The system must also run without me. I should not have to wake the workers, press a button, or write a prompt every day. They keep working on their own, either on a schedule, such as every morning, or nonstop around the clock, if I want that. I should be able to walk away for days or weeks and come back to finished work.

---

## 5. The Planning Session

Everything begins with a planning session. I open an ordinary chat session and tell it that I want to start an evolution project, or that I want to evolve my project. Those words are the trigger. When the session hears them, it goes to find the instruction set I have prepared, reads all of it, and understands that it is now the primary. It also gets the tools, the extension data, and the instructions that the system provides. Because it is now the primary, it also records its own session number and writes a structured file describing itself, so that it can always be found again.

The primary's first job is to learn what I want. It asks whether I have anything mapped out, such as architecture, systems, components, features, or solutions, whether they need to be built now or in the future. If I do, I point to a folder, and the primary reads it, either by referencing it or by copying it. It reads every document, plan, and design I already have, and it walks through each one with me and confirms what it understood back to me, like someone taking an order, until it is exactly what I want and not what the primary wants.

Then it asks for my vision. The vision may be for a code project, a publication project, an influencer project, or anything else. This part has a hard rule: **the vision must be saved exactly in the words I used.** It must not be reworded, polished, summarized, or corrected. I want it kept in its raw form so that every session can read it, and so that I can always check later whether the work is still on track. If the primary rewrites my words, the meaning can drift, and then nobody can tell whether the project still matches what I wanted. The vision will change over time, and when it changes, the new words are added, not rewritten over the old.

Expectations are also gathered, and the primary should not ask me for them every few minutes. It should gather them periodically, or all at once, by asking what my expectations are and what my dreams are for the project. The primary should also coax out the things I may not think to say. It should ask which pieces are more important for the future, what I would ultimately like to see, and which ideas I would like no matter how extreme they are. Perhaps I would want a chat system. Perhaps I would want to turn the product into a social media system. Perhaps I would want virtual reality and augmented reality connections, a mobile app and a desktop app, or connected devices. These large plans are all broken down into micro sprints, little chunks of work that the workers pick up according to their categories.

The primary must also work out, in advance, what the work will need: authorization, access, accounts, keys, and folders. Some of those questions it should know to ask ahead of time. Others it should be prompted to formulate on its own. All keys and access it collects are stored only on the owner's machine, for example in a local administrator folder that is kept out of any online repository, and it also records which decisions it may make by itself and which must come to the owner.

After gathering requirements, the primary examines the project that already exists, if there is one. It traces the project backward to understand how it came to be, and then it does three analyses. The first is a gap analysis, to find what is missing. The second is a technical debt analysis, to find what is weak or unfinished. The third is a final analysis that takes everything it has found and produces a master checklist of every single thing that needs to be built. For a project that does not exist yet, the same method applies to the vision and the requirements alone.

Then it prioritizes with me. My needs and wants come first, along with errors and bugs, and then everything else in a realistic order.

From all of this the primary produces a set of deliverables. I list them here so that nothing is forgotten:

1. My vision, kept in my exact words.
2. A record of the requirements, architecture, systems, components, and features I supplied or described.
3. The gap analysis.
4. The technical debt analysis.
5. The final analysis that produces the master checklist of everything that needs to be built.
6. A separate document that breaks the master checklist into categories.
7. A plan that assigns an agent to each category, or one agent to several categories when the primary decides one agent can handle them.
8. The manifest that defines the agents (section 7).
9. The prompts and resources for each agent.
10. A planning document for the primary itself.
11. A separate document of the access and permissions the work requires, together with the list of which decisions the system may make alone.
12. The prioritized plan, agreed with me.

The primary may not start any work until I have signed off. I also want to be able to see that these documents were actually created and delivered, and that each one was checked. So each document must have a visible status: made, checked, and approved by me.

The planning session itself is a method, and I want that method written down: a procedure that the primary follows, and a main prompt that tells it to produce every one of the deliverables above. The planning prompts should use proven prompt-engineering techniques, which are structured ways of asking an AI to reason more carefully. The ones I want considered are these:

- **Self-consistency:** have the model reason about a question several times and take the answer that most of the attempts agree on.
- **Self-ask:** have the model ask itself the follow-up questions that must be answered first, and answer them before giving its final answer.
- **ReWOO (Reasoning Without Observation):** have the model plan all the steps and tool calls in advance, then carry them out and combine the results, rather than deciding one step at a time.
- **Tree of Thoughts:** have the model explore several lines of reasoning as branches, judge them, and back up when a branch fails.
- **Graph of Thoughts:** a similar idea in which pieces of reasoning are connected and combined, so that good parts of different attempts can be merged.
- **Least-to-most prompting:** break a hard problem into easier sub-problems and solve them in order, using earlier answers for later ones.
- **Chain of Verification:** have the model draft an answer, write questions that check the draft, answer them independently, and then correct the draft. I consider this one close to essential.
- **System 2 Attention:** have the model first rewrite its input to remove irrelevant or misleading material, and then answer from the cleaned version.
- **Multi-agent debate:** have several sessions argue positions and critique each other, in order to reach a better answer than any one of them would alone. I consider this one definitely necessary.
- **Prompt chaining:** have the output of one prompt become the input of the next, as a fixed sequence.

I expect to use a few of these together rather than all of them at once. They are meant to be part of the shared rules that every session works under.

---

## 6. Dividing the Work

After the master checklist exists, the primary divides it into categories, and each category is assigned to a worker. The way to divide the work is to separate it by the kind of work it is. For software, that could mean front end, back end, APIs, deployment and operations, artificial intelligence and data, and testing. For writing and social media, it could mean a research agent, a writing agent in the owner's voice, an image agent, and a separate publishing agent for each channel: one for Facebook, one for Instagram, one for Slack, one for LinkedIn, and so on. If one worker can handle several categories, it may take several.

The number of workers is decided by the amount of work and by how fast I want it done, and I can override it. The categories themselves are meant to prompt the primary: the primary asks, which kinds of work does this project contain, and who should own each? If there is a better way to divide the work, it should find it.

Each worker builds or adopts a checklist of the features that were proposed or architected for its category. That checklist is its list of micro sprints. A worker never changes the master list. It keeps its own records of what it finished.

---

## 7. The Manifest and How Everything Is Packaged

Once the agents are defined, the primary builds a manifest. The manifest is simple and structured. For each agent it records:

1. The agent's name, which is its identity.
2. A description of what the agent does.
3. A list of file paths that point to where its prompts and instructions live.
4. The tools it is going to need.
5. Its directions.
6. The link to the message board, which is where it must report and update.
7. Its main instructions, which tell it to follow the folder that was created for it.

The manifest can be written as JSON, as TOML, or both. We will probably also need a markdown file that describes our MCP server, which I call an `MCP.md`, and I expect the manifest to be elicited from it. The manifest is also the thing that points each agent to the folder from which its instructions come, so that nobody has to guess.

I want all of this to follow the same packaging style that existing skills and plugins use, to the extent that it makes sense, so that anyone in the world can understand it and add to it. I looked at two examples. The first is a skill called *web-artifacts-builder*. It has a `SKILL.md` file with the instructions, a `scripts` folder holding two shell scripts and a compressed archive of components that gets unpacked, and a license file. The second is a plugin called *Desktop Commander*. It has a plugin description file, a `skills` folder in which each of six skills has its own folder and its own `SKILL.md`, a README that lists its components, and a connection to an MCP server. These two examples show the range: a simple skill can be a handful of files, and a more advanced one can contain several folders with several skill files plus connectors, hooks (small automatic triggers), and notes. Some are sets of skills, not just one skill.

What I take from them is a set of habits. A skill file has a clear title, a short lead-in that explains what it is for, and a consistent format, with tables where they help. It can have scripts, references, and a license. It can have MCP servers connected to it. These are base structures that I have already adopted for my own skills and rules, and I already have a repository that does much of this. What I want here is to take it a step further and explain exactly how to use similar formats for document design and for technical design, so that everything is consistent.

What I am building on top of that is a set of rules specific to this system: how to run a planning session, how to break the plan down, how to create the manifest, how the primary must behave, and how each worker must behave. The primary needs its own hard, structured set of rules. Each worker needs its own prompts, some of them pre-written with explicit instructions about how to communicate, how to act, how to reach the message board, and how to call its tools. The primary's prompts add the hierarchy, because it is the one helping me create everything and managing everyone else.

---

## 8. Starting the Workers

After I sign off, the primary starts the workers. It uses the command line to create each worker session and injects the instructions into it. In effect it tells each one: you need to go here, read your instructions, read your prompt, and follow these rules. There is an index, which is the manifest, that points each agent to where its instructions are. Each worker is spun up locally inside the editor environment, so that they work with me inside my code projects. I do not have to spin each one up by hand.

When a worker starts, it also records its session number. These numbers are saved along with each agent's name and identity, so that if I close the editor or shut everything down, I can open a new chat later, say "continue," and have the primary recall every agent and its numbers. The primary can then resume them.

---

## 9. How a Worker Works

The worker's main instruction is to go through the checklist it has been assigned, start working on its tasks, get them done, get them tested, get them verified, get them pushed, and get them merged. It does this nonstop. It never shuts down and it never stops until its work is complete. Its instructions say so explicitly.

A worker begins by analyzing and backtracing the part of the project that it owns. It builds a plan and executes that plan. It picks its own next task from its checklist, and it judges how much to take on at once by how complex the task is. For every piece of work, it follows the same sequence: build it, test it, check it against the final guidelines, validate it, and mark it off. Testing is scaled to the size of the work. A small fix needs a simple check, a component needs unit tests, a whole system needs end-to-end tests, and when a real user is needed, the owner tests it. A worker never pushes anything that is broken. If something breaks, the worker first checks whether another agent's work caused the break before it acts on it.

Because the worker must re-read its instructions each time to know what to do next, its instructions are written around events. When it finishes building, the instructions say what to do: test. When testing is done, they say what is left. When everything on the list is done, they say to write the final object, then to push the branch. The worker marks each of these events in its own records so that it always knows where it is in the cycle.

Those records are structured. A worker keeps a tally of what it has completed and tested, and it writes its own JSON file as a running change log of what it built and finished. The change log is how we know what happened without letting any worker edit the master list. We will need an example structure for this, and one is given in the appendix.

Failures are recorded as well. Whenever a worker catches a failure, it logs it, and then it examines the failure: what failed, what it could not get past, and why it could not. It writes this up as a ticketed report, which is a formal record with an identifier, a description, the cause, and the status, so that the problem can be tracked until it is closed.

Where the work goes depends on the kind of project. For code, a worker commits to its own branch, runs its own tests, including unit tests, and then, when its branch is complete, it posts to the message board that the branch is complete and tested, with the test results, and it says whether the owner needs to be involved. The primary decides whether the owner must be involved. Then somebody pushes it into the main version: the primary reads the board, looks over the test results, and merges it. For a project that is not code, the finished product is published to the web or to wherever it belongs. Either way, the worker can self-merge or self-publish if the rules allow it, which may be easier; small, proven work can go in without the owner, and major changes need the owner's permission. These rules are set during the planning session.

---

## 10. After the Checklist Is Done

When a worker finishes its whole checklist, it does not stop. It performs a gap analysis of its own area, writes the report, and stores it somewhere. If there are gaps, it creates a new worksheet of new work. That worksheet does not override the original work from the planner; it is a separate document. The worker shares the file location with the rest of the team so that everybody knows where it is.

Every few tasks it also runs a gap analysis, and it updates its own instructions with what comes next. When half of a worker's tasks are done, or three-quarters, depending on what the planner and I decide, the worker tells the primary that it is time for future planning. I think half is probably the better choice because it keeps the planning more robust.

When there is truly nothing left to build, the workers begin thinking about the future. They go back to my vision and ask what we do not have yet that we could have. They research similar products, tools, and new technology, and compare them with ours, to find features, systems, and channels that would make the product more valuable and more competitive, such as an email system, marketing, a mobile or desktop app, or new integrations. They must think outside the box and treat the project as a product: what else could be added to give it value, whether it is something in code or something like posting on a daily basis? They also protect what the business depends on and do not break what already works. A worker can also choose to wait to gather real usage data, such as hotspots and user interactions, so that its changes are informed.

Each worker keeps a wish list. Together this becomes a dream list, a vision board of what could be built, one per agent. The primary pitches these proposals to me, each in a couple of sentences, and I say yes or no. If I say no, that worker looks for other things to improve. If I say yes, the idea becomes a new plan with its own requirements and its own gap analysis, and the cycle begins again. If there is nothing more to propose and I do not want anything more, the worker can be retired safely and put to sleep, and nothing further is asked of it. The system must also know when to stop, rather than changing things until they break. A worker with nothing worth doing goes idle, runs tests, or is reassigned.

Over time the primary may retire some workers and hire new ones. That is how we cycle through different workers while the product keeps evolving, and it is why planning is not a one-time event. Planning is comprehensive and it is repeated: the first session starts the work, and further sessions follow as the product evolves.

---

## 11. The Message Board

The message board is simply a place where the workers and the primary can post, so that they can communicate and understand where each other are. I want it to be a simple concept built on rules about what to post and when. Its purpose has two sides.

The first purpose is to keep the workers from stepping on each other's toes. Before a worker starts a task, it posts to the board that it is working in a certain folder, on certain files, and what its plan of action is. Every other worker, when it starts a task, reads what the others have posted and posts its own files too. If a worker finds that another is working in the same folder or the same files, it says so, and a conflict has to be posted to the board. The two sessions can then wait, ask each other how long, or work on something else. This is how collisions are prevented before they happen, and it is also how errors are handled efficiently.

The second purpose is to let the primary know what is happening. Workers post when they start a project, when they finish it, when they begin testing, when they are ready to merge, when they run into a problem, and when their lists are running out. Merging has its own protocol. A worker that has finished and tested a branch announces to the board that it needs to merge and asks whether anybody else is merging. If it hears nothing for a short time, which I would set at about five seconds, that means everyone is busy and there is no objection and it can go ahead. If another worker objects, there is a conflict that has to be handled by the rules.

The board also carries the workers' questions, issues, and finished items, and it carries the requests for planning sessions. For example, a worker will post that it has finished half or three-quarters of its tasks and that a planning session is needed. Workers also coordinate across the boundaries of their categories on the board. For example, if the user-interface worker needs a new API, it works that out with the API worker, and it does not build the API itself.

The board needs a decision process, with levels of severity. Small problems the worker can handle itself. Larger problems go to the primary, which decides whether it can answer, in which case it tells the worker to go ahead and fix it and move on, or whether it needs to ask me, in which case it tells the worker to hold. The most serious problems are brought to me by the primary. Whatever the level, a worker never contacts me directly.

The primary must be aware of the board. Ideally it has a tool that watches the board and sends a signal whenever something new is posted, or the board injects the new messages back into the primary's session, which would be even better. When the signal arrives, the primary reads the post, which may say that a worker is done, that it is stuck, that its list is almost empty, or that a planning session is due, and it decides what to do: instruct the worker, spin up another worker, retire one, run a new analysis, or bring something to me. The board is also what lets me read the chain of reasoning between the sessions.

Because the board will be read all the time, it must be efficient. Each post should be short, the workers should read only what is new and what concerns them, and old messages should be cleaned up automatically so that the board does not grow forever. The details of the technology are in section 17.

---

## 12. Planning Over Time

Planning is not finished after the first session. Some of it is scheduled, and some of it is triggered by progress. A planning session is triggered when a worker, or the whole team, reaches the point I described: half or three-quarters of the tasks done. It can also be triggered by the calendar. For ongoing work such as content, planning should be daily or weekly, because the topics always change. For example, on Saturday, the system should know that it is time to plan next week's videos, and it should ask me what I want for Facebook, what I want for Instagram, and so on. So the system must be aware of time, and it must schedule these sessions. I will be giving more frequent updates to the primary in these cases, and the work will be more dynamic. The instructions must support all of that.

The same method applies to a code project and to a content project. In a content project, one agent might gather the article information, links, search-engine-optimization titles, and images, generating images when needed, and another might write in the owner's voice. One agent would research topics, another assemble the piece, and then separate agents would publish to each channel, constantly. In an administrative project, such as weekly spreadsheets and financial analysis, the same structure applies with different categories.

---

## 13. Seeing and Controlling Everything

I need to be able to see what is going on and to manage it. I want to see which agents exist, what each is named, what chunk of work each is handling, and how many sessions are running at any time. I want to see which agent controls which task, which tasks are finished, and which errors have happened. I want to see the number of tasks on each agent's list, and the planning sessions, past and scheduled. I want a graph of progress and a view of future work, new work, gaps, and technical debt, all in a structured format that is tracked and visualized. For the main progress picture I want a radar chart, with a spoke for each category and a shape showing how much of that category is complete.

I want to read the message board so I can follow the chain of reasoning and thought between the sessions. I also want to be able to act: if I see an agent going rogue, I should be able to stop it, or to tell the primary to fire it.

This should appear inside VS Code, in the left sidebar, where the other extensions put their tools, with a larger view for the charts. That requires an extension, a plugin for VS Code, and it requires the data the extension shows to be recorded somewhere permanent. It should record every agent's name, its identity, its session number, its task counts, and the status of the planning documents, so that nothing is lost when the editor is closed.

---

## 14. What the System Must Be Like to Install and Run

I do not want this to fill up my code projects with files, and I do not want to copy a folder into every project that uses it. That would be inefficient and wasteful. The system should be installed once, and each project should need almost nothing.

It must also not overload VS Code. A large file or database kept inside the editor, or a heavy process running inside it, would slow the editor and make coding painful. Whatever stores the messages and records must run on the machine, outside the editor's own process, and must stay small.

It must be efficient in the engineering sense. It must be bounded, so that its size does not depend on how long it has been running. It must clean up after itself. It must be fast, it must leave room to be optimized, and it must be the best method overall, the most professional enterprise method of delivery.

It must be easy to share. I want to open-source it so that other people can use it to evolve their own projects, whether in VS Code or not. People who do not know how to deploy Docker (a tool for running programs in sealed containers) should not have to. Installing anything on another person's computer raises questions about permissions, so installation must not need administrator rights, and it must be clear exactly what is being installed and where.

---

## 15. Living Documents and Shared Standards

Four documents are living documents, and they are updated after every piece of work: the plan of action, the change log, the future-changes list, and the owner's preferences. Nothing is ever removed from the history of the plan. Every worker follows the same shared rules, templates, and prompt-engineering methods, and every worker is held to professional engineering standards and to a strong standard of user-experience and user-interface design.

---

## 16. Questions the Design Still Has to Answer

While consolidating everything I have said, I found a number of places where the design is still open. I list them here so that planning can settle them.

1. What exactly are the severity levels, and what does each one cause to happen?
2. When two workers conflict over the same files, who wins, and who decides?
3. What does "approved" mean for each planning document, and who may approve it?
4. How long should a worker wait after announcing a merge, and does the wait differ by project size?
5. Where do the master checklist, the category breakdown, and the manifest live, and which of them may a worker read but not write?
6. What limits are placed on a worker's spending, its running time, and its authority to merge?
7. What does it mean to retire a worker, and how are its notes and change log kept?
8. How does the primary learn about a new message if it is idle, and what happens if the owner is talking to it at the time?
9. How are the radar chart's categories chosen, and how is "percent complete" calculated for a category?
10. How are prompts versioned so that a change to the shared rules reaches sessions that are already running?

---

## 17. The Proposed Message Board

This is the only piece of technology I have chosen so far, and it is a proposal. The rest of the architecture has not been decided yet.

**What it is.** The board is a message server called NATS, with its built-in persistent store, called JetStream. NATS is a single program that ships as one executable file. Sessions connect to it, post messages to named subjects, and read from them. JetStream saves the messages and also provides a key-and-value store, a simple table of keys and their values, in which entries can be made to expire automatically.

**Why it fits.** According to its own documentation:

1. A stored message log can be given limits on the number of messages, their total size, and their age, and when a limit is reached the server deletes the oldest messages automatically. This keeps the board bounded and makes it clean up after itself. The defaults are unlimited, so we must set the limits.
2. The key-and-value store can create a key only if nobody holds it, as one indivisible step, and entries can expire. This is how a worker announces which files it is working on, and how a stale announcement from a stopped worker disappears. Two workers cannot both hold the same announcement.
3. Changes can be pushed in real time to anything that is watching, which is how the primary and the dashboard are told when something new has been posted.
4. Many sessions can read and write at once, and a message identifier lets the server discard duplicates.
5. Sessions can connect through ordinary network connections, through a command-line tool, or through WebSockets, a standard way for programs to hold a live connection.
6. It is light. The program is one executable, available for Windows, and its documented minimum for a server with persistence is a single processor core and 32 megabytes of memory at a thousand messages per second, which is far above what a group of agents posting a few messages a minute will produce.

**What it holds.** Besides the messages, it keeps durable records: a registry of agents (name, role, tool, session number, branch, checklist, and task counts), the planning documents with their paths, checksums, and status, the planning sessions and their schedule, the progress counters that feed the radar chart, and a short-lived presence record that shows which agents are currently alive. The documents themselves stay as files; the board holds the pointers and the status. Messages expire once delivered and acknowledged, while the registry and the counters persist. Each delivery to a session is limited in size, so that no session's context is filled with old messages.

**Where it is deployed.** It runs as a normal program on the owner's own machine, outside VS Code, listening only on that machine. Its data is stored in a folder inside the owner's user profile, not inside VS Code and not inside any project. It does not use Docker, and it needs no administrator rights. The VS Code extension carries the program inside its installation package, starts it, and stops it; separate packages for each operating system are supported by VS Code, and an extension can also be shared as a single installable file without any marketplace. A small command, which the sessions call, enforces the posting rules: announcing files, checking for overlaps, posting with a severity, and reading what is new. If the agents ever run on several machines, or for a team, the same server can be run on a shared computer or in Docker, with no change to the design.

**What I still have to decide.** Whether to include the program inside the extension package, which works offline and installs in one step, or to download it the first time the extension runs, which makes the package smaller. And which language to write the small command in, so that it ships as a single file that needs nothing else installed.

---

## Appendix: Illustrative Structures

These examples show what the structured files might look like. They are illustrations, not final designs, and the real fields will be settled during planning.

**One agent's entry in the manifest:**

```json
{
  "name": "api-agent",
  "description": "Owns the back-end APIs: designs, builds, tests, and documents them.",
  "tool": "claude-code",
  "instructions": ["agents/api-agent/instructions.md", "agents/shared/rules.md"],
  "checklist": "agents/api-agent/checklist.json",
  "changelog": "agents/api-agent/changelog.json",
  "tools_needed": ["git", "test-runner", "message-board"],
  "board": "board://project/api-agent",
  "reports_to": "primary",
  "main_instruction": "Follow the folder created for you. Work your checklist without stopping."
}
```

**One entry in a worker's change log:**

```json
{
  "task": "api-014",
  "title": "Add settings endpoint",
  "status": "merged",
  "events": ["built", "tested", "validated", "pushed", "merged"],
  "tests": { "unit": "passed", "end_to_end": "passed" },
  "branch": "api-agent/settings-endpoint",
  "needs_owner": false,
  "time": "recorded when the entry is written"
}
```

**One entry in the failure log:**

```json
{
  "ticket": "FAIL-007",
  "agent": "ui-agent",
  "what_failed": "Settings page could not save changes.",
  "could_not_get_past": "Required endpoint did not exist.",
  "why": "The API worker had not yet built it.",
  "action": "Asked the API worker through the board.",
  "status": "open"
}
```
