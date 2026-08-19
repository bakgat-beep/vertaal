import { useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import "./App.css";

interface ParsedString {
  key: string;
  text: string;
}

function parseLocFile(content: string): ParsedString[] {
  const results: ParsedString[] = [];
  const lines = content.split("\n");

  // Matches: optional leading spaces, a key, a colon, optional number,
  // then the text itself inside quotes.
  const linePattern = /^\s*([A-Za-z0-9_.]+):\d*\s*"(.*)"\s*$/;

  for (const line of lines) {
    const match = line.match(linePattern);
    if (match) {
      results.push({ key: match[1], text: match[2] });
    }
  }
  return results;
}

function App() {
  const [status, setStatus] = useState("");
  const [count, setCount] = useState<number | null>(null);

  async function importFile() {
    setStatus("Waiting for file selection...");

    const filePath = await open({
      multiple: false,
      filters: [{ name: "Localization files", extensions: ["yml"] }],
    });

    if (!filePath) {
      setStatus("No file selected.");
      return;
    }

    setStatus("Reading file...");
    const content = await readTextFile(filePath as string);

    const parsed = parseLocFile(content);
    setStatus(`Found ${parsed.length} strings. Saving to database...`);

    const db = await Database.load("sqlite:pdx-afrikaans.db");

    // Make sure our test game row exists (from the earlier test)
    await db.execute(
      "INSERT OR REPLACE INTO games (game_id, display_name, detected_version) VALUES ($1, $2, $3)",
      ["eu5", "Europa Universalis 5", "1.0"]
    );

    for (const item of parsed) {
      // A simple fingerprint of the text, so we can detect changes later.
      const hash = String(item.text.length) + "-" + item.text.slice(0, 20);

      await db.execute(
        `INSERT OR REPLACE INTO strings (key, game_id, source_text, source_text_hash, file_path, context_label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.key, "eu5", item.text, hash, filePath, "trigger system"]
      );
    }

    const rows = (await db.select("SELECT COUNT(*) as total FROM strings")) as {
      total: number;
    }[];
    setCount(rows[0].total);
    setStatus("Import complete.");
  }

    async function viewStrings() {
    const db = await Database.load("sqlite:pdx-afrikaans.db");
    const rows = await db.select("SELECT key, source_text FROM strings");
    setStatus(JSON.stringify(rows, null, 2));
  }

  return (
    <main className="container">
      <h1>PDX Afrikaans</h1>
      <button onClick={importFile}>Import EU5 Localization File</button>
      <button onClick={viewStrings}>View Stored Strings</button>
      <p>{status}</p>
      {count !== null && <p>Total strings in database: {count}</p>}
    </main>
  );
}

export default App;