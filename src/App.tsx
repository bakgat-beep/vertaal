import { useState, useEffect } from "react";
import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readDir, writeTextFile, mkdir, writeFile } from "@tauri-apps/plugin-fs";
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

type ViewMode = "all" | "untranslated" | "translated" | "search";

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
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [statusCounts, setStatusCounts] = useState({
    untranslated: 0,
    aiDraft: 0,
    confirmed: 0,
    total: 0,
  });

  useEffect(() => {
    refreshCounts();
  }, []);

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

  // --- Unified page loader: respects whichever view is currently active ---

  async function loadPage(mode: ViewMode, newOffset: number) {
    setStatus("Loading...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");

    const baseSelect = `
      SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
             s.context_label as context_label, t.translated_text as translated_text,
             t.status as status
      FROM strings s
      LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
    `;

    let batch: EditorRow[] = [];

    if (mode === "all") {
      batch = (await db.select(
        `${baseSelect} ORDER BY s.file_path, s.key LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, newOffset]
      )) as EditorRow[];
    } else if (mode === "untranslated") {
      batch = (await db.select(
        `${baseSelect} WHERE t.status IS NULL OR t.status = 'untranslated'
         ORDER BY s.file_path, s.key LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, newOffset]
      )) as EditorRow[];
    } else if (mode === "translated") {
      batch = (await db.select(
        `${baseSelect} WHERE t.status = 'human-confirmed'
         ORDER BY t.updated_at DESC LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, newOffset]
      )) as EditorRow[];
    } else if (mode === "search") {
      const likeTerm = `%${searchTerm}%`;
      batch = (await db.select(
        `${baseSelect} WHERE s.key LIKE $1 OR s.source_text LIKE $2 OR t.translated_text LIKE $3
         LIMIT $4 OFFSET $5`,
        [likeTerm, likeTerm, likeTerm, BATCH_SIZE, newOffset]
      )) as EditorRow[];
    }

    setRows(batch);
    setOffset(newOffset);
    setViewMode(mode);

    const initialDrafts: Record<string, string> = {};
    for (const row of batch) initialDrafts[row.key] = row.translated_text ?? "";
    setDrafts(initialDrafts);

    setStatus(`Showing ${batch.length} result(s) — view: ${mode}, offset ${newOffset}.`);
  }

  function toggleTranslatedView() {
    if (viewMode === "translated") {
      loadPage("all", 0);
    } else {
      loadPage("translated", 0);
    }
  }

  function runSearch() {
    if (!searchTerm.trim()) return;
    loadPage("search", 0);
  }

  function updateDraft(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }

  async function saveRow(row: EditorRow) {
    const newText = drafts[row.key] ?? "";
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

    setRows((prev) =>
      prev.map((r) =>
        r.key === row.key ? { ...r, translated_text: newText, status: "human-confirmed" } : r
      )
    );
  }

  // --- Mod export ---

  function toModRelativePath(fullPath: string): string | null {
    const marker = "\\game\\";
    const idx = fullPath.indexOf(marker);
    if (idx === -1) return null;

    const afterGame = fullPath.substring(idx + marker.length);
    const parts = afterGame.split("\\");
    const fileName = parts.pop();

    return [...parts, "replace", fileName].join("\\");
  }

  async function writeTextFileWithBom(path: string, content: string) {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const textBytes = new TextEncoder().encode(content);
    const combined = new Uint8Array(bom.length + textBytes.length);
    combined.set(bom, 0);
    combined.set(textBytes, bom.length);
    await writeFile(path, combined);
  }

  async function exportMod() {
    setStatus("Choose a folder to export the mod into...");
    const destFolder = await open({ directory: true, multiple: false });
    if (!destFolder) {
      setStatus("Export cancelled.");
      return;
    }

    const modName = "afrikaans-translation";
    const modRoot = await join(destFolder as string, modName);

    setStatus("Gathering translated strings...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");

    const translated = (await db.select(`
      SELECT s.key as key, s.file_path as file_path, t.translated_text as translated_text
      FROM strings s
      JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
      WHERE t.status = 'human-confirmed' AND t.translated_text IS NOT NULL AND t.translated_text != ''
    `)) as { key: string; file_path: string; translated_text: string }[];

    if (translated.length === 0) {
      setStatus("No confirmed translations to export yet.");
      return;
    }

    const byFile: Record<string, { key: string; translated_text: string }[]> = {};
    for (const row of translated) {
      const relPath = toModRelativePath(row.file_path);
      if (!relPath) continue;
      if (!byFile[relPath]) byFile[relPath] = [];
      byFile[relPath].push({ key: row.key, translated_text: row.translated_text });
    }

    setStatus(`Writing ${Object.keys(byFile).length} localization files...`);

    for (const [relPath, entries] of Object.entries(byFile)) {
      const fullOutputPath = await join(modRoot, relPath);
      const folderPath = fullOutputPath.substring(0, fullOutputPath.lastIndexOf("\\"));

      await mkdir(folderPath, { recursive: true });

      let fileContent = "l_english:\n";
      for (const entry of entries) {
        const safeText = entry.translated_text.replace(/"/g, '\\"');
        fileContent += ` ${entry.key}: "${safeText}"\n`;
      }

        await writeTextFileWithBom(fullOutputPath, fileContent);
    }

    await mkdir(await join(modRoot, ".metadata"), { recursive: true });
    await writeTextFile(
      await join(modRoot, ".metadata", "metadata.json"),
      JSON.stringify(
        {
          name: "Afrikaans Translation",
          id: "afrikaans-translation",
          version: "0.1.0",
          game_id: "eu5",
          supported_game_version: "1.3.*",
          short_description: "Afrikaans translation of Europa Universalis V.",
          tags: ["Translation"],
          relationships: [],
          game_custom_data: {},
        },
        null,
        2
      )
    );

    
    const placeholderPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const pngBytes = Uint8Array.from(atob(placeholderPngBase64), (c) => c.charCodeAt(0));
    await writeFile(await join(modRoot, ".metadata", "thumbnail.png"), pngBytes);

    await writeTextFile(
      await join(modRoot, "descriptor.mod"),
      `version="0.1.0"\ntags={\n\t"Translation"\n}\nname="Afrikaans Translation"\n`
    );

    setStatus(`Export complete. Wrote ${translated.length} strings across ${Object.keys(byFile).length} files to ${modRoot}`);
  }

  async function refreshCounts() {
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    const result = (await db.select(`
      SELECT
        (SELECT COUNT(*) FROM strings) as total,
        (SELECT COUNT(*) FROM translations WHERE status = 'human-confirmed') as confirmed,
        (SELECT COUNT(*) FROM translations WHERE status = 'ai-suggested') as ai_draft
    `)) as { total: number; confirmed: number; ai_draft: number }[];

    const r = result[0];
    setStatusCounts({
      total: r.total,
      confirmed: r.confirmed,
      aiDraft: r.ai_draft,
      untranslated: r.total - r.confirmed - r.ai_draft,
    });
  }

    return (
    <div className="app-shell">
      <div className="title-bar">
        <div className="logo-mark" />
        <span className="app-name">Vertaal</span>
        <span className="project-context">— EU5 → Afrikaans</span>
        <div className="title-bar-spacer" />
        <button className="build-mod-button" onClick={exportMod}>
          Build Mod
        </button>
      </div>

      <div className="main-content">
        <button onClick={importFolder}>Import Entire Folder</button>{" "}
        <button onClick={() => loadPage("all", 0)}>Open Editor</button>{" "}
        <button onClick={() => loadPage("untranslated", 0)}>Next Untranslated Batch</button>{" "}
        <button onClick={toggleTranslatedView}>
          {viewMode === "translated" ? "← Back to Editor" : "Review My Translations"}
        </button>

        <br /><br />

        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by key, English, or Afrikaans text..."
          style={{ width: "300px" }}
        />{" "}
        <button onClick={runSearch}>Search</button>

        <p style={{ color: "var(--text-dim)" }}>{status}</p>
        {count !== null && <p style={{ color: "var(--text-dim)" }}>Total strings in database: {count}</p>}

        {rows.length > 0 && (
          <div style={{ margin: "0.5rem 0" }}>
            <button onClick={() => loadPage(viewMode, Math.max(0, offset - BATCH_SIZE))} disabled={offset === 0}>
              ← Previous 100
            </button>{" "}
            <button onClick={() => loadPage(viewMode, offset + BATCH_SIZE)}>Next 100 →</button>
          </div>
        )}

        {rows.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--border)" }}>
                <th style={{ width: "10%" }}>Key / Context</th>
                <th style={{ width: "40%" }}>English</th>
                <th style={{ width: "50%" }}>Afrikaans</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const bgColor =
                  row.status === "human-confirmed"
                    ? "rgba(76,175,125,0.15)"
                    : row.status === "ai-suggested"
                    ? "rgba(217,164,65,0.15)"
                    : "rgba(90,95,104,0.15)";
                const barColor =
                  row.status === "human-confirmed"
                    ? "var(--status-confirmed)"
                    : row.status === "ai-suggested"
                    ? "var(--status-ai-draft)"
                    : "var(--status-untranslated)";
                return (
                  <tr key={row.key} style={{ background: bgColor, borderLeft: `4px solid ${barColor}` }}>
                    <td style={{ verticalAlign: "top", padding: "0.4rem", fontSize: "0.8rem" }}>
                      <strong>{row.key}</strong>
                      <br />
                      <em style={{ color: "var(--text-dim)" }}>{row.context_label}</em>
                    </td>
                    <td style={{ verticalAlign: "top", padding: "0.4rem", color: "var(--text-dim)" }}>
                      {row.source_text}
                    </td>
                    <td style={{ padding: "0.4rem" }}>
                      <textarea
                        value={drafts[row.key] ?? ""}
                        onChange={(e) => updateDraft(row.key, e.target.value)}
                        onBlur={() => {
                          saveRow(row);
                          refreshCounts();
                        }}
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
      </div>

      <div className="status-bar">
        <span>
          <span className="status-dot" style={{ background: "var(--status-untranslated)" }} />
          {statusCounts.untranslated.toLocaleString()} untranslated
        </span>
        <span>
          <span className="status-dot" style={{ background: "var(--status-ai-draft)" }} />
          {statusCounts.aiDraft.toLocaleString()} AI draft
        </span>
        <span>
          <span className="status-dot" style={{ background: "var(--status-confirmed)" }} />
          {statusCounts.confirmed.toLocaleString()} confirmed
        </span>
        <span>{statusCounts.total.toLocaleString()} total strings</span>
      </div>
    </div>
  );
}

export default App;