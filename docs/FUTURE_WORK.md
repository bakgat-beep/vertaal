# Future work and known limits

A plain list of things that were deliberately left for later, so they are not forgotten and can be picked up by future sessions and code reviews. Nothing here is a secret bug: each item says what the limit is and why it was deferred. Move an item to "Done" (or delete it) when it is finished.

## Security

- **Windows credential vault for saved keys.** `src/crypto.ts` locks API keys and the GitHub token with a passphrase that is built into the app. The proper fix is to keep the key in the Windows Credential Manager, which needs a small Rust-side change that must be tested on Windows.
- **Narrower app permissions** (`src-tauri/capabilities/default.json`). File access and web access are broad on purpose (game folders can be on any drive; users may point at their own servers). Candidate: limit which `git` commands the app may run. Needs testing on Windows so sync does not break.

## Translation providers

- **Google Translate sends the text in the web address.** Long strings are therefore limited, and the text appears in the address of the request. A POST-based approach would remove the limit, but this is an unofficial endpoint, so the change needs care.
- **DeepL glossary and batching.** DeepL has its own glossary system, which Vertaal does not use, and strings are sent one at a time.

## Data

- **Merge is not all-or-nothing.** Merging collaborators' files checks every record first, but then writes row by row, because the database connection pool does not allow a safe multi-step transaction. Re-running the merge is always safe.
- **Projects made before per-project source language** may mix strings from different source languages in one pool; they are not split automatically.
- **Native-language lists** for Crusader Kings III, Stellaris, Victoria 3 and Hearts of Iron IV should be re-checked against each game's wiki.

## Interface

- **Remaining small UI items.** The ProjectSettings and wizard text-only status messages (e.g. "Saved", "Token saved") still use plain check characters; the Details-panel arrows and the ← → arrows in buttons are still text.
- **Screen tests.** The wizard, settings and batch-translation screens have tests for their helper functions but not for the screens themselves.