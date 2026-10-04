// "Test connection" for a translation provider.
//
// The test is a real, tiny translation ("Hello", in the project's own source
// and target languages) sent through exactly the same code a real translation
// uses. That checks everything at once — the key, the server address, the model
// name AND that the provider accepts this language — which a plain "is the
// server up?" ping can't. Nothing is saved or changed by running it.
//
// Failures are turned into plain-language reasons; the raw technical message is
// kept separately as `detail` for anyone who wants it.

import type { TranslationProvider, ProviderConfig } from "./providers/types";

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  detail?: string;
}

const TEST_TEXT = "Hello";

const TIMED_OUT = "__TEST_TIMED_OUT__";

export async function testProviderConnection(
  provider: TranslationProvider,
  config: ProviderConfig,
  sourceLanguage: string,
  targetLanguage: string,
  options: { timeoutMs?: number } = {}
): Promise<ProviderTestResult> {
  if (provider.requiresModel && !config.model?.trim()) {
    return { ok: false, message: `${provider.displayName} needs a model name — enter one first.` };
  }

  // A local model can take a while to load the first time it is used; online
  // services should answer quickly.
  const timeoutMs = options.timeoutMs ?? (provider.isLocal ? 90_000 : 20_000);
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      provider.translate({ text: TEST_TEXT, sourceLanguage, targetLanguage }, config),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMED_OUT)), timeoutMs);
      }),
    ]);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const shown = result.translatedText.trim().slice(0, 60);
    return { ok: true, message: `Connected. "${TEST_TEXT}" came back as "${shown}" (${seconds} s).` };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: explainProviderError(provider.id, raw, { timeoutSeconds: Math.round(timeoutMs / 1000) }),
      detail: raw === TIMED_OUT ? undefined : raw.slice(0, 300),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Turns what a provider threw into a sentence a non-programmer can act on.
export function explainProviderError(
  providerId: string,
  rawMessage: string,
  context: { timeoutSeconds?: number } = {}
): string {
  const name =
    {
      ollama: "Ollama",
      deepl: "DeepL",
      "google-translate": "Google Translate",
      "openai-compatible": "the OpenAI-compatible server",
      libretranslate: "the LibreTranslate server",
    }[providerId] ?? "the provider";

  if (rawMessage === TIMED_OUT) {
    return `No answer from ${name} after ${context.timeoutSeconds ?? "several"} seconds. ${
      providerId === "ollama"
        ? "If Ollama is running, the model may still be loading — try again in a minute."
        : "Check your internet connection and the server address, then try again."
    }`;
  }

  // Problems the provider itself spotted before sending anything (missing key,
  // model or server address) are already worded for people — pass them on.
  if (/^No .*(configured|API key)/i.test(rawMessage)) return rawMessage;

  const status = /request failed: (\d{3})/i.exec(rawMessage)?.[1];
  if (status) {
    const code = Number(status);
    if (code === 401) return `${name} rejected the API key (error 401). Check that the key is correct and still active.`;
    if (code === 403) {
      return providerId === "deepl"
        ? "DeepL rejected the API key (error 403). Check that it is copied in full — free keys end in :fx."
        : `${name} refused access (error 403). Check the API key and that it is allowed to do this.`;
    }
    if (code === 404) {
      if (providerId === "ollama") {
        return "Ollama answered but doesn't know that model (error 404). Check the model name matches one you have installed.";
      }
      if (providerId === "openai-compatible") {
        return "The server answered but couldn't find that (error 404). Check the Base URL, and that the model name exists on that server.";
      }
      return `${name} couldn't find that address (error 404). Check the server address (Base URL).`;
    }
    if (code === 400) {
      return `${name} didn't accept the request (error 400). This often means the model name is wrong or the language isn't supported — see the details below.`;
    }
    if (code === 429) {
      return providerId === "google-translate"
        ? "Google is limiting requests from this computer (error 429). Wait a few minutes, and raise the Google Translate delay in Project Settings."
        : `${name} says there have been too many requests, or the quota is used up (error 429). Wait a bit, or check your plan.`;
    }
    if (code === 456) return "DeepL says the character quota for this key is used up (error 456).";
    if (code >= 500) return `${name} had a problem on its side (error ${code}). Try again later.`;
    return `${name} returned error ${code} — see the details below.`;
  }

  if (/error sending request|failed to fetch|network|connection refused|econnrefused|dns|unreachable|load failed|refused/i.test(rawMessage)) {
    return providerId === "ollama"
      ? "Couldn't reach Ollama. Make sure the Ollama app is running on this computer."
      : `Couldn't reach ${name}. Check your internet connection and the server address (Base URL).`;
  }

  return `The test failed — see the details below.`;
}