<p align="center">
  <img src="docs/logo.png" alt="Vertaal logo" width="220">
</p>

<h1 align="center">Vertaal</h1>

<p align="center">
  A Windows desktop tool for building fan-translation mods for Paradox grand strategy games.
</p>

<p align="center">
<a href="LICENSE"><img alt="License: GPL v2" src="https://img.shields.io/badge/license-GPLv2-blue.svg"></a>
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

## Setting up translation providers

Vertaal works fully offline with a free local AI model, or with several cloud translation services. See [docs/PROVIDERS.md](docs/PROVIDERS.md) for setup instructions and honest notes on each option's limitations.

## Screenshots

*(Coming soon.)*

## Installing (for translators / beta testers)

Download the latest installer from the [Releases page](https://github.com/bakgat-beep/vertaal/releases) — no coding knowledge or setup required, just run it like any other Windows installer.

> **Note:** the installer isn't code-signed (that requires a paid certificate), so Windows SmartScreen will likely show an "Unknown publisher" warning the first time you run it. Click "More info" → "Run anyway." This is normal for small independent tools and not a sign of a problem.

Setting up your first translation provider (AI assist) is covered in [docs/PROVIDERS.md](docs/PROVIDERS.md).

### Building from source instead

If you'd rather build it yourself, or want to help develop it:

1. Install [Node.js](https://nodejs.org/) (LTS) and the [Rust toolchain](https://www.rust-lang.org/tools/install)
2. Install the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (mainly the WebView2 runtime and the Visual Studio C++ Build Tools — most Windows 10/11 machines already have WebView2)
3. Clone the repo:
  -   git clone https://github.com/bakgat-beep/vertaal.git
  -   cd vertaal
4. Install dependencies and run it:
  -   npm install
  -   npm run tauri dev
See [CONTRIBUTING.md](CONTRIBUTING.md) for more on the codebase itself.

## Building a distributable app

npm run tauri build

The installer will be in `src-tauri/target/release/bundle/`.

## Using Vertaal

1. **Create a project** — pick a game, choose "Vanilla" (translate the base game) or "Mod" (translate a specific mod), set your source and target languages, and point it at the game's install folder (or the mod's own folder).
2. **Import** — Vertaal scans for localization files and pulls in every string.
3. **Translate** — work through strings by category, use AI-assist per string or in batches, or type translations manually. A glossary keeps terminology consistent.
4. **Confirm** — AI and manual drafts stay unconfirmed until a human reviews and confirms them.
5. **Export** — "Build Mod" packages everything into a proper Paradox mod folder, ready to enable in the launcher. For mod translations, this is a separate companion mod — enable both the original mod and the translation together.

## Reporting bugs, requesting features, or reporting a security issue

Vertaal tracks all of this through **GitHub Issues** — a free, built-in bug/request tracker on the project's GitHub page. You don't need any coding knowledge to use it, just a (free) GitHub account.

**To report a bug or request a feature:**

1. If you don't already have one, create a free account at [github.com/signup](https://github.com/signup).
2. Go to the [Issues page](https://github.com/bakgat-beep/vertaal/issues) for this project.
3. Click the green **"New issue"** button.
4. Give it a short, clear title (e.g. "Export fails when target language is Polish") and describe:
   - What you did
   - What you expected to happen
   - What actually happened instead — the exact error message if there was one, or a screenshot
5. Click **"Submit new issue"**. That's it — the maintainer (and anyone else watching the project) will see it.

You can also browse [existing issues](https://github.com/bakgat-beep/vertaal/issues) first, in case someone's already reported the same thing — if so, adding a "+1" comment or a 👍 reaction there is more useful than opening a duplicate.

**To report a security issue** (e.g. you've found a way Vertaal could be tricked into reading/writing files it shouldn't, or a credential-handling problem): please **don't** use a public issue for this one. See [SECURITY.md](SECURITY.md) for how to report it privately instead.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, the project's architecture (the `GameAdapter` pattern for adding new games, the `TranslationProvider` pattern for adding new AI services), and how to submit changes. Vertaal has been built entirely through AI-assisted "vibecoding" by someone with no prior coding background — if that's you too, CONTRIBUTING.md explains how to keep working this way.

## License

[GNU GPL v2](LICENSE). Contributions are welcome under the same license.