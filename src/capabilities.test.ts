import { describe, it, expect } from "vitest";
import capabilitiesText from "../src-tauri/capabilities/default.json?raw";

// The app's permission list (src-tauri/capabilities/default.json) is only read
// when the app starts, so a mistake in it does not show up in any other test:
// the app either refuses to start or quietly blocks something. These checks
// catch the mistakes that are easy to make.

const capabilities = JSON.parse(capabilitiesText) as { permissions: any[] };
const sources = import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function scopeFor(identifier: string): any[] {
  return capabilities.permissions.filter((p) => typeof p === "object" && p.identifier === identifier);
}

describe("web access (http:default)", () => {
  const entries = scopeFor("http:default").flatMap((p) => p.allow as { url: string }[]);

  it("lists at least one address pattern", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  // Why: in these patterns "https://*" means "any host on the standard port
  // ONLY". An address with a port in it (Ollama's http://localhost:11434, a
  // LibreTranslate server on :5000, https://myserver:8443) is blocked unless the
  // pattern has a port part, written ":*". Checked against the same Rust code the
  // app uses (tauri-plugin-http 2.6.1 / urlpattern 0.3.0).
  it("every pattern has an explicit port part, so addresses with a port are covered", () => {
    for (const { url } of entries) expect(url).toMatch(/^https?:\/\/[^/]+:\*$/);
  });

  it("allows plain http only to this computer (localhost / 127.0.0.1), never to any host", () => {
    const http = entries.map((e) => e.url).filter((u) => u.startsWith("http://"));
    expect(http.sort()).toEqual(["http://127.0.0.1:*", "http://localhost:*"]);
  });

  it("still allows https to any host (the AI and translation services)", () => {
    expect(entries.map((e) => e.url)).toContain("https://*:*");
  });
});

describe("running programs (shell:allow-execute)", () => {
  const declared = scopeFor("shell:allow-execute").flatMap((p) => (p.allow as { name: string }[]).map((a) => a.name));

  // A program name that the code uses but the list does not declare fails only
  // when that feature is used, with an unhelpful "not allowed" message. Git
  // commands are named where they are run: runGit("git-push", ...). (That every
  // call is also accepted with exactly its arguments is checked in gitPermissions.test.ts.)
  it("every program name used with runGit or Command.create is declared", () => {
    const used = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const m of text.matchAll(/runGit\(\s*"([^"]+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/Command\.create\(\s*"([^"]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(declared).toContain(name);
    expect(declared).not.toContain("run-git");
  });
});