import { useState, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import {
  listGlossaryTerms,
  countGlossaryTerms,
  countGlossaryTermUsage,
  updateGlossaryTerm,
  deleteGlossaryTerm,
  addGlossaryTerm,
  effectiveStatus,
  type GlossaryRow,
} from "./glossary";

interface Props {
  gameId: string;
  targetLanguage: string;
  onClose: () => void;
  // Jumps to the main editor, searching for the given term — used by the
  // "N strings" usage count both in the table and the details panel.
  onViewOccurrences: (term: string) => void;
  // True for a mod-translation project: the base game's glossary is applied
  // automatically as well (see loadGlossaryTerms), and "this game" really
  // means "this mod".
  isModProject?: boolean;
  // The project's translation provider, so the manager can warn when nothing
  // will actually apply the glossary. undefined = don't say anything; null =
  // the project is manual-only (no AI provider); a name = that provider.
  providerName?: string | null;
  providerSupportsGlossary?: boolean;
}

const PAGE_SIZE = 50;

export default function GlossaryManager({
  gameId,
  targetLanguage,
  onClose,
  onViewOccurrences,
  isModProject = false,
  providerName,
  providerSupportsGlossary = true,
}: Props) {
  const scopeWord = isModProject ? "mod" : "game";
  const [terms, setTerms] = useState<GlossaryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [listMessage, setListMessage] = useState("");

  // Usage counts are fetched separately from (and slightly after) the main
  // page load — one LIKE-count query per visible row, only for the ~50
  // terms on the current page, never the whole glossary — so the table
  // doesn't wait on them to appear. Cells show "…" until their count
  // resolves.
  const [usageCounts, setUsageCounts] = useState<Record<number, number>>({});

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Debounce the search box so every keystroke doesn't trigger a query —
  // and reset back to page 0 once the debounced search actually changes,
  // so you don't end up stranded on, say, page 3 of a search that only
  // has one page of results.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    load();
  }, [gameId, targetLanguage, search, page]);

  async function load() {
    const [rows, count] = await Promise.all([
      listGlossaryTerms(gameId, targetLanguage, { search, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      countGlossaryTerms(gameId, targetLanguage, search),
    ]);
    setTerms(rows);
    setTotalCount(count);
    setLoaded(true);
    setSelectedIds(new Set());
    loadUsageCounts(rows);
  }

  async function loadUsageCounts(rows: GlossaryRow[]) {
    setUsageCounts({});
    const entries = await Promise.all(
      rows.map(async (t) => [t.id, await countGlossaryTermUsage(gameId, t.english_term)] as const)
    );
    setUsageCounts(Object.fromEntries(entries));
  }

  // ---- Bulk selection ----

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const allOnPageSelected = terms.length > 0 && terms.every((t) => selectedIds.has(t.id));

  function toggleSelect(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedIds(allOnPageSelected ? new Set() : new Set(terms.map((t) => t.id)));
  }

  async function handleBulkStatus(status: "preferred" | "review") {
    for (const id of selectedIds) {
      const t = terms.find((x) => x.id === id);
      if (!t) continue;
      await updateGlossaryTerm(id, t.english_term, t.translated_term, t.game_id, { status });
    }
    setListMessage(`Marked ${selectedIds.size} term(s) as ${status === "preferred" ? "Preferred" : "Needs review"}.`);
    await load();
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.size} selected term(s)? This can't be undone.`)) return;
    for (const id of selectedIds) {
      await deleteGlossaryTerm(id);
    }
    setListMessage(`Deleted ${selectedIds.size} term(s).`);
    await load();
  }

  // ---- Details panel (selection + edit) ----

  const [selected, setSelected] = useState<GlossaryRow | "new" | null>(null);
  const [draftEnglish, setDraftEnglish] = useState("");
  const [draftTranslated, setDraftTranslated] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftStatus, setDraftStatus] = useState<"preferred" | "review">("preferred");
  const [draftShared, setDraftShared] = useState(false);
  const [panelMessage, setPanelMessage] = useState("");

  function selectRow(t: GlossaryRow) {
    setSelected(t);
    setDraftEnglish(t.english_term);
    setDraftTranslated(t.translated_term);
    setDraftNotes(t.notes ?? "");
    setDraftStatus(t.status);
    setDraftShared(t.game_id === null);
    setPanelMessage("");
  }

  function startNew() {
    setSelected("new");
    setDraftEnglish("");
    setDraftTranslated("");
    setDraftNotes("");
    setDraftStatus("preferred");
    setDraftShared(false);
    setPanelMessage("");
  }

  function closePanel() {
    setSelected(null);
    setPanelMessage("");
  }

  async function handleSave() {
    if (!draftEnglish.trim() || !draftTranslated.trim()) {
      setPanelMessage("Both English and Translated are required.");
      return;
    }
    const scopeGameId = draftShared ? null : gameId;
    const extra = { notes: draftNotes.trim() || null, status: draftStatus };

    if (selected === "new") {
      await addGlossaryTerm(draftEnglish, draftTranslated, scopeGameId, targetLanguage, extra);
    } else if (selected) {
      await updateGlossaryTerm(selected.id, draftEnglish, draftTranslated, scopeGameId, extra);
    }

    setListMessage(`✓ Saved "${draftEnglish.trim()}".`);
    closePanel();
    await load();
  }

  async function handleDelete() {
    if (selected === "new" || !selected) return;
    if (!window.confirm(`Delete "${selected.english_term}"? This can't be undone.`)) return;
    await deleteGlossaryTerm(selected.id);
    setListMessage(`Deleted "${selected.english_term}".`);
    closePanel();
    await load();
  }

  // ---- Bulk paste import (fallback for large-scale ingestion) ----

  const [bulkText, setBulkText] = useState("");
  const [bulkShared, setBulkShared] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");

  async function handleBulkImport() {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    // Deliberately NOT using the `terms` state here — that only holds the
    // current page/search results, and bulk-import needs to check against
    // the whole glossary so it updates existing terms instead of creating
    // duplicates for anything sitting off-page.
    const allTerms = await listGlossaryTerms(gameId, targetLanguage, { limit: 100000 });

    let added = 0;
    let updated = 0;
    for (const line of lines) {
      if (line.startsWith("#")) continue; // section headers from an exported file
      const parts = line.includes("\t") ? line.split("\t") : line.split(",");
      if (parts.length < 2) continue;
      const english = parts[0].trim();
      const translated = parts[1].trim();
      if (!english || !translated) continue;

      const scopeGameId = bulkShared ? null : gameId;
      const existing = allTerms.find(
        (t) => t.english_term.toLowerCase() === english.toLowerCase() && t.game_id === scopeGameId
      );
      if (existing) {
        await updateGlossaryTerm(existing.id, english, translated, scopeGameId);
        updated++;
      } else {
        await addGlossaryTerm(english, translated, scopeGameId, targetLanguage);
        added++;
      }
    }
    setBulkText("");
    setBulkStatus(`Imported ${lines.length} line(s): ${added} added, ${updated} updated.`);
    await load();
  }

  // ---- Export (whole glossary for this game, spreadsheet-friendly) ----

  async function handleExportGlossary() {
    const allTerms = await listGlossaryTerms(gameId, targetLanguage, { limit: 100000 });
    if (allTerms.length === 0) {
      setListMessage("Nothing to export — the glossary is empty.");
      return;
    }
    const shared = allTerms.filter((t) => t.game_id === null);
    const gameSpecific = allTerms.filter((t) => t.game_id !== null);

    // Kept to plain English/Translated columns to match exactly what Bulk
    // Add/Update reads back in. Shared and game-specific terms are grouped
    // under "#" section headers rather than mixed together — those header
    // lines are ignored on import (any line starting with "#" is skipped),
    // and since Bulk Add/Update applies one scope to a whole paste, each
    // section needs to be pasted back in separately with the matching
    // "Shared across games" checkbox state.
    const lines: string[] = [];
    if (shared.length > 0) {
      lines.push('# Shared terms — paste back in with "Shared across games" CHECKED');
      for (const t of shared) lines.push(`${t.english_term}\t${t.translated_term}`);
      lines.push("");
    }
    if (gameSpecific.length > 0) {
      lines.push('# Game-specific terms — paste back in with "Shared across games" UNCHECKED');
      for (const t of gameSpecific) lines.push(`${t.english_term}\t${t.translated_term}`);
    }

    const docs = await documentDir();
    const defaultPath = await join(docs, `${gameId}-${targetLanguage}-glossary.txt`);
    const chosenPath = await save({ defaultPath });
    if (!chosenPath) return;
    await writeTextFile(chosenPath, lines.join("\n"));
    setListMessage(`Exported ${allTerms.length} term(s) to ${chosenPath}.`);
  }

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < totalCount;
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  const selectedUsage = selected !== "new" && selected ? usageCounts[selected.id] : undefined;

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "980px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Glossary</h1>
          <p style={{ color: "var(--text-dim)" }}>
            Terms marked "shared" apply across all games; others apply only to this {scopeWord}.
            {isModProject &&
              " The base game's own glossary is also applied automatically (it isn't listed here) — add a term here to override one of its translations for this mod."}
          </p>
          {providerName === null && (
            <p className="glossary-save-message" style={{ color: "var(--status-ai-draft)" }}>
              ⚠ This project is set to manual translation (no AI provider), so nothing here is sent to a translator —
              the glossary is just a reference for your own edits.
            </p>
          )}
          {providerName && !providerSupportsGlossary && (
            <p className="glossary-save-message" style={{ color: "var(--status-ai-draft)" }}>
              ⚠ {providerName} can't apply glossary terms, so nothing here is sent to it when translating — the glossary
              is just a reference for your own edits. TranslateGemma (Ollama) and OpenAI-compatible providers do apply it.
            </p>
          )}
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
            Paste rows copied from a spreadsheet (English, then Translated, tab-separated — one pair per line) for
            adding or updating many terms at once. An existing term with the same English word (in the same
            shared/game scope) is updated rather than duplicated. For editing one term at a time, notes, or status,
            use the list below instead.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
            placeholder={"peace\tvrede\npeace treaty\tvredesverdrag"}
          />
          <label style={{ fontSize: "0.8rem" }}>
            <input type="checkbox" checked={bulkShared} onChange={(e) => setBulkShared(e.target.checked)} /> Shared across games
          </label>{" "}
          <button
            onClick={handleBulkImport}
            title={`Adds every pasted pair to this ${scopeWord}'s glossary (or to the shared glossary if the box is ticked). Terms that already exist are updated, not duplicated.`}
          >
            Bulk Add / Update
          </button>{" "}
          <button
            onClick={handleExportGlossary}
            title="Saves every term you can see here to a text file you can edit in a spreadsheet and paste back in."
          >
            Export Whole Glossary to File
          </button>
          {bulkStatus && <p style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{bulkStatus}</p>}
        </div>

        <div className="glossary-toolbar">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search English, translated, or notes..."
          />
          <span className="glossary-result-count">
            {loaded ? (totalCount === 0 ? "No terms" : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`) : "Loading..."}
          </span>
          <button className="build-mod-button" onClick={startNew}>
            + Add Term
          </button>
        </div>
        {listMessage && <p className="glossary-save-message">{listMessage}</p>}

        {selectedIds.size > 0 && (
          <div className="glossary-bulk-toolbar">
            <strong>{selectedIds.size} selected</strong>
            <button onClick={() => handleBulkStatus("preferred")}>Mark Preferred</button>
            <button
              onClick={() => handleBulkStatus("review")}
              title="Needs-review terms stay in your list but are NOT sent to the AI translator until marked Preferred again."
            >
              Mark Needs Review
            </button>
            <button onClick={handleBulkDelete}>Delete</button>
            <button className="text-link-button" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        <div className="glossary-workspace">
          <div className="glossary-list">
            <table className="glossary-table">
              <thead>
                <tr>
                  <th style={{ width: "28px" }}>
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} />
                  </th>
                  <th>English</th>
                  <th>Translated</th>
                  <th title="Preferred terms are applied by the AI translator. Needs-review terms are kept but not applied.">
                    Status
                  </th>
                  <th title="Ticked = applies to every game, not just this one">Shared</th>
                  <th title="How many of this project's strings contain the term as a whole word — the same test the translator uses.">
                    Usage
                  </th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t) => (
                  <tr
                    key={t.id}
                    className={selected !== "new" && selected?.id === t.id ? "selected" : ""}
                    onClick={() => selectRow(t)}
                  >
                    <td onClick={(e) => toggleSelect(e, t.id)}>
                      <input type="checkbox" checked={selectedIds.has(t.id)} readOnly />
                    </td>
                    <td>{t.english_term}</td>
                    <td>{t.translated_term || "—"}</td>
                    <td>
                      <span className={`status-badge ${effectiveStatus(t)}`}>
                        {effectiveStatus(t) === "preferred" && "Preferred"}
                        {effectiveStatus(t) === "review" && "Needs review"}
                        {effectiveStatus(t) === "untranslated" && "Untranslated"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>{t.game_id === null ? "✓" : ""}</td>
                    <td>
                      {usageCounts[t.id] === undefined ? (
                        "…"
                      ) : usageCounts[t.id] === 0 ? (
                        <span style={{ color: "var(--text-dim)" }}>0 strings</span>
                      ) : (
                        <button
                          className="text-link-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewOccurrences(t.english_term);
                          }}
                          title={`View the ${usageCounts[t.id]} string(s) containing "${t.english_term}" in the editor`}
                        >
                          {usageCounts[t.id]} strings
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="glossary-pagination">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={!hasPrev}>
                ← Prev
              </button>
              <span>Page {totalCount === 0 ? 0 : page + 1}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={!hasNext}>
                Next →
              </button>
            </div>
          </div>

          <div className="glossary-details">
            {selected === null ? (
              <p className="glossary-details-empty">Select a term to view or edit it, or click + Add Term to create one.</p>
            ) : (
              <>
                <div className="form-row">
                  <div className="form-label">English</div>
                  <input type="text" value={draftEnglish} onChange={(e) => setDraftEnglish(e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-label">Translated</div>
                  <input type="text" value={draftTranslated} onChange={(e) => setDraftTranslated(e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-label">Status</div>
                  <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as "preferred" | "review")}>
                    <option value="preferred">Preferred</option>
                    <option value="review">Needs review</option>
                  </select>
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
                  Preferred terms are applied when the AI translates. Needs-review terms are kept in the list but not
                  applied until you mark them Preferred.
                </p>
                {!draftTranslated.trim() && (
                  <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
                    Shows as "Untranslated" in the list until a translation is entered, regardless of status.
                  </p>
                )}
                <div className="form-row">
                  <div className="form-label">Notes</div>
                  <textarea rows={3} value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
                </div>
                <div className="form-row">
                  <label
                    style={{ fontWeight: "normal" }}
                    title={`Ticked: this term applies to every game. Unticked: it applies only to this ${scopeWord}.`}
                  >
                    <input type="checkbox" checked={draftShared} onChange={(e) => setDraftShared(e.target.checked)} /> Shared
                    across games
                  </label>
                </div>

                {selected !== "new" && (
                  <div className="form-row">
                    <div className="form-label">Usage</div>
                    {selectedUsage === undefined ? (
                      <span style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>Counting...</span>
                    ) : selectedUsage === 0 ? (
                      <span style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>Not found in any string.</span>
                    ) : (
                      <button onClick={() => onViewOccurrences(draftEnglish)} style={{ width: "100%" }}>
                        View {selectedUsage} occurrence{selectedUsage === 1 ? "" : "s"} →
                      </button>
                    )}
                  </div>
                )}

                {panelMessage && <p style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{panelMessage}</p>}

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button className="build-mod-button" onClick={handleSave} style={{ flexGrow: 1 }}>
                    Save
                  </button>
                  {selected !== "new" && <button onClick={handleDelete}>Delete</button>}
                </div>
                <button className="text-link-button" style={{ marginTop: "0.5rem" }} onClick={closePanel}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

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