import { describe, it, expect, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: createMock } }));

import {
  checkRemoteUrl,
  cloneRepo,
  commitFiles,
  listUnsharedFiles,
  pull,
  push,
  setRemote,
  tokenCanBeSentTo,
  TOKEN_ENV_NAME,
} from "./git";

function queueResults(results: { code: number; stdout: string; stderr: string }[]) {
  const queue = [...results];
  createMock.mockImplementation(() => ({
    execute: async () => queue.shift() ?? { code: 1, stdout: "", stderr: "no more queued results" },
  }));
}

describe("commitFiles", () => {
  it("commits with an identity taken from the contributor's name, never the machine's own git config", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "", stderr: "" }, // add -- file
      { code: 0, stdout: "[main abc123] msg", stderr: "" }, // commit
    ]);
    await commitFiles("/repo", "Update afrikaans translations", "Michi van Wyk", ["a.json"]);

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
    await commitFiles("/repo", "msg", null, ["a.json"]);
    const commitArgs = createMock.mock.calls[1][1] as string[];
    expect(commitArgs).toContain("user.name=Vertaal User");
    expect(commitArgs).toContain("user.email=vertaal-user@users.noreply.vertaal.local");
  });
});

describe("commitFiles when staging fails", () => {
  it("stops and reports the error instead of committing anyway", async () => {
    createMock.mockReset();
    queueResults([
      { code: 128, stdout: "", stderr: "fatal: Unable to create index.lock" }, // add -- file
      { code: 0, stdout: "[main abc] should never run", stderr: "" }, // commit
    ]);
    const result = await commitFiles("/repo", "msg", "Michi", ["a.json"]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("index.lock");
    expect(createMock).toHaveBeenCalledTimes(1); // the commit was never attempted
  });
});

describe("commitFiles shares ONLY the files it is given", () => {
  it("stages the named file with 'add --', never 'add .'", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    await commitFiles("/repo", "msg", "Bob", ["eu5-afrikaans-bob-vertaal-export.json"]);
    expect(createMock.mock.calls[0][1]).toEqual(["add", "--", "eu5-afrikaans-bob-vertaal-export.json"]);
    for (const call of createMock.mock.calls) expect(call[1]).not.toContain(".");
  });

  it("commits only those files, even if something else was already staged in the folder", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    await commitFiles("/repo", "my message", "Bob", ["a.json"]);
    const commitArgs = createMock.mock.calls[1][1] as string[];
    expect(commitArgs.slice(-4)).toEqual(["-m", "my message", "--", "a.json"]);
  });

  it("a file name that starts with a dash cannot be mistaken for a Git option", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    await commitFiles("/repo", "msg", "Bob", ["--all"]);
    expect(createMock.mock.calls[0][1]).toEqual(["add", "--", "--all"]);
  });

  it("refuses to run at all when no file is named (so it can never fall back to everything)", async () => {
    createMock.mockReset();
    queueResults([]);
    const result = await commitFiles("/repo", "msg", "Bob", []);
    expect(result.ok).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("listUnsharedFiles", () => {
  it("lists files in the folder that are not shared, leaving out the ones we do share", async () => {
    createMock.mockReset();
    queueResults([
      { code: 0, stdout: "?? notes.txt\0 M eu5-afrikaans-bob-vertaal-export.json\0?? secrets.env\0", stderr: "" },
    ]);
    const list = await listUnsharedFiles("/repo", ["eu5-afrikaans-bob-vertaal-export.json"]);
    expect(list).toEqual(["notes.txt", "secrets.env"]);
    expect(createMock.mock.calls[0][1]).toEqual(["status", "--porcelain", "-z", "-uall"]);
  });

  it("returns an empty list when Git cannot say (the warning is a courtesy, never a blocker)", async () => {
    createMock.mockReset();
    queueResults([{ code: 128, stdout: "", stderr: "fatal: not a git repository" }]);
    expect(await listUnsharedFiles("/repo", ["a.json"])).toEqual([]);
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

describe("checkRemoteUrl: no passwords written into the web address", () => {
  it.each([
    "https://github.com/a/b.git",
    "https://gitlab.com/a/b.git",
    "git@github.com:a/b.git", // the "git@" form is a normal login name, not a password
    "  https://github.com/a/b.git  ",
  ])("accepts %s", (url) => expect(checkRemoteUrl(url)).toBeNull());

  it.each([
    "https://user:pw@github.com/a/b.git",
    "https://ghp_SuperSecretToken123@github.com/a/b.git", // a token used as the "user name" is still a password
    "http://user:pw@example.com/a/b.git",
    "https://user@example.com/a/b.git",
  ])("refuses %s", (url) => {
    const problem = checkRemoteUrl(url);
    expect(problem).toMatch(/password|token|user name/i);
    expect(problem).not.toContain("SuperSecretToken123"); // the message itself never repeats the secret
  });
});

describe("tokenCanBeSentTo: only github.com over https", () => {
  it.each([
    "https://github.com/a/b.git",
    "https://GitHub.com/a/b.git",
    "https://github.com:443/a/b.git",
  ])("yes: %s", (url) => expect(tokenCanBeSentTo(url)).toBe(true));

  it.each([
    "http://github.com/a/b.git", // not encrypted
    "https://github.com.evil.com/a/b.git", // starts like GitHub, is not
    "https://evil.com/github.com/a/b.git",
    "https://notgithub.com/a/b.git",
    "https://www.github.com/a/b.git",
    "https://github.com:8443/a/b.git",
    "https://github.com./a/b.git",
    "https://github.com@evil.com/a/b.git",
    "https://user:pw@github.com/a/b.git",
    "git@github.com:a/b.git",
    "https://gitlab.com/a/b.git",
    "",
    "not a url",
  ])("no: %j", (url) => expect(tokenCanBeSentTo(url)).toBe(false));
});

describe("the token only goes where it belongs", () => {
  const SECRET = "ghp_SuperSecretToken123";

  it("push to another site: the token is NOT used or passed on", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "ok", stderr: "" }]);
    await push("/repo", SECRET, "https://evil.example.com/a/b.git");
    const args = createMock.mock.calls[0][1] as string[];
    const opts = createMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(args).toEqual(["push", "origin", "HEAD"]);
    expect(args.join(" ")).not.toContain("evil.example.com");
    expect(opts.env[TOKEN_ENV_NAME]).toBeUndefined();
  });

  it("pull from a look-alike address: the token is NOT used", async () => {
    createMock.mockReset();
    queueResults([{ code: 0, stdout: "Already up to date.", stderr: "" }]);
    await pull("/repo", SECRET, "https://github.com.evil.com/a/b.git", "Bob");
    const opts = createMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(opts.env[TOKEN_ENV_NAME]).toBeUndefined();
  });

  it("when the token was held back and Git then fails to log in, the message says why", async () => {
    createMock.mockReset();
    queueResults([{ code: 128, stdout: "", stderr: "fatal: Authentication failed" }]);
    const r = await push("/repo", SECRET, "https://gitlab.com/a/b.git");
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/token was not used/i);
    expect(r.output).toMatch(/github\.com/);
  });

  it("push/pull refuse an address with a password in it, without running Git at all", async () => {
    createMock.mockReset();
    queueResults([]);
    const a = await push("/repo", null, "https://user:pw@github.com/a/b.git");
    const b = await pull("/repo", SECRET, "https://user:pw@github.com/a/b.git", "Bob");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(a.output + b.output).not.toContain("pw@");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cloneRepo and setRemote refuse an address with a password in it", async () => {
    createMock.mockReset();
    queueResults([]);
    const a = await cloneRepo("https://user:pw@github.com/a/b.git", "/dest");
    const b = await setRemote("/repo", "https://ghp_x@github.com/a/b.git");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("addresses with a password are hidden in anything Git prints, for http:// too", () => {
  it.each([
    ["https", "https://user:hunter2@example.com/a/b.git"],
    ["http", "http://user:hunter2@example.com/a/b.git"],
  ])("%s", async (_n, leaky) => {
    createMock.mockReset();
    queueResults([{ code: 128, stdout: "", stderr: `fatal: unable to access '${leaky}': could not resolve host` }]);
    const r = await push("/repo", null, "https://example.com/a/b.git"); // Git itself echoes the address saved earlier
    expect(r.ok).toBe(false);
    expect(r.output).not.toContain("hunter2");
    expect(r.output).toContain("***");
  });
});