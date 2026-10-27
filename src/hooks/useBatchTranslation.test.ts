import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Stage 7: the batch runs. The hook is rendered once on the server side (no
// browser needed) just to get at its functions; its screen state is not used,
// the behaviour checked here is what the functions do.
//   - Starting the overnight batch twice (a second click during the backup)
//     must not start a second run.
//   - Pressing Stop during the backup must still stop the run.
//   - A database error while starting must end the run cleanly, not leave the
//     buttons stuck or throw.

const backupGate = { release: () => {}, wait: Promise.resolve() as Promise<void> };
const mocks = vi.hoisted(() => ({
  backupDatabase: vi.fn(),
  getDb: vi.fn(),
  translateWithRetry: vi.fn(),
  loadGlossaryTerms: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../backup", () => ({ backupDatabase: mocks.backupDatabase }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../translate", () => ({ translateWithRetry: mocks.translateWithRetry }));
vi.mock("../glossary", () => ({ loadGlossaryTerms: mocks.loadGlossaryTerms }));
vi.mock("../confirm", () => ({ confirm: mocks.confirm }));

import { useBatchTranslation } from "./useBatchTranslation";

const project = { game_id: "eu5", target_language: "afrikaans" } as any;
let status: string[] = [];
let api: ReturnType<typeof useBatchTranslation>;
let selectRows: any[] = [];
// What the screen is doing, as far as the hook can tell. Tests change these.
let pageRows: any[] = [];
let unsavedTyping = false;
let loadPageCalls = 0;
// Redrawing the list writes its own message (as the real loadPage does).
const loadPage = async () => {
  loadPageCalls++;
  status.push("Showing strings 1-1 · All strings");
};

function Probe() {
  api = useBatchTranslation({
    currentProject: project,
    rows: pageRows,
    viewMode: "all" as any,
    offset: 0,
    categoryFilter: null,
    subcategoryFilter: null,
    loadPage,
    refreshCounts: async () => {},
    setStatus: (m: string) => status.push(m),
    hasUnsavedEdits: () => unsavedTyping,
  });
  return null;
}

function holdBackup() {
  backupGate.wait = new Promise<void>((resolve) => {
    backupGate.release = resolve;
  });
}

beforeEach(() => {
  status = [];
  pageRows = [];
  unsavedTyping = false;
  loadPageCalls = 0;
  selectRows = [{ key: "k1", game_id: "eu5", source_text: "Hello", file_path: "f.yml" }];
  mocks.backupDatabase.mockReset().mockImplementation(() => backupGate.wait);
  mocks.getDb.mockReset().mockImplementation(async () => ({
    select: async () => {
      const rows = selectRows;
      selectRows = [];
      return rows;
    },
    execute: async () => ({ rowsAffected: 1 }),
  }));
  mocks.translateWithRetry.mockReset().mockResolvedValue({ ok: true, attempts: 1 });
  mocks.loadGlossaryTerms.mockReset().mockResolvedValue([]);
  mocks.confirm.mockReset().mockResolvedValue(true);
  backupGate.wait = Promise.resolve();
  renderToString(createElement(Probe));
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the overnight batch", () => {
  it("a second start during the backup is refused, and only one run happens", async () => {
    holdBackup();
    const first = api.batchTranslateOvernight();
    await tick();
    await api.batchTranslateOvernight(); // the second click
    expect(mocks.backupDatabase).toHaveBeenCalledTimes(1);
    expect(status.join("\n")).toMatch(/already running/i);
    backupGate.release();
    await first;
    expect(mocks.translateWithRetry).toHaveBeenCalledTimes(1);
  });

  it("can be started again once the first run has finished", async () => {
    await api.batchTranslateOvernight();
    selectRows = [{ key: "k2", game_id: "eu5", source_text: "Hi", file_path: "f.yml" }];
    await api.batchTranslateOvernight();
    expect(mocks.backupDatabase).toHaveBeenCalledTimes(2);
  });

  it("Stop pressed during the backup still stops the run", async () => {
    holdBackup();
    const run = api.batchTranslateOvernight();
    await tick();
    api.stopBatch();
    backupGate.release();
    await run;
    expect(mocks.translateWithRetry).not.toHaveBeenCalled();
  });

  it("a database error while starting ends the run cleanly, says so, and does not block the next run", async () => {
    mocks.getDb.mockRejectedValueOnce(new Error("database is locked"));
    await expect(api.batchTranslateOvernight()).resolves.toBeUndefined();
    expect(status.join("\n")).toMatch(/database is locked/);
    await api.batchTranslateOvernight(); // not stuck
    expect(mocks.backupDatabase).toHaveBeenCalledTimes(2);
  });
});

describe("other batch actions respect a run in progress", () => {
  it("re-running AI drafts is refused while the overnight batch is backing up", async () => {
    holdBackup();
    const overnight = api.batchTranslateOvernight();
    await tick();
    await api.batchRerunAIUnconfirmed();
    expect(status.join("\n")).toMatch(/already running/i);
    expect(mocks.confirm).not.toHaveBeenCalled();
    backupGate.release();
    await overnight;
  });

  it("confirming code-only strings reports a database failure instead of throwing", async () => {
    mocks.getDb.mockRejectedValueOnce(new Error("disk I/O error"));
    await expect(api.batchConfirmCodeOnly()).resolves.toBeUndefined();
    expect(status.join("\n")).toMatch(/disk I\/O error/);
  });
});


describe("a failed safety backup (the overnight batch and the AI re-run)", () => {
  it("overnight: if the backup fails and you cancel, nothing is translated and the buttons are free again", async () => {
    mocks.backupDatabase.mockRejectedValueOnce(new Error("disk full"));
    mocks.confirm.mockResolvedValueOnce(false);
    await api.batchTranslateOvernight();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[0][0]).toMatch(/disk full/);
    expect(mocks.translateWithRetry).not.toHaveBeenCalled();
    expect(status[status.length - 1]).toMatch(/Cancelled.*backup failed/i);
    // not stuck:
    mocks.backupDatabase.mockResolvedValue(undefined);
    await api.batchTranslateOvernight();
    expect(mocks.translateWithRetry).toHaveBeenCalledTimes(1);
  });

  it("overnight: if the backup fails and you choose to carry on, the run goes ahead", async () => {
    mocks.backupDatabase.mockRejectedValueOnce(new Error("disk full"));
    mocks.confirm.mockResolvedValueOnce(true);
    await api.batchTranslateOvernight();
    expect(mocks.translateWithRetry).toHaveBeenCalledTimes(1);
  });

  it("overnight: a backup that works asks nothing", async () => {
    mocks.backupDatabase.mockResolvedValueOnce(undefined);
    await api.batchTranslateOvernight();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("re-run: if the backup fails and you cancel, no AI draft is replaced", async () => {
    mocks.backupDatabase.mockRejectedValueOnce(new Error("disk full"));
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // 1st: replace drafts? 2nd: carry on without backup?
    await api.batchRerunAIUnconfirmed();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.translateWithRetry).not.toHaveBeenCalled();
    expect(status[status.length - 1]).toMatch(/Cancelled.*backup failed/i);
  });
});

describe("what happens to the list on screen when a batch ends", () => {
  const untranslatedRow = { key: "k1", game_id: "eu5", source_text: "Hello", status: "untranslated", flagged: 0 };

  it("is redrawn when nothing has changed", async () => {
    pageRows = [untranslatedRow];
    renderToString(createElement(Probe));
    await api.batchTranslatePage();
    expect(loadPageCalls).toBe(1);
  });

  it("is NOT redrawn over typing that has not been saved, and the message says why", async () => {
    pageRows = [untranslatedRow];
    unsavedTyping = true;
    renderToString(createElement(Probe));
    await api.batchTranslatePage();
    expect(loadPageCalls).toBe(0);
    expect(status[status.length - 1]).toMatch(/not refreshed.*not saved yet/i);
  });

  it("the overnight batch leaves the list alone too while you have unsaved typing", async () => {
    unsavedTyping = true;
    mocks.backupDatabase.mockResolvedValue(undefined);
    await api.batchTranslateOvernight();
    expect(loadPageCalls).toBe(0);
    expect(status[status.length - 1]).toMatch(/Overnight batch finished/);
    expect(status[status.length - 1]).toMatch(/not refreshed/i);
  });

  it("the reason a page batch stopped is not wiped out by the redraw", async () => {
    pageRows = [untranslatedRow];
    renderToString(createElement(Probe));
    mocks.translateWithRetry.mockResolvedValue({ ok: false, error: "bad key", attempts: 1, permanent: true });
    await api.batchTranslatePage();
    expect(loadPageCalls).toBe(1);
    expect(status[status.length - 1]).toMatch(/Stopped: bad key/);
  });
});