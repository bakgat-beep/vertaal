# Setting up translation providers

Vertaal can suggest AI translations for you to review and confirm — but it's entirely optional. Every string can be translated manually with no AI provider set up at all.

You choose a provider per-project, in Project Settings (or when creating a new project). Here's what's available and what to actually expect from each.

## TranslateGemma via Ollama (recommended default)

**What it is:** a translation-focused AI model, run entirely on your own computer via [Ollama](https://ollama.com), a free tool for running AI models locally.

**Why it's the recommended default:** it's free, works offline, sends nothing over the internet, and has no rate limits or usage costs. The trade-off is translation quality — a small local model won't match a large cloud service on nuance, but it's a solid starting point, and everything it produces still goes through human review before being confirmed.

**Setup:**
1. Install [Ollama](https://ollama.com/download) for Windows
2. Open a terminal and run:
  - ollama pull translategemma
   (or whichever TranslateGemma variant/size you prefer — check the [Ollama model library](https://ollama.com/library) for available sizes; larger models are slower but generally better quality)
3. Make sure Ollama is running (it usually starts automatically and sits in the system tray)
4. In Vertaal, create or open a project, set the provider to "TranslateGemma (local, via Ollama)" — Vertaal will detect any installed models automatically

No API key needed — this is the only provider with nothing to configure beyond having Ollama running.

## Cloud providers

These need an account/API key with the respective service, entered in Project Settings. None of them are required — pick whichever fits your budget, language pair, and quality needs.

- **DeepL** — generally excellent translation quality; requires a DeepL API key (they offer a free tier with a monthly character limit)
- **LibreTranslate** — open-source, self-hostable, or usable via a public instance
- **Any OpenAI-compatible endpoint** — for using GPT-family models, or any other service that speaks the same API shape (including some self-hosted options)

## Google Translate — implementation details and limitations

This one deserves its own explanation, since it works differently from the others.

**What it actually is:** Vertaal talks to Google Translate's free, *unofficial* public web endpoint — the same one the translate.google.com website itself uses — not Google's paid Cloud Translation API. That means:

- **No API key required**, and it's free to use
- **No official support, no SLA, no rate-limit guarantees.** This is not a documented, stable API — it's the endpoint the public website happens to use, which Google could change or restrict at any time without notice. If it stops working, that's an external change outside Vertaal's control, not a bug to report against Vertaal specifically (though do let us know — we may be able to adapt to a change on Google's side).
- **A configurable delay between requests** (in Project Settings) exists specifically to reduce the chance of Google's servers temporarily blocking rapid automated requests. If you're doing a large overnight batch, a slightly longer delay is safer.
- **Limited language coverage compared to DeepL.** Vertaal maps target language names to Google's language codes for a solid set of common languages; anything not in that list falls back to guessing a code from the language name, which may be wrong. If a language isn't translating correctly, check Project Settings for a manual "language code override" field — this exists specifically for this situation.
- **Using it for anything beyond light, personal use is a grey area relative to Google's own terms of service**, since it's not the API they intend for programmatic/automated use. For a hobby translation project this is generally how the whole modding-tool ecosystem already treats this endpoint, but it's worth knowing rather than assuming it's officially sanctioned.

If translation quality or reliability matters more to you than cost, DeepL (with its free tier) or TranslateGemma locally are the more "supported" choices — Google Translate here is best thought of as a convenient, zero-setup option for getting started or for lower-stakes text.
