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

function Probe() {
  api = useBatchTranslation({
    currentProject: project,
    rows: [],
    viewMode: "all" as any,
    offset: 0,
    categoryFilter: null,
    subcategoryFilter: null,
    loadPage: async () => {},
    refreshCounts: async () => {},
    setStatus: (m: string) => status.push(m),
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