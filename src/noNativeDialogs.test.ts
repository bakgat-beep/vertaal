import { describe, it, expect } from "vitest";

// Every question put to the person goes through the app's own styled dialog
// (confirm.ts). A browser pop-up (window.confirm / alert / prompt) looks
// different from the rest of the app - the Restore question once did - so none
// may come back.
const files = import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("no native browser pop-ups", () => {
  it("finds the source files to check", () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
  });

  it("no source file calls window.confirm, window.alert, window.prompt, alert() or prompt()", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(files)) {
      const code = text
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      if (/\bwindow\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(alert|prompt)\s*\(/m.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});