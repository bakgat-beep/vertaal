import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the file system and the database, so these tests
// check exactly WHICH files get made/replaced/removed and in WHAT order.
const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  calls: [] as string[],
  scrubFails: false,
  copyFailsTo: null as string | null,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => h.files.has(p),
  remove: async (p: string) => {
    if (!h.files.has(p)) throw new Error(`no such file: ${p}`);
    h.files.delete(p);
  },
  copyFile: async (from: string, to: string) => {
    if (h.copyFailsTo === to) throw new Error("file is in use");
    if (!h.files.has(from)) throw new Error(`no such file: ${from}`);
    h.calls.push(`copy:${from}->${to}`);
    h.files.set(to, h.files.get(from)!);
  },
  mkdir: async () => {},
  readDir: async (dir: string) =>
    [...h.files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes("/")).map((k) => ({ name: k.slice(dir.length + 1) })),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: async () => "/cfg",
  appDataDir: async () => "/data",
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async (url: string) => {
      const path = `/cfg/${url.replace("sqlite:", "")}`;
      return {
        execute: async (q: string) => {
          h.calls.push(`scratch:${q}`);
          if (h.scrubFails && q.startsWith("UPDATE")) throw new Error("scrub failed");
        },
        select: async (q: string) => {
          const content = h.files.get(path);
          if (content === "GARBAGE") throw new Error("file is not a database");
          if (q.includes("sqlite_master")) return ["projects", "strings", "translations"].map((name) => ({ name }));
          if (q.includes("integrity_check")) return [{ integrity_check: content === "DAMAGED" ? "row 3 missing" : "ok" }];
          return [];
        },
        close: async () => {
          h.calls.push("scratch:close");
        },
      };
    },
  },
}));

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: string) => {
      h.calls.push(`live:${q}`);
      const m = q.match(/VACUUM INTO '(.*)'/);
      if (m) h.files.set(m[1], "LIVE-COPY");
    },
  }),
}));

import { backupDatabase, restoreDatabase, applyPendingRestore } from "./backup";

beforeEach(() => {
  h.files.clear();
  h.calls.length = 0;
  h.scrubFails = false;
  h.copyFailsTo = null;
  h.files.set("/cfg/vertaal.db", "MY-CURRENT-DATA");
});

describe("backupDatabase", () => {
  it("removes saved secrets from the copy BEFORE it is placed at the destination", async () => {
    await backupDatabase("/docs/my-backup.db");
    const scrubA = h.calls.findIndex((c) => c === "scratch:UPDATE provider_credentials SET api_key = NULL");
    const scrubB = h.calls.findIndex((c) => c === "scratch:UPDATE user_settings SET github_token = NULL");
    const placed = h.calls.findIndex((c) => c.endsWith("->/docs/my-backup.db"));
    expect(scrubA).toBeGreaterThan(-1);
    expect(scrubB).toBeGreaterThan(-1);
    expect(placed).toBeGreaterThan(Math.max(scrubA, scrubB));
    expect(h.files.get("/docs/my-backup.db")).toBe("LIVE-COPY");
  });

  it("leaves no work files behind", async () => {
    await backupDatabase("/docs/my-backup.db");
    expect([...h.files.keys()].filter((k) => k.includes("work"))).toEqual([]);
  });

  it("if removing the secrets fails, no backup is produced and an existing file is left alone", async () => {
    h.files.set("/docs/my-backup.db", "OLDER-BACKUP");
    h.scrubFails = true;
    await expect(backupDatabase("/docs/my-backup.db")).rejects.toThrow("scrub failed");
    expect(h.files.get("/docs/my-backup.db")).toBe("OLDER-BACKUP");
    expect([...h.files.keys()].filter((k) => k.includes("work"))).toEqual([]);
  });

  it("automatic backups keep 5 routine ones and 2 safety ones, independently", async () => {
    for (let i = 1; i <= 6; i++) h.files.set(`/data/backups/vertaal-backup-2026-01-0${i}T00-00-00-000Z.db`, "x");
    for (let i = 1; i <= 3; i++) h.files.set(`/data/backups/vertaal-backup-2026-01-0${i}T00-00-00-000Z-pre-restore.db`, "x");
    await backupDatabase();
    const names = [...h.files.keys()].filter((k) => k.startsWith("/data/backups/")).map((k) => k.split("/").pop()!);
    expect(names.filter((n) => !n.endsWith("-pre-restore.db"))).toHaveLength(5);
    expect(names.filter((n) => n.endsWith("-pre-restore.db"))).toHaveLength(2);
    // the oldest of each kind went first
    expect(names.some((n) => n.startsWith("vertaal-backup-2026-01-01T00-00-00-000Z.db"))).toBe(false);
    expect(names.some((n) => n === "vertaal-backup-2026-01-01T00-00-00-000Z-pre-restore.db")).toBe(false);
  });
});

