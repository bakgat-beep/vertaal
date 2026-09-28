import { describe, it, expect } from "vitest";
import { checkTokenIntegrity } from "./tokenIntegrity";

describe("checkTokenIntegrity", () => {
  it("a clean translation (all codes present, word order changed) has no issues", () => {
    expect(checkTokenIntegrity("Hello $NAME$, welcome to [GetCapital]!", "Welkom by [GetCapital], $NAME$!")).toEqual(
      []
    );
  });

  it("a source with no protected codes never has issues", () => {
    expect(checkTokenIntegrity("Just plain text.", "Enige teks hier, glad nie dieselfde nie.")).toEqual([]);
  });

  it("catches a dropped code", () => {
    const issues = checkTokenIntegrity("You gained $AMOUNT$ gold.", "Jy het goud verdien.");
    expect(issues).toEqual([{ token: "$AMOUNT$", expectedCount: 1, foundCount: 0 }]);
  });

  it("catches a duplicated code", () => {
    const issues = checkTokenIntegrity("$NAME$ says hello.", "$NAME$ $NAME$ groet.");
    expect(issues).toEqual([{ token: "$NAME$", expectedCount: 1, foundCount: 2 }]);
  });

  it("catches a code repeated in the source but only translated once", () => {
    const issues = checkTokenIntegrity("$AMOUNT$ gold, then $AMOUNT$ more.", "$AMOUNT$ goud.");
    expect(issues).toEqual([{ token: "$AMOUNT$", expectedCount: 2, foundCount: 1 }]);
  });

  it("catches a game's own \\n line break going missing", () => {
    const issues = checkTokenIntegrity("First line.\\nSecond line.", "Net een lyn, geen breek nie.");
    expect(issues).toEqual([{ token: "\\n", expectedCount: 1, foundCount: 0 }]);
  });

  it("reports each distinct missing/duplicated code separately", () => {
    const issues = checkTokenIntegrity("$NAME$ has [GetGold] gold.", "Iemand het geld.");
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.token).sort()).toEqual(["$NAME$", "[GetGold]"]);
  });
});