import { useState, useEffect } from "react";
import { TRANSLATION_PROVIDERS } from "./providers";
import { testProviderConnection, makeProviderTestRunner, type ProviderTestResult } from "./providerTest";
import type { ProviderConfig } from "./providers/types";
import { Icon } from "./Icon";

interface Props {
  providerId: string;
  // Called when the button is clicked, so it always tests what is on screen
  // right now (including a key or address that hasn't been saved yet).
  getConfig: () => Promise<ProviderConfig>;
  sourceLanguage: string;
  targetLanguage: string;
  // Changes whenever any setting the test depends on changes; a result shown
  // for older settings is cleared so a stale ✓ can't mislead.
  settingsFingerprint: string;
  // When set, the button is disabled and this explains why.
  disabledReason?: string;
}

export default function ProviderTestButton({
  providerId,
  getConfig,
  sourceLanguage,
  targetLanguage,
  settingsFingerprint,
  disabledReason,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const [runner] = useState(makeProviderTestRunner);

  useEffect(() => {
    runner.cancel(); // an in-flight test is now out of date: stop its request, not just its answer
    setResult(null);
    setTesting(false);
  }, [settingsFingerprint, providerId, runner]);

  // Leaving the screen stops a test that is still running.
  useEffect(() => () => runner.cancel(), [runner]);

  const provider = TRANSLATION_PROVIDERS[providerId];
  if (!provider) return null;

  async function runTest() {
    setTesting(true);
    setResult(null);
    const outcome = await runner.run(async (signal) => {
      try {
        const config = await getConfig();
        return await testProviderConnection(provider, config, sourceLanguage, targetLanguage, { signal });
      } catch (err) {
        return { ok: false, message: "The test couldn't be run.", detail: String(err) };
      }
    });
    if (outcome === null) return; // settings changed (or the screen closed) while testing: that test was stopped
    setResult(outcome);
    setTesting(false);
  }

  return (
    <div style={{ margin: "0.5rem 0" }}>
      <button
        onClick={runTest}
        disabled={testing || !!disabledReason}
        title={
          disabledReason ??
          "Sends one tiny test translation (the word “Hello”) using the settings above. Nothing is saved or changed."
        }
      >
        {testing ? "Testing…" : "Test connection"}
      </button>
      {disabledReason && (
        <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--text-dim)" }}>{disabledReason}</span>
      )}
      {result && (
        <p
          style={{
            fontSize: "0.85rem",
            marginTop: "0.4rem",
            color: result.ok ? "var(--status-confirmed)" : "#e05a5a",
          }}
        >
          <Icon name={result.ok ? "check" : "cross"} className="icon-before" />
          {result.message}
          {result.detail && (
            <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-dim)" }}>
              Details: {result.detail}
            </span>
          )}
        </p>
      )}
    </div>
  );
}