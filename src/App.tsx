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
  flagged: number | null;
  translated_by: string | null;
  updated_at: string | null;
  file_path?: string | null;
}

type ViewMode = "all" | "untranslated" | "translated" | "search" | "category" | "subcategory";

interface SubcategoryCount {
  subcategory: string;
  total: number;
  untranslated: number;
}
interface CategoryCount {
  category: string;
  total: number;
  untranslated: number;
  subcategories: SubcategoryCount[];
}

  interface ProtectedText {
    text: string;
    tokens: string[];
  }

  function protectTokens(source: string): ProtectedText {
    // Matches $VARIABLE$, [Function.Call], #tagname (opening), #! (closing), and @icon! —
    // each protected individually, so any real English text between them stays visible.
    const tokenPattern = /#!|#[A-Za-z_][A-Za-z0-9_]*|\$[^$]+\$|\[[^\]]+\]|@\S+!/g;
    const tokens: string[] = [];
    const text = source.replace(tokenPattern, (match) => {
      tokens.push(match);
      return `__TOKEN_${tokens.length - 1}__`;
    });
    return { text, tokens };
  }

  function restoreTokens(translatedText: string, tokens: string[]): string {
    let result = translatedText;
    tokens.forEach((token, i) => {
      result = result.replace(`__TOKEN_${i}__`, token);
    });
    return result;
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

function App() {
  const [status, setStatus] = useState("");
  const [count, setCount] = useState<number | null>(null);

  const [rows, setRows] = useState<EditorRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [contextPanelOpen, setContextPanelOpen] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [selectedRow, setSelectedRow] = useState<EditorRow | null>(null);

  const [glossaryEnglish, setGlossaryEnglish] = useState("");
  const [glossaryAfrikaans, setGlossaryAfrikaans] = useState("");

  const [statusCounts, setStatusCounts] = useState({
    untranslated: 0,
    aiDraft: 0,
    confirmed: 0,
    total: 0,
  });

  useEffect(() => {
    refreshCounts();
    loadCategories();
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

  async function loadPage(mode: ViewMode, newOffset: number, category?: string, subcategory?: string) {
    setStatus("Loading...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");

    const baseSelect = `
      SELECT s.key as key, s.game_id as game_id, s.source_text as source_text,
             s.context_label as context_label, s.file_path as file_path,
             t.translated_text as translated_text, t.status as status,
             t.flagged as flagged, t.translated_by as translated_by, t.updated_at as updated_at
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
    } else if (mode === "category") {
      batch = (await db.select(
        `${baseSelect} WHERE s.category = $1
         ORDER BY s.file_path, s.key LIMIT $2 OFFSET $3`,
        [category, BATCH_SIZE, newOffset]
      )) as EditorRow[];
    } else if (mode === "subcategory") {
      batch = (await db.select(
        `${baseSelect} WHERE s.category = $1 AND s.subcategory = $2
         ORDER BY s.file_path, s.key LIMIT $3 OFFSET $4`,
        [category, subcategory, BATCH_SIZE, newOffset]
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

  function selectCategory(category: string) {
    setCategoryFilter(category);
    setSubcategoryFilter(null);
    loadPage("category", 0, category);
  }

  function selectSubcategory(category: string, subcategory: string) {
    setCategoryFilter(category);
    setSubcategoryFilter(subcategory);
    loadPage("subcategory", 0, category, subcategory);
  }

    async function saveDraft(row: EditorRow) {
    const newText = drafts[row.key] ?? "";
    if (newText === (row.translated_text ?? "")) return;

    // Don't downgrade an already-confirmed row just because it was clicked into
    // without actually being changed further, or re-typed with the same text.
    const newStatus = newText.trim() === "" ? "untranslated" : "human-draft";

    const db = await Database.load("sqlite:pdx-afrikaans.db");

    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, translated_text, status, translated_by, updated_at, flagged)
       VALUES ($1, $2, $3, $4, $5, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $6 AND game_id = $7), 0))`,
      [row.key, row.game_id, newText, newStatus, "You (local)", row.key, row.game_id]
    );

    await db.execute(
      `INSERT INTO translation_history (string_key, game_id, old_text, new_text, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.key, row.game_id, row.translated_text ?? "", newText, "You (local)"]
    );

    const updated = { ...row, translated_text: newText, status: newStatus };
    setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
    if (selectedRow?.key === row.key) setSelectedRow(updated);
  }

  async function confirmRow(row: EditorRow) {
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    await db.execute(
      `UPDATE translations SET status = 'human-confirmed', translated_by = $1, updated_at = datetime('now')
       WHERE string_key = $2 AND game_id = $3`,
      ["You (local)", row.key, row.game_id]
    );
    const updated = { ...row, status: "human-confirmed" };
    setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
    setSelectedRow(updated);
    refreshCounts();
  }

  async function toggleFlag(row: EditorRow) {
    const newFlagged = row.flagged ? 0 : 1;
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    await db.execute(
      `INSERT OR REPLACE INTO translations (string_key, game_id, translated_text, status, translated_by, updated_at, flagged)
       VALUES ($1, $2, $3, $4, $5, datetime('now'), $6)`,
      [row.key, row.game_id, row.translated_text ?? "", row.status ?? "untranslated", row.translated_by ?? "You (local)", newFlagged]
    );
    const updated = { ...row, flagged: newFlagged };
    setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
    if (selectedRow?.key === row.key) setSelectedRow(updated);
  }

  // --- Categories / subcategories ---

  function extractCategory(fullPath: string): string {
    const marker = "\\game\\";
    const idx = fullPath.indexOf(marker);
    if (idx === -1) return "other";
    const afterGame = fullPath.substring(idx + marker.length);
    return afterGame.split("\\")[0];
  }

  async function backfillCategories() {
    setStatus("Backfilling categories...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    const distinctFiles = (await db.select("SELECT DISTINCT file_path FROM strings")) as { file_path: string }[];
    let done = 0;
    for (const row of distinctFiles) {
      const category = extractCategory(row.file_path);
      await db.execute("UPDATE strings SET category = $1 WHERE file_path = $2", [category, row.file_path]);
      done++;
      if (done % 50 === 0) setStatus(`Backfilling categories... ${done}/${distinctFiles.length} files`);
    }
    setStatus(`Category backfill complete. Processed ${distinctFiles.length} files.`);
    await loadCategories();
  }

  function extractSubcategory(fullPath: string): string {
    const marker = "\\localization\\";
    const idx = fullPath.indexOf(marker);
    if (idx === -1) return "general";
    const afterLoc = fullPath.substring(idx + marker.length);
    const parts = afterLoc.split("\\");
    if (parts.length <= 2) return "general";
    return parts[1];
  }

  async function backfillSubcategories() {
    setStatus("Backfilling subcategories...");
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    const distinctFiles = (await db.select("SELECT DISTINCT file_path FROM strings")) as { file_path: string }[];
    let done = 0;
    for (const row of distinctFiles) {
      const subcategory = extractSubcategory(row.file_path);
      await db.execute("UPDATE strings SET subcategory = $1 WHERE file_path = $2", [subcategory, row.file_path]);
      done++;
      if (done % 50 === 0) setStatus(`Backfilling subcategories... ${done}/${distinctFiles.length}`);
    }
    setStatus(`Subcategory backfill complete. Processed ${distinctFiles.length} files.`);
    await loadCategories();
  }

  async function loadCategories() {
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    const rows = (await db.select(`
      SELECT s.category as category, s.subcategory as subcategory,
             COUNT(*) as total,
             SUM(CASE WHEN t.status IS NULL OR t.status = 'untranslated' THEN 1 ELSE 0 END) as untranslated
      FROM strings s
      LEFT JOIN translations t ON s.key = t.string_key AND s.game_id = t.game_id
      WHERE s.category IS NOT NULL
      GROUP BY s.category, s.subcategory
      ORDER BY total DESC
    `)) as { category: string; subcategory: string | null; total: number; untranslated: number }[];

    const grouped: Record<string, CategoryCount> = {};
    for (const row of rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = { category: row.category, total: 0, untranslated: 0, subcategories: [] };
      }
      grouped[row.category].total += row.total;
      grouped[row.category].untranslated += row.untranslated;
      grouped[row.category].subcategories.push({
        subcategory: row.subcategory ?? "general",
        total: row.total,
        untranslated: row.untranslated,
      });
    }

    setCategories(Object.values(grouped).sort((a, b) => b.total - a.total));
  }

  function toggleCategoryExpanded(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
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

  async function addGlossaryTerm() {
    if (!glossaryEnglish.trim() || !glossaryAfrikaans.trim()) return;
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    await db.execute(
      "INSERT INTO glossary (english_term, afrikaans_term) VALUES ($1, $2)",
      [glossaryEnglish.trim(), glossaryAfrikaans.trim()]
    );
    setStatus(`Added glossary term: "${glossaryEnglish}" → "${glossaryAfrikaans}"`);
    setGlossaryEnglish("");
    setGlossaryAfrikaans("");
  }

  async function aiTranslateRow(row: EditorRow) {
    setStatus(`Requesting AI translation for ${row.key}...`);
    try {
      const { text: protectedText, tokens } = protectTokens(row.source_text);

      const db = await Database.load("sqlite:pdx-afrikaans.db");
      const glossaryRows = (await db.select(
        "SELECT english_term, afrikaans_term FROM glossary"
      )) as { english_term: string; afrikaans_term: string }[];

      const matchedTerms = glossaryRows.filter((g) =>
        row.source_text.toLowerCase().includes(g.english_term.toLowerCase())
      );

      let glossaryInstruction = "";
      if (matchedTerms.length > 0) {
        const lines = matchedTerms
          .map((t) => `- "${t.english_term}" must be translated as "${t.afrikaans_term}"`)
          .join("\n");
        glossaryInstruction = `\n\nFollow these mandatory terminology rules:\n${lines}`;
      }

      const prompt =
        `You are a professional English (en) to Afrikaans (af) translator. Your goal is to accurately convey the meaning and nuances of the original English text while adhering to Afrikaans grammar, vocabulary, and cultural sensitivities. Produce only the Afrikaans translation, without any additional explanations or commentary.${glossaryInstruction}\n\nPlease translate the following English text into Afrikaans:\n\n${protectedText}`;

      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "translategemma:4b",
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (!response.ok) {
        setStatus(`AI translation failed: ${response.status} ${response.statusText}`);
        return;
      }

      const data = await response.json();
      const finalTranslation = restoreTokens(data.message.content.trim(), tokens);

      await db.execute(
        `INSERT OR REPLACE INTO translations (string_key, game_id, translated_text, status, translated_by, updated_at, flagged)
         VALUES ($1, $2, $3, 'ai-suggested', $4, datetime('now'), COALESCE((SELECT flagged FROM translations WHERE string_key = $5 AND game_id = $6), 0))`,
        [row.key, row.game_id, finalTranslation, "TranslateGemma:4b", row.key, row.game_id]
      );

      await db.execute(
        `INSERT INTO translation_history (string_key, game_id, old_text, new_text, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.key, row.game_id, row.translated_text ?? "", finalTranslation, "TranslateGemma:4b"]
      );

      const updated: EditorRow = {
        ...row,
        translated_text: finalTranslation,
        status: "ai-suggested",
        translated_by: "TranslateGemma:4b",
      };
      setRows((prev) => prev.map((r) => (r.key === row.key ? updated : r)));
      setDrafts((prev) => ({ ...prev, [row.key]: finalTranslation }));
      if (selectedRow?.key === row.key) setSelectedRow(updated);
      refreshCounts();
      setStatus(`AI translated ${row.key}${matchedTerms.length > 0 ? " (glossary applied)" : ""}.`);
    } catch (err) {
      setStatus(`AI translation error: ${err}`);
    }
  }

  function testTokenProtection() {
    const original = '#trigger_pass @trigger_pass! $TEXT$#!';
    const { text, tokens } = protectTokens(original);
    const restored = restoreTokens(text, tokens);
    setStatus(`Protected: "${text}" | Restored matches original: ${restored === original}`);
  }

    async function testOllamaConnection() {
    setStatus("Sending test request to Ollama...");
    try {
      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "translategemma:4b",
          messages: [
            {
              role: "user",
              content:
                "You are a professional English (en) to Afrikaans (af) translator. Your goal is to accurately convey the meaning and nuances of the original English text while adhering to Afrikaans grammar, vocabulary, and cultural sensitivities. Produce only the Afrikaans translation, without any additional explanations or commentary. Please translate the following English text into Afrikaans:\n\nHello, welcome to the game.",
            },
          ],
          stream: false,
        }),
      });

      if (!response.ok) {
        setStatus(`Ollama request failed: ${response.status} ${response.statusText}`);
        return;
      }

      const data = await response.json();
      setStatus(`Ollama responded: "${data.message.content}"`);
    } catch (err) {
      setStatus(`Could not reach Ollama: ${err}`);
    }
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

      <div className="toolbar">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder="Search by key, English, or Afrikaans text..."
          style={{ width: "260px" }}
        />
        <button onClick={runSearch}>Search</button>

        <input
          type="text"
          value={glossaryEnglish}
          onChange={(e) => setGlossaryEnglish(e.target.value)}
          placeholder="English term"
          style={{ width: "110px" }}
        />
        <input
          type="text"
          value={glossaryAfrikaans}
          onChange={(e) => setGlossaryAfrikaans(e.target.value)}
          placeholder="Afrikaans term"
          style={{ width: "110px" }}
        />
        <button onClick={addGlossaryTerm}>Add Glossary Term</button>

        <div className="filter-chips">
          <span className="chip">
            <span className="chip-dot" style={{ background: "var(--status-untranslated)" }} />
            Untranslated
          </span>
          <span className="chip">
            <span className="chip-dot" style={{ background: "var(--status-ai-draft)" }} />
            AI draft
          </span>
          <span className="chip">
            <span className="chip-dot" style={{ background: "var(--status-confirmed)" }} />
            Confirmed
          </span>
        </div>

        <div className="toolbar-spacer" />

        <button onClick={importFolder}>Import Folder</button>{" "}
        <button onClick={testTokenProtection}>Test Token Protection</button>
       </div>

      <div className="content-columns">
        <div className="sidebar">
          <div className="sidebar-item" onClick={() => loadPage("all", 0)}>
            <span>All Files</span>
            <span className="sidebar-count">{statusCounts.total.toLocaleString()}</span>
          </div>
          <div className="sidebar-item" onClick={() => loadPage("untranslated", 0)}>
            <span>Untranslated</span>
            <span className="sidebar-count">{statusCounts.untranslated.toLocaleString()}</span>
          </div>
          <div className="sidebar-item" onClick={toggleTranslatedView}>
            <span>Confirmed</span>
            <span className="sidebar-count">{statusCounts.confirmed.toLocaleString()}</span>
          </div>

          <div style={{ height: "1px", background: "var(--border)", margin: "0.6rem 0" }} />

          {categories.map((cat) => (
            <div key={cat.category}>
              <div className="sidebar-item" onClick={() => selectCategory(cat.category)}>
                <span onClick={(e) => { e.stopPropagation(); toggleCategoryExpanded(cat.category); }}>
                  {expandedCategories.has(cat.category) ? "▾ " : "▸ "}
                  {cat.category.replace(/_/g, " ")}
                </span>
                <span className="sidebar-count" style={{ opacity: cat.untranslated === 0 ? 0.4 : 1 }}>
                  {cat.untranslated.toLocaleString()}
                </span>
              </div>

              {expandedCategories.has(cat.category) &&
                cat.subcategories.map((sub) => (
                  <div
                    key={sub.subcategory}
                    className="sidebar-item"
                    style={{ paddingLeft: "1.8rem" }}
                    onClick={() => selectSubcategory(cat.category, sub.subcategory)}
                  >
                    <span style={{ fontSize: "0.8rem" }}>{sub.subcategory.replace(/_/g, " ")}</span>
                    <span className="sidebar-count" style={{ opacity: sub.untranslated === 0 ? 0.4 : 1 }}>
                      {sub.untranslated.toLocaleString()}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="editor-column">
          <p style={{ color: "var(--text-dim)" }}>{status}</p>
          {count !== null && <p style={{ color: "var(--text-dim)" }}>Total strings in database: {count}</p>}

          {rows.length > 0 && (
            <div style={{ margin: "0.5rem 0" }}>
              <button
                onClick={() =>
                  loadPage(viewMode, Math.max(0, offset - BATCH_SIZE), categoryFilter ?? undefined, subcategoryFilter ?? undefined)
                }
                disabled={offset === 0}
              >
                ← Previous 100
              </button>{" "}
              <button
                onClick={() =>
                  loadPage(viewMode, offset + BATCH_SIZE, categoryFilter ?? undefined, subcategoryFilter ?? undefined)
                }
              >
                Next 100 →
              </button>
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              {rows.map((row) => {
                const barColor =
                  row.status === "human-confirmed"
                    ? "var(--status-confirmed)"
                    : row.status === "ai-suggested" || row.status === "human-draft"
                    ? "var(--status-ai-draft)"
                    : "var(--status-untranslated)";
                const isSelected = selectedRow?.key === row.key;

                return (
                  <div
                    key={row.key}
                    onClick={() => setSelectedRow(row)}
                    className={isSelected ? "row-selected" : ""}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 10%) minmax(0, 30%) minmax(0, 50%) minmax(0, 10%)",
                      borderLeft: `4px solid ${barColor}`,
                      borderBottom: "1px solid var(--border)",
                      padding: "0.5rem",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ overflowWrap: "break-word", minWidth: 0 }}>
                      <div className="row-key" style={{ overflowWrap: "break-word" }}>{row.key}</div>
                      <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>{row.context_label}</div>
                    </div>
                      <div style={{ color: "var(--text-dim)", overflowWrap: "break-word" }}>{row.source_text}</div>
                    <div>
                      <textarea
                        value={drafts[row.key] ?? ""}
                        onChange={(e) => updateDraft(row.key, e.target.value)}
                        onFocus={() => setSelectedRow(row)}
                        onBlur={() => saveDraft(row)}
                        placeholder="— not yet translated —"
                        rows={4}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="row-actions">
                                          <div className="row-actions">
                      <button className="action-btn" title="AI translate" onClick={(e) => { e.stopPropagation(); aiTranslateRow(row); }}>
                        AI
                      </button>
                      <button className="action-btn confirm" title="Confirm" onClick={(e) => { e.stopPropagation(); confirmRow(row); }}>
                        ✓
                      </button>
                      <button
                        className={row.flagged ? "action-btn flag flagged" : "action-btn flag"}
                        title="Flag for review"
                        onClick={(e) => { e.stopPropagation(); toggleFlag(row); }}
                      >
                        ⚑
                      </button>
                    </div>
                      <button className="action-btn confirm" title="Confirm" onClick={(e) => { e.stopPropagation(); confirmRow(row); }}>
                        ✓
                      </button>
                      <button
                        className={row.flagged ? "action-btn flag flagged" : "action-btn flag"}
                        title="Flag for review"
                        onClick={(e) => { e.stopPropagation(); toggleFlag(row); }}
                      >
                        ⚑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={contextPanelOpen ? "context-panel" : "context-panel context-panel-collapsed"}>
          {contextPanelOpen && (
            <>
              <button className="collapse-toggle" onClick={() => setContextPanelOpen(false)}>
                Collapse →
              </button>
              {selectedRow ? (
                <>
                  <p className="row-key" style={{ color: "var(--text-main)" }}>{selectedRow.key}</p>
                  <p>
                    <strong>Status:</strong>{" "}
                    {selectedRow.status === "human-confirmed"
                      ? "Confirmed"
                      : selectedRow.status === "ai-suggested"
                      ? "AI draft (unconfirmed)"
                      : selectedRow.status === "human-draft"
                      ? "Draft (unconfirmed)"
                      : "Untranslated"}
                  </p>
                  {selectedRow.translated_by && (
                    <p>
                      <strong>Last edited by:</strong> {selectedRow.translated_by}
                    </p>
                  )}
                  {selectedRow.updated_at && (
                    <p>
                      <strong>Last updated:</strong> {selectedRow.updated_at}
                    </p>
                  )}
                  {selectedRow.flagged ? <p style={{ color: "#e05a5a" }}>⚑ Flagged for review</p> : null}
                  <p>
                    <strong>Category:</strong> {categoryFilter ?? "—"}
                  </p>
                  <p style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
                    <strong>Source file:</strong> {selectedRow.file_path}
                  </p>
                </>
              ) : (
                <p>Select a row to see details here.</p>
              )}
            </>
          )}
        </div>
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