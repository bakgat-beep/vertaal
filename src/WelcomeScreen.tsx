import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { documentDir, join } from "@tauri-apps/api/path";
import { getDb } from "./db";
import type { Project } from "./types";
import { GAME_ADAPTERS } from "./games";
import { validateInstallPath } from "./import";
import { detectInstalledModels, type OllamaModel } from "./ollama";
import { TRANSLATION_PROVIDERS } from "./providers";
import { getProviderCredentials, setProviderCredentials } from "./providers/credentials";
import { backupDatabase, restoreDatabase } from "./backup";
import { readModDescriptor, slugifyModName } from "./modDescriptor";
import { detectSteamGameFolder } from "./steamDetect";

const STEAM_FOLDER_NAMES: Record<string, string> = {
  eu5: "Europa Universalis V",
  ck3: "Crusader Kings III",
  victoria3: "Victoria 3",
  stellaris: "Stellaris",
  imperator: "Imperator Rome",
  hoi4: "Hearts of Iron IV",
};

interface Props {
  onProjectSelected: (project: Project) => void;
}

interface RecentProject extends Project {
  confirmed: number;
  total: number;
}

// Turns "brazilian portuguese" into "Brazilian Portuguese" for display.
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// A broad, commonly-useful set of target languages — covers most of what
// the AI providers support plus the world's most-spoken languages. Anything
// not listed here is still reachable via "Custom…".
const TARGET_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "afrikaans", label: "Afrikaans" },
  { value: "dutch", label: "Dutch" },
  { value: "german", label: "German" },
  { value: "french", label: "French" },
  { value: "spanish", label: "Spanish" },
  { value: "portuguese", label: "Portuguese" },
  { value: "italian", label: "Italian" },
  { value: "polish", label: "Polish" },
  { value: "russian", label: "Russian" },
  { value: "turkish", label: "Turkish" },
  { value: "arabic", label: "Arabic" },
  { value: "hindi", label: "Hindi" },
  { value: "chinese", label: "Chinese" },
  { value: "japanese", label: "Japanese" },
  { value: "korean", label: "Korean" },
  { value: "swahili", label: "Swahili" },
  { value: "zulu", label: "Zulu" },
  { value: "xhosa", label: "Xhosa" },
];

