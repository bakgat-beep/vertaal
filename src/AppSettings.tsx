import { useState } from "react";
import { setContributorName } from "./settings";

interface Props {
  contributorName: string;
  onSaved: (name: string) => void;
  onClose: () => void;
}

// Settings that belong to the app as a whole (not to one project). For now
// that is the name recorded against your work; this is also where the other
// app-wide things are pointed out, so nobody has to hunt for them.
export default function AppSettings({ contributorName, onSaved, onClose }: Props) {
  const [name, setName] = useState(contributorName);
  const [message, setMessage] = useState("");

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Please enter a name.");
      return;
    }
    await setContributorName(trimmed);
    onSaved(trimmed);
    setMessage("✓ Saved.");
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-window" style={{ width: "560px" }}>
        <div className="welcome-title">
          <h1 style={{ marginBottom: 0 }}>App Settings</h1>
          <p style={{ color: "var(--text-dim)" }}>Settings that apply to Vertaal as a whole, not to one project.</p>
        </div>

        <div className="form-row">
          <div className="form-label">Your name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flexGrow: 1 }}
            title="Recorded as the author of your translations, confirmations and edits"
          />
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "-0.5rem" }}>
          Recorded as the author of your translations, edits and confirmations — it appears in each string's history
          and in files you share with collaborators. Changing it only affects work from now on; nothing already
          recorded is rewritten.
        </p>
        {message && <p style={{ fontSize: "0.85rem" }}>{message}</p>}

        <h3 style={{ marginBottom: 0, marginTop: "1.25rem" }}>Where to find other settings</h3>
        <ul style={{ fontSize: "0.85rem", color: "var(--text-dim)", paddingLeft: "1.2rem" }}>
          <li>
            <strong>Translation provider, model, API key</strong> — Project Settings (top right, inside a project). The
            API key is saved once per provider and shared by every project using it.
          </li>
          <li>
            <strong>GitHub token</strong> — More actions ▾ → GitHub collaboration.
          </li>
          <li>
            <strong>Backups</strong> — More actions ▾ → Back up all app data (also on the start screen, together with
            Restore).
          </li>
        </ul>

        <div className="welcome-footer">
          <button onClick={onClose}>Close</button>
          <button className="build-mod-button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}