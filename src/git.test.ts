import { describe, it, expect, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: createMock } }));

import { commitAll, pull, push, TOKEN_ENV_NAME } from "./git";

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

describe("commitAll when staging fails", () => {
  it("stops and reports the error instead of committing anyway", async () => {
    createMock.mockReset();
    queueResults([
      { code: 128, stdout: "", stderr: "fatal: Unable to create index.lock" }, // add .
      { code: 0, stdout: "[main abc] should never run", stderr: "" }, // commit
    ]);
    const result = await commitAll("/repo", "msg", "Michi");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("index.lock");
    expect(createMock).toHaveBeenCalledTimes(1); // the commit was never attempted
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
describe("the GitHub token never goes into the command", () => {
  const SECRET = "ghp_SuperSecretToken123";
  const URL = "https://github.com/a/b.git";

  it("push: the token travels in the environment, not in any command-line argument", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "ok", stderr: "" }]);
    await push("/repo", SECRET, URL);
    const args = createMock.mock.calls[0][1] as string[];
    const opts = createMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(args.join(" ")).not.toContain(SECRET);
    expect(opts.env[TOKEN_ENV_NAME]).toBe(SECRET);
    expect(opts.env.GIT_TERMINAL_PROMPT).toBe("0");
    // The address is the plain one, with no password written into it.
    expect(args).toContain(URL);
    expect(args.slice(-2)).toEqual([URL, "HEAD"]);
  });

  it("push: clears other credential helpers first, then adds ours that reads the variable", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "", stderr: "" }]);
    await push("/repo", SECRET, URL);
    const args = createMock.mock.calls[0][1] as string[];
    expect(args.slice(0, 3)).toEqual(["-c", "credential.helper=", "-c"]);
    expect(args[3]).toContain(`$${TOKEN_ENV_NAME}`);
    expect(args[3]).toContain("username=x-access-token");
  });

  it("pull: the token is not in the arguments either", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "Already up to date.", stderr: "" }]);
    await pull("/repo", SECRET, URL, "Bob");
    const args = createMock.mock.calls[0][1] as string[];
    const opts = createMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(args.join(" ")).not.toContain(SECRET);
    expect(opts.env[TOKEN_ENV_NAME]).toBe(SECRET);
  });

  it("without a token, no token variable is set and no helper is added", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "", stderr: "" }]);
    await push("/repo", null, URL);
    const args = createMock.mock.calls[0][1] as string[];
    const opts = createMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(args).toEqual(["push", "origin", "HEAD"]);
    expect(opts.env[TOKEN_ENV_NAME]).toBeUndefined();
  });

  it("if Git echoes the token back in an error, it is hidden before being shown", async () => {
    createMock.mockReset();
    queueResults([{ code: 128, stdout: "", stderr: `fatal: bad credentials ${SECRET} rejected` }]);
    const r = await push("/repo", SECRET, URL);
    expect(r.ok).toBe(false);
    expect(r.output).not.toContain(SECRET);
    expect(r.output).toContain("***");
  });
});