export default function WelcomeScreen({ onProjectSelected }: Props) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [maintenanceStatus, setMaintenanceStatus] = useState("");

  const [projectType, setProjectType] = useState<"vanilla" | "mod">("vanilla");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("english");
  const [targetLanguage, setTargetLanguage] = useState("afrikaans");
  const [customTargetLanguage, setCustomTargetLanguage] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [installPathValid, setInstallPathValid] = useState<boolean | null>(null);
  const [checkingPath, setCheckingPath] = useState(false);
  const [autoDetectNote, setAutoDetectNote] = useState("");
  const [modName, setModName] = useState("");

  // Mod-specific: the mod being translated (not to be confused with modName
  // above, which is the name of the *output* translation mod we're building).
  const [sourceModName, setSourceModName] = useState("");
  const [sourceModIdentifier, setSourceModIdentifier] = useState<string | null>(null);
  const [modDescriptorFormat, setModDescriptorFormat] = useState<"metadata-json" | "descriptor-mod" | "none" | null>(
    null
  );

  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [checkingModels, setCheckingModels] = useState(true);

  const [providerId, setProviderId] = useState("ollama");
  const [providerModel, setProviderModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  const [duplicateProjectNotice, setDuplicateProjectNotice] = useState("");
  
  useEffect(() => {
    loadRecentProjects();
  }, []);

  useEffect(() => {
    detectInstalledModels().then((models) => {
      setAvailableModels(models);
      if (models.length > 0) setSelectedModel(models[0].name);
      setCheckingModels(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedGameId) return;
    const newGm = GAME_ADAPTERS[selectedGameId];
    setSourceLanguage(newGm.sourceLanguage);
    setInstallPath("");
    setInstallPathValid(null);
    setSourceModName("");
    setSourceModIdentifier(null);
    setModDescriptorFormat(null);
    setAutoDetectNote("");
    setDuplicateProjectNotice("");
    if (projectType === "vanilla") {
      tryAutoDetectInstallPath(selectedGameId, newGm.sourceLanguage);
    }
  }, [selectedGameId]);

  useEffect(() => {
    setInstallPath("");
    setInstallPathValid(null);
    setSourceModName("");
    setSourceModIdentifier(null);
    setModDescriptorFormat(null);
    setAutoDetectNote("");
    setDuplicateProjectNotice("");
    if (projectType === "vanilla" && selectedGameId) {
      tryAutoDetectInstallPath(selectedGameId, GAME_ADAPTERS[selectedGameId].sourceLanguage);
    }
  }, [projectType]);

  async function tryAutoDetectInstallPath(gameId: string, sourceLang: string) {
    const folderName = STEAM_FOLDER_NAMES[gameId];
    if (!folderName) return;
    setAutoDetectNote("Checking your Steam library...");
    const found = await detectSteamGameFolder(folderName);
    if (!found) {
      setAutoDetectNote("");
      return;
    }
    setCheckingPath(true);
    const valid = await validateInstallPath(found, sourceLang);
    setInstallPath(found);
    setInstallPathValid(valid);
    setCheckingPath(false);
    setAutoDetectNote(valid ? "Auto-detected from your Steam library — Browse to change it." : "");
  }

  // Load any previously-saved credentials whenever a non-local provider is picked.
  useEffect(() => {
    if (!providerId || providerId === "ollama") return;
    getProviderCredentials(providerId).then((creds) => {
      setHasApiKey(!!creds.apiKey);
      setBaseUrl(creds.baseUrl ?? "");
      setApiKeyInput("");
    });
  }, [providerId]);

  async function loadRecentProjects() {
    const db = await getDb();
    const projects = (await db.select("SELECT * FROM projects ORDER BY id DESC")) as Project[];

    const withCounts: RecentProject[] = [];
    for (const p of projects) {
      const result = (await db.select(
        `SELECT
           (SELECT COUNT(*) FROM strings WHERE game_id = $1) as total,
           (SELECT COUNT(*) FROM translations WHERE status = 'human-confirmed' AND game_id = $1 AND target_language = $2) as confirmed`,
        [p.game_id, p.target_language]
      )) as { total: number; confirmed: number }[];
      withCounts.push({ ...p, total: result[0].total, confirmed: result[0].confirmed });
    }
    setRecentProjects(withCounts);
  }

  async function handleBackupNow() {
    const docs = await documentDir();
    const defaultPath = await join(docs, `vertaal-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const chosenPath = await save({ defaultPath });
    if (!chosenPath) return;
    setMaintenanceStatus("Backing up...");
    try {
      await backupDatabase(chosenPath);
      setMaintenanceStatus(`Backup saved: ${chosenPath}`);
    } catch (err) {
      setMaintenanceStatus(`Backup failed: ${err}`);
    }
  }

  async function handleRestoreNow() {
    const filePath = await open({ multiple: false, filters: [{ name: "Vertaal backup", extensions: ["db"] }] });
    if (!filePath) return;
    const proceed = window.confirm(
      "This will REPLACE your entire Vertaal database (every project, every game) with the selected backup file. " +
        "Your current database will automatically be saved first in case you need to undo this, but this action " +
        "should not be taken lightly. Continue?"
    );
    if (!proceed) return;
    setMaintenanceStatus("Restoring...");
    try {
      const safetyBackupPath = await restoreDatabase(filePath as string);
      setMaintenanceStatus(
        `Restore complete. Your previous database was saved to: ${safetyBackupPath}. Please close and reopen Vertaal for the change to take effect.`
      );
    } catch (err) {
      setMaintenanceStatus(`Restore failed: ${err}`);
    }
  }

  async function browseInstallPath() {
    const picked = await open({ directory: true, multiple: false });
    if (!picked) return;
    setInstallPath(picked as string);
    setAutoDetectNote("");
    setCheckingPath(true);
    const valid = await validateInstallPath(picked as string, sourceLanguage);
    setInstallPathValid(valid);

    if (projectType === "mod") {
      const info = await readModDescriptor(picked as string);
      setModDescriptorFormat(info.format);
      setSourceModIdentifier(info.identifier);
      if (info.name) setSourceModName(info.name);
    }

    setCheckingPath(false);
  }

  const gm = selectedGameId ? GAME_ADAPTERS[selectedGameId] : null;
  const sourceLanguageOptions: { code: string; label: string }[] = gm
    ? [
        { code: gm.sourceLanguage, label: "English" },
        ...Object.entries(gm.nativeLanguages).map(([label, code]) => ({ code, label: titleCase(label) })),
      ]
    : [{ code: "english", label: "English" }];

  const effectiveTargetLanguage = targetLanguage === "custom" ? customTargetLanguage.trim() : targetLanguage;
  const canCreate =
    selectedGameId !== null &&
    effectiveTargetLanguage.length > 0 &&
    installPathValid === true &&
    (projectType === "vanilla" || sourceModName.trim().length > 0);

  const provider = providerId ? TRANSLATION_PROVIDERS[providerId] : null;

async function handleCreateProject() {
    if (!canCreate || !selectedGameId) return;

    if (projectType === "vanilla") {
      const existing = recentProjects.find(
        (p) =>
          p.project_type === "vanilla" &&
          p.game_id === selectedGameId &&
          p.target_language === effectiveTargetLanguage
      );
      if (existing) {
        setDuplicateProjectNotice(
          `A ${titleCase(effectiveTargetLanguage)} project for ${GAME_ADAPTERS[selectedGameId].displayName} ` +
            `already exists. Opening it instead of creating a duplicate, since a second one would share the ` +
            `same translation data behind the scenes.`
        );
        onProjectSelected(existing);
        return;
      }
    }
    setDuplicateProjectNotice("");

    const db = await getDb();

    const isMod = projectType === "mod";
    const finalGameId = isMod ? `${selectedGameId}:mod:${slugifyModName(sourceModName)}` : selectedGameId;
    const finalModName =
      modName.trim() ||
      (isMod ? `${sourceModName} — ${effectiveTargetLanguage} Translation` : `${effectiveTargetLanguage} Translation`);
    const finalModel = providerId === "ollama" ? selectedModel || null : providerModel.trim() || null;

    await db.execute(
      `INSERT INTO projects
         (game_id, source_language, target_language, mod_name, install_path, ai_model, translation_provider_id,
          project_type, parent_game_id, source_mod_name, source_mod_identifier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        finalGameId,
        sourceLanguage,
        effectiveTargetLanguage,
        finalModName,
        installPath,
        finalModel,
        providerId || null,
        projectType,
        selectedGameId,
        isMod ? sourceModName.trim() : null,
        isMod ? sourceModIdentifier : null,
      ]
    );

    if (providerId && providerId !== "ollama" && (apiKeyInput.trim() || baseUrl.trim())) {
      await setProviderCredentials(providerId, apiKeyInput.trim() || null, baseUrl.trim() || null);
    }

    const inserted = (await db.select(
      "SELECT * FROM projects WHERE game_id = $1 AND target_language = $2 ORDER BY id DESC LIMIT 1",
      [finalGameId, effectiveTargetLanguage]
    )) as Project[];

    if (inserted.length > 0) onProjectSelected(inserted[0]);
  }

  const availableGames = Object.values(GAME_ADAPTERS);

  return (
    <div className="welcome-overlay">
      <div className="welcome-window">
        <div className="welcome-title">
          <h1 style={{ marginBottom: "0.2rem" }}>Vertaal</h1>
          <p style={{ color: "var(--text-dim)", margin: 0 }}>Translate Paradox grand strategy games</p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", margin: "0.75rem 0" }}>
          <button onClick={handleBackupNow} title="Save a full backup copy of the entire app database (every project, every game)">
            Backup App
          </button>
          <button onClick={handleRestoreNow} title="Replace the entire app database with a previously-saved backup file">
            Restore App
          </button>
        </div>
        {maintenanceStatus && (
          <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--text-dim)" }}>{maintenanceStatus}</p>
        )}

        {recentProjects.length > 0 && (
          <>
            <h3>Recent projects</h3>
            {recentProjects.map((p) => (
              <div key={p.id} className="recent-project-card" onClick={() => onProjectSelected(p)}>
                <div>
                  <div>
                    {GAME_ADAPTERS[p.parent_game_id]?.displayName ?? p.parent_game_id}
                    {p.project_type === "mod" ? ` — Mod: ${p.source_mod_name ?? "?"}` : ""} → {p.target_language}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>{p.mod_name}</div>
                </div>
                <span className="progress-pill">
                  {p.confirmed.toLocaleString()} / {p.total.toLocaleString()}
                </span>
              </div>
            ))}
            <div className="divider-text">or start a new project</div>
          </>
        )}

        <h3>Choose a game</h3>
        <div className="game-card-grid">
          {availableGames.map((game) => (
            <div
              key={game.id}
              className={`game-card ${selectedGameId === game.id ? "selected" : ""}`}
              onClick={() => setSelectedGameId(game.id)}
            >
              <div className="game-card-abbr">{game.id.toUpperCase()}</div>
              <div className="game-card-name">{game.displayName}</div>
            </div>
          ))}
          <div className="game-card disabled">
            <div className="game-card-abbr">?</div>
            <div className="game-card-name">More games coming soon</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-label">Translating</div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={{ opacity: projectType === "vanilla" ? 1 : 0.5 }} onClick={() => setProjectType("vanilla")}>
              {projectType === "vanilla" ? "✓ " : ""}Vanilla (Base Game)
            </button>
            <button style={{ opacity: projectType === "mod" ? 1 : 0.5 }} onClick={() => setProjectType("mod")}>
              {projectType === "mod" ? "✓ " : ""}Mod
            </button>
          </div>
        </div>

        <h3>Set up languages &amp; files</h3>

        <div className="form-row">
          <div className="form-label">Source language</div>
          <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
            {sourceLanguageOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {!gm && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
            Pick a game above to see which languages it ships with.
          </p>
        )}

        <div className="form-row">
          <div className="form-label">
            Target language <span className="required-asterisk">*</span>
          </div>
          <div>
            <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
              {TARGET_LANGUAGE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {targetLanguage === "custom" && (
              <input
                type="text"
                value={customTargetLanguage}
                onChange={(e) => setCustomTargetLanguage(e.target.value)}
                placeholder="Language name"
                style={{ marginLeft: "0.5rem", width: "150px" }}
              />
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-label">
            {projectType === "mod" ? "Mod folder" : "Game install path"} <span className="required-asterisk">*</span>
          </div>
          <div style={{ flexGrow: 1 }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="text" value={installPath} readOnly style={{ flexGrow: 1 }} />
              <button onClick={browseInstallPath}>Browse…</button>
            </div>
            {checkingPath && (
              <div className="validation-line" style={{ color: "var(--status-ai-draft)", fontWeight: 600 }}>
                Checking... Please wait.
              </div>
            )}
            {!checkingPath && installPathValid === true && (
              <div className="validation-line validation-ok">✓ Localisation files detected</div>
            )}
            {!checkingPath && installPathValid === false && (
              <div className="validation-line validation-bad">✕ No localisation files found in this folder</div>
            )}
            {!checkingPath && autoDetectNote && (
              <div className="validation-line" style={{ color: "var(--text-dim)" }}>{autoDetectNote}</div>
            )}
          </div>
        </div>

        {projectType === "mod" && installPathValid === true && (
          <>
            <div className="form-row">
              <div className="form-label">
                Mod being translated <span className="required-asterisk">*</span>
              </div>
              <input
                type="text"
                value={sourceModName}
                onChange={(e) => setSourceModName(e.target.value)}
                placeholder="Name of the mod you're translating"
                style={{ flexGrow: 1 }}
              />
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
              {modDescriptorFormat === "none" &&
                "Couldn't find a descriptor.mod or .metadata/metadata.json in that folder — enter the mod's name manually above."}
              {modDescriptorFormat === "metadata-json" && "Detected from this mod's metadata.json."}
              {modDescriptorFormat === "descriptor-mod" && "Detected from this mod's descriptor.mod."}
              {sourceModIdentifier && ` (Workshop/mod ID: ${sourceModIdentifier})`}
            </p>
          </>
        )}

        <div className="form-row">
          <div className="form-label">Output mod name</div>
          <input
            type="text"
            value={modName}
            onChange={(e) => setModName(e.target.value)}
            placeholder={
              projectType === "mod"
                ? `${sourceModName || "..."} — ${effectiveTargetLanguage || "..."} Translation`
                : `${effectiveTargetLanguage || "..."} Translation`
            }
            style={{ flexGrow: 1 }}
          />
        </div>

        <h3>AI assist</h3>

        <div className="form-row">
          <div className="form-label">Translation provider</div>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} style={{ flexGrow: 1 }}>
            {Object.values(TRANSLATION_PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} {p.isLocal ? "(local)" : "(cloud)"}
              </option>
            ))}
            <option value="">None — manual translation only</option>
          </select>
        </div>

        {providerId === "ollama" && (
          <div className="form-row">
            <div className="form-label">Model</div>
            <div style={{ flexGrow: 1 }}>
              {checkingModels ? (
                <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>Checking for local models...</span>
              ) : availableModels.length > 0 ? (
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                  {availableModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.sizeGb} GB)
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                  No TranslateGemma models detected. Pick a different provider above, or continue and add one later.
                </span>
              )}
            </div>
          </div>
        )}

        {providerId && providerId !== "ollama" && (
          <>
            <div className="form-row">
              <div className="form-label">Model</div>
              <input
                value={providerModel}
                onChange={(e) => setProviderModel(e.target.value)}
                placeholder={
                  providerId === "openai-compatible" ? "e.g. gpt-4o-mini (required)" : "leave blank if not applicable"
                }
                style={{ flexGrow: 1 }}
              />
            </div>
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
            {provider && !provider.supportsGlossary && (
              <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
                Note: {provider.displayName} does not apply your glossary rules automatically.
              </p>
            )}
          </>
        )}

        {!providerId && (
          <p style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            No AI provider selected — you can still translate manually, or set one up later in project settings.
          </p>
        )}

        <div className="welcome-footer">
          <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            You can change these later in project settings.
          </span>
          <button className="build-mod-button" onClick={handleCreateProject} disabled={!canCreate}>
            Create Project →
          </button>
        </div>
        {duplicateProjectNotice && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>{duplicateProjectNotice}</p>
        )}
      </div>
    </div>
  );
}