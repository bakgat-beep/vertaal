import { useState, useEffect } from "react";
import {
  listSourceFileOptions,
  splitKeyPatterns,
  countNameConfirmMatches,
  countAiDraftMatches,
  confirmNameMatches,
  type SourceFileOption,
} from "./nameConfirm";
import { confirm } from "./confirm";
import { useEscapeKey } from "./hooks/useEscapeKey";

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
  useEscapeKey(onClose);
  const [fileOptions, setFileOptions] = useState<SourceFileOption[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const [keyPatternInput, setKeyPatternInput] = useState("");
  const [keyPatterns, setKeyPatterns] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Off by default: strings that already hold an AI suggestion are left alone
  // unless the person ticks this (see nameConfirm.ts).
  const [includeAiDrafts, setIncludeAiDrafts] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  // Of the strings matching the current selection, how many hold an AI draft.
  const [aiDraftMatchCount, setAiDraftMatchCount] = useState(0);
  const [counting, setCounting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    listSourceFileOptions(gameId, targetLanguage, includeAiDrafts).then((rows) => {
      if (cancelled) return;
      setFileOptions(rows);
      setFilesLoaded(true);
      // A ticked file that no longer has anything eligible has left the list.
      setSelectedFiles((prev) => new Set(Array.from(prev).filter((p) => rows.some((r) => r.file_path === p))));
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, targetLanguage, includeAiDrafts]);

  // Debounce the key-pattern text box so every keystroke doesn't trigger a
  // count query — same 300ms approach the Glossary search box uses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyPatterns(splitKeyPatterns(keyPatternInput));
    }, 300);
    return () => clearTimeout(timer);
  }, [keyPatternInput]);

  useEffect(() => {
    // `cancelled` stops a slow, out-of-date count from overwriting a newer one
    // when the selection changes quickly.
    let cancelled = false;
    setCounting(true);
    setResultMessage("");
    Promise.all([
      countNameConfirmMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles), includeAiDrafts),
      countAiDraftMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles)),
    ]).then(([count, aiCount]) => {
      if (cancelled) return;
      setMatchCount(count);
      setAiDraftMatchCount(aiCount);
      setCounting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, targetLanguage, keyPatterns, selectedFiles, includeAiDrafts]);

  function toggleFile(filePath: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  async function handleConfirm() {
    const aiNote =
      includeAiDrafts && aiDraftMatchCount > 0
        ? ` ${aiDraftMatchCount.toLocaleString()} of them currently hold an AI draft, which will be replaced (the old AI text is kept in History).`
        : "";
    const proceed = await confirm(
      `Confirm ${matchCount.toLocaleString()} string(s) matching this selection, using their source text exactly as-is?${aiNote} This cannot be bulk-undone.`
    );
    if (!proceed) return;

    setConfirming(true);
    const { confirmed: confirmedCount, aiDraftsReplaced } = await confirmNameMatches(
      gameId,
      targetLanguage,
      keyPatterns,
      Array.from(selectedFiles),
      translatedBy,
      includeAiDrafts
    );

    // These rows are no longer "untouched," so refresh the file checklist
    // (counts drop, files that hit zero disappear) and re-run the preview
    // count for the current selection.
    const [freshFileOptions, freshCount, freshAiCount] = await Promise.all([
      listSourceFileOptions(gameId, targetLanguage, includeAiDrafts),
      countNameConfirmMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles), includeAiDrafts),
      countAiDraftMatches(gameId, targetLanguage, keyPatterns, Array.from(selectedFiles)),
    ]);
    setFileOptions(freshFileOptions);
    setMatchCount(freshCount);
    setAiDraftMatchCount(freshAiCount);
    setConfirming(false);
    setResultMessage(
      `Confirmed ${confirmedCount.toLocaleString()} string(s)` +
        (aiDraftsReplaced > 0 ? `, replacing ${aiDraftsReplaced.toLocaleString()} AI draft(s) (see History for the old text).` : ".")
    );
    onConfirmed();
  }

  const hasSelection = keyPatterns.length > 0 || selectedFiles.size > 0;

  return (
    <div className="welcome-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="welcome-window" style={{ width: "760px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Confirm Names/Locations As-Is</h1>
          <p style={{ color: "var(--text-dim)" }}>
            For strings the game re-localizes dynamically by language/culture — names of people, countries,
            locations — where the source text should be kept exactly as-is rather than translated. Select by
            key/name pattern, by source file, or both. Only unflagged strings with no translation yet are affected
            (plus strings holding an AI draft, if you tick the box below). Your own drafts, confirmed strings and
            flagged strings are always skipped.
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
          <label style={{ fontWeight: "normal", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={includeAiDrafts}
              onChange={(e) => setIncludeAiDrafts(e.target.checked)}
            />{" "}
            Also include strings the AI has already drafted
          </label>
          <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", margin: "0.25rem 0 0" }}>
            An AI suggestion nobody has confirmed is replaced by the original text; the old suggestion stays in
            History. Text you typed yourself is never replaced.
          </p>
        </div>

        <div className="form-row" style={{ marginTop: "0.75rem" }}>
          <div className="form-label">Source file(s)</div>
          {!filesLoaded ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>Loading files...</p>
          ) : fileOptions.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
              {includeAiDrafts
                ? "No untouched or AI-drafted strings remain in this project — nothing to select."
                : "No untouched strings remain in this project — nothing to select."}
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
                  <span style={{ color: "var(--text-dim)" }}>
                    {f.count.toLocaleString()} {includeAiDrafts ? "untouched or AI-drafted" : "untouched"}
                  </span>
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
              : `${matchCount.toLocaleString()} unflagged string(s) currently match${
                  includeAiDrafts
                    ? ` (including ${aiDraftMatchCount.toLocaleString()} with an AI draft).`
                    : aiDraftMatchCount > 0
                    ? `. ${aiDraftMatchCount.toLocaleString()} more match but hold an AI draft — tick the box above to include them.`
                    : "."
                }`}
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