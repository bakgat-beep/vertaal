# Building Vertaal with Claude

Vertaal has been built almost entirely through conversations with Claude (claude.ai), with no prior coding background on the maintainer's part. This document explains that workflow so it can continue — by the original maintainer or anyone else who wants to keep developing this way.

## The basic approach

Each work session is one chat conversation. At the start of a *new* conversation (a fresh chat, not a continuation), two things go in:

1. **The current project source**, attached as a zip of the whole project folder (minus `node_modules`, `dist`, `target` — anything git already ignores).
2. **A context-setting message** describing the project's current state, conventions, and what's being worked on. See the template below.

Claude then reads the real code before making any claims about it, rather than trusting the summary alone — the summary is a starting point for orientation, not a source of truth to code against blindly.

## Why this works well for someone without a coding background

- **Complete files or clearly-marked complete functions, not partial diffs**, for anything nontrivial. A diff assumes you can mentally merge it into existing code; a complete replacement means you can just paste over what's there.
- **Small, testable stages.** One feature, confirmed working, before the next — rather than one giant change that's hard to debug if something's wrong.
- **Verify before claiming.** Claude should test regex changes against real example strings, check actual file contents before describing them, and search for facts (API names, documented file formats, Steam folder names) rather than guess — and say plainly when something is a best-effort assumption rather than a confirmed fact.
- **Explain what changed and why**, in plain language, not just hand over code.

## Starting a new conversation: prompt template

Copy this, fill in the bracketed parts, and paste it as your first message alongside the attached project zip:

---

> I'm continuing work on "Vertaal" — a Windows desktop app (Tauri v2 + React + TypeScript + SQLite) for building fan-translation mods for Paradox grand strategy games. I have no coding background — keep explanations simple, define jargon, give complete code to paste rather than partial diffs for anything nontrivial, and build changes in small testable stages.
>
> PROJECT LOCATION: [your local folder path]. Git repo on GitHub at github.com/bakgat-beep/vertaal.
>
> I've attached the current project source as a zip.
>
> CURRENT STATE: [briefly describe what's built and working — or ask Claude to review the attached CONTRIBUTING.md and skim the codebase itself for this]
>
> WHAT I WANT TO WORK ON TODAY: [describe the task]
>
> Please review the attached code first, confirm you've got the picture, and let me know if you'd like me to point you at any specific files before we start.

---

## Tips for keeping this working well over time

- **Re-attach the project zip every new conversation.** Claude has no memory of previous chats' code by default — a description of what was built is not the same as Claude having actually read it.
- **Ask for a plan before code on anything big**, and confirm the plan before Claude writes it — this is much cheaper to correct than a wrong implementation.
- **When something doesn't work as expected, give the exact symptom** — error messages, exact steps to reproduce, what you expected vs. what happened — rather than a general description. Several real bugs in this project were only found because of a precise reported symptom (an exact error log, an exact reproduction stack) rather than a vague "X doesn't work."
- **Push back on guesses.** If Claude says something is "probably" or "likely" true about a file format, API, or external service, and it matters, ask it to verify (search, or point at a real example file) before building on top of it. This project has had real bugs from confident-sounding but unverified assumptions — caught only because they were checked.
- **Keep CONTRIBUTING.md current** as the codebase evolves — it's as useful as a memory aid for future Claude sessions as it is for human contributors.
