import React from "react";
import ReactDOM from "react-dom/client";
import { message } from "@tauri-apps/plugin-dialog";
import App from "./App";
import { applyPendingRestore } from "./backup";

async function start() {
  // If a backup restore is waiting, put it in place NOW — before the app (and
  // so the database) is opened, when nothing can be holding the file.
  let restoreNote: { text: string; kind: "info" | "error" } | null = null;
  try {
    const restore = await applyPendingRestore();
    if (restore.status === "applied") {
      restoreNote = { text: "Your backup has been restored. Saved API keys and your GitHub token are not part of a backup, so enter them again in Project Settings / GitHub collaboration if you use them.", kind: "info" };
    } else if (restore.status === "failed") {
      restoreNote = {
        text: `Vertaal could not finish restoring your backup: ${restore.message}\n\nYour current data was left as it was. Vertaal will try again the next time it starts.`,
        kind: "error",
      };
    }
  } catch {
    // If even checking fails, carry on and open the app normally.
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  if (restoreNote) await message(restoreNote.text, { title: "Vertaal", kind: restoreNote.kind });
}

start();