import { useState, useEffect } from "react";
import {
  listSourceFileOptions,
  splitKeyPatterns,
  countNameConfirmMatches,
  confirmNameMatches,
  type SourceFileOption,
} from "./nameConfirm";

interface Props {
  gameId: string;
  targetLanguage: string;
  translatedBy: string | null;
  onConfirmed: () => void;
  onClose: () => void;
}

// Shortens a full Windows install path down to just the filename, so the
// checklist shows "character_names_l_english.yml" rather than the whole
// "C:\...\localization\english\character_names_l_english.yml" — the app's
// existing context_label (file_path with the language suffix and
// underscores stripped) is friendlier still, so that's used as the primary
// label when it's available, with the filename as a fallback.
function shortFileName(filePath: string): string {
  const parts = filePath.split("\\");
  return parts[parts.length - 1] ?? filePath;
}

export default function ConfirmNamesPanel({ gameId, targetLanguage, translatedBy, onConfirmed, onClose }: Props) {
  const [fileOptions, setFileOptions] = useState<SourceFileOption[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const [keyPatternInput, setKeyPatternInput] = useState("");
  const [keyPatterns, setKeyPatterns] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const [matchCount, setMatchCount] = useState(0);
  const [counting, setCounting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    listSourceFileOptions(gameId, targetLanguage).then((rows) => {
      setFileOptions(rows);
      setFilesLoaded(true);
    });
  }, [gameId, targetLanguage]);

  // Debounce the key-pattern text box so every keystroke doesn't trigger a
  // count query — same 300ms approach the Glossary search box uses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyPatterns(splitKeyPatterns(keyPatternInput));
    }, 300);
    return () => clearTimeout(timer);
  }, [keyPatternInput]);

  useEffect(() => {
    setCounting(true);
    setResultMessage("");
    countNameConfirmMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles)).then((count) => {
      setMatchCount(count);
      setCounting(false);
    });
  }, [gameId, targetLanguage, keyPatterns, selectedFiles]);

  function toggleFile(filePath: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  async function handleConfirm() {
    const proceed = window.confirm(
      `Confirm ${matchCount.toLocaleString()} string(s) matching this selection, using their source text exactly as-is? This cannot be bulk-undone.`
    );
    if (!proceed) return;

    setConfirming(true);
    const confirmedCount = await confirmNameMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles), translatedBy);

    // These rows are no longer "untouched," so refresh the file checklist
    // (counts drop, files that hit zero disappear) and re-run the preview
    // count for the current selection.
    const [freshFileOptions, freshCount] = await Promise.all([
      listSourceFileOptions(gameId, targetLanguage),
      countNameConfirmMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles)),
    ]);
    setFileOptions(freshFileOptions);
    setMatchCount(freshCount);
    setConfirming(false);
    setResultMessage(`Confirmed ${confirmedCount.toLocaleString()} string(s).`);
    onConfirmed();
  }

  const hasSelection = keyPatterns.length > 0 || selectedFiles.size > 0;

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "760px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Confirm Names/Locations As-Is</h1>
          <p style={{ color: "var(--text-dim)" }}>
            For strings the game re-localizes dynamically by language/culture — names of people, countries,
            locations — where the source text should be kept exactly as-is rather than translated. Select by
            key/name pattern, by source file, or both. Only untouched, unflagged strings are ever affected —
            anything already drafted or confirmed is skipped.
          </p>
        </div>

        <div className="form-row">
          <div className="form-label">Key/name contains</div>
          <input
            type="text"
            value={keyPatternInput}
            onChange={(e) => setKeyPatternInput(e.target.value)}
            placeholder="e.g. character_name_, location_name_"
            style={{ width: "100%" }}
          />
          <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", margin: "0.25rem 0 0" }}>
            Comma-separated — a string matches if its key contains any one of these. Leave blank to select by file
            only.
          </p>
        </div>

        <div className="form-row" style={{ marginTop: "0.75rem" }}>
          <div className="form-label">Source file(s)</div>
          {!filesLoaded ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>Loading files...</p>
          ) : fileOptions.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
              No untouched strings remain in this project — nothing to select.
            </p>
          ) : (
            <div
              style={{
                maxHeight: "260px",
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "0.4rem 0.6rem",
              }}
            >
              {fileOptions.map((f) => (
                <label
                  key={f.file_path}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.2rem 0", fontSize: "0.85rem" }}
                  title={f.file_path}
                >
                  <input type="checkbox" checked={selectedFiles.has(f.file_path)} onChange={() => toggleFile(f.file_path)} />
                  <span style={{ flexGrow: 1 }}>{f.context_label || shortFileName(f.file_path)}</span>
                  <span style={{ color: "var(--text-dim)" }}>{f.count.toLocaleString()} untouched</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: "1rem",
            padding: "0.6rem 0.8rem",
            borderRadius: "6px",
            background: "var(--bg-elevated, rgba(255,255,255,0.04))",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span style={{ flexGrow: 1 }}>
            {!hasSelection
              ? "Enter a key pattern or select at least one file to see how many strings would match."
              : counting
              ? "Counting..."
              : `${matchCount.toLocaleString()} untouched, unflagged string(s) currently match.`}
          </span>
          <button
            className="build-mod-button"
            onClick={handleConfirm}
            disabled={!hasSelection || counting || confirming || matchCount === 0}
          >
            {confirming ? "Confirming..." : `Confirm ${matchCount.toLocaleString()} As-Is`}
          </button>
        </div>
        {resultMessage && <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>{resultMessage}</p>}

        <div className="welcome-footer">
          <span></span>
          <button className="build-mod-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}