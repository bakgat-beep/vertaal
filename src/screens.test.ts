import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Screen tests. Each screen is drawn once, on the server side (no browser
// window needed), and the resulting page text is checked: the right controls
// are there, and no text symbol (✓ ← → ▾) has crept back in where a drawn icon
// belongs. This covers the first thing each screen shows; clicking and typing
// would need a browser-like test library, which this project does not have.
vi.mock("./db", () => ({ getDb: vi.fn(async () => ({ select: async () => [], execute: async () => ({}) })) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./settings", () => ({ setContributorName: vi.fn(), getContributorName: vi.fn(async () => "") }));

import AppSettings from "./AppSettings";
import ProjectSettings from "./ProjectSettings";
import NewProjectWizard from "./NewProjectWizard";
import { Pager, BatchProgress } from "./BatchControls";
import { StatusText, splitStatusMark } from "./StatusText";
import { GAME_ADAPTERS } from "./games";

const noop = () => {};
const SYMBOLS = /[✓✗→←▾◀▶⚠]/;
const html = (el: any) => renderToString(el).replace(/<!-- -->/g, "");
const text = (el: any) => html(el).replace(/<[^>]*>/g, "");

const project = {
  id: 1,
  created_at: "",
  game_id: "eu5_afrikaans",
  source_language: "english",
  target_language: "afrikaans",
  mod_name: "My Afrikaans Mod",
  output_path: null,
  install_path: null,
  ai_model: null,
  translation_provider_id: "ollama",
  retry_delay_ms: 2000,
  google_translate_delay_ms: 500,
  source_language_code_override: null,
  target_language_code_override: null,
  project_type: "vanilla",
  parent_game_id: "eu5",
  source_mod_name: null,
  source_mod_identifier: null,
  git_repo_path: null,
  git_remote_url: null,
  hidden_from_recent: 0,
} as any;

describe("StatusText", () => {
  it("turns a leading ✓ / ✗ / ⚠ into a drawn icon", () => {
    expect(splitStatusMark("✓ Saved.")).toEqual({ icon: "check", text: "Saved." });
    expect(splitStatusMark("✗ Failed")).toEqual({ icon: "cross", text: "Failed" });
    expect(splitStatusMark("⚠ Careful")).toEqual({ icon: "warning", text: "Careful" });
    expect(splitStatusMark("Please enter a name.")).toEqual({ icon: null, text: "Please enter a name." });
  });

  it("draws an svg and no text symbol; plain messages get no icon", () => {
    const done = html(createElement(StatusText, { text: "✓ Saved." }));
    expect(done).toContain("<svg");
    expect(done).not.toMatch(SYMBOLS);
    expect(done).toContain("Saved.");
    expect(html(createElement(StatusText, { text: "Nothing to do" }))).not.toContain("<svg");
  });
});

describe("AppSettings screen", () => {
  const screen = () => createElement(AppSettings, { contributorName: "Michiel", onSaved: noop, onClose: noop });

  it("shows the saved name in an editable box and a Save button", () => {
    const out = html(screen());
    expect(out).toContain('value="Michiel"');
    expect(text(screen())).toContain("Save");
  });

  it("starts with no status message", () => {
    expect(text(screen())).not.toMatch(/Saved\.|Please enter/);
  });

  it("points to where the other settings live", () => {
    const t = text(screen());
    expect(t).toContain("Project Settings");
    expect(t).toContain("GitHub");
  });
});

describe("ProjectSettings screen", () => {
  const screen = () => createElement(ProjectSettings, { project, onProjectUpdated: noop, onClose: noop });

  it("shows this project's mod name and retry delay", () => {
    const out = html(screen());
    expect(out).toContain('value="My Afrikaans Mod"');
    expect(out).toContain('value="2000"');
  });

  it("offers the Ollama provider as selected, and a Save button", () => {
    const out = html(screen());
    expect(out).toMatch(/<option value="ollama"[^>]*selected/);
    expect(text(screen())).toContain("Save");
  });

  it("uses no text symbols (status marks are drawn icons)", () => {
    expect(text(screen())).not.toMatch(SYMBOLS);
  });
});

describe("New project wizard screen", () => {
  const screen = () => createElement(NewProjectWizard, { onProjectSelected: noop });

  it("lists every supported game", () => {
    const t = text(screen());
    for (const adapter of Object.values(GAME_ADAPTERS)) expect(t).toContain(adapter.displayName);
  });

  it("starts with the create button unavailable until the form is filled in", () => {
    expect(html(screen())).toMatch(/<button[^>]*disabled[^>]*>[^<]*Create/);
  });

  it("uses no text symbols", () => {
    expect(text(screen())).not.toMatch(SYMBOLS);
  });
});

describe("Page buttons (Previous / Next)", () => {
  const pager = (o: Partial<Parameters<typeof Pager>[0]>) =>
    html(createElement(Pager, { offset: 0, rowCount: 50, pageSize: 50, onPrevious: noop, onNext: noop, ...o }));

  it("first full page: Previous is greyed out, Next is available", () => {
    const out = pager({});
    expect(out).toMatch(/<button[^>]*disabled[^>]*>.*?Previous 50/);
    expect(out).not.toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Next 50/);
    expect(out).toContain("Strings 1–50");
  });

  it("a short last page greys out Next", () => {
    expect(pager({ offset: 100, rowCount: 7 })).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Next 50/);
  });

  it("an empty page still says so, and draws arrows as icons", () => {
    const out = pager({ offset: 50, rowCount: 0 });
    expect(out).toContain("No more strings here");
    expect(out.match(/<svg/g)?.length).toBe(2);
    expect(out).not.toMatch(SYMBOLS);
  });
});

describe("Batch progress and Stop", () => {
  const progress = (running: boolean) =>
    html(createElement(BatchProgress, { running, done: 12, total: 300, onStop: noop }));

  it("shows nothing when no batch is running", () => {
    expect(progress(false)).toBe("");
  });

  it("shows done/total and a Stop button while running", () => {
    const out = progress(true);
    expect(out).toContain("12");
    expect(out).toContain("300");
    expect(out).toContain("Stop");
  });
});
