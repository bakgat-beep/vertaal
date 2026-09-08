import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";

export interface ExportPreflight {
  total: number;
  confirmed: number;
  outdated: number;
  flagged: number;
}

export type ExportOutcome =
  | { status: "ok"; stringsWritten: number; filesWritten: number; destPath: string }
  | { status: "cancelled" }
  | { status: "error"; error: string };

interface Props {
  preflight: ExportPreflight;
  isMod: boolean;
  sourceModName: string | null;
  outputModName: string;
  liveStatus: string;
  onProceed: () => Promise<ExportOutcome>;
  onClose: () => void;
}

type Phase = "preflight" | "progress" | "success" | "failed";

export default function ExportSummary({
  preflight,
  isMod,
  sourceModName,
  outputModName,
  liveStatus,
  onProceed,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>("preflight");
  const [result, setResult] = useState<{ stringsWritten: number; filesWritten: number; destPath: string } | null>(
    null
  );
  const [error, setError] = useState("");

  async function handleProceed() {
    setPhase("progress");
    const outcome = await onProceed();
    if (outcome.status === "ok") {
      setResult({ stringsWritten: outcome.stringsWritten, filesWritten: outcome.filesWritten, destPath: outcome.destPath });
      setPhase("success");
    } else if (outcome.status === "cancelled") {
      onClose();
    } else {
      setError(outcome.error);
      setPhase("failed");
    }
  }

  async function handleOpenFolder(path: string) {
    try {
      await openPath(path);
    } catch {
      // Best-effort — nothing more useful to do if the OS can't open it.
    }
  }

  const coveragePct = preflight.total > 0 ? Math.round((preflight.confirmed / preflight.total) * 100) : 0;

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "520px" }}>
        {phase === "preflight" && (
          <>
            <h1 style={{ marginBottom: "0.2rem" }}>Ready to export?</h1>
            <p style={{ color: "var(--text-dim)" }}>
              {isMod ? `Companion mod for "${sourceModName}"` : "Base game translation mod"}
            </p>

            <div className="form-row">
              <div className="form-label">Confirmed strings</div>
              <div>
                {preflight.confirmed.toLocaleString()} of {preflight.total.toLocaleString()} ({coveragePct}%)
              </div>
            </div>

            {preflight.outdated > 0 && (
              <p style={{ color: "var(--status-ai-draft)" }}>
                ⚠ {preflight.outdated.toLocaleString()} of those are confirmed, but the source text has changed
                since (marked "Patch Changed") — they'll still be exported as-is unless you review them first.
              </p>
            )}

            {preflight.flagged > 0 && (
              <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                {preflight.flagged.toLocaleString()} flagged string(s) will be excluded.
              </p>
            )}

            {preflight.confirmed === 0 && (
              <p style={{ color: "#e05a5a" }}>No confirmed translations yet — there's nothing to export.</p>
            )}

            <div className="welcome-footer">
              <button onClick={onClose}>Cancel</button>
              <button className="build-mod-button" onClick={handleProceed} disabled={preflight.confirmed === 0}>
                Proceed →
              </button>
            </div>
          </>
        )}

        {phase === "progress" && (
          <>
            <h1 style={{ marginBottom: "0.2rem" }}>Exporting...</h1>
            <p style={{ color: "var(--text-dim)" }}>{liveStatus || "Working..."}</p>
          </>
        )}

        {phase === "success" && result && (
          <>
            <h1 style={{ marginBottom: "0.2rem", color: "var(--status-confirmed)" }}>✓ Export complete</h1>

            <div className="form-row">
              <div className="form-label">Strings written</div>
              <div>{result.stringsWritten.toLocaleString()}</div>
            </div>
            <div className="form-row">
              <div className="form-label">Files written</div>
              <div>{result.filesWritten.toLocaleString()}</div>
            </div>
            <div className="form-row">
              <div className="form-label">Location</div>
              <div style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{result.destPath}</div>
            </div>

            {preflight.outdated > 0 && (
              <p style={{ color: "var(--status-ai-draft)", fontSize: "0.85rem" }}>
                ⚠ {preflight.outdated.toLocaleString()} of the exported strings were confirmed before a source-text
                change — worth a review pass.
              </p>
            )}

            {isMod && (
              <p style={{ fontSize: "0.85rem" }}>
                Remember to enable both "{sourceModName}" and "{outputModName}" in your playset.
              </p>
            )}

            <div className="welcome-footer">
              <span />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => handleOpenFolder(result.destPath)}>Open Folder</button>
                <button className="build-mod-button" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          </>
        )}

        {phase === "failed" && (
          <>
            <h1 style={{ marginBottom: "0.2rem", color: "#e05a5a" }}>✕ Export failed</h1>
            <p>{error}</p>
            <div className="welcome-footer">
              <button onClick={onClose}>Close</button>
              <button className="build-mod-button" onClick={handleProceed}>
                Try Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}