# Codex project instructions

## Comment and change-description policy (highest priority)

This policy overrides lower-level documentation and applies to code comments, maintenance guidance, and pull-request descriptions.

1. Comments explain only non-obvious reasons, constraints, or risks that cannot be read directly from the code.
2. Do not preserve intermediate attempts, debugging history, rejected alternatives, prior implementations, or states that were never merged.
3. Pull-request descriptions state the final behavior and trade-offs that are not visible in the diff. They must not mention unmerged intermediate states.
4. When maintaining project guidance, express a constraint as the current rule plus its reason, without narrating how the project arrived there.

Before doing any work:

1. Read `CLAUDE.md` in full.
2. Treat `CLAUDE.md` as important project guidance, but verify important details against the current code because some documentation may be outdated.
3. Preserve the existing architecture, naming conventions, and toolchain unless the task explicitly requires changing them.
4. Do not rewrite or replace existing implementations merely to match personal preferences.
5. Make only the changes required for the current task.
6. Do not perform unrelated cleanup or refactoring.
7. Run the validation commands documented in `CLAUDE.md` before declaring work complete.
8. When `CLAUDE.md` conflicts with this file, follow `AGENTS.md`.

## Live Kancolle safety

Browser use is allowed for local UI development and visual inspection.

The agent may use a browser to inspect:

* local development pages
* extension popup pages
* extension side panel pages
* overview pages
* replay viewer pages
* local mock pages
* localhost pages
* screenshots and layout dimensions

The agent must never access or interact with the live Kancolle game.

The agent must not:

* log into any DMM account
* open the authenticated Kancolle game
* perform gameplay
* automate gameplay
* send requests to live Kancolle servers
* capture new packets from the live game
* interact with a real player account
* use browser automation against the live game

If a task requires live-game verification, stop and provide a manual verification checklist for the developer instead.

Only the developer may log into and operate the live Kancolle game.

## Local preview and browser tool usage

* The browser tool (`browser_subagent`) does not support the `file://` protocol due to sandbox restrictions.
* When offline preview pages (`.preview/*.html`) or mock pages need visual inspection and DOM measurement:
  1. The agent must start a background HTTP server (e.g., `python3 -m http.server <port>` with `IsDaemon: true`) from the project root before invoking the browser tool.
  2. Pass `http://localhost:<port>/.preview/<filename>.html` (or the corresponding localhost route) to `browser_subagent`.
  3. Clean up the background server task after inspection is complete.

## Passive observation requirement

This extension must remain passive.

The agent must not add code that:

* changes outgoing game requests
* modifies incoming game responses
* injects gameplay commands
* automates player actions
* delays, reorders, or resends game requests
* changes game behaviour

The extension may only observe existing traffic and derive local state.

## Unverified game data

Do not invent or assume the meaning of unverified Kancolle API fields.

When real packet evidence is missing:

* keep the field marked as unverified
* preserve the raw value where appropriate
* avoid implementing guessed behaviour
* state clearly that manual validation or real packet samples are required

## Data safety

Do not make changes that can silently lose, overwrite, duplicate, or corrupt:

* captured events
* IndexedDB data
* sortie history
* expedition history
* factory history
* replay data
* backup data
* restored data

Any database or backup-format change must preserve existing user data or include a clear migration path.

## Completion requirements

Before declaring a task complete:

1. Confirm which files were changed.
2. Run the available compile, build, and test commands relevant to the task.
3. Report any validation that could not be performed.
4. Provide manual browser verification steps when live-game testing would otherwise be required.
5. Do not claim that live Kancolle behaviour was verified unless the developer supplied the relevant logs, screenshots, or packet captures.
