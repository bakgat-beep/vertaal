import { describe, it, expect } from "vitest";
import { splitByGameCodes } from "./exportGuard";

// Stage 6: at export time, every confirmed string is checked once more against
// its source text with the same game-code check the Verify button uses.

const row = (key: string, source_text: string, translated_text: string) => ({ key, source_text, translated_text });

describe("splitByGameCodes", () => {
  it("lets strings through when every game code matches", () => {
    const rows = [row("a", "You gain $GOLD$ and [GetName]", "Jy kry $GOLD$ en [GetName]"), row("b", "Hello", "Hallo")];
    const { clean, heldBack } = splitByGameCodes(rows);
    expect(clean).toEqual(rows);
    expect(heldBack).toEqual([]);
  });

  it("holds back a string that lost a code, gained one, or repeated one", () => {
    const lost = row("lost", "You gain $GOLD$", "Jy kry goud");
    const repeated = row("repeated", "You gain $GOLD$", "Jy kry $GOLD$ $GOLD$");
    const extra = row("extra", "Hello", "Hallo $GOLD$"); // source has no codes, but the check only compares codes found in the source
    const ok = row("ok", "You gain $GOLD$", "Jy kry $GOLD$");
    const { clean, heldBack } = splitByGameCodes([lost, repeated, ok, extra]);
    expect(heldBack.map((r) => r.key)).toEqual(["lost", "repeated"]);
    expect(clean.map((r) => r.key)).toEqual(["ok", "extra"]);
  });

  it("keeps the original order and extra fields of the rows", () => {
    const rows = [
      { key: "1", source_text: "A $X$", translated_text: "B $X$", file_path: "f1" },
      { key: "2", source_text: "A $X$", translated_text: "B", file_path: "f2" },
    ];
    const { clean, heldBack } = splitByGameCodes(rows);
    expect(clean[0].file_path).toBe("f1");
    expect(heldBack[0].file_path).toBe("f2");
  });

  it("copes with an empty list", () => {
    expect(splitByGameCodes([])).toEqual({ clean: [], heldBack: [] });
  });
});