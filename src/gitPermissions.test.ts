import { describe, it, expect, vi, beforeEach } from "vitest";
import capabilitiesText from "../src-tauri/capabilities/default.json?raw";

// The app may only run the git commands listed, one by one, in
// src-tauri/capabilities/default.json. This file checks two things:
//  1. every command src/git.ts really runs is accepted by that list, exactly as
//     written (so Sync, Pull, Clone ... keep working), and
//  2. the list refuses what it must refuse (options that make git run other
//     programs, the GitHub token going anywhere but github.com, files outside the
//     Vertaal export files).
//
// "Accepted" is worked out with a copy of the rules Tauri's shell plugin uses
// (tauri-plugin-shell, scope.rs, read from its source):
//  - the entry is found by NAME, and the first entry with that name is the only one used;
//  - a fixed word in the list is what runs, whatever was asked for in that place;
//  - a {"validator": ...} place must match ^validator$ (the whole text);
//  - arguments beyond the end of the list are silently dropped.
// So a call is only really "as asked" when what would run equals what was asked.

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: createMock } }));

import { checkGitAvailable, initRepo, cloneRepo, setRemote, commitFiles, listUnsharedFiles, push, pull, tokenCredentialArgs } from "./git";

type Arg = string | { validator: string };
interface Entry {
  name: string;
  cmd: string;
  args: Arg[] | boolean;
}
const capabilities = JSON.parse(capabilitiesText) as { permissions: any[] };
const entries: Entry[] = capabilities.permissions
  .filter((p) => typeof p === "object" && p.identifier === "shell:allow-execute")
  .flatMap((p) => p.allow);

function whatWouldRun(name: string, asked: string[]): { ok: true; run: string[] } | { ok: false; why: string } {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return { ok: false, why: "no entry with this name" };
  if (entry.args === true) return { ok: true, run: asked };
  if (entry.args === false || !Array.isArray(entry.args)) return { ok: false, why: "no arguments allowed" };
  const run: string[] = [];
  for (let i = 0; i < entry.args.length; i++) {
    const a = entry.args[i];
    if (typeof a === "string") {
      run.push(a);
    } else {
      if (asked[i] === undefined) return { ok: false, why: `missing argument ${i}` };
      if (!new RegExp(`^${a.validator}$`).test(asked[i])) return { ok: false, why: `argument ${i} not allowed` };
      run.push(asked[i]);
    }
  }
  return { ok: true, run };
}
function isAcceptedAsAsked(name: string, asked: string[]): boolean {
  const r = whatWouldRun(name, asked);
  return r.ok && JSON.stringify(r.run) === JSON.stringify(asked);
}

const results: { code: number; stdout: string; stderr: string }[] = [];
function nextResults(...r: { code: number; stdout?: string; stderr?: string }[]) {
  results.length = 0;
  for (const x of r) results.push({ code: x.code, stdout: x.stdout ?? "", stderr: x.stderr ?? "" });
}
let calls: { name: string; args: string[] }[] = [];
beforeEach(() => {
  calls = [];
  createMock.mockReset().mockImplementation((name: string, args: string[]) => {
    calls.push({ name, args });
    return { execute: async () => results.shift() ?? { code: 0, stdout: "", stderr: "" } };
  });
  nextResults();
});

const OWN_FILE = "eu5-afrikaans-michi-van-wyk-3fa91c-vertaal-export.json";
const GITHUB = "https://github.com/someone/repo.git";