describe("restoreDatabase", () => {
  it("rejects a file that is not a database, and changes nothing", async () => {
    h.files.set("/docs/notes.db", "GARBAGE");
    await expect(restoreDatabase("/docs/notes.db")).rejects.toThrow("not a valid Vertaal backup");
    expect(h.files.has("/cfg/vertaal-restore-pending.db")).toBe(false);
    expect([...h.files.keys()].some((k) => k.startsWith("/data/backups/"))).toBe(false);
    expect(h.files.get("/cfg/vertaal.db")).toBe("MY-CURRENT-DATA");
    expect(h.files.has("/cfg/vertaal-backup-work.db")).toBe(false);
  });

  it("rejects a damaged backup, and changes nothing", async () => {
    h.files.set("/docs/damaged.db", "DAMAGED");
    await expect(restoreDatabase("/docs/damaged.db")).rejects.toThrow("damaged");
    expect(h.files.has("/cfg/vertaal-restore-pending.db")).toBe(false);
  });

  it("with a good backup: makes a safety backup and stages the restore — the live database is NOT touched", async () => {
    h.files.set("/docs/good.db", "VALID-BACKUP");
    const safety = await restoreDatabase("/docs/good.db");
    expect(safety).toMatch(/^\/data\/backups\/vertaal-backup-.*-pre-restore\.db$/);
    expect(h.files.get(safety)).toBe("LIVE-COPY");
    expect(h.files.get("/cfg/vertaal-restore-pending.db")).toBe("VALID-BACKUP");
    expect(h.files.get("/cfg/vertaal.db")).toBe("MY-CURRENT-DATA"); // untouched while the app is running
    expect(h.files.get("/docs/good.db")).toBe("VALID-BACKUP"); // the user's own file is untouched
  });

  it("without a safety backup there is no restore", async () => {
    h.files.set("/docs/good.db", "VALID-BACKUP");
    h.scrubFails = true;
    await expect(restoreDatabase("/docs/good.db")).rejects.toThrow("scrub failed");
    expect(h.files.has("/cfg/vertaal-restore-pending.db")).toBe(false);
  });
});

describe("applyPendingRestore (runs at startup, before the database is opened)", () => {
  it("does nothing when no restore is waiting", async () => {
    expect(await applyPendingRestore()).toEqual({ status: "none" });
    expect(h.files.get("/cfg/vertaal.db")).toBe("MY-CURRENT-DATA");
  });

  it("puts the backup in place and clears the old database's leftover side files", async () => {
    h.files.set("/cfg/vertaal-restore-pending.db", "VALID-BACKUP");
    h.files.set("/cfg/vertaal.db-wal", "stale");
    h.files.set("/cfg/vertaal.db-shm", "stale");
    expect(await applyPendingRestore()).toEqual({ status: "applied" });
    expect(h.files.get("/cfg/vertaal.db")).toBe("VALID-BACKUP");
    expect(h.files.has("/cfg/vertaal.db-wal")).toBe(false);
    expect(h.files.has("/cfg/vertaal.db-shm")).toBe(false);
    expect(h.files.has("/cfg/vertaal-restore-pending.db")).toBe(false);
  });

  it("if it cannot replace the database, keeps the pending file (to retry next launch) and leaves the current data alone", async () => {
    h.files.set("/cfg/vertaal-restore-pending.db", "VALID-BACKUP");
    h.files.set("/cfg/vertaal.db-wal", "recent-writes");
    h.copyFailsTo = "/cfg/vertaal.db";
    const result = await applyPendingRestore();
    expect(result.status).toBe("failed");
    expect(h.files.has("/cfg/vertaal-restore-pending.db")).toBe(true);
    expect(h.files.get("/cfg/vertaal.db")).toBe("MY-CURRENT-DATA");
    expect(h.files.has("/cfg/vertaal.db-wal")).toBe(true); // recent writes are not thrown away
  });
});