import { describe, it, expect } from "vitest";
import { checkExportMatchesProject } from "./exportCheck";

const project = { game_id: "eu5", target_language: "afrikaans" };
const good = { format_version: 1, game_id: "eu5", target_language: "afrikaans", translations: [], glossary: [] };

describe("checkExportMatchesProject", () => {
  it("accepts a matching export", () => {
    expect(checkExportMatchesProject(good, project)).toBeNull();
  });

  it("accepts a matching export from before the glossary field existed", () => {
    const { glossary: _unused, ...noGlossary } = good;
    void _unused;
    expect(checkExportMatchesProject(noGlossary, project)).toBeNull();
  });

  it("ignores letter case in the language name", () => {
    expect(checkExportMatchesProject({ ...good, target_language: "Afrikaans" }, project)).toBeNull();
  });

  it("rejects a file for a different game or mod", () => {
    expect(checkExportMatchesProject({ ...good, game_id: "ck3" }, project)).toMatch(/"ck3".*"eu5"/);
    expect(checkExportMatchesProject({ ...good, game_id: "eu5:mod:x" }, project)).not.toBeNull();
  });

  it("rejects a file for a different language", () => {
    expect(checkExportMatchesProject({ ...good, target_language: "dutch" }, project)).toMatch(/dutch/);
  });

  it("rejects something that isn't an export at all", () => {
    expect(checkExportMatchesProject(null, project)).not.toBeNull();
    expect(checkExportMatchesProject([], project)).not.toBeNull();
    expect(checkExportMatchesProject({ hello: "world" }, project)).not.toBeNull();
    expect(checkExportMatchesProject({ ...good, translations: "nope" }, project)).not.toBeNull();
  });

  it("rejects a file from a newer export format", () => {
    expect(checkExportMatchesProject({ ...good, format_version: 3 }, project)).toMatch(/newer version/);
    expect(checkExportMatchesProject({ ...good, format_version: 2 }, project)).toBeNull();
  });
});

describe("every record is checked before anything is merged", () => {
  const row = { key: "k", source_text: "S", translated_text: "T", status: "human-confirmed", translated_by: null, updated_at: null };
  it("accepts well-formed records", () => {
    expect(checkExportMatchesProject({ ...good, translations: [row] }, project)).toBeNull();
  });
  it("rejects a record with no key", () => {
    expect(checkExportMatchesProject({ ...good, translations: [row, { ...row, key: undefined }] }, project)).toMatch(/translation #2/);
  });
  it("rejects translated text that is not text", () => {
    expect(checkExportMatchesProject({ ...good, translations: [{ ...row, translated_text: 5 }] }, project)).not.toBeNull();
  });
  it("rejects a missing or unknown status", () => {
    expect(checkExportMatchesProject({ ...good, translations: [{ ...row, status: undefined }] }, project)).not.toBeNull();
    expect(checkExportMatchesProject({ ...good, translations: [{ ...row, status: "bogus" }] }, project)).not.toBeNull();
  });
  it("rejects a non-object entry", () => {
    expect(checkExportMatchesProject({ ...good, translations: [row, null] }, project)).not.toBeNull();
  });
  it("rejects a damaged glossary term", () => {
    expect(checkExportMatchesProject({ ...good, glossary: [{ english_term: "", translated_term: "x" }] }, project)).not.toBeNull();
    expect(checkExportMatchesProject({ ...good, glossary: [{ english_term: "a", translated_term: 3 }] }, project)).not.toBeNull();
  });
});