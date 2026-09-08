import { useState, useEffect } from "react";
import type { Project } from "./types";
import { TRANSLATION_PROVIDERS } from "./providers";
import { getProviderCredentials, setProviderCredentials } from "./providers/credentials";
import { getDb } from "./db";
import { GAME_ADAPTERS } from "./games";

interface Props {
  project: Project;
  onProjectUpdated: (project: Project) => void;
  onClose: () => void;
}

export default function ProjectSettings({ project, onProjectUpdated, onClose }: Props) {
  const [modName, setModName] = useState(project.mod_name);
  const [providerId, setProviderId] = useState(project.translation_provider_id ?? "ollama");
  const [model, setModel] = useState(project.ai_model ?? "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [retryDelayMs, setRetryDelayMs] = useState(String(project.retry_delay_ms ?? 2000));
  const [googleDelayMs, setGoogleDelayMs] = useState(String(project.google_translate_delay_ms ?? 500));
  const [sourceLangOverride, setSourceLangOverride] = useState(project.source_language_code_override ?? "");
  const [targetLangOverride, setTargetLangOverride] = useState(project.target_language_code_override ?? "");
  const [output, setOutput] = useState("");

  useEffect(() => {
    loadCredentials(providerId);
  }, [providerId]);

  async function loadCredentials(id: string) {
    const creds = await getProviderCredentials(id);
    setHasApiKey(!!creds.apiKey);
    setBaseUrl(creds.baseUrl ?? "");
    setApiKeyInput("");
  }

  const provider = TRANSLATION_PROVIDERS[providerId];

  async function handleSave() {
    const parsedRetryDelay = parseInt(retryDelayMs, 10);
    const parsedGoogleDelay = parseInt(googleDelayMs, 10);
    if (!Number.isFinite(parsedRetryDelay) || parsedRetryDelay < 0) {
      setOutput("Retry delay must be a number of milliseconds (0 or more).");
      return;
    }
    if (!Number.isFinite(parsedGoogleDelay) || parsedGoogleDelay < 0) {
      setOutput("Google Translate delay must be a number of milliseconds (0 or more).");
      return;
    }

    const trimmedSourceOverride = sourceLangOverride.trim() || null;
    const trimmedTargetOverride = targetLangOverride.trim() || null;

    try {
      const db = await getDb();
      await db.execute(
        `UPDATE projects
         SET mod_name = $1, translation_provider_id = $2, ai_model = $3, retry_delay_ms = $4,
             google_translate_delay_ms = $5, source_language_code_override = $6, target_language_code_override = $7
         WHERE id = $8`,
        [modName, providerId, model || null, parsedRetryDelay, parsedGoogleDelay, trimmedSourceOverride, trimmedTargetOverride, project.id]
      );

      if (apiKeyInput.trim() || baseUrl.trim()) {
        await setProviderCredentials(providerId, apiKeyInput.trim() || null, baseUrl.trim() || null);
        if (apiKeyInput.trim()) {
          setHasApiKey(true);
          setApiKeyInput("");
        }
      }

      onProjectUpdated({
        ...project,
        mod_name: modName,
        translation_provider_id: providerId,
        ai_model: model || null,
        retry_delay_ms: parsedRetryDelay,
        google_translate_delay_ms: parsedGoogleDelay,
        source_language_code_override: trimmedSourceOverride,
        target_language_code_override: trimmedTargetOverride,
      });
      setOutput("✓ Settings saved.");
    } catch (err) {
      setOutput(`Save failed: ${err}`);
    }
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "600px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Project Settings</h1>
          <p style={{ color: "var(--text-dim)" }}>
            {GAME_ADAPTERS[project.parent_game_id]?.displayName ?? project.parent_game_id}
            {project.project_type === "mod" ? ` — Mod: ${project.source_mod_name ?? "?"}` : ""} → {project.target_language}
          </p>
        </div>

        <div className="form-row">
          <div className="form-label">Mod name</div>
          <input value={modName} onChange={(e) => setModName(e.target.value)} style={{ flexGrow: 1 }} />
        </div>

        <div className="form-row">
          <div className="form-label">Translation provider</div>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} style={{ flexGrow: 1 }}>
            {Object.values(TRANSLATION_PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} {p.isLocal ? "(local)" : "(cloud)"}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-label">Model</div>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={
              provider?.isLocal
                ? "e.g. translategemma:4b"
                : providerId === "openai-compatible"
                ? "e.g. gpt-4o-mini (required)"
                : "leave blank if not applicable"
            }
            style={{ flexGrow: 1 }}
          />
        </div>

        {provider && !provider.isLocal && (
          <>
            <div className="form-row">
              <div className="form-label">API key</div>
              <div style={{ flexGrow: 1, display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={hasApiKey ? "Saved (enter a new one to replace)" : "API key"}
                  style={{ flexGrow: 1 }}
                />
                {hasApiKey && <span style={{ color: "var(--status-confirmed)", fontSize: "0.8rem" }}>✓ Saved</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-label">Base URL</div>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="Only needed for self-hosted/OpenAI-compatible endpoints"
                style={{ flexGrow: 1 }}
              />
            </div>
          </>
        )}

        {provider && !provider.supportsGlossary && (
          <p style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            Note: {provider.displayName} does not apply your glossary rules automatically.
          </p>
        )}

        <div className="form-row">
          <div className="form-label">Retry delay (ms)</div>
          <input
            value={retryDelayMs}
            onChange={(e) => setRetryDelayMs(e.target.value)}
            placeholder="2000"
            style={{ flexGrow: 1 }}
          />
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
          How long to wait between retry attempts on a string that failed to translate, during batch runs.
        </p>

        <div className="form-row">
          <div className="form-label">Google Translate delay (ms)</div>
          <input
            value={googleDelayMs}
            onChange={(e) => setGoogleDelayMs(e.target.value)}
            placeholder="500"
            style={{ flexGrow: 1 }}
          />
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
          Pause before every request sent to the Google Translate workaround. Only applies when Google Translate is the selected provider.
        </p>

        <h3 style={{ marginBottom: 0, marginTop: "1rem" }}>Advanced</h3>
        <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
          Only needed if your provider doesn't recognize "{project.target_language}" (or "{project.source_language}")
          by name — for example, if the provider adds support for a language after our built-in list was written.
          Enter the exact code the provider expects (e.g. "af" for Google Translate/LibreTranslate, "AF" for DeepL).
          Leave blank to use the automatic lookup.
        </p>

        <div className="form-row">
          <div className="form-label">Source language code override</div>
          <input
            value={sourceLangOverride}
            onChange={(e) => setSourceLangOverride(e.target.value)}
            placeholder="leave blank for automatic"
            style={{ flexGrow: 1 }}
          />
        </div>

        <div className="form-row">
          <div className="form-label">Target language code override</div>
          <input
            value={targetLangOverride}
            onChange={(e) => setTargetLangOverride(e.target.value)}
            placeholder="leave blank for automatic"
            style={{ flexGrow: 1 }}
          />
        </div>

        {output && <p style={{ fontSize: "0.85rem" }}>{output}</p>}

        <div className="welcome-footer">
          <button onClick={onClose}>Close</button>
          <button className="build-mod-button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}