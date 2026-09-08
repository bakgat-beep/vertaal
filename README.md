<p align="center">
  <img src="docs/logo.png" alt="Vertaal logo" width="220">
</p>

<h1 align="center">Vertaal</h1>

<p align="center">
  A Windows desktop tool for building fan-translation mods for Paradox grand strategy games.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-blue.svg"></a>
</p>

> **Not affiliated with Paradox Interactive.** Vertaal is an independent, fan-made tool. All game names, trademarks, and localization data belong to their respective owners — Vertaal only reads and translates text you already own a legal copy of.

## What is this?

Vertaal helps you translate a Paradox grand strategy game — or a mod for one — into a language it doesn't officially support, and package the result as a shareable mod. It was built starting with an Afrikaans translation of **Europa Universalis V**, but is intended to work with any of the six supported games and any target language.

**Supported games:** Europa Universalis V, Victoria 3, Crusader Kings III, Imperator: Rome, Stellaris, Hearts of Iron IV.

## Features

- **Import** a game's (or a mod's) own localization files directly — no manual file editing
- **AI-assisted translation** with a pluggable provider system: local/offline via Ollama (e.g. TranslateGemma), or cloud options — DeepL, Google Translate, LibreTranslate, and any OpenAI-compatible endpoint
- **Token-safe parsing** — game syntax like `$VARIABLES$`, `[functions]`, `#formatting#!` codes, and icon references are protected from translation and restored automatically, so AI translation can't break your game scripts
- **Glossary support** — enforce consistent terminology across the whole project
- **Batch translation** — translate a page, translate overnight in bulk, or re-run AI translation on everything unconfirmed (handy after switching providers)
- **Human review workflow** — every AI suggestion is a draft until a person confirms it; nothing ships unreviewed
- **Change detection** — if the game patches and original text changes, previously-translated strings are automatically flagged for re-review
- **Mod translation, not just base-game translation** — translate a specific Steam Workshop mod and export a small, separate companion mod that layers your translation on top, without ever touching the original mod's own files (so Workshop updates never conflict with your work)
- **Git/GitHub collaboration**, or a lightweight JSON export/import for sharing progress without Git
- **Full backup/restore** for your whole project database

## Screenshots

*(Coming soon.)*

## Installing (for translators / beta testers)

There's no pre-built installer yet, so you'll need to build it yourself:

1. Install [Node.js](https://nodejs.org/) (LTS) and the [Rust toolchain](https://www.rust-lang.org/tools/install)
2. Install the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (mainly the WebView2 runtime and the Visual Studio C++ Build Tools — most Windows 10/11 machines already have WebView2)
3. Clone the repo:
