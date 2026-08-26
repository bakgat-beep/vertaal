import { useState, useEffect } from "react";
import { listGlossaryTerms, updateGlossaryTerm, deleteGlossaryTerm, addGlossaryTerm, type GlossaryRow } from "./glossary";

interface Props {
  gameId: string;
  targetLanguage: string;
  onClose: () => void;
}

export default function GlossaryManager({ gameId, targetLanguage, onClose }: Props) {
  const [terms, setTerms] = useState<GlossaryRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, { english: string; translated: string; shared: boolean }>>({});
  const [newEnglish, setNewEnglish] = useState("");
  const [newTranslated, setNewTranslated] = useState("");
  const [newShared, setNewShared] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const rows = await listGlossaryTerms(gameId, targetLanguage);
    setTerms(rows);
    const initialDrafts: typeof drafts = {};
    for (const t of rows) {
      initialDrafts[t.id] = { english: t.english_term, translated: t.translated_term, shared: t.game_id === null };
    }
    setDrafts(initialDrafts);
  }

  function updateDraft(id: number, field: "english" | "translated" | "shared", value: string | boolean) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function saveRow(row: GlossaryRow) {
    const draft = drafts[row.id];
    if (!draft) return;
    await updateGlossaryTerm(row.id, draft.english, draft.translated, draft.shared ? null : gameId);
  }

  async function handleDelete(id: number) {
    await deleteGlossaryTerm(id);
    await load();
  }

  async function handleAdd() {
    if (!newEnglish.trim() || !newTranslated.trim()) return;
    await addGlossaryTerm(newEnglish, newTranslated, newShared ? null : gameId, targetLanguage);
    setNewEnglish("");
    setNewTranslated("");
    setNewShared(false);
    await load();
  }

    const [bulkText, setBulkText] = useState("");
  const [bulkShared, setBulkShared] = useState(false);

  async function handleBulkImport() {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.includes("\t") ? line.split("\t") : line.split(",");
      if (parts.length < 2) continue;
      const english = parts[0].trim();
      const translated = parts[1].trim();
      if (!english || !translated) continue;

      const scopeGameId = bulkShared ? null : gameId;
      const existing = terms.find(
        (t) => t.english_term.toLowerCase() === english.toLowerCase() && t.game_id === scopeGameId
      );
      if (existing) {
        await updateGlossaryTerm(existing.id, english, translated, scopeGameId);
      } else {
        await addGlossaryTerm(english, translated, scopeGameId, targetLanguage);
      }
    }
    setBulkText("");
    await load();
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "700px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>Glossary</h1>
          <p style={{ color: "var(--text-dim)" }}>Terms marked "shared" apply across all games; others apply only to this game.</p>
        </div>
        
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
            Paste rows copied from a spreadsheet (English, then Translated, tab-separated — one pair per line).
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={4}
            style={{ width: "100%" }}
            placeholder={"peace\tvrede\npeace treaty\tvredesverdrag"}
          />
          <label style={{ fontSize: "0.8rem" }}>
            <input type="checkbox" checked={bulkShared} onChange={(e) => setBulkShared(e.target.checked)} /> Shared across games
          </label>{" "}
          <button onClick={handleBulkImport}>Bulk Add / Update</button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th>English</th>
              <th>Translated</th>
              <th>Shared</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td>
                  <input
                    value={drafts[t.id]?.english ?? ""}
                    onChange={(e) => updateDraft(t.id, "english", e.target.value)}
                    onBlur={() => saveRow(t)}
                    style={{ width: "95%" }}
                  />
                </td>
                <td>
                  <input
                    value={drafts[t.id]?.translated ?? ""}
                    onChange={(e) => updateDraft(t.id, "translated", e.target.value)}
                    onBlur={() => saveRow(t)}
                    style={{ width: "95%" }}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={drafts[t.id]?.shared ?? false}
                    onChange={(e) => {
                      updateDraft(t.id, "shared", e.target.checked);
                      saveRow(t);
                    }}
                  />
                </td>
                <td>
                  <button onClick={() => handleDelete(t.id)}>Delete</button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <input value={newEnglish} onChange={(e) => setNewEnglish(e.target.value)} placeholder="English term" style={{ width: "95%" }} />
              </td>
              <td>
                <input value={newTranslated} onChange={(e) => setNewTranslated(e.target.value)} placeholder="Translated term" style={{ width: "95%" }} />
              </td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={newShared} onChange={(e) => setNewShared(e.target.checked)} />
              </td>
              <td>
                <button onClick={handleAdd}>Add</button>
              </td>
            </tr>
          </tbody>
        </table>

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