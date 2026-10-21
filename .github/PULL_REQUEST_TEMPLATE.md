<!-- Read CONTRIBUTING.md first. A pull request that leaves out a section below is asked to fill it in before review. -->

## Problem

<!-- What is wrong or missing, and how you established it. Link the issue or discussion where a maintainer agreed to the direction; a behaviour change needs one. -->

## Change

<!-- What the change does about it, and why this is the smallest change that solves it. -->

## Scope

- [ ] This solves one problem; anything adjacent is its own pull request
- [ ] Core names no module and no theme; a feature only some sites need is a module
- [ ] Changed module sources are bumped and rebuilt with `npm run build:marketplace`, archives included
- [ ] New strings are in every locale

## Verification

<!-- The steps to reproduce, the tests you added or ran and what you saw, and anything you could not check. Before and after screenshots for a visual change. -->

- [ ] `npm run verify` passes
- [ ] `npm run test:e2e` passes, when the change touches the interface

<!-- Last line: the model and harness that wrote the code, e.g. "Written with Claude Opus 5.5 in Claude Code", or "No AI model wrote this code". -->
