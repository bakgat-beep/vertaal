import { useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import "./App.css";

function App() {
  const [result, setResult] = useState("");

  async function testDatabase() {
    // "Load" opens (or creates, if missing) the database file we defined
    // in our migration. The name here must match what we wrote in lib.rs.
    const db = await Database.load("sqlite:pdx-afrikaans.db");

    // Write a test row into the "games" table
    await db.execute(
      "INSERT OR REPLACE INTO games (game_id, display_name, detected_version) VALUES ($1, $2, $3)",
      ["eu5", "Europa Universalis 5", "1.0"]
    );

    // Read it back to prove the write actually worked
    const rows = await db.select("SELECT * FROM games");

    setResult(JSON.stringify(rows, null, 2));
  }

  return (
    <main className="container">
      <h1>PDX Afrikaans — Database Test</h1>
      <button onClick={testDatabase}>Test Database Connection</button>
      <pre style={{ textAlign: "left", background: "#eee", padding: "1rem" }}>
        {result}
      </pre>
    </main>
  );
}

export default App;