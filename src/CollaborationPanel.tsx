import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import type { Project } from "./types";
import { checkGitAvailable, initRepo, cloneRepo, setRemote, commitAll, push, pull } from "./git";
import { getGithubToken, setGithubToken } from "./settings";
import { exportPortableProjectData } from "./portableExport";
import { importPortableProjectData } from "./mergeImport";
import { getDb } from "./db";

interface Props {
  project: Project;
  onProjectUpdated: (project: Project) => void;
  onDataChanged: () => void;
  onClose: () => void;
}

export default function CollaborationPanel({ project, onProjectUpdated, onDataChanged, onClose }: Props) {
  const [repoPath, setRepoPath] = useState(project.git_repo_path ?? "");
  const [remoteUrl, setRemoteUrl] = useState(project.git_remote_url ?? "");
  const [cloneUrl, setCloneUrl] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGithubToken().then((t) => setHasToken(!!t));
  }, []);

  function exportFileName() {
    return `${project.game_id}-${project.target_language}-vertaal-export.json`;
  }

  async function saveProjectField(field: "git_repo_path" | "git_remote_url", value: string) {
    try {
      const db = await getDb();
      await db.execute(`UPDATE projects SET ${field} = $1 WHERE id = $2`, [value, project.id]);
      onProjectUpdated({ ...project, [field]: value });
    } catch (err) {
      setOutput(`Failed to save ${field}: ${err}`);
    }
  }

  async function handleChooseFolder() {
    const picked = await open({ directory: true, multiple: false });
    if (!picked) return;
    setRepoPath(picked as string);
    await saveProjectField("git_repo_path", picked as string);
  }

  async function handleInit() {
    if (!repoPath) return;
    setBusy(true);
    const result = await initRepo(repoPath);
    setOutput(result.output);
    setBusy(false);
  }

  async function handleClone() {
    if (!repoPath || !cloneUrl.trim()) return;
    setBusy(true);
    const result = await cloneRepo(cloneUrl.trim(), repoPath);
    setOutput(result.output);
    if (result.ok) {
      setRemoteUrl(cloneUrl.trim());
      await saveProjectField("git_remote_url", cloneUrl.trim());
    }
    setBusy(false);
  }

  async function handleSetRemote() {
    if (!repoPath || !remoteUrl.trim()) return;
    await saveProjectField("git_remote_url", remoteUrl.trim());
    setBusy(true);
    const result = await setRemote(repoPath, remoteUrl.trim());
    setOutput(result.ok ? `Remote set to ${remoteUrl.trim()}` : result.output);
    setBusy(false);
  }

  async function handleSaveToken() {
    if (!tokenInput.trim()) return;
    try {
      await setGithubToken(tokenInput.trim());
      setTokenInput("");
      setHasToken(true);
      setOutput("✓ Token saved (encrypted locally).");
    } catch (err) {
      setOutput(`Token save failed: ${err}`);
    }
  }

  async function handleSync() {
    if (!repoPath) return;
    setBusy(true);
    setOutput("Exporting current translations...");
    try {
      const filePath = await join(repoPath, exportFileName());
      await exportPortableProjectData(project, filePath);

      setOutput("Committing changes...");
      const commitResult = await commitAll(repoPath, `Update ${project.target_language} translations`);

      setOutput("Pushing to remote...");
      const token = await getGithubToken();
      const pushResult = await push(repoPath, token, remoteUrl);

      setOutput(`Commit: ${commitResult.output}\n\nPush: ${pushResult.output}`);
    } catch (err) {
      setOutput(`Sync failed: ${err}`);
    }
    setBusy(false);
  }

  async function handlePull() {
    if (!repoPath) return;
    setBusy(true);
    setOutput("Pulling latest changes...");
    try {
      const token = await getGithubToken();
      const pullResult = await pull(repoPath, token, remoteUrl);
      setOutput(`Pull: ${pullResult.output}`);

      if (pullResult.ok) {
        const filePath = await join(repoPath, exportFileName());
        const summary = await importPortableProjectData(project, filePath);
        setOutput(
          `Pull: ${pullResult.output}\n\nMerge complete: ${summary.applied} translation(s) applied, ` +
            `${summary.skippedLocalNewer} skipped (your local version was newer), ` +
            `${summary.skippedNoLocalString} skipped (string not found locally), ` +
            `${summary.glossaryAdded} glossary term(s) added, ${summary.glossaryUpdated} updated.`
        );
        onDataChanged();
      }
    } catch (err) {
      setOutput(`Pull failed: ${err}`);
    }
    setBusy(false);
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "700px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Collaboration</h1>
          <p style={{ color: "var(--text-dim)" }}>
            Sync this project's translations with a Git repository so others can contribute.
          </p>
        </div>

        <div className="form-row">
          <div className="form-label">Local folder</div>
          <div style={{ flexGrow: 1, display: "flex", gap: "0.5rem" }}>
            <input value={repoPath} readOnly style={{ flexGrow: 1 }} />
            <button onClick={handleChooseFolder}>Browse…</button>
          </div>
        </div>

        {repoPath && (
          <>
            <div className="form-row">
              <div className="form-label">Clone existing repo</div>
              <div style={{ flexGrow: 1, display: "flex", gap: "0.5rem" }}>
                <input
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/username/repo.git"
                  style={{ flexGrow: 1 }}
                />
                <button onClick={handleClone} disabled={busy}>
                  Clone
                </button>
              </div>
            </div>

            <div className="form-row">
              <div className="form-label">Or start fresh</div>
              <button onClick={handleInit} disabled={busy}>
                Initialize New Repo Here
              </button>
            </div>

            <div className="form-row">
              <div className="form-label">Remote URL</div>
              <div style={{ flexGrow: 1, display: "flex", gap: "0.5rem" }}>
                <input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://github.com/username/repo.git"
                  style={{ flexGrow: 1 }}
                />
                <button onClick={handleSetRemote} disabled={busy}>
                  Set Remote
                </button>
              </div>
            </div>

            <div className="form-row">
              <div className="form-label">GitHub token</div>
              <div style={{ flexGrow: 1, display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {hasToken && <span style={{ color: "var(--status-confirmed)", fontSize: "0.8rem" }}>✓ Saved</span>}
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={hasToken ? "Saved (enter a new one to replace)" : "Personal access token"}
                  style={{ flexGrow: 1 }}
                />
                <button onClick={handleSaveToken}>Save</button>
              </div>
            </div>

            <div className="welcome-footer" style={{ justifyContent: "flex-start", gap: "0.5rem" }}>
              <button className="build-mod-button" onClick={handleSync} disabled={busy}>
                Sync (Export + Commit + Push)
              </button>
              <button className="build-mod-button" onClick={handlePull} disabled={busy}>
                Pull + Merge
              </button>
            </div>

            {output && (
              <pre
                style={{
                  background: "var(--bg-row)",
                  padding: "0.6rem",
                  fontSize: "0.75rem",
                  whiteSpace: "pre-wrap",
                  marginTop: "1rem",
                  maxHeight: "150px",
                  overflowY: "auto",
                }}
              >
                {output}
              </pre>
            )}
          </>
        )}

        <div className="welcome-footer">
          <span></span>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}