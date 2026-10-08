import { describe, it, expect } from "vitest";
import { restoreOuterSpacing, describeChattyReply } from "./replyCheck";

describe("restoreOuterSpacing", () => {
  it("puts back the spaces a game string started and ended with", () => {
    expect(restoreOuterSpacing("Gold: ", "Goud:")).toBe("Goud: ");
    expect(restoreOuterSpacing("  - Item", "- Item")).toBe("  - Item");
  });
  it("removes stray padding and line breaks the reply added when the source had none", () => {
    expect(restoreOuterSpacing("Hello", "  Hallo \n")).toBe("Hallo");
  });
  it("leaves an empty reply empty", () => {
    expect(restoreOuterSpacing(" ", "   ")).toBe("");
  });
});

describe("describeChattyReply", () => {
  it("accepts an ordinary translation", () => {
    expect(describeChattyReply("The war ended.", "Die oorlog het geëindig.")).toBeNull();
  });
  it("accepts a translation that contains game tokens", () => {
    expect(describeChattyReply("Gain __TOKEN_0__ gold", "Kry __TOKEN_0__ goud")).toBeNull();
  });
  it.each([
    ["Here is the translation: Hallo", /introduction/],
    ["Sure! Hallo", /introduction/],
    ["Translation: Hallo", /introduction/],
    ["```\nHallo\n```", /code block/],
    ["Hallo\n\nNote: this is informal.", /several lines/],
    ['"Hallo"', /quotation/],
  ])("rejects %j", (reply, reason) => {
    expect(describeChattyReply("Hello", reply)).toMatch(reason);
  });
  it("does not object when the source itself is quoted or starts like that", () => {
    expect(describeChattyReply('"Hello"', '"Hallo"')).toBeNull();
    expect(describeChattyReply("Here is the way", "Hier is die pad")).toBeNull();
  });
});