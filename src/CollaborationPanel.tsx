import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import type { Project } from "./types";
import { checkGitAvailable, initRepo, cloneRepo, setRemote, commitAll, push, pull } from "./git";
import { getContributorName, getGithubToken, setGithubToken } from "./settings";
import { exportPortableProjectData } from "./portableExport";
import { importAllContributorFiles, type CombinedMergeSummary } from "./mergeImport";
import { getDb } from "./db";
import { portableExportFileName } from "./fileNames";
import { useEscapeKey } from "./hooks/useEscapeKey";

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
  const [gitAvailable, setGitAvailable] = useState<string | null | "checking">("checking");
  const [contributorName, setContributorNameState] = useState<string | null>(null);

  // Not while a sync/pull is actually running — closing partway through a
  // Git operation would leave you unsure whether it finished.
  useEscapeKey(onClose, !busy);

  useEffect(() => {
    getGithubToken().then((t) => setHasToken(!!t));
    checkGitAvailable().then(setGitAvailable);
    getContributorName().then(setContributorNameState);
  }, []);

  // Each contributor's file is named after them, so two people syncing to the
  // same folder never write the same file — that's what lets Git merge their
  // changes automatically instead of conflicting. See fileNames.ts.
  function exportFileName() {
    return portableExportFileName(project, contributorName);
  }

  function summaryLine(summary: CombinedMergeSummary): string {
    if (summary.filesProcessed.length === 0) return "No collaborator files found to merge yet.";
    return (
      `Merged ${summary.filesProcessed.length} file(s) (${summary.filesProcessed.join(", ")}): ` +
      `${summary.applied} translation(s) applied, ${summary.skippedLocalNewer} skipped (your local version was newer), ` +
      `${summary.skippedNoLocalString} skipped (string not found locally), ` +
      `${summary.glossaryAdded} glossary term(s) added, ${summary.glossaryUpdated} updated.`
    );
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
      setOutput(
        "✓ Token saved. It's obscured in the local database, not strongly secured — " +
          "anyone with access to this computer and Vertaal's own source code could still recover it."
      );
    } catch (err) {
      setOutput(`Token save failed: ${err}`);
    }
  }

  // Uploads your work AND brings in your collaborators' — in that order:
  // export your own file, commit it, pull (merging in anyone else's file —
  // see git.ts for why this almost never conflicts), THEN push. Pulling
  // before pushing means a push that would otherwise be rejected because
  // someone else pushed first now succeeds automatically, instead of you
  // having to notice the failure and separately run Pull yourself.
  async function handleSync() {
    if (!repoPath) return;
    setBusy(true);
    setOutput("Exporting your translations...");
    try {
      const filePath = await join(repoPath, exportFileName());
      await exportPortableProjectData(project, filePath);

      setOutput("Committing your changes...");
      const commitResult = await commitAll(repoPath, `Update ${project.target_language} translations`, contributorName);

      setOutput("Checking for collaborators' changes first...");
      const token = await getGithubToken();
      const pullResult = await pull(repoPath, token, remoteUrl, contributorName);
      if (!pullResult.ok) {
        setOutput(`Sync stopped before pushing — could not merge in collaborators' changes:\n\n${pullResult.output}`);
        setBusy(false);
        return;
      }

      setOutput("Pushing to the shared repository...");
      const pushResult = await push(repoPath, token, remoteUrl);
      if (!pushResult.ok) {
        setOutput(`Commit: ${commitResult.output}\n\nPull: ${pullResult.output}\n\nPush failed: ${pushResult.output}`);
        setBusy(false);
        return;
      }

      setOutput("Merging in any collaborators' changes...");
      const mergeSummary = await importAllContributorFiles(project, repoPath);
      setOutput(`Push: ${pushResult.output}\n\n${summaryLine(mergeSummary)}`);
      if (mergeSummary.applied > 0 || mergeSummary.glossaryAdded > 0 || mergeSummary.glossaryUpdated > 0) {
        onDataChanged();
      }
    } catch (err) {
      setOutput(`Sync failed: ${err}`);
    }
    setBusy(false);
  }

  // A lighter one-way check: brings in collaborators' work without pushing
  // your own — for when you just want to see what's new.
  async function handlePull() {
    if (!repoPath) return;
    setBusy(true);
    setOutput("Pulling latest changes...");
    try {
      const token = await getGithubToken();
      const pullResult = await pull(repoPath, token, remoteUrl, contributorName);
      if (!pullResult.ok) {
        setOutput(`Pull: ${pullResult.output}`);
        setBusy(false);
        return;
      }

      const mergeSummary = await importAllContributorFiles(project, repoPath);
      setOutput(`Pull: ${pullResult.output}\n\n${summaryLine(mergeSummary)}`);
      if (mergeSummary.applied > 0 || mergeSummary.glossaryAdded > 0 || mergeSummary.glossaryUpdated > 0) {
        onDataChanged();
      }
    } catch (err) {
      setOutput(`Pull failed: ${err}`);
    }
    setBusy(false);
  }

  return (
    <div className="welcome-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="welcome-window" style={{ width: "700px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Collaboration</h1>
          <p style={{ color: "var(--text-dim)" }}>
            Sync this project's translations with a Git repository so others can contribute.
          </p>
          <p style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            Each collaborator has their own file in the shared folder, so nobody's work overwrites anyone else's.
            <strong> Sync</strong> saves your translations to your own file, uploads it, and brings in everyone
            else's too. <strong>Pull + Merge</strong> only brings in everyone else's, without uploading yours yet.
            Anything you edited more recently is always kept over an older incoming version. Set the folder and
            repository up once, then just use those two buttons.
          </p>
        </div>

        {gitAvailable === null && (
          <p style={{ color: "#e05a5a" }}>
            ⚠ Git wasn't found on this computer. Install it from{" "}
            <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">
              git-scm.com
            </a>{" "}
            before using any of the options below — they all require it.
          </p>
        )}

        <div className="form-row">
          <div className="form-label">Local folder</div>
          <div style={{ flexGrow: 1, display: "flex", gap: "0.5rem" }}>
            <input value={repoPath} readOnly style={{ flexGrow: 1 }} />
            <button
              onClick={handleChooseFolder}
              title="Choose the folder on your computer that holds (or will hold) the shared repository's files"
            >
              Browse…
            </button>
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
                <button
                  onClick={handleClone}
                  disabled={busy}
                  title="Download an existing shared repository (one a collaborator or you already set up on GitHub) into the folder above"
                >
                  Clone
                </button>
              </div>
            </div>

            <div className="form-row">
              <div className="form-label">Or start fresh</div>
              <button
                onClick={handleInit}
                disabled={busy}
                title="Turn the folder above into a brand-new repository. Use this only if nobody has created one for this project yet."
              >
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
                <button
                  onClick={handleSetRemote}
                  disabled={busy}
                  title="Tell this repository which GitHub address to upload to and download from (the 'remote')"
                >
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
                <button
                  onClick={handleSaveToken}
                  title="Saves your GitHub access token (a password-like key that lets Vertaal upload for you). It's shared by all your projects."
                >
                  Save
                </button>
              </div>
            </div>

            <div className="welcome-footer" style={{ justifyContent: "flex-start", gap: "0.5rem" }}>
              <button
                className="build-mod-button"
                onClick={handleSync}
                disabled={busy}
                title="Uploads your translations (to your own file, so it never collides with a collaborator's) and brings in everyone else's latest work too"
              >
                Sync (Export + Commit + Pull + Push)
              </button>
              <button
                className="build-mod-button"
                onClick={handlePull}
                disabled={busy}
                title="Downloads every collaborator's work from GitHub and merges it into this project, without uploading anything of yours yet. Strings you edited more recently are kept as they are."
              >
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