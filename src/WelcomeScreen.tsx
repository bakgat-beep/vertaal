import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { documentDir, join } from "@tauri-apps/api/path";
import { getDb } from "./db";
import type { Project } from "./types";
import { GAME_ADAPTERS } from "./games";
import { backupDatabase, restoreDatabase } from "./backup";
import { importPortableProjectData } from "./mergeImport";
import NewProjectWizard from "./NewProjectWizard";
import logoFull from "./assets/logo-full-white.png";

interface Props {
  onProjectSelected: (project: Project) => void;
}

interface RecentProject extends Project {
  confirmed: number;
  total: number;
}

// The bit of text shown on every project card/row — game, mod (if any),
// target language, and the output mod name underneath. Shared between the
// Hub's recent-projects list and the Import Project picker so both stay
// in sync.
function ProjectSummary({ p }: { p: RecentProject | Project }) {
  return (
    <div>
      <div>
        {GAME_ADAPTERS[p.parent_game_id]?.displayName ?? p.parent_game_id}
        {p.project_type === "mod" ? ` — Mod: ${p.source_mod_name ?? "?"}` : ""} → {p.target_language}
      </div>
      <div className="project-card-meta">{p.mod_name}</div>
    </div>
  );
}

export default function WelcomeScreen({ onProjectSelected }: Props) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [hiddenProjects, setHiddenProjects] = useState<Project[]>([]);
  const [showHiddenList, setShowHiddenList] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"hub" | "new-project" | "import-project">("hub");
  const [maintenanceStatus, setMaintenanceStatus] = useState("");
  const [importStatus, setImportStatus] = useState("");

  useEffect(() => {
    loadRecentProjects();
  }, []);

  async function loadRecentProjects() {
    const db = await getDb();
    // Ordered by actual last activity (the most recent translation touched
    // in that project), not creation order — a project you translated an
    // hour ago should outrank one you merely created earlier. A project
    // with no translations yet (brand new) falls back to created_at so it
    // doesn't drop to the bottom before you've had a chance to touch it.
    // Fetched together (not filtered in SQL) so a hidden project can still be
    // found and un-hidden here — otherwise, once hidden, there'd be no way
    // back to it through any of the Hub's other flows.
    const allProjects = (await db.select(
      `SELECT p.*,
              COALESCE(
                (SELECT MAX(t.updated_at) FROM translations t
                  WHERE t.game_id = p.game_id AND t.target_language = p.target_language),
                p.created_at
              ) as last_activity
       FROM projects p
       ORDER BY last_activity DESC`
    )) as Project[];

    const visible = allProjects.filter((p) => p.hidden_from_recent === 0);
    setHiddenProjects(allProjects.filter((p) => p.hidden_from_recent === 1));

    const withCounts: RecentProject[] = [];
    for (const p of visible) {
      const result = (await db.select(
        `SELECT
           (SELECT COUNT(*) FROM strings WHERE game_id = $1) as total,
           (SELECT COUNT(*) FROM translations WHERE status = 'human-confirmed' AND game_id = $1 AND target_language = $2) as confirmed`,
        [p.game_id, p.target_language]
      )) as { total: number; confirmed: number }[];
      withCounts.push({ ...p, total: result[0].total, confirmed: result[0].confirmed });
    }
    setRecentProjects(withCounts);
    setLoaded(true);
  }

  // Hides a project from this list without deleting it — its settings and
  // translated strings stay intact, and it can be un-hidden later either
  // from Project Settings or from the "hidden projects" list below.
  async function handleRemoveFromRecent(e: React.MouseEvent, projectId: number) {
    e.stopPropagation();
    const db = await getDb();
    await db.execute("UPDATE projects SET hidden_from_recent = 1 WHERE id = $1", [projectId]);
    await loadRecentProjects();
  }

  async function handleUnhide(e: React.MouseEvent, projectId: number) {
    e.stopPropagation();
    const db = await getDb();
    await db.execute("UPDATE projects SET hidden_from_recent = 0 WHERE id = $1", [projectId]);
    await loadRecentProjects();
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

  // Imports a portable export file (produced by "Export Project Data" inside
  // an existing project) by merging it into the chosen project. This can't
  // create a brand-new project on its own — the target project has to
  // already exist locally, with its game files already imported, since the
  // merge only fills in translations for strings it can already find.
  async function handleImportInto(project: RecentProject) {
    const filePath = await open({ multiple: false, filters: [{ name: "Vertaal export", extensions: ["json"] }] });
    if (!filePath) return;
    setImportStatus(
      `Importing into ${GAME_ADAPTERS[project.parent_game_id]?.displayName ?? project.parent_game_id} → ${project.target_language}...`
    );
    try {
      const summary = await importPortableProjectData(project, filePath as string);
      setImportStatus(
        `Import complete: ${summary.applied} applied, ${summary.skippedLocalNewer} skipped (local was newer), ` +
          `${summary.skippedNoLocalString} skipped (string not found locally), ${summary.glossaryAdded} glossary term(s) added, ${summary.glossaryUpdated} updated.`
      );
      await loadRecentProjects();
    } catch (err) {
      setImportStatus(`Import failed: ${err}`);
    }
  }

  const hasProjects = recentProjects.length > 0;

  return (
    <div className="welcome-overlay">
      <div className="welcome-window">
        <div className="welcome-title">
          <img src={logoFull} alt="Vertaal" className="welcome-logo" />
        </div>

        {loaded && view === "hub" && (
          <>
            <h2 className={`welcome-heading ${hasProjects ? "" : "compact"}`}>
              {hasProjects ? "What are you working on?" : "Welcome to Vertaal"}
            </h2>

            {hasProjects ? (
              <>
                {recentProjects.map((p) => (
                  <div key={p.id} className="recent-project-card" onClick={() => onProjectSelected(p)}>
                    <ProjectSummary p={p} />
                    <div className="project-card-actions">
                      <span className="progress-pill">
                        {p.confirmed.toLocaleString()} / {p.total.toLocaleString()}
                      </span>
                      <button
                        className="text-link-button"
                        onClick={(e) => handleRemoveFromRecent(e, p.id)}
                        title="Remove from Recent Projects (keeps the project and its data — can be undone in Project Settings)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}

                <div className="welcome-actions">
                  <button className="build-mod-button" onClick={() => setView("new-project")}>
                    + New Project
                  </button>
                  <button
                    onClick={() => {
                      setImportStatus("");
                      setView("import-project");
                    }}
                  >
                    Import Project
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="welcome-intro-text">
                  Vertaal helps you translate Paradox grand strategy games and mods — it finds the game's
                  localisation files for you, keeps protected tokens intact, and tracks your progress as you go.
                  Create your first project below to get started.
                </p>
                <NewProjectWizard recentProjects={recentProjects} onProjectSelected={onProjectSelected} />
              </>
            )}

            {hiddenProjects.length > 0 && (
              <div className="hidden-projects-toggle">
                <button className="text-link-button" onClick={() => setShowHiddenList(!showHiddenList)}>
                  {showHiddenList ? "Hide" : `Show ${hiddenProjects.length} hidden project${hiddenProjects.length === 1 ? "" : "s"}`}
                </button>
                {showHiddenList &&
                  hiddenProjects.map((p) => (
                    <div
                      key={p.id}
                      className="recent-project-card hidden-project"
                      onClick={(e) => handleUnhide(e, p.id)}
                    >
                      <ProjectSummary p={p} />
                      <span className="project-card-meta">Click to unhide</span>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}

        {loaded && view === "new-project" && (
          <>
            <button className="text-link-button welcome-back-link" onClick={() => setView("hub")}>
              ← Back to Projects
            </button>
            <h2 className="welcome-heading">Create a project</h2>
            <NewProjectWizard recentProjects={recentProjects} onProjectSelected={onProjectSelected} />
          </>
        )}

        {loaded && view === "import-project" && (
          <>
            <button className="text-link-button welcome-back-link" onClick={() => setView("hub")}>
              ← Back to Projects
            </button>
            <h2 className="welcome-heading compact">Import into which project?</h2>
            <p className="import-hint">
              Pick the project to merge translations into, then choose the exported file. Only strings that
              already exist in that project are affected — nothing is overwritten unless the imported version
              is newer.
            </p>
            {importStatus && <p className="import-status">{importStatus}</p>}
            {recentProjects.map((p) => (
              <div key={p.id} className="recent-project-card" onClick={() => handleImportInto(p)}>
                <ProjectSummary p={p} />
                <span className="progress-pill">
                  {p.confirmed.toLocaleString()} / {p.total.toLocaleString()}
                </span>
              </div>
            ))}
          </>
        )}

        <div className="app-footer-menu">
          <button
            className="text-link-button"
            onClick={handleBackupNow}
            title="Save a full backup copy of the entire app database (every project, every game)"
          >
            Backup App
          </button>
          <button
            className="text-link-button"
            onClick={handleRestoreNow}
            title="Replace the entire app database with a previously-saved backup file"
          >
            Restore App
          </button>
        </div>
        {maintenanceStatus && <p className="maintenance-status">{maintenanceStatus}</p>}
      </div>
    </div>
  );
}