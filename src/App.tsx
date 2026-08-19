import { useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import "./App.css";

interface ParsedString {
  key: string;
  text: string;
}

interface EditorRow {
  key: string;
  game_id: string;
  source_text: string;
  context_label: string | null;
  translated_text: string | null;
  status: string | null;
}

function parseLocFile(content: string): ParsedString[] {
  const results: ParsedString[] = [];
  const lines = content.split("\n");
  const linePattern = /^\s*([A-Za-z0-9_.]+):\d*\s*"(.*)"\s*$/;
  for (const line of lines) {
    const match = line.match(linePattern);
    if (match) results.push({ key: match[1], text: match[2] });
  }
  return results;
}

const BATCH_SIZE = 100;

const STATUS_COLORS: Record<string, string> = {
  untranslated: "#f8d7da",
  "ai-suggested": "#fff3cd",
  "human-confirmed": "#d4edda",
};

function App() {
  const [status, setStatus] = useState("");
  const [count, setCount] = useState<number | null>(null);

  const [rows, setRows] = useState<EditorRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function findLocFiles(dirPath: string): Promise<string[]> {
    const entries = await readDir(dirPath);
    let found: string[] = [];
    for (const entry of entries) {
      const fullPath = await join(dirPath, entry.name ?? "");
      if (entry.isDirectory) {
        found = found.concat(await findLocFiles(fullPath));
      } else if (entry.name?.endsWith("_l_english.yml")) {
        found.push(fullPath);
      }
    }
    return found;
  }

  async function importFolder() {
    setStatus("Waiting for folder selection...");
    const folderPath = await open({ directory: true, multiple: false });
    if (!folderPath) {
      setStatus("No folder selected.");
      return;
    }
    setStatus("Scanning folder for localization files...");
    const files = await findLocFiles(folderPath as string);
    if (files.length === 0) {
      setStatus("No _l_english.yml files found in that folder.");
      return;
    }
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    await db.execute(
      "INSERT OR REPLACE INTO games (game_id, display_name, detected_version) VALUES ($1, $2, $3)",
      ["eu5", "Europa Universalis 5", "1.0"]
    );
    let totalStrings = 0;
    for (const filePath of files) {
      setStatus(`Reading ${filePath}...`);
      const content = await readTextFile(filePath);
      const parsed = parseLocFile(content);
      const fileName = filePath.split("\\").pop() ?? filePath;
      const contextLabel = fileName.replace("_l_english.yml", "").replace(/_/g, " ");
      for (const item of parsed) {
        const hash = String(item.text.length) + "-" + item.text.slice(0, 20);
        await db.execute(
          `INSERT OR REPLACE INTO strings (key, game_id, source_text, source_text_hash, file_path, context_label)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.key, "eu5", item.text, hash, filePath, contextLabel]
        );
        totalStrings++;
      }
    }
    const countRows = (await db.select("SELECT COUNT(*) as total FROM strings")) as { total: number }[];
    setCount(countRows[0].total);
    setStatus(`Import complete. Processed ${files.length} files, ${totalStrings} strings this run.`);
  }

  // --- Editor view ---

  async function loadBatch(newOffset: number) {
    setStatus("Loading batch...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");

    const batch = (await db.select(
      `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
              s.context_label as context_label, t.translated_text as translated_text,
              t.status as status
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
       ORDER BY s.file_path, s.key
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, newOffset]
    )) as EditorRow[];

    setRows(batch);
    setOffset(newOffset);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) {
      initialDrafts[row.key] = row.translated_text ?? "";
    }
    setDrafts(initialDrafts);

    setStatus(`Showing rows ${newOffset + 1}–${newOffset + batch.length}.`);
  }

  async function loadNextUntranslated() {
    setStatus("Finding next untranslated strings...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");

    const batch = (await db.select(
      `SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
              s.context_label as context_label, t.translated_text as translated_text,
              t.status as status
       FROM strings s
       LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
       WHERE t.status IS NULL OR t.status = 'untranslated'
       ORDER BY s.file_path, s.key
       LIMIT $1`,
      [BATCH_SIZE]
    )) as EditorRow[];

    setRows(batch);
    setOffset(0);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) initialDrafts[row.key] = row.translated_text ?? "";
    setDrafts(initialDrafts);

    setStatus(`Loaded ${batch.length} untranslated strings.`);
  }

  function updateDraft(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }

  async function saveRow(row: EditorRow) {
    const newText = drafts[row.key] ?? "";
    // Don't save if nothing actually changed from what's already stored
    if (newText === (row.translated_text ?? "")) return;

    const db = await Database.load("sqlite:pdx-afrikaans.db");

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, translated_text, status, translated_by, updated_at)
       VALUES ($1, $2, $3, 'human-confirmed', $4, datetime('now'))`,
      [row.key, row.game_id, newText, "You (local)"]
    );

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.key, row.game_id, row.translated_text ?? "", newText, "You (local)"]
    );

    // Reflect the save immediately in the visible list (updates the color)
    setRows((prev) =>
      prev.map((r) =>
        r.key === row.key ? { ...r, translated_text: newText, status: "human-confirmed" } : r
      )
    );
  }

  return (
    <main className="container" style={{ maxWidth: "100%", padding: "1rem" }}>
      <h1>PDX Afrikaans</h1>

      <button onClick={importFolder}>Import Entire Folder</button>{" "}
      <button onClick={() => loadBatch(0)}>Open Editor</button>{" "}
      <button onClick={loadNextUntranslated}>Next Untranslated Batch</button>{" "}
      {rows.length > 0 && (
        <>
          <button onClick={() => loadBatch(Math.max(0, offset - BATCH_SIZE))} disabled={offset === 0}>
            ← Previous 100
          </button>{" "}
          <button onClick={() => loadBatch(offset + BATCH_SIZE)}>Next 100 →</button>
        </>
      )}

      <p>{status}</p>
      {count !== null && <p>Total strings in database: {count}</p>}

      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #999" }}>
              <th style={{ width: "10%" }}>Key / Context</th>
              <th style={{ width: "40%" }}>English</th>
              <th style={{ width: "50%" }}>Afrikaans</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const bgColor = STATUS_COLORS[row.status ?? "untranslated"] ?? STATUS_COLORS.untranslated;
              return (
                <tr key={row.key} style={{ background: bgColor, borderLeft: "4px solid #999" }}>
                  <td style={{ verticalAlign: "top", padding: "0.4rem", fontSize: "0.8rem" }}>
                    <strong>{row.key}</strong>
                    <br />
                    <em>{row.context_label}</em>
                  </td>
                  <td style={{ verticalAlign: "top", padding: "0.4rem" }}>{row.source_text}</td>
                  <td style={{ padding: "0.4rem" }}>
                    <textarea
                      value={drafts[row.key] ?? ""}
                      onChange={(e) => updateDraft(row.key, e.target.value)}
                      onBlur={() => saveRow(row)}
                      rows={6}
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default App;