describe("the permission list itself", () => {
  it("has at least one entry, every entry runs git, and none allows 'any arguments'", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.cmd).toBe("git");
      expect(Array.isArray(e.args)).toBe(true);
    }
  });

  // The plugin only ever uses the FIRST entry with a given name.
  it("gives every entry its own name", () => {
    const names = entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no entry called run-git (the old 'any git command' entry)", () => {
    expect(entries.map((e) => e.name)).not.toContain("run-git");
  });

  // A pattern that Rust cannot read stops the whole app at start-up, so keep to
  // the plain features both JavaScript and Rust understand.
  it("uses only plain pattern features, and no top-level '|' (the plugin adds ^ and $ around the pattern)", () => {
    for (const e of entries)
      for (const a of e.args as Arg[])
        if (typeof a === "object") {
          expect(a.validator).not.toMatch(/\(\?[<=!]|\\[1-9]|\(\?i|\(\?m/);
          expect(a.validator.replace(/\(\?:[^()]*\)/g, "")).not.toContain("|");
        }
  });
});

describe("every git command the app runs is accepted exactly as written", () => {
  it("version, init, clone, remote, status", async () => {
    await checkGitAvailable();
    await initRepo("/repo");
    await cloneRepo(GITHUB, "/repo");
    nextResults({ code: 0, stdout: "origin" }, { code: 0 });
    await setRemote("/repo", GITHUB); // remote, then set-url
    nextResults({ code: 0, stdout: "" }, { code: 0 });
    await setRemote("/repo", GITHUB); // remote, then add
    await listUnsharedFiles("/repo", [OWN_FILE]);
    expect(calls.map((c) => c.name)).toEqual([
      "git-version",
      "git-init",
      "git-clone",
      "git-remote-list",
      "git-remote-set-url",
      "git-remote-list",
      "git-remote-add",
      "git-status",
    ]);
    for (const c of calls) expect(isAcceptedAsAsked(c.name, c.args), `${c.name} ${JSON.stringify(c.args)}`).toBe(true);
  });

  it("add and commit of the contributor's own export file, with and without a contributor name", async () => {
    await commitFiles("/repo", "Update afrikaans translations", "Michi van Wyk", [OWN_FILE]);
    await commitFiles("/repo", "Update afrikaans translations", null, [OWN_FILE]);
    await commitFiles("/repo", "msg", "Zoë O'Neil-Smith", ["eu5-afrikaans-zo-o-neil-smith-9ab12c-vertaal-export.json"]);
    expect(calls.map((c) => c.name)).toEqual(["git-add", "git-commit", "git-add", "git-commit", "git-add", "git-commit"]);
    for (const c of calls) expect(isAcceptedAsAsked(c.name, c.args), `${c.name} ${JSON.stringify(c.args)}`).toBe(true);
  });

  it("a project whose id has a space in it still gets its file committed", async () => {
    await commitFiles("/repo", "msg", "Bob", ["eu5_mod_my mod-afrikaans-vertaal-export.json"]);
    for (const c of calls) expect(isAcceptedAsAsked(c.name, c.args), `${c.name} ${JSON.stringify(c.args)}`).toBe(true);
  });

  it("push and pull, without a token", async () => {
    await push("/repo", null, GITHUB);
    await pull("/repo", null, GITHUB, "Michi van Wyk");
    await pull("/repo", null, "", null);
    expect(calls.map((c) => c.name)).toEqual(["git-push", "git-pull", "git-pull"]);
    for (const c of calls) expect(isAcceptedAsAsked(c.name, c.args), `${c.name} ${JSON.stringify(c.args)}`).toBe(true);
  });

  it("push and pull with the GitHub token (the four credential arguments come first)", async () => {
    await push("/repo", "ghp_secret", GITHUB);
    await pull("/repo", "ghp_secret", "https://github.com/a/b", "Michi");
    expect(calls.map((c) => c.name)).toEqual(["git-push-token", "git-pull-token"]);
    for (const c of calls) {
      expect(c.args.slice(0, 4)).toEqual(tokenCredentialArgs());
      expect(isAcceptedAsAsked(c.name, c.args), `${c.name} ${JSON.stringify(c.args)}`).toBe(true);
    }
  });

  it("the cancel-the-merge step after a conflict", async () => {
    nextResults({ code: 1, stdout: "CONFLICT (content): Merge conflict in a.json" }, { code: 0 });
    await pull("/repo", null, GITHUB, "Bob");
    expect(calls.map((c) => c.name)).toEqual(["git-pull", "git-merge-abort"]);
    for (const c of calls) expect(isAcceptedAsAsked(c.name, c.args)).toBe(true);
  });
});

describe("what the list refuses", () => {
  const identity = ["-c", "user.name=Bob", "-c", "user.email=bob@users.noreply.vertaal.local"];

  it("does not know the old run-git name", () => {
    expect(whatWouldRun("run-git", ["push", "origin", "HEAD"]).ok).toBe(false);
  });

  it("will not clone or add a remote from an address that is not https/http or git@host:path", () => {
    for (const bad of ["--upload-pack=calc.exe", "ext::sh -c calc", "file:///c/secrets", "ssh://-oProxyCommand=calc/x", "C:\\shared\\repo", "-c", "https://user:pw@github.com/a/b.git"]) {
      expect(whatWouldRun("git-clone", ["clone", bad, "."]).ok, bad).toBe(false);
      expect(whatWouldRun("git-remote-add", ["remote", "add", "origin", bad]).ok, bad).toBe(false);
      expect(whatWouldRun("git-remote-set-url", ["remote", "set-url", "origin", bad]).ok, bad).toBe(false);
    }
  });

  it("will not send the token anywhere but https://github.com", () => {
    const cred = tokenCredentialArgs();
    for (const bad of [
      "https://github.com.evil.com/a/b.git",
      "https://evil.com/github.com/a/b.git",
      "http://github.com/a/b.git",
      "https://github.com@evil.com/a/b.git",
      "https://github.com:8443/a/b.git",
      "git@github.com:a/b.git",
    ]) {
      expect(whatWouldRun("git-push-token", [...cred, "push", bad, "HEAD"]).ok, bad).toBe(false);
      expect(whatWouldRun("git-pull-token", [...cred, ...identity, "pull", "--no-rebase", "--allow-unrelated-histories", bad, "HEAD"]).ok, bad).toBe(false);
    }
    expect(isAcceptedAsAsked("git-push-token", [...cred, "push", GITHUB, "HEAD"])).toBe(true);
  });

  it("will only add or commit Vertaal export files in the folder itself", () => {
    for (const bad of ["notes.txt", "../x-vertaal-export.json", "sub/x-vertaal-export.json", "..\\x-vertaal-export.json", "--all", "-A", ".", "x-vertaal-export.json.exe", "secrets.env"]) {
      expect(whatWouldRun("git-add", ["add", "--", bad]).ok, bad).toBe(false);
      expect(whatWouldRun("git-commit", [...identity, "commit", "-m", "m", "--", bad]).ok, bad).toBe(false);
    }
  });

  // A fixed place always runs the written word, so an asked-for option that
  // would run another program is replaced, never passed on.
  it("replaces any other option put where a fixed word belongs, instead of passing it on", () => {
    const r1 = whatWouldRun("git-push", ["-c", "core.sshCommand=calc", "push", "origin", "HEAD"]);
    expect(r1.ok && r1.run).toEqual(["push", "origin", "HEAD"]);
    expect(isAcceptedAsAsked("git-push", ["-c", "core.sshCommand=calc", "push", "origin", "HEAD"])).toBe(false);
    expect(isAcceptedAsAsked("git-pull", [...identity, "pull", "--upload-pack=calc", "--allow-unrelated-histories", "origin", "HEAD"])).toBe(false);
    expect(isAcceptedAsAsked("git-status", ["status", "--porcelain", "-z", "-uall", "--output=x"])).toBe(false);
  });

  it("only lets the -c settings be user.name and user.email", () => {
    for (const evil of ["core.sshCommand=calc", "core.hooksPath=/tmp/x", "alias.x=!calc", "credential.helper=!calc", "core.fsmonitor=calc"]) {
      const asked = ["-c", evil, "-c", identity[3], "commit", "-m", "m", "--", OWN_FILE];
      expect(whatWouldRun("git-commit", asked).ok, evil).toBe(false);
    }
  });
});