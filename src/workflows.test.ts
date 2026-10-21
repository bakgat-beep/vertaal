import { describe, it, expect } from "vitest";
// The two GitHub workflow files, read as plain text (Vite's "?raw"), so these
// tests can check how a release is gated without running GitHub.
import checkYml from "../.github/workflows/check.yml?raw";
import releaseYml from "../.github/workflows/release.yml?raw";

// The file without its comment lines, so a comment that mentions a command
// can never count as the command itself.
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

// The text of one job: from its name up to the next job (or the end).
function job(text: string, name: string): string {
  const start = text.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `no job called "${name}"`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n  [\w-]+:\s*\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the release is gated on the checks", () => {
  const release = code(releaseYml);
  const check = code(checkYml);

  it("check.yml can be called by another workflow, and still runs on pushes to main and pull requests", () => {
    expect(check).toMatch(/^\s+workflow_call:/m);
    expect(check).toMatch(/^\s+push:\s*\n\s+branches: \[main\]/m);
    expect(check).toMatch(/^\s+pull_request:/m);
  });

  it("check.yml runs the type-check, the tests and the security audit", () => {
    expect(check).toContain("npx tsc --noEmit");
    expect(check).toContain("npm test");
    expect(check).toContain("npm audit --omit=dev");
    expect(check).toContain("npm ci");
  });

  it("release.yml runs those same checks (by calling check.yml) in a job of its own", () => {
    expect(job(release, "check")).toMatch(/uses: \.\/\.github\/workflows\/check\.yml\s*$/m);
  });

  it("the installer build waits for that job, so it never starts if a check fails", () => {
    expect(job(release, "build")).toMatch(/^\s+needs: check\s*$/m);
  });

  it("nothing in the build job tries to run regardless of the checks (no always() / failure overrides)", () => {
    expect(job(release, "build")).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
  });

  it("the check job calls the file from the same repository by plain path, so it is the tagged commit's own copy", () => {
    expect(job(release, "check")).not.toMatch(/uses: .*@/);
  });

  it("release.yml installs with npm ci (the committed lock file), never npm install", () => {
    expect(release).toMatch(/run: npm ci\s*$/m);
    expect(release).not.toMatch(/npm install/);
  });

  it("the release still only publishes for a version tag, as a draft", () => {
    expect(release).toMatch(/tags:\s*\n\s+- "v\*"/);
    expect(release).toContain("releaseDraft: true");
  });
});