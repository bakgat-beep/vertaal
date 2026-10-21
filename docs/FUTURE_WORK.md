# Future work and known limits

A plain list of things that were deliberately left for later, so they are not forgotten and can be picked up by future sessions and code reviews. Nothing here is a secret bug: each item says what the limit is and why it was deferred. Move an item to "Done" (or delete it) when it is finished.

## Security

- **Windows credential vault for saved keys.** `src/crypto.ts` locks API keys and the GitHub token with a passphrase that is built into the app. The proper fix is to keep the key in the Windows Credential Manager, which needs a small Rust-side change that must be tested on Windows.
- **Narrower app permissions** (`src-tauri/capabilities/default.json`). Done so far: web access (https to any host, plain http only to this computer) and git (one entry per command Vertaal runs; no "any git command"). Still broad on purpose: file access and opening paths (`**`; game folders can be on any drive), and the folder git runs in (the plugin does not check it). Candidate: limit file access to folders the user has picked in a dialog. Needs testing on Windows. Git no longer accepts local-path or `ssh://` remote addresses, only `https://`, `http://` and `git@host:path`.
- **Backup and restore hardening.** Restore checks the chosen file before anything is replaced (`src/backupValidation.ts`): it must be a genuine Vertaal database whose update history is an unbroken, unedited run of this app's own updates (older backups are fine, backups from a newer Vertaal are refused), it must have every table, column, index and trigger those updates create, and it must pass SQLite's integrity check. The same check runs again at launch on a restore that is waiting, and a safety backup is made before anything is replaced. Still missing: a check that there is enough free disk space (the app's permissions cannot read it).
- **Provider test has no Cancel button.** The test button gives up after 20 seconds (90 for a local model) and says so, and the request itself is aborted when it times out, when a setting on the screen changes, or when the screen is closed. There is still no button to cancel a test by hand.

## Translation providers

- **Google Translate sends the text in the web address.** Long strings are therefore limited, and the text appears in the address of the request. A POST-based approach would remove the limit, but this is an unofficial endpoint, so the change needs care.
- **DeepL glossary and batching.** DeepL has its own glossary system, which Vertaal does not use, and strings are sent one at a time.

## Data

- **Merge and import are not all-or-nothing.** Merging collaborators' files checks every record first, but then writes row by row, because the database connection pool does not allow a safe multi-step transaction. An import that fails halfway likewise leaves the rows written so far. Re-running either is always safe.
- **Projects made before per-project source language** may mix strings from different source languages in one pool; they are not split automatically.
- **Native-language lists need re-checking when a game adds a language.** All six lists were checked against each game's Steam page on 2026-10-16 and are pinned by `src/games/nativeLanguages.test.ts`, so the test must be updated together with a list. The Paradox wikis' language lists are marked "potentially outdated" and one (Crusader Kings III) lists none, so Steam's supported-language list is the source used. Whether Crusader Kings III really has no Italian or Brazilian Portuguese file slot was not confirmed from the game files themselves.
- **Folder scan builds paths by hand.** `findLocFiles` (src/import.ts) joins folder and file names itself. Changing it to use the path library could change the `file_path` values already stored, so it needs a migration plan and a Windows test first.
- **Speed indexes cost disk space.** Migration 22 (Stage 8) added two indexes: about 47 MB on a 137 MB database, and backups grow with it. A category index was measured and gave no gain, so it was not added.

## Interface

- **Screen interaction tests.** The wizard, settings and Previous/Next/Stop screens now have first-render tests (`src/screens.test.ts`), but nothing clicks or types in them. That needs a browser-like test library (e.g. jsdom with Testing Library), which is a new dependency and so your call.
- **Arrows in plain-text messages.** The only text arrow left is inside the "Importing into … → language" progress message (a string, not a button).