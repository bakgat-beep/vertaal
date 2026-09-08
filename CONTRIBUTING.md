# Contributing to Vertaal

Thanks for taking an interest in Vertaal! This document covers how the codebase is put together, so you can add a game, a provider, or a fix without having to reverse-engineer the whole thing first.

## Development setup

1. Install [Node.js](https://nodejs.org/) (LTS) and the [Rust toolchain](https://www.rust-lang.org/tools/install)
2. Install the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/)
3. `npm install`
4. `npm run tauri dev` — runs the app with hot reload

Vertaal is Windows-only by design (it writes Paradox game/mod files using Windows-style paths throughout), so development is expected to happen on Windows.

## Tech stack

- **Tauri v2** (Rust backend + native webview) — not Electron, so the binary is small and doesn't bundle a whole browser
- **React + TypeScript** for the UI
- **SQLite** via `tauri-plugin-sql`, for all app data (projects, strings, translations, glossary, history)
- No backend server, no cloud dependency for the app itself — it's a fully local desktop tool (individual translation providers you choose to use may call out to the internet; see `docs/PROVIDERS.md`)

## Project layout

src/
App.tsx — main editor UI and most application logic
db.ts — SQLite connection
types.ts — shared TypeScript types
parser.ts — loc file parsing + token protection (see below)
glossary.ts — glossary matching/injection logic
import.ts — recursive localization file scanner (game-agnostic)
games/ — one file per supported game (see "Adding a game")
providers/ — one file per AI/translation provider (see "Adding a provider")
backup.ts, portableExport.ts, mergeImport.ts, git.ts — backup/sync features
modDescriptor.ts, modExport.ts, steamDetect.ts — mod-translation support
src-tauri/
src/lib.rs — Tauri entry point, migration registration
migrations/ — SQL migrations, numbered sequentially
tauri.conf.json — app config (name, window, permissions)
capabilities/ — Tauri v2's permission system


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

If you find a real-world string where this is protecting too much (swallowing real translatable text) or too little (letting game syntax get translated), please open an issue with the **exact string** — regex fixes in this area are easy to get subtly wrong without a concrete real example to test against, and a "sounds like it might happen" report can't be reliably fixed.

## Database migrations

New schema changes go in `src-tauri/migrations/` as a new numbered file (`00XX_description.sql`, following on from the highest existing number), and must be registered in `src-tauri/src/lib.rs`'s migration list with a matching version number. Existing installs upgrade automatically — never edit an already-shipped migration file, only add new ones.

## Conventions

- Small, focused, testable changes over large ones — easier to review, easier to bisect if something breaks later
- No new dependencies without a good reason — the stack is intentionally lean
- If you're touching a regex, test it against a few concrete example strings before submitting, not just the one case that prompted the change
- TypeScript strictness as already configured — don't relax it to make something compile

## Submitting changes

1. Fork the repo, branch off `main`
2. Make your change
3. Open a PR describing what changed and why — for a new game or provider, mention what you verified the file-layout/API details against (a wiki, a real download, official docs), since guessed details are a common source of subtle bugs here
4. For bug reports or feature requests without a PR, please use [GitHub Issues](https://github.com/bakgat-beep/vertaal/issues)
