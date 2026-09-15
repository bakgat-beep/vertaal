# Building Vertaal with Claude

Vertaal has been built almost entirely through conversations with Claude (claude.ai), by someone with **no prior coding background**. This document explains that workflow in detail — jargon included and explained — so it can continue, by the original maintainer or anyone else who wants to develop this way.

If you've never written code and have never used an AI chat tool for anything like this before, read this whole document before starting; it's written for exactly that situation.

## What is "vibecoding"?

"Vibecoding" is a casual term for building software by describing what you want in plain English to an AI assistant, and having it write the actual code — rather than writing the code yourself. You stay in charge of *what* gets built and *whether it actually works*; the AI handles the *how*, in a language (code) you don't need to read fluently to direct.

It doesn't remove your judgment from the process — you still need to test things, describe problems clearly, and push back when something seems off. This document is mostly about how to do those parts well, since they're where most of the actual skill sits.

## What you need before starting

- A free account at [claude.ai](https://claude.ai). The free tier is enough to build and maintain a project like this one, but it comes with a **usage limit** — a cap on how much you can send/receive in a given window before you have to wait. This is the main reason session hygiene (covered below) matters.
- The project's GitHub repository link: `https://github.com/bakgat-beep/vertaal`. You don't need to know how to *use* GitHub to do this — you just need the link.
- Everything else (Node.js, Rust, etc., for actually running the app) is covered in [CONTRIBUTING.md](../CONTRIBUTING.md)'s development setup section, and Claude can walk you through installing it the first time if you don't have it yet.

## Setting up your computer, before your first session

Before you can run Vertaal from source or use Claude to develop it, you need a few programs installed once on your computer: [Node.js](https://nodejs.org/), the [Rust toolchain](https://www.rust-lang.org/tools/install), the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/), [Git](https://git-scm.com/downloads), and a code editor — [Visual Studio Code](https://code.visualstudio.com/) is the standard free choice. This is a one-time setup (or close to it), separate from the ongoing coding sessions described below.

**Consider doing this setup with the help of an AI chat tool as well — ChatGPT is a good choice for this specific step.** The reason to prefer ChatGPT here rather than Claude: installation is exactly the kind of task where you hit an unexpected snag — a permissions error, a PATH variable that didn't get set, a version mismatch, an installer that behaves differently than the instructions describe — and you need to keep going back and forth to resolve it. If you're on a free tier and happen to hit a usage limit mid-troubleshooting, ChatGPT's free tier is generally more forgiving about this, tending to throttle or limit what you can do rather than cutting off the conversation outright the way hitting a cap elsewhere might — which matters when you're mid-way through an install and don't want to lose your place.

Whichever tool you use, the approach is the same: tell it what you're trying to install (paste in the "Development setup" list from [CONTRIBUTING.md](../CONTRIBUTING.md)), tell it your operating system and, if you know it, your Windows version, and ask it to walk you through the steps one at a time rather than dumping the whole list at once. **This is exactly the kind of thing AI chat tools are good at**: if a step fails, if an error message means nothing to you, or if you're not sure which option to pick in an installer, describe exactly what you're seeing and ask — working through that ambiguity interactively, in plain language, is what the tool is for. You don't need to already understand the error to ask about it.

## The basic approach

Each work session is one chat conversation with Claude. Vertaal's source code is public on GitHub, which makes starting a session simple:

**Give Claude the repository link and ask it to clone the code directly**, rather than attaching files yourself. For example:

> Please clone https://github.com/bakgat-beep/vertaal.git and read CONTRIBUTING.md and docs/AI_ASSISTED_DEVELOPMENT.md before we start.

This works whenever Claude has a sandbox with internet access and the ability to run commands — this is available in claude.ai when its coding/file-creation tools are turned on, and is the default in tools built specifically for coding, like Claude Code. If you're using a plain chat interface without that capability, Claude will tell you it can't reach the internet — in that case, download the project as a zip from GitHub (the green "Code" button → "Download ZIP" on the repo page) and attach that instead. Either way, a **context-setting message** should go in alongside it — see the template below.

One important thing to understand about this: **when Claude clones the repo itself, it's working in its own temporary copy, not your actual local files on your computer.** Nothing Claude changes there automatically appears on your machine. That means any change worth keeping needs to come back to you as either:
- the **complete content of the file**, ready to paste over what you have, or
- **exact "find this text, replace it with this text" instructions**

— never just a description of a change in prose. If Claude ever just *describes* a change without giving you one of the above, ask for the actual code before moving on.

## Why this works well for someone without a coding background

- **Complete files or clearly-marked complete functions, not partial diffs**, for anything nontrivial. A diff assumes you can mentally merge it into existing code; a complete replacement means you can just paste over what's there.
- **Small, testable stages.** One feature, confirmed working, before the next — rather than one giant change that's hard to debug if something's wrong.
- **Verify before claiming.** Claude should run the test suite (`npm test`) and type-checker (`npx tsc --noEmit`) after changes that touch tested code, check actual file contents before describing them, and search for facts (API names, documented file formats, Steam folder names) rather than guess — and say plainly when something is a best-effort assumption rather than a confirmed fact.
- **Explain what changed and why**, in plain language, not just hand over code.

## Starting a new conversation: prompt template

Copy this, fill in the bracketed parts, and paste it as your first message:

---

> I'm continuing work on "Vertaal" — a Windows desktop app (Tauri v2 + React + TypeScript + SQLite) for building fan-translation mods for Paradox grand strategy games. I have no coding background — keep explanations simple, define jargon, give complete code to paste rather than partial diffs for anything nontrivial, and build changes in small testable stages.
>
> Please clone https://github.com/bakgat-beep/vertaal.git directly rather than asking me to upload anything. Read CONTRIBUTING.md and docs/AI_ASSISTED_DEVELOPMENT.md first.
>
> Run `npm test` and `npx tsc --noEmit` after any change that touches tested code (currently `src/parser.ts`).
>
> You'll be working in your own cloned copy, not my real local files — so after every change, give me the literal code to paste into my own local copy: full file content for anything nontrivial, or exact find/replace instructions.
>
> WHAT I WANT TO WORK ON TODAY: [describe the task]

---

## When to start a *new* chat

**Start a fresh conversation at the end of each major work session** — don't keep reusing one long-running chat indefinitely. This matters for two reasons:

1. **Usage efficiency.** Every message in a conversation carries the *entire* conversation history with it behind the scenes — the project files Claude read, everything discussed so far, all of it. On a free tier with a usage cap, a long-running chat burns through your available usage much faster per message than a fresh one does, because each reply has to process all that accumulated history again.
2. **Staying on task.** A chat that's accumulated a lot of history from earlier, unrelated work can start drifting — referencing old context that's no longer relevant, or losing track of the specific thing you're doing right now. A fresh chat, pointed at the current state of the real repo, avoids that.

A good rule of thumb: if you've finished a feature or fix and confirmed it works, that's a natural end point — wrap up, and start the next piece of work (even later the same day) as a new conversation. Since the project lives on GitHub, a new chat just re-clones the current code, so nothing is lost by starting fresh.

## Tips for keeping this working well over time

- **Point Claude at the real GitHub repo every new conversation**, so it's always working from actual current code rather than a stale description. If Claude can't reach the internet in your interface, fall back to attaching a fresh zip export instead.
- **Ask for a plan before code on anything big**, and confirm the plan before Claude writes it — this is much cheaper to correct than a wrong implementation.
- **When something doesn't work as expected, give the exact symptom** — error messages, exact steps to reproduce, what you expected vs. what happened — rather than a general description. Several real bugs in this project were only found because of a precise reported symptom (an exact error log, an exact reproduction stack) rather than a vague "X doesn't work."
- **Push back on guesses.** If Claude says something is "probably" or "likely" true about a file format, API, or external service, and it matters, ask it to verify (search, or point at a real example file) before building on top of it. This project has had real bugs from confident-sounding but unverified assumptions — caught only because they were checked.
- **Keep CONTRIBUTING.md current** as the codebase evolves — it's as useful as a memory aid for future Claude sessions as it is for human contributors.
- **Use ChatGPT (or similar) for the "thinking" side if you find it helpful.** This project uses ChatGPT separately for scoping out what to build next and reviewing finished code, and Claude for the actual implementation — you don't have to work this way, but splitting "what should we build and does this look right" from "write the code" can help you catch issues you might otherwise miss by only ever talking to one assistant.

## A short glossary

A few terms used above and throughout the project's docs, in case they're new:

- **Repo (repository)** — the project's folder of code and its full history, hosted on GitHub.
- **Clone** — making a local copy of a repo (or, here, Claude fetching a copy into its own sandbox).
- **Sandbox** — an isolated, temporary environment Claude works in when it runs code or clones a repo. It is *not* your computer.
- **Diff** — a description of only the lines that changed in a file, shown as removed/added lines. Useful for experienced developers skimming a change quickly; not what you want as a beginner, since you can't easily tell where it fits into the file you already have.
- **Token** (AI-usage sense) — the unit AI models process text in (roughly a word or word-fragment); "usage" on a free tier is generally metered in tokens processed, which is why long conversations cost more per message. **Careful:** Vertaal's own code also has a completely unrelated concept called "token protection" (`src/parser.ts`), referring to placeholders for game syntax like `$VARIABLES$` — the two uses of the word "token" have nothing to do with each other.
- **Context window** — how much of the current conversation (and any attached files) an AI model can "see" at once when generating a reply. A long chat eventually fills this up, which is another reason to start fresh sessions periodically.
- **`tsc --noEmit`** — runs TypeScript's type-checker without actually building the app, to catch a class of mistakes (wrong types, typos in property names, etc.) before you even try running it.