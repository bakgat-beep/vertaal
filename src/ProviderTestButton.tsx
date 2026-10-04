import { useState, useRef, useEffect } from "react";
import { TRANSLATION_PROVIDERS } from "./providers";
import { testProviderConnection, type ProviderTestResult } from "./providerTest";
import type { ProviderConfig } from "./providers/types";

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
  const runId = useRef(0);

  useEffect(() => {
    runId.current++; // an in-flight test is now out of date
    setResult(null);
    setTesting(false);
  }, [settingsFingerprint, providerId]);

  const provider = TRANSLATION_PROVIDERS[providerId];
  if (!provider) return null;

  async function runTest() {
    const thisRun = ++runId.current;
    setTesting(true);
    setResult(null);
    let outcome: ProviderTestResult;
    try {
      outcome = await testProviderConnection(provider, await getConfig(), sourceLanguage, targetLanguage);
    } catch (err) {
      outcome = { ok: false, message: "The test couldn't be run.", detail: String(err) };
    }
    if (runId.current !== thisRun) return; // settings changed while testing
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
          {result.ok ? "✓ " : "✗ "}
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