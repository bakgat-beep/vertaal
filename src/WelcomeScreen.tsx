import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getDb } from "./db";
import type { Project } from "./types";
import { GAME_ADAPTERS } from "./games";
import { validateInstallPath } from "./import";
import { detectInstalledModels, type OllamaModel } from "./ollama";

interface Props {
  onProjectSelected: (project: Project) => void;
}

interface RecentProject extends Project {
  confirmed: number;
  total: number;
}

export default function WelcomeScreen({ onProjectSelected }: Props) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("english");
  const [targetLanguage, setTargetLanguage] = useState("afrikaans");
  const [customTargetLanguage, setCustomTargetLanguage] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [installPathValid, setInstallPathValid] = useState<boolean | null>(null);
  const [checkingPath, setCheckingPath] = useState(false);
  const [modName, setModName] = useState("");

  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [checkingModels, setCheckingModels] = useState(true);

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

  async function browseInstallPath() {
    const picked = await open({ directory: true, multiple: false });
    if (!picked) return;
    setInstallPath(picked as string);
    setCheckingPath(true);
    const valid = await validateInstallPath(picked as string, sourceLanguage);
    setInstallPathValid(valid);
    setCheckingPath(false);
  }

  const effectiveTargetLanguage = targetLanguage === "custom" ? customTargetLanguage.trim() : targetLanguage;
  const canCreate = selectedGameId !== null && effectiveTargetLanguage.length > 0 && installPathValid === true;

  async function handleCreateProject() {
    if (!canCreate || !selectedGameId) return;
    const db = await getDb();
    const finalModName = modName.trim() || `${effectiveTargetLanguage} Translation`;

    await db.execute(
      `INSERT INTO projects (game_id, source_language, target_language, mod_name, install_path, ai_model)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [selectedGameId, sourceLanguage, effectiveTargetLanguage, finalModName, installPath, selectedModel || null]
    );

    const inserted = (await db.select(
      "SELECT * FROM projects WHERE game_id = $1 AND target_language = $2 ORDER BY id DESC LIMIT 1",
      [selectedGameId, effectiveTargetLanguage]
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

        {recentProjects.length > 0 && (
          <>
            <h3>Recent projects</h3>
            {recentProjects.map((p) => (
              <div key={p.id} className="recent-project-card" onClick={() => onProjectSelected(p)}>
                <div>
                  <div>
                    {GAME_ADAPTERS[p.game_id]?.displayName ?? p.game_id} → {p.target_language}
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

        <h3>Set up languages &amp; files</h3>

        <div className="form-row">
          <div className="form-label">Source language</div>
          <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
            <option value="english">English</option>
          </select>
        </div>

        <div className="form-row">
          <div className="form-label">
            Target language <span className="required-asterisk">*</span>
          </div>
          <div>
            <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
              <option value="afrikaans">Afrikaans</option>
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
            Game install path <span className="required-asterisk">*</span>
          </div>
          <div style={{ flexGrow: 1 }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="text" value={installPath} readOnly style={{ flexGrow: 1 }} />
              <button onClick={browseInstallPath}>Browse…</button>
            </div>
            {checkingPath && <div className="validation-line" style={{ color: "var(--text-dim)" }}>Checking...</div>}
            {!checkingPath && installPathValid === true && (
              <div className="validation-line validation-ok">✓ Localisation files detected</div>
            )}
            {!checkingPath && installPathValid === false && (
              <div className="validation-line validation-bad">✕ No localisation files found in this folder</div>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-label">Mod name</div>
          <input
            type="text"
            value={modName}
            onChange={(e) => setModName(e.target.value)}
            placeholder={`${effectiveTargetLanguage || "..."} Translation`}
            style={{ flexGrow: 1 }}
          />
        </div>

        <div className="form-row">
          <div className="form-label">AI assist</div>
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
                <option value="">None — manual translation only</option>
              </select>
            ) : (
              <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                No TranslateGemma models detected. AI assist will be unavailable — you can still translate manually.
              </span>
            )}
          </div>
        </div>

        <div className="welcome-footer">
          <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            You can change these later in project settings.
          </span>
          <button className="build-mod-button" onClick={handleCreateProject} disabled={!canCreate}>
            Create Project →
          </button>
        </div>
      </div>
    </div>
  );
}