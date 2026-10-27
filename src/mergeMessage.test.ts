import { describe, it, expect } from "vitest";
import { describeMerge } from "./mergeMessage";

const counts = {
  applied: 5,
  skippedLocalNewer: 4,
  skippedKeptYourWork: 3,
  skippedNoLocalString: 2,
  flaggedForGameCodes: 0,
  glossaryAdded: 7,
  glossaryUpdated: 6,
};

describe("describeMerge", () => {
  it("reports every number, including the AI-draft skips", () => {
    const text = describeMerge(counts);
    expect(text).toContain("5 applied");
    expect(text).toContain("4 skipped (your version was newer)");
    expect(text).toContain("3 skipped (an AI draft would have replaced your own work)");
    expect(text).toContain("2 skipped (string not found locally)");
    expect(text).toContain("7 glossary term(s) added, 6 updated");
  });

  it("says nothing about game codes when none were flagged", () => {
    expect(describeMerge(counts)).not.toMatch(/flagged/i);
  });

  it("tells you when confirmed strings were saved as flagged drafts", () => {
    const text = describeMerge({ ...counts, flaggedForGameCodes: 3 });
    expect(text).toContain("3 confirmed translation(s) had game codes that don't match the original");
    expect(text).toContain("see Flagged");
  });
});

// All three screens that merge a file must use this one wording; one that wrote
// its own sentence (as the Welcome screen once did) could leave things out.
const sources = import.meta.glob(["./App.tsx", "./WelcomeScreen.tsx", "./CollaborationPanel.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the three places that merge a shared file", () => {
  it.each(["./App.tsx", "./WelcomeScreen.tsx", "./CollaborationPanel.tsx"])("%s uses describeMerge and writes no merge sentence of its own", (file) => {
    const text = sources[file];
    expect(text, file).toBeTruthy();
    expect(text).toContain("describeMerge(");
    expect(text).not.toContain("skipped (");
  });
});