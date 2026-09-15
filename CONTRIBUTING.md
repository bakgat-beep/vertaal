# Contributing to Vertaal

Thanks for taking an interest in Vertaal! This document covers how the codebase is put together, so you can add a game, a provider, or a fix without having to reverse-engineer the whole thing first.

## How this project is built: AI-assisted development ("vibecoding")

Vertaal has been built entirely through **vibecoding** — describing what you want in plain English to an AI chat assistant, which writes the actual code — by someone with **no prior software development background**. Specifically:

- **ChatGPT** (free tier) is used for project scoping, planning, and reviewing code changes.
- **Claude** (free tier, [claude.ai](https://claude.ai)) is used for all of the actual coding and documentation writing.

This isn't a footnote — it's the intended way to keep developing Vertaal, and it's exactly how the original maintainer works with no coding background of their own. If you're in the same position — you have ideas for the project but no traditional coding experience — you can contribute this way too. **[docs/AI_ASSISTED_DEVELOPMENT.md](docs/AI_ASSISTED_DEVELOPMENT.md)** is a full, jargon-explained walkthrough of exactly how to do this: how to start a session with Claude, what to give it, how to test what it produces, and how to keep a session efficient and on-task.

If you *do* have traditional coding experience, everything in this document still applies as normal — write code by hand if you'd rather, the architecture and conventions below don't assume either workflow.

## Development setup

1. Install [Node.js](https://nodejs.org/) (LTS) and the [Rust toolchain](https://www.rust-lang.org/tools/install)
2. Install the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/)
3. `npm install`
4. `npm run tauri dev` — runs the app with hot reload

Vertaal is Windows-only by design (it writes Paradox game/mod files using Windows-style paths throughout), so development is expected to happen on Windows.

### Running the test suite

Vertaal has an automated test suite (using [Vitest](https://vitest.dev/)), currently covering `src/parser.ts` — the token-protection logic, which is the part of the codebase most likely to silently break game syntax if a change goes wrong.

- `npm test` — runs the test suite
- `npx tsc --noEmit` — type-checks the whole project without building it (catches a wide class of mistakes before you even run the app)

Run both after any change that touches tested code. When you add a new game, provider, or nontrivial feature, add tests where it's genuinely high-value — the existing tests in `src/parser.test.ts` follow a "test real current behavior against real example strings, don't invent speculative coverage" approach; new tests should follow the same spirit rather than testing implementation details that don't matter.

## Tech stack

- **Tauri v2** (Rust backend + native webview) — not Electron, so the binary is small and doesn't bundle a whole browser
- **React + TypeScript** for the UI
- **SQLite** via `tauri-plugin-sql`, for all app data (projects, strings, translations, glossary, history)
- **Vitest** for automated tests
- No backend server, no cloud dependency for the app itself — it's a fully local desktop tool (individual translation providers you choose to use may call out to the internet; see `docs/PROVIDERS.md`)

## Project layout

```
src/
  App.tsx            — main editor UI and most application logic
  db.ts               — SQLite connection
  types.ts            — shared TypeScript types
  parser.ts           — loc file parsing + token protection (see below)
  parser.test.ts       — automated tests for parser.ts
  glossary.ts          — glossary matching/injection logic
  import.ts            — recursive localization file scanner (game-agnostic)
  translate.ts          — orchestrates calling a provider + protect/restore/validate
  games/               — one file per supported game (see "Adding a new game")
  providers/            — one file per AI/translation provider (see "Adding a new translation provider")
  hooks/               — React hooks factoring logic out of App.tsx (batch translation, editor rows, panel state, project stats)
  backup.ts, portableExport.ts, mergeImport.ts, git.ts — backup/sync features
  modDescriptor.ts, modExport.ts, steamDetect.ts        — mod-translation support
src-tauri/
  src/lib.rs           — Tauri entry point, migration registration
  migrations/          — SQL migrations, numbered sequentially
  tauri.conf.json       — app config (name, window, permissions)
  capabilities/         — Tauri v2's permission system
```

## Where contributions help most

A few areas that are especially valuable and don't require deep familiarity with the whole codebase:

- **Adding a new game** — Vertaal supports six games today; more are welcome, and each one is a fairly self-contained adapter file (see below).
- **Improving an existing game adapter** — fixing an incorrect path convention, a missing native language, or a forbidden-character edge case for a game Vertaal already supports.
- **Adding a new translation provider** — hooking up another AI/translation API.
- **Improving the token protection system** (`src/parser.ts`) — the single most sensitive piece of the codebase, since a subtle regression there can silently corrupt game syntax in a way that's easy to miss. See below for how to report or fix a specific case.
- **Testing coverage** — the test suite currently only covers `parser.ts`; extending it (carefully, against real behavior — see above) to other modules is valuable.

## Adding a new game

Every game is a `GameAdapter` (see `src/games/types.ts` for the full interface) — a small object of pure functions describing that game's file-layout conventions. Look at `src/games/imperator.ts` for the simplest existing example to copy from.

You'll need to work out, and ideally verify against the game's own wiki rather than guess:
- Does the install path have a `\game\` wrapper folder, or do loc files sit directly under the install root? (Compare `eu5.ts` vs `stellaris.ts`.)
- US spelling `localization` or UK spelling `localisation`?
- Does overriding text use a flat `replace/` folder, or one nested inside the language folder? (Compare the different adapters — they're not all the same.)
- Does the game need the two-file outer/inner `.mod` pointer system, or is a single descriptor enough? (`buildOuterModPointer`, optional.)
- What languages does the game natively support in its own language dropdown? (`nativeLanguages` — matters for export: if your target language happens to be one of these, Vertaal writes a proper native-language file instead of overwriting English.)

Register the new adapter in `src/games/index.ts`.

## Adding a new translation provider

Every provider implements the `TranslationProvider` interface (`src/providers/types.ts`). Look at `src/providers/libretranslate.ts` for the simplest existing example.

Key fields to get right:
- `isLocal` — is this a local/offline service (like Ollama), or does it call out to the internet?
- `requiresModel` — does this provider need a specific model name (Ollama, OpenAI-compatible), or is it a fixed-engine service that doesn't take one (DeepL, Google Translate, LibreTranslate)? Getting this wrong blocks translation entirely for that provider — this exact bug happened once already, worth double-checking.
- `supportsGlossary` — can glossary instructions actually be injected into the request for this provider?
- A `translate()` function that protects/restores tokens correctly (this part is handled centrally in `parser.ts`, not per-provider — providers just need to send/receive plain text).

Register the new provider in `src/providers/index.ts`.

## The token protection system

`src/parser.ts` is shared across every game and provider. Before any text goes to a translator, `protectTokens()` replaces game syntax — `$VARIABLES$`, `[functions]`, `#formatting#!` codes, `§color§` codes, icon references, etc. — with placeholder tokens, so the AI can't corrupt them. `restoreTokens()` puts them back afterward, and `validateTokensPreserved()` checks nothing was lost or duplicated before a translation is accepted.

If you find a real-world string where this is protecting too much (swallowing real translatable text) or too little (letting game syntax get translated), please open an issue with the **exact string** — regex fixes in this area are easy to get subtly wrong without a concrete real example to test against, and a "sounds like it might happen" report can't be reliably fixed. `src/parser.test.ts` has real examples of what's already handled — a new failing case is a good candidate for a new test alongside the fix.

## Database migrations

New schema changes go in `src-tauri/migrations/` as a new numbered file (`00XX_description.sql`, following on from the highest existing number), and must be registered in `src-tauri/src/lib.rs`'s migration list with a matching version number. Existing installs upgrade automatically — never edit an already-shipped migration file, only add new ones.

## Conventions

- Small, focused, testable changes over large ones — easier to review, easier to bisect if something breaks later
- No new dependencies without a good reason — the stack is intentionally lean
- If you're touching a regex, test it against a few concrete example strings before submitting, not just the one case that prompted the change
- TypeScript strictness as already configured — don't relax it to make something compile
- Run `npm test` and `npx tsc --noEmit` before submitting a change that touches tested code

## Do you need permission to contribute?

**No — anyone can propose a change, with no advance approval needed.** Vertaal uses GitHub's standard open-source workflow: you **fork** the repo (make your own personal copy of it under your GitHub account), make your change there, and open a **pull request (PR)** asking for it to be pulled into the real project. You don't need to be specially added to the project to do any of this — forking and opening a PR is open to anyone with a free GitHub account.

What *does* require the maintainer's decision is whether a given PR actually gets **merged** (accepted into the real codebase) — that's a normal review step, not a permissions barrier, and it's why the "Submitting changes" section below asks you to explain what changed and why, so the review goes smoothly.

If you expect to be contributing regularly and would find it easier to work directly in the main repo rather than a fork (this is a convenience, not a requirement), you can ask the maintainer about being added as a collaborator — open a [GitHub Issue](https://github.com/bakgat-beep/vertaal/issues) or a Discussion saying so, with a bit of context on what you'd like to work on. Whether to grant that is entirely at the maintainer's discretion, and plenty of solid contributions happen from a fork with no collaborator status at all.

## Submitting changes

1. Fork the repo, branch off `main`
2. Make your change
3. Open a PR describing what changed and why — for a new game or provider, mention what you verified the file-layout/API details against (a wiki, a real download, official docs), since guessed details are a common source of subtle bugs here
4. For bug reports or feature requests without a PR, please use [GitHub Issues](https://github.com/bakgat-beep/vertaal/issues) — see the README's [Reporting bugs, requesting features, or reporting a security issue](README.md#reporting-bugs-requesting-features-or-reporting-a-security-issue) section for a no-experience-needed walkthrough of how
5. For a security-relevant issue specifically, see [SECURITY.md](SECURITY.md) instead of a public issue or PR description