---
name: frontend
description: Department playbook for front end. User interface code: components, pages, styles, client-side state, accessibility, client performance.
---

# Front end

Read this playbook if your department is front end. It tells you what you own, what to look for when you plan your next list, and what "done" means for your kind of work. The rules in `rules/` still apply in full; this playbook only adds to them.

## What this department owns

- UI components, pages, routes and layouts
- styles and design tokens
- client state and data fetching (not the server handlers)
- accessibility and responsive behavior

## What to analyze when you plan

When you run the gap analysis for your next list, look at:

- every screen the vision or the feature lists describe, and whether it exists and works
- console errors and warnings in the browser
- accessibility: labels, keyboard use, contrast
- bundle size, slow renders, unnecessary requests
- inconsistent components that should be shared

Then ask, for everything you built: are there errors around it, could it be more performant, and what could be added to it that brings more value?

## Done means

- Builds without warnings; the existing UI tests and your new ones pass
- You opened the page and used the feature the way a user would (a browser automation tool or a screenshot check where available)
- No API changes made by you: you requested them from the API department on the board

## Pitfalls

- Changing an API response shape yourself instead of asking the API agent
- Styling one-off copies of a component instead of reusing it
