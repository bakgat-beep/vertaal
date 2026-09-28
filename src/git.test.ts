import { describe, it, expect, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: createMock } }));

import { commitAll, pull } from "./git";

function queueResults(results: { code: number; stdout: string; stderr: string }[]) {
  const queue = [...results];
  createMock.mockImplementation(() => ({
    execute: async () => queue.shift() ?? { code: 1, stdout: "", stderr: "no more queued results" },
  }));
}

describe("commitAll", () => {
  it("commits with an identity taken from the contributor's name, never the machine's own git config", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "", stderr: "" }, // add .
      { code: 0, stdout: "[main abc123] msg", stderr: "" }, // commit
    ]);
    await commitAll("/repo", "Update afrikaans translations", "Michi van Wyk");

    const commitArgs = createMock.mock.calls[1][1] as string[];
    expect(commitArgs.slice(0, 6)).toEqual([
      "-c",
      "user.name=Michi van Wyk",
      "-c",
      "user.email=michi-van-wyk@users.noreply.vertaal.local",
      "commit",
      "-m",
    ]);
  });

  it("falls back to a generic identity when no contributor name is set, rather than failing", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    await commitAll("/repo", "msg", null);
    const commitArgs = createMock.mock.calls[1][1] as string[];
    expect(commitArgs).toContain("user.name=Vertaal User");
    expect(commitArgs).toContain("user.email=vertaal-user@users.noreply.vertaal.local");
  });
});

describe("pull", () => {
  it("uses --no-rebase, --allow-unrelated-histories, HEAD, and an identity (a merge can create a commit), and passes a clean pull straight through", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "Already up to date.", stderr: "" }]);
    const result = await pull("/repo", null, "https://github.com/a/b.git", "Bob");
    expect(result).toEqual({ ok: true, output: "Already up to date." });
    expect(createMock.mock.calls[0][1]).toEqual([
      "-c",
      "user.name=Bob",
      "-c",
      "user.email=bob@users.noreply.vertaal.local",
      "pull",
      "--no-rebase",
      "--allow-unrelated-histories",
      "origin",
      "HEAD",
    ]);
  });

  it("treats a completely empty shared repository (nobody has synced yet) as success, not a failure", async () => {
    createMock.mockReset();
    queueResults([{ code: 1, stdout: "", stderr: "fatal: couldn't find remote ref HEAD" }]);
    const result = await pull("/repo", null, "https://github.com/a/b.git", "Bob");
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/Nothing to pull yet/);
    expect(createMock.mock.calls).toHaveLength(1); // no merge --abort — there was never a merge in progress
  });

  it("on a real conflict, safely aborts the merge instead of leaving it half-done", async () => {
    createMock.mockReset();
    queueResults([
      {
        code: 1,
        stdout: "Auto-merging eu5-afrikaans-alex-vertaal-export.json",
        stderr: "CONFLICT (content): Merge conflict in eu5-afrikaans-alex-vertaal-export.json",
      },
      { code: 0, stdout: "", stderr: "" }, // merge --abort
    ]);
    const result = await pull("/repo", null, "https://github.com/a/b.git", "Bob");
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/safely cancelled/);
    expect(result.output).toMatch(/same name/);
    expect(createMock.mock.calls).toHaveLength(2);
    expect(createMock.mock.calls[1][1]).toEqual(["merge", "--abort"]);
  });

  it("on an ordinary failure (no conflict), does NOT run merge --abort", async () => {
    createMock.mockReset();
    queueResults([{ code: 1, stdout: "", stderr: "fatal: could not read from remote repository." }]);
    const result = await pull("/repo", null, "https://github.com/a/b.git", "Bob");
    expect(result.ok).toBe(false);
    expect(result.output).toBe("fatal: could not read from remote repository.");
    expect(createMock.mock.calls).toHaveLength(1);
  });
});